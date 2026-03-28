import bcrypt from 'bcryptjs';
import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAuth } from '../../auth.js';
import { db } from '@psi/db';
import {
  profiles,
  products,
  provisioningJobs,
  referralRewardsLedger,
  referrals,
  subscriptions,
  users,
  vpsInstances,
} from '@psi/db/schema';

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
        vpsInstanceId: vpsInstances.id,
        vpsStatus: vpsInstances.status,
        ipAddress: vpsInstances.ipAddress,
        region: vpsInstances.region,
      })
      .from(subscriptions)
      .innerJoin(products, eq(products.id, subscriptions.productId))
      .leftJoin(vpsInstances, eq(vpsInstances.subscriptionId, subscriptions.id))
      .where(eq(subscriptions.userId, request.user.sub));

    return rows;
  });

  app.get('/user/instances/:id/status', { preHandler: requireAuth }, async (request, reply) => {
    const params = z.object({ id: z.string().uuid() }).safeParse(request.params);

    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid instance id' });
    }

    const [instance] = await db
      .select({
        id: vpsInstances.id,
        status: vpsInstances.status,
        providerInstanceId: vpsInstances.providerInstanceId,
        ipAddress: vpsInstances.ipAddress,
        region: vpsInstances.region,
        subscriptionId: vpsInstances.subscriptionId,
      })
      .from(vpsInstances)
      .innerJoin(subscriptions, eq(subscriptions.id, vpsInstances.subscriptionId))
      .where(and(eq(vpsInstances.id, params.data.id), eq(subscriptions.userId, request.user.sub)))
      .limit(1);

    if (!instance) {
      return reply.status(404).send({ error: 'Instance not found' });
    }

    const [latestJob] = await db
      .select()
      .from(provisioningJobs)
      .where(eq(provisioningJobs.vpsInstanceId, instance.id))
      .orderBy(desc(provisioningJobs.createdAt))
      .limit(1);

    return {
      instance,
      provisioningJob: latestJob ?? null,
    };
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

    return {
      referralCode: user?.referralCode ?? null,
      referralLink: `${process.env.FRONTEND_WEB_URL ?? 'https://web.canariaslibre.com'}?ref=${user?.referralCode ?? ''}`,
      activeCount,
      convertedCount,
      totalCreditCents,
      ledger,
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
