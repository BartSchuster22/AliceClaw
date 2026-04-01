import { Queue, Worker } from 'bullmq';
import { eq } from 'drizzle-orm';
import type IORedis from 'ioredis';

import { db } from '@psi/db';
import { containerInstances, subscriptions } from '@psi/db/schema';

import { closeRedisConnection, createRedisConnection } from '../lib/redis.js';
import { getDockerAdapter } from '../providers/docker-adapter.js';

export type StopContainerJobPayload = {
  containerInstanceId: string;
};

export type DeleteContainerJobPayload = {
  containerInstanceId: string;
};

export async function enqueueStopContainerJob(payload: StopContainerJobPayload) {
  const connection = createRedisConnection('stop-container-enqueue');
  const queue = new Queue<StopContainerJobPayload>('stop-container', { connection });
  try {
    await queue.add('stop-container', payload);
  } finally {
    await queue.close();
    await closeRedisConnection(connection);
  }
}

export async function enqueueDeleteContainerJob(payload: DeleteContainerJobPayload) {
  const connection = createRedisConnection('delete-container-enqueue');
  const queue = new Queue<DeleteContainerJobPayload>('delete-container', { connection });
  try {
    await queue.add('delete-container', payload);
  } finally {
    await queue.close();
    await closeRedisConnection(connection);
  }
}

export type ContainerLifecycleWorkerRuntime = {
  stopWorker: Worker<StopContainerJobPayload>;
  deleteWorker: Worker<DeleteContainerJobPayload>;
  close: () => Promise<void>;
};

export function createContainerLifecycleWorkers(): ContainerLifecycleWorkerRuntime {
  const dockerAdapter = getDockerAdapter();
  const stopConnection = createRedisConnection('stop-container-worker');
  const deleteConnection = createRedisConnection('delete-container-worker');
  const connectionPool = new Set<IORedis>([stopConnection, deleteConnection]);

  const makeClientFactory = (connection: IORedis) => (_type: string, redisOpts: any) => {
    const client = new (connection.constructor as typeof IORedis)({
      ...redisOpts,
      maxRetriesPerRequest: null,
    });
    connectionPool.add(client);
    return client;
  };

  const stopWorker = new Worker<StopContainerJobPayload>(
    'stop-container',
    async (job) => {
      const { containerInstanceId } = job.data;
      const [instance] = await db.select().from(containerInstances).where(eq(containerInstances.id, containerInstanceId)).limit(1);
      if (!instance) return;

      if (instance.hostServerId && instance.containerName) {
        try {
          await dockerAdapter.stopContainer({
            hostIp: instance.agentUrl?.split('/')[2]?.split(':')[0] ?? '',
            containerName: instance.containerName,
          });
        } catch (error) {
          console.error('[stop-container] stop failed', error);
        }

        try {
          await dockerAdapter.removeContainer({
            hostIp: instance.agentUrl?.split('/')[2]?.split(':')[0] ?? '',
            containerName: instance.containerName,
          });
        } catch (error) {
          console.error('[stop-container] remove failed', error);
        }
      }

      await db
        .update(containerInstances)
        .set({
          status: 'stopped',
          containerId: null,
          agentUrl: null,
          stoppedAt: new Date(),
          healthyAt: null,
        })
        .where(eq(containerInstances.id, containerInstanceId));
    },
    {
      connection: stopConnection,
      concurrency: 1,
      createClient: makeClientFactory(stopConnection),
    },
  );

  const deleteWorker = new Worker<DeleteContainerJobPayload>(
    'delete-container',
    async (job) => {
      const { containerInstanceId } = job.data;
      const [instance] = await db.select().from(containerInstances).where(eq(containerInstances.id, containerInstanceId)).limit(1);
      if (!instance) return;

      if (instance.hostServerId && instance.containerName) {
        try {
          await dockerAdapter.stopContainer({
            hostIp: instance.agentUrl?.split('/')[2]?.split(':')[0] ?? '',
            containerName: instance.containerName,
          });
        } catch (error) {
          console.error('[delete-container] stop failed', error);
        }

        try {
          await dockerAdapter.removeContainer({
            hostIp: instance.agentUrl?.split('/')[2]?.split(':')[0] ?? '',
            containerName: instance.containerName,
          });
        } catch (error) {
          console.error('[delete-container] remove failed', error);
        }
      }

      await db
        .update(containerInstances)
        .set({
          status: 'deleted',
          containerId: null,
          agentUrl: null,
          stoppedAt: new Date(),
          healthyAt: null,
          deletedAt: new Date(),
        })
        .where(eq(containerInstances.id, containerInstanceId));
    },
    {
      connection: deleteConnection,
      concurrency: 1,
      createClient: makeClientFactory(deleteConnection),
    },
  );

  return {
    stopWorker,
    deleteWorker,
    async close() {
      await stopWorker.close();
      await deleteWorker.close();
      await Promise.all([...connectionPool].map((connection) => closeRedisConnection(connection)));
      connectionPool.clear();
    },
  };
}

export async function handleSubscriptionCancellationLifecycle(subscriptionId: string, eventType: 'subscription.cancelled' | 'subscription.grace_period_ended') {
  const [subscription] = await db.select().from(subscriptions).where(eq(subscriptions.id, subscriptionId)).limit(1);
  if (!subscription) return;

  if (eventType === 'subscription.cancelled') {
    return;
  }

  const rows = await db
    .select({ id: containerInstances.id, status: containerInstances.status })
    .from(containerInstances)
    .where(eq(containerInstances.subscriptionId, subscriptionId));

  for (const row of rows) {
    if (!['deleted', 'failed'].includes(row.status)) {
      await enqueueDeleteContainerJob({ containerInstanceId: row.id });
    }
  }
}
