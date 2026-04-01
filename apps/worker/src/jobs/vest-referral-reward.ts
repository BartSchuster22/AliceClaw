import type IORedis from 'ioredis';
import { Worker } from 'bullmq';

import { createRedisConnection, closeRedisConnection } from '../lib/redis.js';
import { processVestReferralReward, type VestReferralRewardPayload } from '../../../backend-api/src/modules/billing/referral-jobs.js';

export type VestReferralRewardWorkerRuntime = {
  worker: Worker<VestReferralRewardPayload>;
  close: () => Promise<void>;
};

export function createVestReferralRewardWorker(): VestReferralRewardWorkerRuntime {
  const workerConnection = createRedisConnection('referral-worker');
  const connectionPool = new Set<IORedis>([workerConnection]);

  const worker = new Worker<VestReferralRewardPayload>(
    'vest-referral-reward',
    async (job) => {
      console.log('[worker][vest-referral-reward] received', {
        bullmqJobId: job.id,
        referralId: job.data.referralId ?? null,
      });

      if (!job.data.referralId) {
        throw new Error('Vest referral reward job payload is missing referralId');
      }

      await processVestReferralReward(job.data);
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
    console.error('[worker][vest-referral-reward] worker error', error.message);
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
