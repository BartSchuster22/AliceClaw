import { and, desc, eq, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { db } from '@psi/db';
import { referralSettings, referralUserOverrides, referrals, users } from '@psi/db/schema';

import { requireAdmin, requireAdminRole } from '../../admin-auth.js';

const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

const settingsPatchSchema = z.object({
  global_reward_rate_percent: z.number().nonnegative().max(100).optional(),
  cooling_period_days: z.number().int().nonnegative().optional(),
});

const overrideSchema = z.object({
  custom_reward_rate_percent: z.number().nonnegative().max(100),
  reason: z.string().min(1),
});

const flagSchema = z.object({
  reason: z.string().min(1),
});

function toSettingsResponse(row: typeof referralSettings.$inferSelect | undefined) {
  if (!row) {
    return {
      id: 1,
      global_reward_rate_percent: 10,
      cooling_period_days: 14,
      updated_at: null,
      updated_by_admin_id: null,
    };
  }

  return {
    id: row.id,
    global_reward_rate_percent: Number(row.globalRewardRatePercent),
    cooling_period_days: row.coolingPeriodDays,
    updated_at: row.updatedAt,
    updated_by_admin_id: row.updatedByAdminId,
  };
}

export async function registerReferralRoutes(app: FastifyInstance) {
  app.get(
    '/admin/referrals',
    { preHandler: [requireAdmin, requireAdminRole(['super_admin', 'referral_admin'])] },
    async (request, reply) => {
      const parsed = paginationSchema.safeParse(request.query);

      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid pagination params' });
      }

      const { page, pageSize } = parsed.data;
      const offset = (page - 1) * pageSize;

      const rows = await db
        .select({
          id: referrals.id,
          referralCode: referrals.referralCode,
          orderId: referrals.orderId,
          status: referrals.status,
          fraudReason: referrals.fraudReason,
          createdAt: referrals.createdAt,
          referrerUserId: referrals.referrerUserId,
          referrerEmail: users.email,
          referrerFullName: users.fullName,
          referredUserId: sql<string>`referred_users.id`,
          referredEmail: sql<string>`referred_users.email`,
          referredFullName: sql<string>`referred_users.full_name`,
          rewardAmountCents: sql<number>`(
            select coalesce(sum(rrl.amount_cents), 0)
            from referral_rewards_ledger rrl
            where rrl.referral_id = ${referrals.id}
          )`,
        })
        .from(referrals)
        .innerJoin(users, eq(users.id, referrals.referrerUserId))
        .innerJoin(sql`users as referred_users`, sql`referred_users.id = ${referrals.referredUserId}`)
        .orderBy(desc(referrals.createdAt))
        .limit(pageSize)
        .offset(offset);

      const [countRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(referrals);

      const [convertedRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(referrals)
        .where(eq(referrals.status, 'converted'));

      const [rewardedRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(referrals)
        .where(eq(referrals.status, 'rewarded'));

      const [fraudRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(referrals)
        .where(eq(referrals.status, 'fraud_flagged'));

      return {
        page,
        pageSize,
        total: Number(countRow?.count ?? 0),
        stats: {
          total_referrals: Number(countRow?.count ?? 0),
          converted: Number(convertedRow?.count ?? 0),
          rewarded: Number(rewardedRow?.count ?? 0),
          fraud_flagged: Number(fraudRow?.count ?? 0),
        },
        items: rows.map((row) => ({
          id: row.id,
          referral_code: row.referralCode,
          order_id: row.orderId,
          status: row.status,
          fraud_reason: row.fraudReason,
          reward_amount_cents: Number(row.rewardAmountCents ?? 0),
          created_at: row.createdAt,
          referrer: {
            id: row.referrerUserId,
            email: row.referrerEmail,
            full_name: row.referrerFullName,
          },
          referred: {
            id: row.referredUserId,
            email: row.referredEmail,
            full_name: row.referredFullName,
          },
        })),
      };
    },
  );

  app.get(
    '/admin/referrals/settings',
    { preHandler: [requireAdmin, requireAdminRole(['super_admin', 'referral_admin'])] },
    async () => {
      const [settings] = await db.select().from(referralSettings).where(eq(referralSettings.id, 1)).limit(1);
      return toSettingsResponse(settings);
    },
  );

  app.patch(
    '/admin/referrals/settings',
    { preHandler: [requireAdmin, requireAdminRole(['super_admin', 'referral_admin'])] },
    async (request, reply) => {
      const parsed = settingsPatchSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.flatten() });
      }

      const input = parsed.data;
      const existing = await db.select().from(referralSettings).where(eq(referralSettings.id, 1)).limit(1);

      const values = {
        globalRewardRatePercent: input.global_reward_rate_percent?.toFixed(2),
        coolingPeriodDays: input.cooling_period_days,
        updatedAt: new Date(),
        updatedByAdminId: request.admin.sub,
      };

      const [saved] = existing.length
        ? await db
            .update(referralSettings)
            .set(values)
            .where(eq(referralSettings.id, 1))
            .returning()
        : await db
            .insert(referralSettings)
            .values({
              id: 1,
              globalRewardRatePercent: values.globalRewardRatePercent ?? '10.00',
              coolingPeriodDays: values.coolingPeriodDays ?? 14,
              updatedAt: values.updatedAt,
              updatedByAdminId: values.updatedByAdminId,
            })
            .returning();

      return toSettingsResponse(saved);
    },
  );

  app.post(
    '/admin/referrals/users/:userId/override',
    { preHandler: [requireAdmin, requireAdminRole(['super_admin', 'referral_admin'])] },
    async (request, reply) => {
      const params = z.object({ userId: z.string().uuid() }).safeParse(request.params);
      const parsed = overrideSchema.safeParse(request.body);

      if (!params.success || !parsed.success) {
        return reply.status(400).send({ error: 'Invalid request' });
      }

      const [saved] = await db
        .insert(referralUserOverrides)
        .values({
          userId: params.data.userId,
          customRewardRatePercent: parsed.data.custom_reward_rate_percent.toFixed(2),
          reason: parsed.data.reason,
          setByAdminId: request.admin.sub,
        })
        .onConflictDoUpdate({
          target: referralUserOverrides.userId,
          set: {
            customRewardRatePercent: parsed.data.custom_reward_rate_percent.toFixed(2),
            reason: parsed.data.reason,
            setByAdminId: request.admin.sub,
          },
        })
        .returning();

      return reply.status(201).send({
        id: saved.id,
        user_id: saved.userId,
        custom_reward_rate_percent: Number(saved.customRewardRatePercent),
        reason: saved.reason,
        set_by_admin_id: saved.setByAdminId,
        created_at: saved.createdAt,
      });
    },
  );

  app.delete(
    '/admin/referrals/users/:userId/override',
    { preHandler: [requireAdmin, requireAdminRole(['super_admin', 'referral_admin'])] },
    async (request, reply) => {
      const params = z.object({ userId: z.string().uuid() }).safeParse(request.params);

      if (!params.success) {
        return reply.status(400).send({ error: 'Invalid user id' });
      }

      await db.delete(referralUserOverrides).where(eq(referralUserOverrides.userId, params.data.userId));
      return reply.status(204).send();
    },
  );

  app.post(
    '/admin/referrals/:id/flag',
    { preHandler: [requireAdmin, requireAdminRole(['super_admin', 'referral_admin'])] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
      const parsed = flagSchema.safeParse(request.body);

      if (!params.success || !parsed.success) {
        return reply.status(400).send({ error: 'Invalid request' });
      }

      const [updated] = await db
        .update(referrals)
        .set({
          status: 'fraud_flagged',
          fraudReason: parsed.data.reason,
        })
        .where(eq(referrals.id, params.data.id))
        .returning();

      if (!updated) {
        return reply.status(404).send({ error: 'Referral not found' });
      }

      return {
        id: updated.id,
        status: updated.status,
        fraud_reason: updated.fraudReason,
      };
    },
  );
}
