import { Worker } from 'bullmq';
import { and, eq, isNull } from 'drizzle-orm';
import type IORedis from 'ioredis';

import { db } from '@psi/db';
import { hostServers } from '@psi/db/schema';

import { closeRedisConnection, createRedisConnection } from '../lib/redis.js';
import { getHostProviderRegistry } from '../provisioning/registry/host-provider-registry.js';

export type RefreshHostProviderStateJobPayload = {
  hostServerId: string;
};

function mapProviderLifecycleToHostStatus(currentStatus: typeof hostServers.$inferSelect.status, providerStatus: string) {
  if (providerStatus === 'running') {
    return currentStatus === 'provisioning' ? 'ready' : currentStatus;
  }

  if (providerStatus === 'deleted') {
    return currentStatus === 'draining' ? 'decommissioned' : 'failed';
  }

  if (providerStatus === 'deleting') {
    return 'draining';
  }

  if (providerStatus === 'error' || providerStatus === 'unknown') {
    return currentStatus === 'draining' ? 'draining' : 'failed';
  }

  return currentStatus;
}

export function createRefreshHostProviderStateWorker() {
  const connection = createRedisConnection('refresh-host-provider-state-worker');
  const connectionPool = new Set<IORedis>([connection]);
  const providerRegistry = getHostProviderRegistry();

  const worker = new Worker<RefreshHostProviderStateJobPayload>(
    'refresh-host-provider-state',
    async (job) => {
      const { hostServerId } = job.data;
      const [host] = await db.select().from(hostServers).where(eq(hostServers.id, hostServerId)).limit(1);
      if (!host || host.archivedAt) {
        return;
      }

      if (!host.providerInstanceId) {
        return;
      }

      const provider = providerRegistry.get(host.provider as 'mock' | 'hetzner');
      const details = await provider.getHostServerDetails(host.providerInstanceId);
      const nextStatus = mapProviderLifecycleToHostStatus(host.status, details.lifecycleStatus);

      await db
        .update(hostServers)
        .set({
          providerInstanceId: details.exists ? host.providerInstanceId : null,
          ipAddress: details.ipAddress ?? host.ipAddress,
          providerActionId: details.action?.id ?? host.providerActionId,
          providerActionCommand: details.action?.command ?? host.providerActionCommand,
          providerActionStatus: details.action?.status ?? details.rawStatus ?? host.providerActionStatus,
          providerActionStartedAt: details.action?.startedAt ? new Date(details.action.startedAt) : host.providerActionStartedAt,
          providerActionFinishedAt: details.action?.finishedAt ? new Date(details.action.finishedAt) : host.providerActionFinishedAt,
          status: nextStatus,
          readyAt: nextStatus === 'ready' && !host.readyAt ? new Date() : nextStatus === 'ready' ? host.readyAt : null,
          archivedAt: details.exists ? host.archivedAt : nextStatus === 'decommissioned' ? host.archivedAt ?? new Date() : host.archivedAt,
          lastHeartbeatAt: details.exists && details.lifecycleStatus === 'running' ? new Date() : host.lastHeartbeatAt,
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
