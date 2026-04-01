import { Queue, Worker } from 'bullmq';
import { desc, eq } from 'drizzle-orm';
import type IORedis from 'ioredis';

import { db } from '@psi/db';
import {
  containerInstances,
  hostServers,
  productDefinitions,
  provisioningJobs,
  subscriptions,
} from '@psi/db/schema';

import { closeRedisConnection, createRedisConnection } from '../lib/redis.js';
import { getDockerAdapter } from '../providers/docker-adapter.js';
import { slotAllocator } from '../services/slot-allocator.js';
import { notificationService } from '../services/notification-service.js';

export type DeployContainerJobPayload = {
  containerInstanceId: string;
  capacityWaitCount?: number;
};

export type DeployContainerWorkerRuntime = {
  worker: Worker<DeployContainerJobPayload>;
  close: () => Promise<void>;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveEnvTemplate(template: Record<string, string>, vars: Record<string, string>) {
  return Object.fromEntries(
    Object.entries(template).map(([key, value]) => [
      key,
      value.replace(/{{\s*([a-zA-Z0-9_]+)\s*}}/g, (_match, tokenName: string) => {
        const resolved = vars[tokenName];
        if (resolved == null) {
          throw new Error(`MissingEnvTemplateVariableError:${tokenName}`);
        }
        return resolved;
      }),
    ]),
  );
}

async function appendJobLog(jobId: string, line: string) {
  const [job] = await db
    .select({ logLines: provisioningJobs.logLines })
    .from(provisioningJobs)
    .where(eq(provisioningJobs.id, jobId))
    .limit(1);

  await db
    .update(provisioningJobs)
    .set({
      logLines: [...(job?.logLines ?? []), line],
    })
    .where(eq(provisioningJobs.id, jobId));
}

async function getOrCreateProvisioningJob(containerInstanceId: string, subscriptionId: string) {
  const [existingRunningJob] = await db
    .select()
    .from(provisioningJobs)
    .where(eq(provisioningJobs.containerInstanceId, containerInstanceId))
    .orderBy(desc(provisioningJobs.createdAt))
    .limit(1);

  if (existingRunningJob && ['queued', 'running'].includes(existingRunningJob.status)) {
    return existingRunningJob;
  }

  const [createdJob] = await db
    .insert(provisioningJobs)
    .values({
      containerInstanceId,
      subscriptionId,
      status: 'queued',
      currentStep: 'waiting_for_deploy',
      logLines: [],
      errorMessage: null,
      retryCount: 0,
      startedAt: null,
      finishedAt: null,
    })
    .returning();

  return createdJob;
}

async function markFailed(containerInstanceId: string, jobId: string, errorMessage: string) {
  await db
    .update(containerInstances)
    .set({
      status: 'failed',
      failureReason: errorMessage,
    })
    .where(eq(containerInstances.id, containerInstanceId));

  await db
    .update(provisioningJobs)
    .set({
      status: 'failed',
      errorMessage,
      finishedAt: new Date(),
    })
    .where(eq(provisioningJobs.id, jobId));

  await appendJobLog(jobId, `ERROR: ${errorMessage}`);
}

export function createDeployContainerWorker(): DeployContainerWorkerRuntime {
  const dockerAdapter = getDockerAdapter();
  const workerConnection = createRedisConnection('deploy-container-worker');
  const requeueConnection = createRedisConnection('deploy-container-requeue');
  const requeueQueue = new Queue<DeployContainerJobPayload>('deploy-container', { connection: requeueConnection });
  const connectionPool = new Set<IORedis>([workerConnection, requeueConnection]);

  const worker = new Worker<DeployContainerJobPayload>(
    'deploy-container',
    async (job) => {
      const { containerInstanceId, capacityWaitCount = 0 } = job.data;
      if (!containerInstanceId) {
        throw new Error('Deploy container job payload missing containerInstanceId');
      }

      const [containerInstance] = await db
        .select()
        .from(containerInstances)
        .where(eq(containerInstances.id, containerInstanceId))
        .limit(1);

      if (!containerInstance) {
        throw new Error(`Container instance not found: ${containerInstanceId}`);
      }

      if (containerInstance.status === 'running') {
        return;
      }

      if (!['queued', 'allocating', 'deploying', 'starting', 'stopped'].includes(containerInstance.status)) {
        throw new Error(`Container instance ${containerInstanceId} is not deployable from status ${containerInstance.status}`);
      }

      const provisioningJob = await getOrCreateProvisioningJob(containerInstance.id, containerInstance.subscriptionId);

      try {
        await db
          .update(provisioningJobs)
          .set({ status: 'running', startedAt: new Date() })
          .where(eq(provisioningJobs.id, provisioningJob.id));

        const [subscription] = await db
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.id, containerInstance.subscriptionId))
          .limit(1);

        if (!subscription) {
          throw new Error(`Subscription not found: ${containerInstance.subscriptionId}`);
        }

        const [productDefinition] = await db
          .select()
          .from(productDefinitions)
          .where(eq(productDefinitions.id, containerInstance.productDefinitionId))
          .limit(1);

        if (!productDefinition || !productDefinition.active) {
          throw new Error('no_product_definition');
        }

        await db
          .update(containerInstances)
          .set({ status: 'allocating' })
          .where(eq(containerInstances.id, containerInstance.id));
        await db
          .update(provisioningJobs)
          .set({ currentStep: 'allocate-host' })
          .where(eq(provisioningJobs.id, provisioningJob.id));
        await appendJobLog(provisioningJob.id, 'STEP 1: allocate-host');

        let assignedHostId = containerInstance.hostServerId;
        let assignedPort = containerInstance.assignedPort;
        let containerName = containerInstance.containerName;

        if (!assignedHostId || !assignedPort || !containerName) {
          const host = await slotAllocator.findAvailableHost(productDefinition);

          if (!host) {
            const hasScaleOut = await slotAllocator.hasAnyActiveScaleOut();
            if (capacityWaitCount >= 10) {
              throw new Error('no_capacity_scale_timeout');
            }

            await db
              .update(containerInstances)
              .set({ status: 'queued' })
              .where(eq(containerInstances.id, containerInstance.id));
            await db
              .update(provisioningJobs)
              .set({ currentStep: hasScaleOut ? 'waiting_for_capacity' : 'waiting_for_scale_out' })
              .where(eq(provisioningJobs.id, provisioningJob.id));
            await appendJobLog(
              provisioningJob.id,
              hasScaleOut ? 'No capacity yet, scale-out already in progress' : 'No capacity available yet',
            );

            await requeueQueue.add(
              'deploy-container',
              {
                containerInstanceId: containerInstance.id,
                capacityWaitCount: capacityWaitCount + 1,
              },
              { delay: 60_000 },
            );

            return;
          }

          assignedHostId = host.id;
          assignedPort = await slotAllocator.assignPort(host.id);
          containerName = `agent-${subscription.id.slice(0, 8)}`;

          await db
            .update(containerInstances)
            .set({
              hostServerId: host.id,
              assignedPort,
              containerName,
              assignedCpuMillicores: productDefinition.cpuMillicores,
              assignedMemoryMb: productDefinition.memoryMb,
              assignedDiskGb: productDefinition.diskGb,
              status: 'deploying',
            })
            .where(eq(containerInstances.id, containerInstance.id));
        } else {
          await db
            .update(containerInstances)
            .set({ status: 'deploying' })
            .where(eq(containerInstances.id, containerInstance.id));
        }

        const [host] = await db.select().from(hostServers).where(eq(hostServers.id, assignedHostId)).limit(1);
        if (!host || !host.ipAddress) {
          throw new Error('assigned_host_not_ready');
        }

        const envVars = resolveEnvTemplate((productDefinition.envTemplate ?? {}) as Record<string, string>, {
          user_id: subscription.userId,
          subscription_id: subscription.id,
          container_name: containerName,
          host_ip: host.ipAddress,
        });

        const agentUrl = `http://${host.ipAddress}:${assignedPort}`;
        await appendJobLog(provisioningJob.id, 'STEP 2: deploy');

        const deployment = await dockerAdapter.deployContainer({
          hostIp: host.ipAddress,
          containerName,
          dockerImage: productDefinition.dockerImage,
          dockerTag: productDefinition.dockerTag,
          hostPort: assignedPort,
          containerPort: productDefinition.port,
          cpuMillicores: productDefinition.cpuMillicores,
          memoryMb: productDefinition.memoryMb,
          envVars,
          healthCheckPath: productDefinition.healthCheckPath,
        });

        await db
          .update(containerInstances)
          .set({
            containerId: deployment.containerId,
            agentUrl,
            status: 'starting',
          })
          .where(eq(containerInstances.id, containerInstance.id));

        await db
          .update(provisioningJobs)
          .set({ currentStep: 'starting' })
          .where(eq(provisioningJobs.id, provisioningJob.id));
        await appendJobLog(provisioningJob.id, 'STEP 3: starting');

        const startupDeadline = Date.now() + productDefinition.startupTimeoutSeconds * 1000;
        let runtimeStatus: 'running' | 'starting' | 'unhealthy' | 'stopped' | 'not_found' = 'starting';

        while (Date.now() < startupDeadline) {
          runtimeStatus = await dockerAdapter.getContainerStatus({
            hostIp: host.ipAddress,
            containerName,
          });

          if (runtimeStatus === 'running') {
            break;
          }

          if (runtimeStatus === 'unhealthy' || runtimeStatus === 'stopped' || runtimeStatus === 'not_found') {
            throw new Error(`deploy_failed:${runtimeStatus}`);
          }

          await sleep(5000);
        }

        if (runtimeStatus !== 'running') {
          throw new Error('DeployTimeoutError');
        }

        await db
          .update(containerInstances)
          .set({
            status: 'running',
            startedAt: new Date(),
            healthyAt: new Date(),
          })
          .where(eq(containerInstances.id, containerInstance.id));

        await slotAllocator.checkAndTriggerScaleOut(host.id).catch(async (error) => {
          await appendJobLog(
            provisioningJob.id,
            `Scale-out check failed: ${error instanceof Error ? error.message : String(error)}`,
          );
        });

        await notificationService.sendAgentReadyEmail({
          userId: subscription.userId,
          productName: 'PSI Agent',
          agentUrl,
        });

        await db
          .update(provisioningJobs)
          .set({
            status: 'completed',
            currentStep: 'completed',
            finishedAt: new Date(),
          })
          .where(eq(provisioningJobs.id, provisioningJob.id));
        await appendJobLog(provisioningJob.id, 'STEP 4: completed');
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        await markFailed(containerInstance.id, provisioningJob.id, message);
        throw error;
      }
    },
    {
      connection: workerConnection,
      concurrency: 1,
      createClient(_type, redisOpts) {
        const client = new (workerConnection.constructor as typeof IORedis)({
          ...redisOpts,
          maxRetriesPerRequest: null,
        });
        connectionPool.add(client);
        return client;
      },
    },
  );

  return {
    worker,
    async close() {
      await worker.close();
      await requeueQueue.close();
      await Promise.all([...connectionPool].map((connection) => closeRedisConnection(connection)));
      connectionPool.clear();
    },
  };
}
