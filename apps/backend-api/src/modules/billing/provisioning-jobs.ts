import { Queue } from 'bullmq';

export type ProvisionInstanceQueuePayload = {
  subscriptionId: string;
  vpsInstanceId: string;
  jobId: string;
};

function getRedisUrl() {
  return process.env.REDIS_URL ?? 'redis://redis:6379';
}

export async function enqueueProvisionInstanceJob(payload: ProvisionInstanceQueuePayload) {
  const queue = new Queue<ProvisionInstanceQueuePayload>('provision-instance', {
    connection: {
      url: getRedisUrl(),
    },
  });

  try {
    await queue.add('provision-instance', payload);
  } finally {
    await queue.close();
  }
}
