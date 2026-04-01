import { Queue } from 'bullmq';

function getRedisUrl() {
  return process.env.REDIS_URL ?? 'redis://redis:6379';
}

async function withQueue<T>(name: string, fn: (queue: Queue<any>) => Promise<T>) {
  const queue = new Queue(name, {
    connection: {
      url: getRedisUrl(),
    },
  });

  try {
    return await fn(queue);
  } finally {
    await queue.close();
  }
}

export async function enqueueDeployContainerJob(payload: { containerInstanceId: string }) {
  return withQueue('deploy-container', (queue) => queue.add('deploy-container', payload));
}

export async function enqueueStopContainerJob(payload: { containerInstanceId: string }) {
  return withQueue('stop-container', (queue) => queue.add('stop-container', payload));
}

export async function enqueueDeleteContainerJob(payload: { containerInstanceId: string }) {
  return withQueue('delete-container', (queue) => queue.add('delete-container', payload));
}

export async function enqueueProvisionHostServerJob(payload: { scaleEventId: string }) {
  return withQueue('provision-host-server', (queue) => queue.add('provision-host-server', payload));
}

export async function enqueueRetireHostServerJob(payload: { hostServerId: string }) {
  return withQueue('retire-host-server', (queue) => queue.add('retire-host-server', payload));
}
