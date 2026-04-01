import { Queue, Worker } from 'bullmq';
import { eq, inArray, isNull } from 'drizzle-orm';
import type IORedis from 'ioredis';

import { db } from '@psi/db';
import { adminAlerts, containerInstances } from '@psi/db/schema';

import { closeRedisConnection, createRedisConnection } from '../lib/redis.js';
import { getDockerAdapter } from '../providers/docker-adapter.js';

const MONITORED_STATUSES = ['starting', 'running', 'unhealthy'] as const;

type HealthCheckJobPayload = Record<string, never>;

async function createAlertIfMissing(params: {
  type: string;
  entityId: string;
  message: string;
  severity?: string;
  dedupeKey?: string;
}) {
  const [existing] = await db
    .select()
    .from(adminAlerts)
    .where(eq(adminAlerts.dedupeKey, params.dedupeKey ?? `${params.type}:${params.entityId}`))
    .limit(1);

  if (existing && !existing.resolvedAt) {
    return existing;
  }

  const [created] = await db
    .insert(adminAlerts)
    .values({
      type: params.type,
      severity: params.severity ?? 'warning',
      entityType: 'container_instance',
      entityId: params.entityId,
      message: params.message,
      dedupeKey: params.dedupeKey ?? `${params.type}:${params.entityId}`,
    })
    .returning();

  return created;
}

async function resolveAlertByDedupeKey(dedupeKey: string) {
  await db
    .update(adminAlerts)
    .set({ resolvedAt: new Date() })
    .where(eq(adminAlerts.dedupeKey, dedupeKey));
}

export type HealthCheckContainersWorkerRuntime = {
  worker: Worker<HealthCheckJobPayload>;
  close: () => Promise<void>;
};

export async function registerHealthCheckContainersJob() {
  const connection = createRedisConnection('health-check-containers-register');
  const queue = new Queue<HealthCheckJobPayload>('health-check-containers', { connection });

  try {
    await queue.upsertJobScheduler('repeat-health-check-containers', { every: 120000 }, { name: 'health-check-containers', data: {} });
  } finally {
    await queue.close();
    await closeRedisConnection(connection);
  }
}

export function createHealthCheckContainersWorker(): HealthCheckContainersWorkerRuntime {
  const dockerAdapter = getDockerAdapter();
  const workerConnection = createRedisConnection('health-check-containers-worker');
  const connectionPool = new Set<IORedis>([workerConnection]);

  const worker = new Worker<HealthCheckJobPayload>(
    'health-check-containers',
    async () => {
      let instances: typeof containerInstances.$inferSelect[] = [];

      try {
        instances = await db
          .select()
          .from(containerInstances)
          .where(inArray(containerInstances.status, [...MONITORED_STATUSES]));
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);

        if (
          message.includes('relation "container_instances" does not exist') ||
          message.includes('relation \"container_instances\" does not exist')
        ) {
          console.warn('[health-check-containers] skipped: container_instances table is unavailable in this local DB state');
          return;
        }

        throw error;
      }

      let checked = 0;
      let issues = 0;
      let recoveries = 0;

      for (const instance of instances) {
        if (!instance.agentUrl || !instance.containerName) {
          continue;
        }

        const hostIp = instance.agentUrl.split('/')[2]?.split(':')[0];
        if (!hostIp) {
          continue;
        }

        checked += 1;

        let runtimeStatus: 'running' | 'starting' | 'unhealthy' | 'stopped' | 'not_found';
        try {
          runtimeStatus = await dockerAdapter.getContainerStatus({
            hostIp,
            containerName: instance.containerName,
          });
        } catch (error) {
          issues += 1;
          await createAlertIfMissing({
            type: 'container_runtime_check_failed',
            entityId: instance.id,
            severity: 'critical',
            message: error instanceof Error ? error.message : String(error),
          });
          continue;
        }

        if (runtimeStatus === 'running') {
          if (instance.status !== 'running') {
            await db.update(containerInstances).set({ status: 'running' }).where(eq(containerInstances.id, instance.id));
            recoveries += 1;
          }
          await resolveAlertByDedupeKey(`container_unhealthy:${instance.id}`);
          await resolveAlertByDedupeKey(`container_stopped_unexpectedly:${instance.id}`);
          await resolveAlertByDedupeKey(`container_missing:${instance.id}`);
          continue;
        }

        if (runtimeStatus === 'starting') {
          if (instance.status !== 'starting') {
            await db.update(containerInstances).set({ status: 'starting' }).where(eq(containerInstances.id, instance.id));
          }
          continue;
        }

        if (runtimeStatus === 'unhealthy') {
          issues += 1;
          await db.update(containerInstances).set({ status: 'unhealthy' }).where(eq(containerInstances.id, instance.id));
          await createAlertIfMissing({
            type: 'container_unhealthy',
            entityId: instance.id,
            message: 'Container health check is failing',
            dedupeKey: `container_unhealthy:${instance.id}`,
          });
          continue;
        }

        if (runtimeStatus === 'stopped') {
          issues += 1;
          await db.update(containerInstances).set({ status: 'stopped' }).where(eq(containerInstances.id, instance.id));
          await createAlertIfMissing({
            type: 'container_stopped_unexpectedly',
            entityId: instance.id,
            severity: 'critical',
            message: 'Container stopped unexpectedly',
            dedupeKey: `container_stopped_unexpectedly:${instance.id}`,
          });
          continue;
        }

        if (runtimeStatus === 'not_found') {
          issues += 1;
          await db.update(containerInstances).set({ status: 'failed' }).where(eq(containerInstances.id, instance.id));
          await createAlertIfMissing({
            type: 'container_missing',
            entityId: instance.id,
            severity: 'critical',
            message: 'Container not found on host',
            dedupeKey: `container_missing:${instance.id}`,
          });
        }
      }

      console.log(`[health-check-containers] checked=${checked} issues=${issues} recoveries=${recoveries}`);
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
