import { Worker } from 'bullmq';
import { and, eq, inArray, sql } from 'drizzle-orm';
import type IORedis from 'ioredis';

import { db } from '@psi/db';
import { containerInstances, hostServers } from '@psi/db/schema';

import { closeRedisConnection, createRedisConnection } from '../lib/redis.js';
import { getHostServerProvider } from '../providers/index.js';

const activeRuntimeStatuses = ['allocating', 'deploying', 'starting', 'running', 'unhealthy'] as const;

export type RetireHostServerJobPayload = {
  hostServerId: string;
};

export function createRetireHostServerWorker() {
  const connection = createRedisConnection('retire-host-server-worker');
  const connectionPool = new Set<IORedis>([connection]);
  const provider = getHostServerProvider();

  const worker = new Worker<RetireHostServerJobPayload>(
    'retire-host-server',
    async (job) => {
      const { hostServerId } = job.data;
      const [host] = await db.select().from(hostServers).where(eq(hostServers.id, hostServerId)).limit(1);
      if (!host) return;

      const [usage] = await db
        .select({ count: sql<number>`count(*)` })
        .from(containerInstances)
        .where(
          and(
            eq(containerInstances.hostServerId, host.id),
            inArray(containerInstances.status, [...activeRuntimeStatuses]),
          ),
        );

      if (Number(usage?.count ?? 0) > 0) {
        throw new Error('Host still has active containers');
      }

      if (host.providerInstanceId) {
        await provider.deleteHostServer(host.providerInstanceId);
      }

      await db
        .update(hostServers)
        .set({
          status: 'failed',
          archivedAt: new Date(),
          providerInstanceId: null,
          ipAddress: null,
          lastHeartbeatAt: null,
          readyAt: null,
        })
        .where(eq(hostServers.id, host.id));
    },
    {
      connection,
      concurrency: 1,
      createClient: (_type, redisOpts) => {
        const client = new (connection.constructor as typeof IORedis)({
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
      await Promise.all([...connectionPool].map((client) => closeRedisConnection(client)));
      connectionPool.clear();
    },
  };
}
