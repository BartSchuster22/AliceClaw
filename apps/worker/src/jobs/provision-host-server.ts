import { Worker } from 'bullmq';
import { and, eq, isNull, lt } from 'drizzle-orm';
import type IORedis from 'ioredis';

import { db } from '@psi/db';
import { hostProvisionAttempts, hostServers, serverScaleEvents, serverTemplates } from '@psi/db/schema';

import { closeRedisConnection, createRedisConnection } from '../lib/redis.js';
import { getHostServerProvider } from '../providers/index.js';

export type ProvisionHostServerJobPayload = {
  scaleEventId: string;
};

export type ProvisionHostServerWorkerRuntime = {
  worker: Worker<ProvisionHostServerJobPayload>;
  close: () => Promise<void>;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function getStatusPollIntervalMs() {
  return Number(process.env.HOST_PROVIDER_STATUS_POLL_INTERVAL_MS ?? 10_000);
}

function getStatusPollMaxAttempts() {
  return Number(process.env.HOST_PROVIDER_STATUS_POLL_MAX_ATTEMPTS ?? 60);
}

function getReadyStabilizationDelayMs() {
  return Number(process.env.HOST_PROVIDER_READY_STABILIZATION_DELAY_MS ?? 45_000);
}

function getProvisionAttemptStaleMs() {
  return Number(process.env.HOST_PROVISION_ATTEMPT_STALE_MS ?? 300_000);
}

async function heartbeatAttempt(attemptId: string, workerRunId: string) {
  await db
    .update(hostProvisionAttempts)
    .set({
      lastHeartbeatAt: new Date(),
      workerRunId,
    })
    .where(eq(hostProvisionAttempts.id, attemptId));
}

export async function reconcileStaleHostProvisionAttempts(workerRunId: string) {
  const staleBefore = new Date(Date.now() - getProvisionAttemptStaleMs());
  const failureReason = 'Provisioning interrupted or stale after worker restart';

  const staleAttempts = await db
    .select()
    .from(hostProvisionAttempts)
    .where(eq(hostProvisionAttempts.status, 'running'));

  for (const attempt of staleAttempts) {
    const belongsToOlderRun = attempt.workerRunId != null && attempt.workerRunId !== workerRunId;
    const isStaleByHeartbeat = attempt.lastHeartbeatAt < staleBefore;

    if (!belongsToOlderRun && !isStaleByHeartbeat) {
      continue;
    }

    if (attempt.hostServerId) {
      await db
        .update(hostServers)
        .set({
          status: 'failed',
          readyAt: null,
        })
        .where(and(eq(hostServers.id, attempt.hostServerId), eq(hostServers.status, 'provisioning')));
    }

    await db
      .update(serverScaleEvents)
      .set({
        status: 'failed',
        failedReason: failureReason,
      })
      .where(and(eq(serverScaleEvents.id, attempt.scaleEventId), eq(serverScaleEvents.status, 'provisioning')));

    await db
      .update(hostProvisionAttempts)
      .set({
        status: 'failed',
        failureReason,
        finishedAt: new Date(),
      })
      .where(eq(hostProvisionAttempts.id, attempt.id));
  }

  const legacyStaleScaleEvents = await db
    .select()
    .from(serverScaleEvents)
    .where(and(eq(serverScaleEvents.status, 'provisioning'), lt(serverScaleEvents.createdAt, staleBefore)));

  for (const scaleEvent of legacyStaleScaleEvents) {
    const [legacyHost] = await db
      .select()
      .from(hostServers)
      .where(and(eq(hostServers.status, 'provisioning'), isNull(hostServers.readyAt)))
      .orderBy(hostServers.createdAt)
      .limit(1);

    if (legacyHost) {
      await db
        .update(hostServers)
        .set({
          status: 'failed',
          readyAt: null,
        })
        .where(eq(hostServers.id, legacyHost.id));
    }

    await db
      .update(serverScaleEvents)
      .set({
        status: 'failed',
        failedReason: failureReason,
      })
      .where(eq(serverScaleEvents.id, scaleEvent.id));
  }
}

function buildHostCloudInit(params: { sshPublicKeys: string[]; prePullImages: string[] }) {
  const authorizedKeys = params.sshPublicKeys.map((key) => `      - ${key}`).join('\n');
  const prePullCommands = params.prePullImages.filter(Boolean).map((image) => `docker pull ${image}`);
  const portRangeStart = Number(process.env.HOST_AGENT_PORT_RANGE_START ?? 3000);
  const portRangeEnd = Number(process.env.HOST_AGENT_PORT_RANGE_END ?? 3500);

  return `#cloud-config
package_update: true
package_upgrade: true
packages:
  - docker.io
  - docker-compose-plugin
  - fail2ban
  - ufw
users:
  - name: openclaw
    groups: docker, sudo
    shell: /bin/bash
    sudo: ALL=(ALL) NOPASSWD:ALL
    ssh_authorized_keys:
${authorizedKeys || '      []'}
ssh_pwauth: false
runcmd:
  - systemctl enable docker
  - systemctl start docker
  - ufw allow 22/tcp
  - ufw allow ${portRangeStart}:${portRangeEnd}/tcp
  - ufw --force enable
  - mkdir -p /opt/openclaw
${prePullCommands.map((command) => `  - ${command}`).join('\n')}
`;
}

export function createProvisionHostServerWorker(): ProvisionHostServerWorkerRuntime {
  const hostServerProvider = getHostServerProvider();
  const workerConnection = createRedisConnection('provision-host-server-worker');
  const connectionPool = new Set<IORedis>([workerConnection]);

  const worker = new Worker<ProvisionHostServerJobPayload>(
    'provision-host-server',
    async (job) => {
      const { scaleEventId } = job.data;
      if (!scaleEventId) {
        throw new Error('Provision host server job missing scaleEventId');
      }

      const [scaleEvent] = await db
        .select()
        .from(serverScaleEvents)
        .where(eq(serverScaleEvents.id, scaleEventId))
        .limit(1);

      if (!scaleEvent || scaleEvent.status !== 'triggered') {
        return;
      }

      await db
        .update(serverScaleEvents)
        .set({ status: 'provisioning' })
        .where(eq(serverScaleEvents.id, scaleEvent.id));

      const [activeTemplate] = await db
        .select()
        .from(serverTemplates)
        .where(eq(serverTemplates.isActive, true))
        .limit(1);

      if (!activeTemplate) {
        throw new Error('No active server template');
      }

      const serverName = `host-${activeTemplate.region}-${Date.now()}`;
      const sshPublicKey = process.env.PROVISIONING_SSH_PUBLIC_KEY;
      const sshPublicKeys = sshPublicKey ? [sshPublicKey] : [];
      const prePullImages = (process.env.AGENT_IMAGES ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean);

      const cloudInitScript = buildHostCloudInit({
        sshPublicKeys,
        prePullImages,
      });

      const sshKeyRefs = await hostServerProvider.ensureSshKeyRefs({
        sshPublicKeys,
        keyNamePrefix: 'psi-host-key',
      });

      let createdHostRecordId: string | null = null;
      let createdProviderId: string | null = null;

      const workerRunId = process.env.WORKER_RUN_ID ?? `worker-run-${process.pid}`;

      const [attempt] = await db
        .insert(hostProvisionAttempts)
        .values({
          scaleEventId: scaleEvent.id,
          workerRunId,
          status: 'running',
        })
        .returning();

      try {
        const created = await hostServerProvider.provisionHostServer({
          name: serverName,
          instanceType: activeTemplate.instanceType,
          region: activeTemplate.region,
          sshKeyRefs,
          cloudInitScript,
        });

        createdProviderId = created.providerId;

        await db
          .update(hostProvisionAttempts)
          .set({
            providerInstanceId: created.providerId,
            workerRunId,
            lastHeartbeatAt: new Date(),
          })
          .where(eq(hostProvisionAttempts.id, attempt.id));

        const reservedCpuMillicores = Math.floor(
          activeTemplate.expectedCpuMillicores * (activeTemplate.managementOverheadPercent / 100),
        );
        const reservedMemoryMb = Math.floor(
          activeTemplate.expectedMemoryMb * (activeTemplate.managementOverheadPercent / 100),
        );
        const reservedDiskGb = Math.floor(
          activeTemplate.expectedDiskGb * (activeTemplate.managementOverheadPercent / 100),
        );

        const [host] = await db
          .insert(hostServers)
          .values({
            name: serverName,
            provider: activeTemplate.provider,
            providerInstanceId: created.providerId,
            region: activeTemplate.region,
            ipAddress: created.ipAddress,
            instanceType: activeTemplate.instanceType,
            totalCpuMillicores: activeTemplate.expectedCpuMillicores,
            totalMemoryMb: activeTemplate.expectedMemoryMb,
            totalDiskGb: activeTemplate.expectedDiskGb,
            reservedCpuMillicores,
            reservedMemoryMb,
            reservedDiskGb,
            status: 'provisioning',
            capacityThresholdPercent: activeTemplate.capacityThresholdPercent,
          })
          .returning();

        createdHostRecordId = host.id;

        await db
          .update(hostProvisionAttempts)
          .set({
            hostServerId: host.id,
            workerRunId,
            lastHeartbeatAt: new Date(),
          })
          .where(eq(hostProvisionAttempts.id, attempt.id));

        let providerStatus: 'creating' | 'starting' | 'running' | 'deleting' | 'deleted' | 'error' | 'unknown' = 'creating';
        for (let pollAttempt = 1; pollAttempt <= getStatusPollMaxAttempts(); pollAttempt += 1) {
          await heartbeatAttempt(attempt.id, workerRunId);
          const providerDetails = await hostServerProvider.getHostServerDetails(created.providerId);
          providerStatus = providerDetails.lifecycleStatus;

          if (!providerDetails.exists || providerStatus === 'deleted') {
            throw new Error('Host provider reported server missing during provisioning');
          }

          if (providerDetails.ipAddress && providerDetails.ipAddress !== host.ipAddress) {
            await db
              .update(hostServers)
              .set({ ipAddress: providerDetails.ipAddress })
              .where(eq(hostServers.id, host.id));
          }

          if (providerStatus === 'running') {
            break;
          }
          if (providerStatus === 'error' || providerStatus === 'unknown' || providerStatus === 'deleting') {
            throw new Error(`Host provider returned terminal state: ${providerStatus}`);
          }
          await sleep(getStatusPollIntervalMs());
        }

        if (providerStatus !== 'running') {
          throw new Error('ProvisionTimeoutError');
        }

        await sleep(getReadyStabilizationDelayMs());

        await db
          .update(hostServers)
          .set({
            status: 'ready',
            readyAt: new Date(),
          })
          .where(eq(hostServers.id, host.id));

        await db
          .update(serverScaleEvents)
          .set({
            newHostServerId: host.id,
            status: 'ready',
            completedAt: new Date(),
          })
          .where(eq(serverScaleEvents.id, scaleEvent.id));

        await db
          .update(hostProvisionAttempts)
          .set({
            status: 'completed',
            cleanupStatus: 'not_required',
            finishedAt: new Date(),
            lastHeartbeatAt: new Date(),
          })
          .where(eq(hostProvisionAttempts.id, attempt.id));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        let cleanupStatus = 'not_started';

        if (createdProviderId) {
          cleanupStatus = 'in_progress';
          try {
            await hostServerProvider.deleteHostServer(createdProviderId);
            cleanupStatus = 'completed';
          } catch (cleanupError) {
            cleanupStatus = 'failed';
            console.error('[provision-host-server] cleanup failed', cleanupError);
          }
        }

        if (createdHostRecordId) {
          await db
            .update(hostServers)
            .set({
              status: 'failed',
              readyAt: null,
            })
            .where(eq(hostServers.id, createdHostRecordId));
        }

        await db
          .update(serverScaleEvents)
          .set({
            status: 'failed',
            failedReason: message,
          })
          .where(eq(serverScaleEvents.id, scaleEvent.id));

        await db
          .update(hostProvisionAttempts)
          .set({
            status: 'failed',
            failureReason: message,
            cleanupStatus,
            finishedAt: new Date(),
            lastHeartbeatAt: new Date(),
          })
          .where(eq(hostProvisionAttempts.id, attempt.id));

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
      await Promise.all([...connectionPool].map((connection) => closeRedisConnection(connection)));
      connectionPool.clear();
    },
  };
}
