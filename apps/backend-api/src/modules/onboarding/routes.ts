import { and, desc, eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAuth } from '../../auth.js';
import { db } from '@psi/db';
import { containerInstances, onboardingSessions, provisioningJobs, subscriptions } from '@psi/db/schema';

const deployStatusSchema = z.object({
  subscriptionId: z.string().uuid(),
});

const getOnboardingSessionSchema = z.object({
  subscriptionId: z.string().uuid(),
});

const saveStepSchema = z.object({
  subscriptionId: z.string().uuid(),
  step: z.number().int().positive(),
  answers: z.record(z.string(), z.unknown()),
});

const completeSchema = z.object({
  subscriptionId: z.string().uuid(),
});

function mergeAnswers(
  current: Record<string, unknown> | null | undefined,
  incoming: Record<string, unknown>,
) {
  return {
    ...(current ?? {}),
    ...incoming,
  };
}

export async function registerOnboardingRoutes(app: FastifyInstance) {
  app.get('/onboarding/deploy-status', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = deployStatusSchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid subscriptionId' });
    }

    const { subscriptionId } = parsed.data;

    const [subscription] = await db
      .select({ id: subscriptions.id, userId: subscriptions.userId })
      .from(subscriptions)
      .where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.userId, request.user.sub)))
      .limit(1);

    if (!subscription) {
      return reply.status(404).send({ error: 'Subscription not found' });
    }

    const [container] = await db
      .select()
      .from(containerInstances)
      .where(eq(containerInstances.subscriptionId, subscriptionId))
      .limit(1);

    if (!container) {
      return reply.status(404).send({ error: 'Container instance not found' });
    }

    const [job] = await db
      .select()
      .from(provisioningJobs)
      .where(eq(provisioningJobs.containerInstanceId, container.id))
      .orderBy(desc(provisioningJobs.createdAt))
      .limit(1);

    const isLiveRuntime = ['running', 'starting', 'unhealthy'].includes(container.status);

    return {
      containerStatus: container.status,
      currentStep: job?.currentStep ?? (container.status === 'pending_verification' ? 'waiting_for_email_verification' : null),
      recentLogs: (job?.logLines ?? []).slice(-5),
      agentUrl: isLiveRuntime ? container.agentUrl : null,
      startedAt: isLiveRuntime ? container.startedAt : null,
    };
  });

  app.get('/onboarding/session', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = getOnboardingSessionSchema.safeParse(request.query);

    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid subscriptionId' });
    }

    const { subscriptionId } = parsed.data;

    const [subscription] = await db
      .select({ id: subscriptions.id, userId: subscriptions.userId })
      .from(subscriptions)
      .where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.userId, request.user.sub)))
      .limit(1);

    if (!subscription) {
      return reply.status(404).send({ error: 'Subscription not found' });
    }

    const [session] = await db
      .select()
      .from(onboardingSessions)
      .where(eq(onboardingSessions.subscriptionId, subscriptionId))
      .limit(1);

    if (session) {
      return {
        subscriptionId: session.subscriptionId,
        currentStep: session.currentStep,
        answers: session.answers,
        completedAt: session.completedAt,
      };
    }

    const [created] = await db
      .insert(onboardingSessions)
      .values({
        userId: request.user.sub,
        subscriptionId,
        currentStep: 1,
        answers: {},
      })
      .returning();

    return {
      subscriptionId: created.subscriptionId,
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

    const { subscriptionId, step, answers } = parsed.data;

    const [subscription] = await db
      .select({ id: subscriptions.id, userId: subscriptions.userId })
      .from(subscriptions)
      .where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.userId, request.user.sub)))
      .limit(1);

    if (!subscription) {
      return reply.status(404).send({ error: 'Subscription not found' });
    }

    const [existing] = await db
      .select()
      .from(onboardingSessions)
      .where(eq(onboardingSessions.subscriptionId, subscriptionId))
      .limit(1);

    if (!existing) {
      const [created] = await db
        .insert(onboardingSessions)
        .values({
          userId: request.user.sub,
          subscriptionId,
          currentStep: step,
          answers,
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

    const { subscriptionId } = parsed.data;

    const [subscription] = await db
      .select({ id: subscriptions.id, userId: subscriptions.userId })
      .from(subscriptions)
      .where(and(eq(subscriptions.id, subscriptionId), eq(subscriptions.userId, request.user.sub)))
      .limit(1);

    if (!subscription) {
      return reply.status(404).send({ error: 'Subscription not found' });
    }

    const [session] = await db
      .select()
      .from(onboardingSessions)
      .where(eq(onboardingSessions.subscriptionId, subscriptionId))
      .limit(1);

    if (!session) {
      return reply.status(404).send({ error: 'Onboarding session not found' });
    }

    await db
      .update(onboardingSessions)
      .set({
        completedAt: new Date(),
      })
      .where(eq(onboardingSessions.id, session.id));

    return {
      success: true,
      subscriptionId,
    };
  });
}
