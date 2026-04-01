import { randomUUID } from 'node:crypto';

import { createContainerLifecycleWorkers } from './jobs/container-lifecycle.js';
import { createDeployContainerWorker } from './jobs/deploy-container.js';
import { createHealthCheckContainersWorker, registerHealthCheckContainersJob } from './jobs/health-check-containers.js';
import { createProvisionHostServerWorker, reconcileStaleHostProvisionAttempts } from './jobs/provision-host-server.js';
import { createProvisionInstanceWorker } from './jobs/provision-instance.js';
import { createVestReferralRewardWorker } from './jobs/vest-referral-reward.js';

process.env.WORKER_RUN_ID = process.env.WORKER_RUN_ID ?? randomUUID();

console.log('[worker] started', new Date().toISOString(), { workerRunId: process.env.WORKER_RUN_ID });

await reconcileStaleHostProvisionAttempts(process.env.WORKER_RUN_ID);
await registerHealthCheckContainersJob();

const containerLifecycleWorkers = createContainerLifecycleWorkers();

const workerRuntimes = [
  createDeployContainerWorker(),
  createHealthCheckContainersWorker(),
  createProvisionHostServerWorker(),
  createProvisionInstanceWorker(),
  createVestReferralRewardWorker(),
  {
    worker: containerLifecycleWorkers.stopWorker,
    close: containerLifecycleWorkers.close,
  },
  {
    worker: containerLifecycleWorkers.deleteWorker,
    close: async () => {},
  },
];

for (const runtime of workerRuntimes) {
  runtime.worker.on('completed', (job) => {
    console.log('[worker] completed job', job.id);
  });

  runtime.worker.on('failed', (job, error) => {
    console.error('[worker] failed job', job?.id, error);
  });
}

async function shutdown(signal: string) {
  console.log(`[worker] received ${signal}, shutting down`);
  await Promise.all(
    workerRuntimes.map((runtime) =>
      runtime.close().catch((error) => {
        console.error('[worker] failed to close worker cleanly', error);
      }),
    ),
  );
  process.exit(0);
}

process.on('SIGINT', () => {
  void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
  void shutdown('SIGTERM');
});
