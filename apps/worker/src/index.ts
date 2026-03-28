import { closeRedisConnection } from './lib/redis.js';
import { createProvisionInstanceWorker } from './jobs/provision-instance.js';

console.log('[worker] started', new Date().toISOString());

const worker = createProvisionInstanceWorker();

worker.on('completed', (job) => {
  console.log('[worker] completed job', job.id);
});

worker.on('failed', (job, error) => {
  console.error('[worker] failed job', job?.id, error);
});

async function shutdown(signal: string) {
  console.log(`[worker] received ${signal}, shutting down`);
  await worker.close().catch((error) => {
    console.error('[worker] failed to close worker cleanly', error);
  });
  await closeRedisConnection().catch((error) => {
    console.error('[worker] failed to close redis cleanly', error);
  });
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
