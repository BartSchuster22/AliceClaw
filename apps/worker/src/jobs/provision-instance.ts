import { Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import type IORedis from 'ioredis';

import { db } from '@psi/db';
import {
  onboardingSessions,
  orders,
  products,
  provisioningJobs,
  subscriptions,
  vpsInstances,
} from '@psi/db/schema';

import { getHostServerProvider } from '../providers/index.js';
import { createRedisConnection, closeRedisConnection } from '../lib/redis.js';
import { notificationService } from '../services/notification-service.js';

export type ProvisionInstanceJobPayload = {
  subscriptionId: string;
  vpsInstanceId: string;
  jobId: string;
};

export type ProvisionInstanceWorkerRuntime = {
  worker: Worker<ProvisionInstanceJobPayload>;
  close: () => Promise<void>;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getProvisioningPublicKey() {
  const key = process.env.PROVISIONING_SSH_PUBLIC_KEY;

  if (key) {
    return key;
  }

  return null;
}

function getProvisioningPreflightError() {
  if (!process.env.PROVISIONING_SSH_PUBLIC_KEY) {
    return 'Provisioning is not configured: PROVISIONING_SSH_PUBLIC_KEY is missing';
  }

  if (!process.env.POSTMARK_API_TOKEN) {
    return 'Provisioning is not configured: POSTMARK_API_TOKEN is missing';
  }

  if (!process.env.POSTMARK_FROM_EMAIL) {
    return 'Provisioning is not configured: POSTMARK_FROM_EMAIL is missing';
  }

  return null;
}

async function appendJobLog(jobId: string, line: string) {
  const [job] = await db
    .select({ logLines: provisioningJobs.logLines })
    .from(provisioningJobs)
    .where(eq(provisioningJobs.id, jobId))
    .limit(1);

  const current = job?.logLines ?? [];

  await db
    .update(provisioningJobs)
    .set({
      logLines: [...current, line],
    })
    .where(eq(provisioningJobs.id, jobId));
}

async function updateStep(params: {
  vpsInstanceId: string;
  jobId: string;
  vpsStatus: typeof vpsInstances.$inferInsert.status;
  currentStep: string;
  logLine: string;
}) {
  await db
    .update(vpsInstances)
    .set({ status: params.vpsStatus })
    .where(eq(vpsInstances.id, params.vpsInstanceId));

  await db
    .update(provisioningJobs)
    .set({ currentStep: params.currentStep })
    .where(eq(provisioningJobs.id, params.jobId));

  await appendJobLog(params.jobId, params.logLine);
}

async function markFailed(params: { vpsInstanceId?: string; jobId?: string; errorMessage: string }) {
  if (params.vpsInstanceId) {
    await db
      .update(vpsInstances)
      .set({ status: 'failed' })
      .where(eq(vpsInstances.id, params.vpsInstanceId));
  }

  if (params.jobId) {
    await db
      .update(provisioningJobs)
      .set({
        status: 'failed',
        errorMessage: params.errorMessage,
        finishedAt: new Date(),
      })
      .where(eq(provisioningJobs.id, params.jobId));

    await appendJobLog(params.jobId, `ERROR: ${params.errorMessage}`);
  }

  console.error('[provision-instance]', params.errorMessage, {
    jobId: params.jobId ?? null,
    vpsInstanceId: params.vpsInstanceId ?? null,
  });
}

export function createProvisionInstanceWorker(): ProvisionInstanceWorkerRuntime {
  const hostServerProvider = getHostServerProvider();
  const workerConnection = createRedisConnection('worker');
  const connectionPool = new Set<IORedis>([workerConnection]);

  const worker = new Worker<ProvisionInstanceJobPayload>(
    'provision-instance',
    async (job) => {
      const { subscriptionId, vpsInstanceId, jobId } = job.data;

      console.log('[worker][job] received', {
        bullmqJobId: job.id,
        subscriptionId: subscriptionId ?? null,
        vpsInstanceId: vpsInstanceId ?? null,
        jobId: jobId ?? null,
      });

      if (!subscriptionId || !vpsInstanceId || !jobId) {
        throw new Error('Provision job payload is missing required identifiers');
      }

      try {
        await db
          .update(provisioningJobs)
          .set({ status: 'running', startedAt: new Date() })
          .where(eq(provisioningJobs.id, jobId));

        const preflightError = getProvisioningPreflightError();
        if (preflightError) {
          await db
            .update(provisioningJobs)
            .set({ currentStep: 'blocked_configuration' })
            .where(eq(provisioningJobs.id, jobId));

          await appendJobLog(jobId, `BLOCKED: ${preflightError}`);
          throw new Error(preflightError);
        }

        await updateStep({
          vpsInstanceId,
          jobId,
          vpsStatus: 'creating_server',
          currentStep: 'creating_server',
          logLine: 'STEP 1: creating_server',
        });

        const [vpsInstance] = await db
          .select()
          .from(vpsInstances)
          .where(eq(vpsInstances.id, vpsInstanceId))
          .limit(1);

        if (!vpsInstance) {
          throw new Error('VPS instance not found');
        }

        let providerId = vpsInstance.providerInstanceId;
        let ip = vpsInstance.ipAddress;

        if (!providerId) {
          const [subscription] = await db
            .select()
            .from(subscriptions)
            .where(eq(subscriptions.id, subscriptionId))
            .limit(1);

          if (!subscription) {
            throw new Error('Subscription not found');
          }

          const [product] = await db
            .select()
            .from(products)
            .where(eq(products.id, subscription.productId))
            .limit(1);

          if (!product) {
            throw new Error('Product not found');
          }

          const [order] = await db
            .select()
            .from(orders)
            .where(eq(orders.id, subscription.orderId))
            .limit(1);

          if (!order) {
            throw new Error('Order not found');
          }

          const [onboardingSession] = await db
            .select()
            .from(onboardingSessions)
            .where(eq(onboardingSessions.orderId, order.id))
            .limit(1);

          const provisioningPublicKey = getProvisioningPublicKey();
          const sshPublicKeys = [provisioningPublicKey, onboardingSession?.sshPublicKey].filter(
            (value): value is string => Boolean(value),
          );

          const created = await hostServerProvider.provisionHostServer({
            name: `psi-${subscriptionId}`,
            instanceType: `${product.slug}-placeholder`,
            region: vpsInstance.region,
            sshPublicKeys,
            cloudInitScript: '# mock cloud-init placeholder',
          });

          providerId = created.providerId;
          ip = created.ipAddress;

          await db
            .update(vpsInstances)
            .set({
              providerInstanceId: providerId,
              status: 'creating_server',
            })
            .where(eq(vpsInstances.id, vpsInstanceId));
        } else {
          await appendJobLog(jobId, 'Provider host already exists, skipping provisionHostServer');
        }

        await updateStep({
          vpsInstanceId,
          jobId,
          vpsStatus: 'server_ready',
          currentStep: 'server_ready',
          logLine: 'STEP 2: server_ready polling started',
        });

        let status: 'starting' | 'running' | 'error' = 'starting';
        for (let attempt = 1; attempt <= 40; attempt += 1) {
          status = await hostServerProvider.getHostServerStatus(providerId!);
          if (status === 'running') {
            await db
              .update(vpsInstances)
              .set({ ipAddress: ip, status: 'server_ready' })
              .where(eq(vpsInstances.id, vpsInstanceId));
            await appendJobLog(jobId, `Server reached running state on attempt ${attempt}`);
            break;
          }
          if (status === 'error') {
            throw new Error('Server entered error state');
          }
          await sleep(5000);
        }

        if (status !== 'running') {
          throw new Error('Timed out waiting for server to become running');
        }

        await updateStep({
          vpsInstanceId,
          jobId,
          vpsStatus: 'provisioning',
          currentStep: 'provisioning',
          logLine: 'STEP 3: provisioning',
        });

        await sleep(5000);
        await appendJobLog(jobId, 'PSI install complete (mock)');

        await db
          .update(vpsInstances)
          .set({ status: 'completed' })
          .where(eq(vpsInstances.id, vpsInstanceId));

        await db
          .update(provisioningJobs)
          .set({ status: 'completed', finishedAt: new Date(), currentStep: 'completed' })
          .where(eq(provisioningJobs.id, jobId));

        await appendJobLog(jobId, 'STEP 4: completed');

        await db
          .update(subscriptions)
          .set({ status: 'active' })
          .where(eq(subscriptions.id, subscriptionId));

        const [subscription] = await db
          .select({ userId: subscriptions.userId })
          .from(subscriptions)
          .where(eq(subscriptions.id, subscriptionId))
          .limit(1);

        if (!subscription || !ip) {
          throw new Error('Missing delivery context');
        }

        await notificationService.sendAgentReadyEmail({
          userId: subscription.userId,
          productName: 'PSI Agent',
          agentUrl: `http://${ip}:8080`,
        });
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown provisioning error';
        await markFailed({ vpsInstanceId, jobId, errorMessage: message });
        throw error;
      } finally {
      }
    },
    {
      connection: workerConnection,
      concurrency: 1,
      createClient(type, redisOpts) {
        const client = new (workerConnection.constructor as typeof IORedis)({
          ...redisOpts,
          maxRetriesPerRequest: null,
        });

        connectionPool.add(client);
        return client;
      },
    },
  );

  worker.on('error', (error) => {
    console.error('[worker][bullmq] worker error', error.message);
  });

  return {
    worker,
    async close() {
      await worker.close();
      await Promise.all([...connectionPool].map((connection) => closeRedisConnection(connection)));
      connectionPool.clear();
    },
  };
}
