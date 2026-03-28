import { createProvisionInstanceWorker } from './jobs/provision-instance.js';

console.log('[worker] started', new Date().toISOString());

const worker = createProvisionInstanceWorker();

worker.on('completed', (job) => {
  console.log('[worker] completed job', job.id);
});

worker.on('failed', (job, error) => {
  console.error('[worker] failed job', job?.id, error);
});
