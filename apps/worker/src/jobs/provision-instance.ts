import { randomBytes } from 'node:crypto';

import { Worker } from 'bullmq';
import { eq } from 'drizzle-orm';

import { db } from '@psi/db';
import {
  onboardingSessions,
  orders,
  products,
  provisioningJobs,
  subscriptions,
  vpsInstances,
} from '@psi/db/schema';

import { getVpsProvider } from '../providers/index.js';
import { notificationService } from '../services/notification-service.js';

export type ProvisionInstanceJobPayload = {
  subscriptionId: string;
  vpsInstanceId: string;
  jobId: string;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function generateAppPassword() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let password = '';

  while (password.length < 16) {
    password += alphabet[randomBytes(1)[0] % alphabet.length];
  }

  return password;
}

function getProvisioningPublicKey() {
  const key = process.env.PROVISIONING_SSH_PUBLIC_KEY;

  if (!key) {
    throw new Error('PROVISIONING_SSH_PUBLIC_KEY is required');
  }

  return key;
}

async function appendJobLog(jobId: string, line: string) {
  const [job] = await db
    .select({ logLines: provisioningJobs.logLines })
    .from(provisioningJobs)
    .where(eq(provisioningJobs.id, jobId))
    .limit(1);

  const current = job?.logLines ?? [];

  await db
    .update(provisioningJobs)
    .set({
      logLines: [...current, line],
    })
    .where(eq(provisioningJobs.id, jobId));
}

async function updateStep(params: {
  vpsInstanceId: string;
  jobId: string;
  vpsStatus: typeof vpsInstances.$inferInsert.status;
  currentStep: string;
  logLine: string;
}) {
  await db
    .update(vpsInstances)
    .set({ status: params.vpsStatus })
    .where(eq(vpsInstances.id, params.vpsInstanceId));

  await db
    .update(provisioningJobs)
    .set({ currentStep: params.currentStep })
    .where(eq(provisioningJobs.id, params.jobId));

  await appendJobLog(params.jobId, params.logLine);
}

async function markFailed(params: { vpsInstanceId: string; jobId: string; errorMessage: string }) {
  await db
    .update(vpsInstances)
    .set({ status: 'failed' })
    .where(eq(vpsInstances.id, params.vpsInstanceId));

  await db
    .update(provisioningJobs)
    .set({
      status: 'failed',
      errorMessage: params.errorMessage,
      finishedAt: new Date(),
    })
    .where(eq(provisioningJobs.id, params.jobId));

  await appendJobLog(params.jobId, `ERROR: ${params.errorMessage}`);
  console.error('[provision-instance]', params.errorMessage);
}

export function createProvisionInstanceWorker() {
  const vpsProvider = getVpsProvider();

  return new Worker<ProvisionInstanceJobPayload>(
    'provision-instance',
    async (job) => {
      const { subscriptionId, vpsInstanceId, jobId } = job.data;
      let appPassword: string | null = null;

      try {
        await db
          .update(provisioningJobs)
          .set({ status: 'running', startedAt: new Date() })
          .where(eq(provisioningJobs.id, jobId));

        await updateStep({
          vpsInstanceId,
          jobId,
          vpsStatus: 'creating_server',
          currentStep: 'creating_server',
          logLine: 'STEP 1: creating_server',
        });

        const [vpsInstance] = await db
          .select()
          .from(vpsInstances)
          .where(eq(vpsInstances.id, vpsInstanceId))
          .limit(1);

        if (!vpsInstance) {
          throw new Error('VPS instance not found');
        }

        let providerId = vpsInstance.providerInstanceId;
        let ip = vpsInstance.ipAddress;

        if (!providerId) {
          const [subscription] = await db
            .select()
            .from(subscriptions)
            .where(eq(subscriptions.id, subscriptionId))
            .limit(1);

          if (!subscription) {
            throw new Error('Subscription not found');
          }

          const [product] = await db
            .select()
            .from(products)
            .where(eq(products.id, subscription.productId))
            .limit(1);

          if (!product) {
            throw new Error('Product not found');
          }

          const [order] = await db
            .select()
            .from(orders)
            .where(eq(orders.id, subscription.orderId))
            .limit(1);

          if (!order) {
            throw new Error('Order not found');
          }

          const [onboardingSession] = await db
            .select()
            .from(onboardingSessions)
            .where(eq(onboardingSessions.orderId, order.id))
            .limit(1);

          const sshPublicKeys = [getProvisioningPublicKey()];
          if (onboardingSession?.sshPublicKey) {
            sshPublicKeys.push(onboardingSession.sshPublicKey);
          }

          const created = await vpsProvider.createServer({
            name: `psi-${subscriptionId}`,
            spec: product.vpsSpec as { ram_gb: number; cpu: number; disk_gb: number; os_image: string },
            region: vpsInstance.region,
            sshPublicKeys,
            cloudInitScript: '# mock cloud-init placeholder',
          });

          providerId = created.providerId;
          ip = created.ip;

          await db
            .update(vpsInstances)
            .set({
              providerInstanceId: providerId,
              status: 'creating_server',
            })
            .where(eq(vpsInstances.id, vpsInstanceId));
        } else {
          await appendJobLog(jobId, 'Provider instance already exists, skipping createServer');
        }

        await updateStep({
          vpsInstanceId,
          jobId,
          vpsStatus: 'server_ready',
          currentStep: 'server_ready',
          logLine: 'STEP 2: server_ready polling started',
        });

        let status: 'starting' | 'running' | 'error' = 'starting';
        for (let attempt = 1; attempt <= 40; attempt += 1) {
          status = await vpsProvider.getServerStatus(providerId!);
          if (status === 'running') {
            await db
              .update(vpsInstances)
              .set({ ipAddress: ip, status: 'server_ready' })
              .where(eq(vpsInstances.id, vpsInstanceId));
            await appendJobLog(jobId, `Server reached running state on attempt ${attempt}`);
            break;
          }
          if (status === 'error') {
            throw new Error('Server entered error state');
          }
          await sleep(5000);
        }

        if (status !== 'running') {
          throw new Error('Timed out waiting for server to become running');
        }

        await updateStep({
          vpsInstanceId,
          jobId,
          vpsStatus: 'provisioning',
          currentStep: 'provisioning',
          logLine: 'STEP 3: provisioning',
        });

        await sleep(5000);
        await appendJobLog(jobId, 'PSI install complete (mock)');
        appPassword = generateAppPassword();

        await db
          .update(vpsInstances)
          .set({ status: 'completed' })
          .where(eq(vpsInstances.id, vpsInstanceId));

        await db
          .update(provisioningJobs)
          .set({ status: 'completed', finishedAt: new Date(), currentStep: 'completed' })
          .where(eq(provisioningJobs.id, jobId));

        await appendJobLog(jobId, 'STEP 4: completed');

        await db
          .update(subscriptions)
          .set({ status: 'active' })
          .where(eq(subscriptions.id, subscriptionId));

        const [subscription] = await db
          .select({ userId: subscriptions.userId })
          .from(subscriptions)
          .where(eq(subscriptions.id, subscriptionId))
          .limit(1);

        if (!subscription || !ip || !appPassword) {
          throw new Error('Missing delivery context');
        }

        await notificationService.sendDeliveryEmail({
          userId: subscription.userId,
          ip,
          appPassword,
        });

        appPassword = null;
      } catch (error) {
        const message = error instanceof Error ? error.message : 'Unknown provisioning error';
        await markFailed({ vpsInstanceId, jobId, errorMessage: message });
        throw error;
      } finally {
        appPassword = null;
      }
    },
    {
      connection: {
        url: process.env.REDIS_URL ?? 'redis://redis:6379',
      },
    },
  );
}
