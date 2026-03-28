import { randomUUID } from 'node:crypto';

import { and, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAuth } from '../../auth.js';
import { db } from '@psi/db';
import { onboardingSessions, orders, provisioningJobs, subscriptions, vpsInstances } from '@psi/db/schema';

const getOnboardingSessionSchema = z.object({
  orderId: z.string().uuid(),
});

const saveStepSchema = z.object({
  orderId: z.string().uuid(),
  step: z.number().int().positive(),
  answers: z.record(z.string(), z.unknown()),
});

const completeSchema = z.object({
  orderId: z.string().uuid(),
});

function isValidSshPublicKey(value: string) {
  return /^(ssh-rsa|ssh-ed25519|ecdsa-sha2-nistp256|ecdsa-sha2-nistp384|ecdsa-sha2-nistp521)\s+[A-Za-z0-9+/=]+(?:\s+.+)?$/.test(
    value.trim(),
  );
}

function mergeAnswers(
  current: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown>,
) {
  return {
    ...(current ?? {}),
    ...incoming,
  };
}

function hasRequiredOnboardingFields(answers: Record<string, unknown>) {
  const requiredKeys = ['full_name', 'phone', 'country', 'account_type', 'intended_use_case', 'preferred_region', 'accepted_terms'];
  return requiredKeys.every((key) => answers[key] !== undefined && answers[key] !== null && answers[key] !== '');
}

export async function registerOnboardingRoutes(app: FastifyInstance) {
  app.get('/onboarding/session', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = getOnboardingSessionSchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid orderId' });
    }

    const { orderId } = parsed.data;

    const [order] = await db
      .select({ id: orders.id, userId: orders.userId })
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.userId, request.user.sub)))
      .limit(1);

    if (!order) {
      return reply.status(404).send({ error: 'Order not found' });
    }

    const [session] = await db
      .select()
      .from(onboardingSessions)
      .where(eq(onboardingSessions.orderId, orderId))
      .limit(1);

    if (session) {
      return {
        orderId: session.orderId,
        currentStep: session.currentStep,
        answers: session.answers,
        completedAt: session.completedAt,
      };
    }

    const [created] = await db
      .insert(onboardingSessions)
      .values({
        userId: request.user.sub,
        orderId,
        currentStep: 1,
        answers: {},
      })
      .returning();

    return {
      orderId: created.orderId,
      currentStep: created.currentStep,
      answers: created.answers,
      completedAt: created.completedAt,
    };
  });

  app.post('/onboarding/save-step', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = saveStepSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.flatten() });
    }

    const { orderId, step, answers } = parsed.data;

    const [order] = await db
      .select({ id: orders.id, userId: orders.userId })
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.userId, request.user.sub)))
      .limit(1);

    if (!order) {
      return reply.status(404).send({ error: 'Order not found' });
    }

    const sshPublicKeyValue = answers.ssh_public_key;
    const sshPublicKey = typeof sshPublicKeyValue === 'string' ? sshPublicKeyValue.trim() : undefined;

    if (sshPublicKey && !isValidSshPublicKey(sshPublicKey)) {
      return reply.status(400).send({ error: 'Invalid SSH public key format' });
    }

    const [existing] = await db
      .select()
      .from(onboardingSessions)
      .where(eq(onboardingSessions.orderId, orderId))
      .limit(1);

    if (!existing) {
      const [created] = await db
        .insert(onboardingSessions)
        .values({
          userId: request.user.sub,
          orderId,
          currentStep: step,
          answers,
          sshPublicKey: sshPublicKey ?? null,
        })
        .returning();

      return { success: true, currentStep: created.currentStep };
    }

    const mergedAnswers = mergeAnswers(existing.answers as Record<string, unknown>, answers);

    const [updated] = await db
      .update(onboardingSessions)
      .set({
        answers: mergedAnswers,
        currentStep: Math.max(existing.currentStep, step),
        sshPublicKey: sshPublicKey ?? existing.sshPublicKey,
      })
      .where(eq(onboardingSessions.id, existing.id))
      .returning();

    return { success: true, currentStep: updated.currentStep };
  });

  app.post('/onboarding/complete', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = completeSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.flatten() });
    }

    const { orderId } = parsed.data;

    const [order] = await db
      .select({ id: orders.id, userId: orders.userId })
      .from(orders)
      .where(and(eq(orders.id, orderId), eq(orders.userId, request.user.sub)))
      .limit(1);

    if (!order) {
      return reply.status(404).send({ error: 'Order not found' });
    }

    const [session] = await db
      .select()
      .from(onboardingSessions)
      .where(eq(onboardingSessions.orderId, orderId))
      .limit(1);

    if (!session) {
      return reply.status(404).send({ error: 'Onboarding session not found' });
    }

    const answers = (session.answers ?? {}) as Record<string, unknown>;

    if (!hasRequiredOnboardingFields(answers)) {
      return reply.status(400).send({ error: 'Required onboarding steps are incomplete' });
    }

    const [updatedSession] = await db
      .update(onboardingSessions)
      .set({
        completedAt: new Date(),
      })
      .where(eq(onboardingSessions.id, session.id))
      .returning();

    const [subscription] = await db
      .select({ id: subscriptions.id })
      .from(subscriptions)
      .where(eq(subscriptions.orderId, orderId))
      .limit(1);

    if (!subscription) {
      return reply.status(409).send({ error: 'Provisioning linkage missing: subscription not found' });
    }

    const [vpsInstance] = await db
      .select({ id: vpsInstances.id, subscriptionId: vpsInstances.subscriptionId })
      .from(vpsInstances)
      .where(eq(vpsInstances.subscriptionId, subscription.id))
      .limit(1);

    if (!vpsInstance) {
      return reply.status(409).send({ error: 'Provisioning linkage missing: VPS instance not found' });
    }

    const [existingJob] = await db
      .select()
      .from(provisioningJobs)
      .where(eq(provisioningJobs.subscriptionId, subscription.id))
      .limit(1);

    if (existingJob) {
      if (existingJob.status === 'queued') {
        await db
          .update(provisioningJobs)
          .set({
            currentStep: updatedSession.sshPublicKey ? 'ssh_key_attached' : existingJob.currentStep,
          })
          .where(eq(provisioningJobs.id, existingJob.id));
      }

      return {
        success: true,
        subscriptionId: subscription.id,
        vpsInstanceId: vpsInstance.id,
      };
    }

    const [createdJob] = await db
      .insert(provisioningJobs)
      .values({
        id: randomUUID(),
        vpsInstanceId: vpsInstance.id,
        subscriptionId: subscription.id,
        status: 'queued',
        currentStep: updatedSession.sshPublicKey ? 'ssh_key_attached' : null,
      })
      .returning();

    return {
      success: true,
      subscriptionId: subscription.id,
      vpsInstanceId: vpsInstance.id,
      provisioningJobId: createdJob.id,
    };
  });
}
