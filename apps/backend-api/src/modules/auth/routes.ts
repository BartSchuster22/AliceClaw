import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import crypto from 'node:crypto';

import { db } from '@psi/db';
import {
  containerInstances,
  emailVerifications,
  products,
  provisioningJobs,
  subscriptions,
  users,
} from '@psi/db/schema';

import { requireAuth } from '../../auth.js';
import { enqueueDeployContainerJob } from '../../lib/queues.js';
import { notificationService } from '../../services/notification-service.js';

function getFrontendAppUrl() {
  return process.env.FRONTEND_APP_URL ?? 'http://localhost:3000';
}

function getBackendApiUrl() {
  return process.env.BACKEND_API_URL ?? 'http://localhost:4000';
}

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function renderHtml(title: string, message: string) {
  return `<!doctype html><html><head><meta charset="utf-8" /><title>${title}</title></head><body><h1>${title}</h1><p>${message}</p></body></html>`;
}

async function createVerificationEmail(params: {
  userId: string;
  subscriptionId: string;
  productName: string;
  resendCount?: number;
}) {
  const token = crypto.randomBytes(32).toString('hex');
  const tokenHash = hashToken(token);
  const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

  await db.insert(emailVerifications).values({
    userId: params.userId,
    subscriptionId: params.subscriptionId,
    tokenHash,
    expiresAt,
    resendCount: params.resendCount ?? 0,
  });

  const verificationUrl = `${getBackendApiUrl()}/auth/verify-email?token=${token}`;
  await notificationService.sendVerificationEmail({
    userId: params.userId,
    subscriptionId: params.subscriptionId,
    productName: params.productName,
    verificationUrl,
  });
}

export async function registerEmailVerificationRoutes(app: FastifyInstance) {
  app.get('/auth/verify-email', async (request, reply) => {
    const token = String((request.query as { token?: string })?.token ?? '');

    if (!token) {
      return reply.type('text/html').send(renderHtml('Verification link not found', 'The verification link is invalid.'));
    }

    const tokenHash = hashToken(token);
    const [verification] = await db
      .select()
      .from(emailVerifications)
      .where(eq(emailVerifications.tokenHash, tokenHash))
      .limit(1);

    if (!verification) {
      return reply.type('text/html').send(renderHtml('Verification link not found', 'The verification link is invalid.'));
    }

    if (verification.verifiedAt) {
      return reply.redirect(`${getFrontendAppUrl()}/onboarding?subscriptionId=${verification.subscriptionId}&deploying=true`);
    }

    if (verification.invalidatedAt || verification.expiresAt <= new Date()) {
      return reply
        .type('text/html')
        .send(renderHtml('Verification link has expired', 'Please request a new verification email.'));
    }

    await db
      .update(emailVerifications)
      .set({ verifiedAt: new Date() })
      .where(eq(emailVerifications.id, verification.id));

    await db.update(users).set({ emailVerified: true }).where(eq(users.id, verification.userId));

    const [containerInstance] = await db
      .select()
      .from(containerInstances)
      .where(eq(containerInstances.subscriptionId, verification.subscriptionId))
      .limit(1);

    if (containerInstance && containerInstance.status === 'pending_verification') {
      await db
        .update(containerInstances)
        .set({
          status: 'queued',
          deploymentRequestedAt: new Date(),
        })
        .where(eq(containerInstances.id, containerInstance.id));

      await enqueueDeployContainerJob({
        containerInstanceId: containerInstance.id,
      });
    }

    return reply.redirect(`${getFrontendAppUrl()}/onboarding?subscriptionId=${verification.subscriptionId}&deploying=true`);
  });

  app.post('/auth/resend-verification', { preHandler: requireAuth }, async (request, reply) => {
    const subscriptionId = String((request.body as { subscriptionId?: string })?.subscriptionId ?? '');

    if (!subscriptionId) {
      return reply.status(400).send({ error: 'subscriptionId is required' });
    }

    const [subscription] = await db
      .select({ id: subscriptions.id, userId: subscriptions.userId, productId: subscriptions.productId })
      .from(subscriptions)
      .where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.userId, request.user.sub)))
      .limit(1);

    if (!subscription) {
      return reply.status(404).send({ error: 'Subscription not found' });
    }

    const [containerInstance] = await db
      .select()
      .from(containerInstances)
      .where(
        and(
          eq(containerInstances.subscriptionId, subscriptionId),
          eq(containerInstances.userId, request.user.sub),
          eq(containerInstances.status, 'pending_verification'),
        ),
      )
      .limit(1);

    if (!containerInstance) {
      return reply.status(409).send({ error: 'Subscription is not awaiting email verification' });
    }

    const [latestVerification] = await db
      .select()
      .from(emailVerifications)
      .where(
        and(
          eq(emailVerifications.subscriptionId, subscriptionId),
          eq(emailVerifications.userId, request.user.sub),
          isNull(emailVerifications.verifiedAt),
          isNull(emailVerifications.invalidatedAt),
        ),
      )
      .orderBy(desc(emailVerifications.createdAt))
      .limit(1);

    const currentResendCount = latestVerification?.resendCount ?? 0;
    if (currentResendCount >= 3) {
      return reply.status(429).send({ error: 'Maximum resends reached, contact support' });
    }

    if (latestVerification) {
      await db
        .update(emailVerifications)
        .set({ invalidatedAt: new Date() })
        .where(eq(emailVerifications.id, latestVerification.id));
    }

    const [product] = await db
      .select({ name: products.name })
      .from(subscriptions)
      .innerJoin(products, eq(subscriptions.productId, products.id))
      .where(eq(subscriptions.id, subscriptionId))
      .limit(1);

    await createVerificationEmail({
      userId: request.user.sub,
      subscriptionId,
      productName: product?.name ?? 'PSI Agent',
      resendCount: currentResendCount + 1,
    });

    return reply.send({ success: true, message: 'Verification email resent' });
  });
}
