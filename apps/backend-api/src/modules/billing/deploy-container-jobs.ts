import { Queue } from 'bullmq';

export type DeployContainerQueuePayload = {
  containerInstanceId: string;
};

function getRedisUrl() {
  return process.env.REDIS_URL ?? 'redis://redis:6379';
}

export async function enqueueDeployContainerJob(payload: DeployContainerQueuePayload) {
  const queue = new Queue<DeployContainerQueuePayload>('deploy-container', {
    connection: {
      url: getRedisUrl(),
    },
  });

  try {
    await queue.add('deploy-container', payload);
  } finally {
    await queue.close();
  }
}
