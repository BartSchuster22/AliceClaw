import bcrypt from 'bcryptjs';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAuth } from '../../auth.js';
import { db } from '@psi/db';
import {
  containerInstances,
  profiles,
  products,
  provisioningJobs,
  referralRewardsLedger,
  referrals,
  subscriptions,
  users,
} from '@psi/db/schema';
import { enqueueDeleteContainerJob, enqueueDeployContainerJob, enqueueStopContainerJob } from '../../lib/queues.js';

const updateProfileSchema = z.object({
  full_name: z.string().min(1).optional(),
  phone: z.string().min(1).optional(),
  company_name: z.string().min(1).optional(),
  country: z.string().length(2).optional(),
});

const changePasswordSchema = z.object({
  currentPassword: z.string().min(1),
  newPassword: z.string().min(8),
});

function maskRuntimeFields<
  T extends {
    status?: string;
    containerStatus?: string | null;
    containerId?: string | null;
    agentUrl?: string | null;
    startedAt?: string | Date | null;
  },
>(instance: T) {
  const effectiveStatus = instance.containerStatus ?? instance.status;

  if (!effectiveStatus || !['stopped', 'stopping', 'deleted', 'deleting', 'failed'].includes(effectiveStatus)) {
    return instance;
  }

  return {
    ...instance,
    containerId: 'containerId' in instance ? null : instance.containerId,
    agentUrl: 'agentUrl' in instance ? null : instance.agentUrl,
    startedAt: 'startedAt' in instance ? null : instance.startedAt,
  };
}

export async function registerUserRoutes(app: FastifyInstance) {
  app.get('/user/profile', { preHandler: requireAuth }, async (request, reply) => {
    const [row] = await db
      .select({
        userId: users.id,
        email: users.email,
        fullName: users.fullName,
        referralCode: users.referralCode,
        emailVerified: users.emailVerified,
        userStatus: users.status,
        profileId: profiles.id,
        accountType: profiles.accountType,
        companyName: profiles.companyName,
        taxId: profiles.taxId,
        phone: profiles.phone,
        country: profiles.country,
        onboardingState: profiles.onboardingState,
      })
      .from(users)
      .leftJoin(profiles, eq(profiles.userId, users.id))
      .where(eq(users.id, request.user.sub))
      .limit(1);

    if (!row) {
      return reply.status(404).send({ error: 'User not found' });
    }

    return row;
  });

  app.patch('/user/profile', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = updateProfileSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.flatten() });
    }

    const input = parsed.data;

    if (input.full_name !== undefined) {
      await db.update(users).set({ fullName: input.full_name }).where(eq(users.id, request.user.sub));
    }

    const [existingProfile] = await db
      .select({ id: profiles.id })
      .from(profiles)
      .where(eq(profiles.userId, request.user.sub))
      .limit(1);

    if (existingProfile) {
      await db
        .update(profiles)
        .set({
          phone: input.phone,
          companyName: input.company_name,
          country: input.country,
        })
        .where(eq(profiles.id, existingProfile.id));
    } else {
      await db.insert(profiles).values({
        userId: request.user.sub,
        accountType: 'private',
        companyName: input.company_name ?? null,
        taxId: null,
        phone: input.phone ?? null,
        country: input.country ?? 'XX',
        onboardingState: 'pending',
      });
    }

    const [updated] = await db
      .select({
        userId: users.id,
        email: users.email,
        fullName: users.fullName,
        referralCode: users.referralCode,
        phone: profiles.phone,
        companyName: profiles.companyName,
        country: profiles.country,
      })
      .from(users)
      .leftJoin(profiles, eq(profiles.userId, users.id))
      .where(eq(users.id, request.user.sub))
      .limit(1);

    return updated;
  });

  app.get('/user/subscriptions', { preHandler: requireAuth }, async (request) => {
    const rows = await db
      .select({
        subscriptionId: subscriptions.id,
        status: subscriptions.status,
        currentPeriodStart: subscriptions.currentPeriodStart,
        currentPeriodEnd: subscriptions.currentPeriodEnd,
        cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
        productId: products.id,
        productName: products.name,
        productSlug: products.slug,
        priceCents: products.priceCents,
        billingCycle: products.billingCycle,
        containerInstanceId: containerInstances.id,
        containerStatus: containerInstances.status,
        agentUrl: containerInstances.agentUrl,
        startedAt: containerInstances.startedAt,
      })
      .from(subscriptions)
      .innerJoin(products, eq(products.id, subscriptions.productId))
      .leftJoin(containerInstances, eq(containerInstances.subscriptionId, subscriptions.id))
      .where(eq(subscriptions.userId, request.user.sub));

    return rows.map((row) => maskRuntimeFields(row));
  });

  app.get('/user/instances/:id/status', { preHandler: requireAuth }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);

    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid instance id' });
    }

    const [instance] = await db
      .select({
        id: containerInstances.id,
        status: containerInstances.status,
        containerId: containerInstances.containerId,
        agentUrl: containerInstances.agentUrl,
        hostServerId: containerInstances.hostServerId,
        subscriptionId: containerInstances.subscriptionId,
      })
      .from(containerInstances)
      .innerJoin(subscriptions, eq(subscriptions.id, containerInstances.subscriptionId))
      .where(and(eq(containerInstances.id, params.data.id), eq(subscriptions.userId, request.user.sub)))
      .limit(1);

    if (!instance) {
      return reply.status(404).send({ error: 'Instance not found' });
    }

    const [latestJob] = await db
      .select()
      .from(provisioningJobs)
      .where(eq(provisioningJobs.containerInstanceId, instance.id))
      .orderBy(desc(provisioningJobs.createdAt))
      .limit(1);

    return {
      instance: maskRuntimeFields(instance),
      provisioningJob: latestJob ?? null,
    };
  });

  app.post('/user/instances/:id/stop', { preHandler: requireAuth }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);

    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid instance id' });
    }

    const [instance] = await db
      .select()
      .from(containerInstances)
      .innerJoin(subscriptions, eq(subscriptions.id, containerInstances.subscriptionId))
      .where(and(eq(containerInstances.id, params.data.id), eq(subscriptions.userId, request.user.sub)))
      .limit(1);

    if (!instance?.container_instances) {
      return reply.status(404).send({ error: 'Instance not found' });
    }

    if (!['running', 'unhealthy'].includes(instance.container_instances.status)) {
      return reply.status(409).send({ error: 'Instance is not stoppable' });
    }

    await db
      .update(containerInstances)
      .set({ status: 'stopping' })
      .where(eq(containerInstances.id, instance.container_instances.id));

    await enqueueStopContainerJob({
      containerInstanceId: instance.container_instances.id,
    });

    return { success: true };
  });

  app.post('/user/instances/:id/start', { preHandler: requireAuth }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);

    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid instance id' });
    }

    const [instance] = await db
      .select()
      .from(containerInstances)
      .innerJoin(subscriptions, eq(subscriptions.id, containerInstances.subscriptionId))
      .where(and(eq(containerInstances.id, params.data.id), eq(subscriptions.userId, request.user.sub)))
      .limit(1);

    if (!instance?.container_instances || !instance.subscriptions) {
      return reply.status(404).send({ error: 'Instance not found' });
    }

    if (instance.container_instances.status !== 'stopped') {
      return reply.status(409).send({ error: 'Instance is not resumable' });
    }

    if (instance.subscriptions.status !== 'active') {
      return reply.status(409).send({ error: 'Subscription is not active' });
    }

    await db
      .update(containerInstances)
      .set({
        status: 'queued',
        deploymentRequestedAt: new Date(),
      })
      .where(eq(containerInstances.id, instance.container_instances.id));

    await enqueueDeployContainerJob({
      containerInstanceId: instance.container_instances.id,
    });

    return { success: true };
  });

  app.post('/user/instances/:id/delete', { preHandler: requireAuth }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);

    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid instance id' });
    }

    const [instance] = await db
      .select()
      .from(containerInstances)
      .innerJoin(subscriptions, eq(subscriptions.id, containerInstances.subscriptionId))
      .where(and(eq(containerInstances.id, params.data.id), eq(subscriptions.userId, request.user.sub)))
      .limit(1);

    if (!instance?.container_instances) {
      return reply.status(404).send({ error: 'Instance not found' });
    }

    if (['deleting', 'deleted'].includes(instance.container_instances.status)) {
      return reply.status(409).send({ error: 'Instance is already being deleted' });
    }

    await db
      .update(containerInstances)
      .set({ status: 'deleting' })
      .where(eq(containerInstances.id, instance.container_instances.id));

    await enqueueDeleteContainerJob({
      containerInstanceId: instance.container_instances.id,
    });

    return { success: true };
  });

  app.get('/user/referrals', { preHandler: requireAuth }, async (request) => {
    const [user] = await db
      .select({ referralCode: users.referralCode })
      .from(users)
      .where(eq(users.id, request.user.sub))
      .limit(1);

    const activeCount = Number(
      (
        await db
          .select({ count: sql<number>`count(*)` })
          .from(referrals)
          .where(and(eq(referrals.referrerUserId, request.user.sub), eq(referrals.status, 'pending')))
      )[0]?.count ?? 0,
    );

    const convertedCount = Number(
      (
        await db
          .select({ count: sql<number>`count(*)` })
          .from(referrals)
          .where(and(eq(referrals.referrerUserId, request.user.sub), eq(referrals.status, 'converted')))
      )[0]?.count ?? 0,
    );

    const totalCreditCents = Number(
      (
        await db
          .select({ total: sql<number>`coalesce(sum(${referralRewardsLedger.amountCents}), 0)` })
          .from(referralRewardsLedger)
          .where(eq(referralRewardsLedger.userId, request.user.sub))
      )[0]?.total ?? 0,
    );

    const ledger = await db
      .select()
      .from(referralRewardsLedger)
      .where(eq(referralRewardsLedger.userId, request.user.sub))
      .orderBy(desc(referralRewardsLedger.createdAt));

    const referralRows = await db
      .select()
      .from(referrals)
      .where(eq(referrals.referrerUserId, request.user.sub))
      .orderBy(desc(referrals.createdAt));

    return {
      referralCode: user?.referralCode ?? null,
      referralLink: `${process.env.FRONTEND_WEB_URL ?? 'https://aquiero.com'}?ref=${user?.referralCode ?? ''}`,
      activeCount,
      convertedCount,
      totalCreditCents,
      ledger,
      referrals: referralRows,
    };
  });

  app.post('/auth/change-password', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = changePasswordSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.flatten() });
    }

    const { currentPassword, newPassword } = parsed.data;

    const [user] = await db
      .select({ id: users.id, passwordHash: users.passwordHash })
      .from(users)
      .where(eq(users.id, request.user.sub))
      .limit(1);

    if (!user) {
      return reply.status(404).send({ error: 'User not found' });
    }

    const valid = await bcrypt.compare(currentPassword, user.passwordHash);
    if (!valid) {
      return reply.status(401).send({ error: 'Current password is incorrect' });
    }

    const newHash = await bcrypt.hash(newPassword, 12);
    await db.update(users).set({ passwordHash: newHash }).where(eq(users.id, request.user.sub));

    return { success: true };
  });
}
