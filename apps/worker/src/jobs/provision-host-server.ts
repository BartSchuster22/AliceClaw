import { Worker } from 'bullmq';
import { and, eq, isNull, lt } from 'drizzle-orm';
import type IORedis from 'ioredis';

import { db } from '@psi/db';
import { hostProvisionAttempts, hostServers, serverScaleEvents, serverTemplates } from '@psi/db/schema';

import { closeRedisConnection, createRedisConnection } from '../lib/redis.js';
import { runSingleProviderProvisionAttempt } from '../provisioning/execution/host-provision-attempt-runner.js';
import { buildSingleCandidateHostProvisionPlan } from '../provisioning/plan/host-placement-planner.js';
import { getHostServerProvider } from '../providers/index.js';

export type ProvisionHostServerJobPayload = {
  scaleEventId: string;
};

export type ProvisionHostServerWorkerRuntime = {
  worker: Worker<ProvisionHostServerJobPayload>;
  close: () => Promise<void>;
};

function getProvisionAttemptStaleMs() {
  return Number(process.env.HOST_PROVISION_ATTEMPT_STALE_MS ?? 300_000);
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

      const plan = await buildSingleCandidateHostProvisionPlan({
        scaleEventId: scaleEvent.id,
        activeTemplate,
      });

      const primaryCandidate = plan.candidates[0];
      if (!primaryCandidate) {
        throw new Error('Provision plan produced no candidates');
      }

      const sshKeyRefs = await hostServerProvider.ensureSshKeyRefs({
        sshPublicKeys,
        keyNamePrefix: 'psi-host-key',
      });

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
        await runSingleProviderProvisionAttempt({
          provider: hostServerProvider,
          scaleEventId: scaleEvent.id,
          attemptId: attempt.id,
          workerRunId,
          serverName,
          activeTemplate: {
            ...activeTemplate,
            provider: primaryCandidate.provider,
            region: primaryCandidate.region,
            instanceType: primaryCandidate.instanceType,
          },
          sshKeyRefs,
          cloudInitScript,
        });
      } catch (error) {
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
