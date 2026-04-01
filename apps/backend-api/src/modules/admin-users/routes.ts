import { and, asc, desc, eq, gte, inArray, lte, or, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { requireAdmin, requireAdminRole } from '../../admin-auth.js';
import { db } from '@psi/db';
import {
  adminAuditLog,
  profiles,
  referralRewardsLedger,
  referrals,
  subscriptions,
  users,
} from '@psi/db/schema';

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  query: z.string().trim().optional(),
  status: z.enum(['active', 'suspended']).optional(),
  subscription_status: z.enum(['active', 'suspended', 'cancelled', 'expired', 'provisioning_failed']).optional(),
  joined_from: z.string().datetime().optional(),
  joined_to: z.string().datetime().optional(),
});

const paramsSchema = z.object({
  id: z.string().uuid(),
});

const creditSchema = z.object({
  amount_cents: z.number().int().positive(),
  reason: z.string().min(1),
});

function getRequestIp(request: FastifyRequest) {
  return request.ip === '127.0.0.1' ? '127.0.0.1' : request.ip;
}

async function insertAuditLog(params: {
  request: FastifyRequest;
  action: string;
  targetId: string;
  payloadSummary: Record<string, unknown>;
}) {
  await db.insert(adminAuditLog).values({
    adminUserId: params.request.admin.sub,
    action: params.action,
    targetType: 'user',
    targetId: params.targetId,
    payloadSummary: params.payloadSummary,
    ipAddress: getRequestIp(params.request),
  });
}

export async function registerAdminUserRoutes(app: FastifyInstance) {
  app.get(
    '/admin/users',
    { preHandler: [requireAdmin, requireAdminRole(['super_admin', 'support_admin'])] },
    async (request, reply) => {
      const parsed = listQuerySchema.safeParse(request.query);

      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid query params', details: parsed.error.flatten() });
      }

      const { page, pageSize, query, status, subscription_status, joined_from, joined_to } = parsed.data;
      const offset = (page - 1) * pageSize;

      const whereClauses = [];

      if (query) {
        whereClauses.push(
          or(
            sql`${users.email} ilike ${`%${query}%`}`,
            sql`${users.fullName} ilike ${`%${query}%`}`,
          ),
        );
      }

      if (status) {
        whereClauses.push(eq(users.status, status));
      }

      if (joined_from) {
        whereClauses.push(gte(users.createdAt, new Date(joined_from)));
      }

      if (joined_to) {
        whereClauses.push(lte(users.createdAt, new Date(joined_to)));
      }

      let filteredUserIds: string[] | null = null;
      if (subscription_status) {
        const subRows = await db
          .select({ userId: subscriptions.userId })
          .from(subscriptions)
          .where(eq(subscriptions.status, subscription_status));

        filteredUserIds = [...new Set(subRows.map((row) => row.userId))];
        if (filteredUserIds.length === 0) {
          return { page, pageSize, total: 0, items: [] };
        }
        whereClauses.push(inArray(users.id, filteredUserIds));
      }

      const where = whereClauses.length ? and(...whereClauses) : undefined;

      const rows = await db
        .select({
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          status: users.status,
          createdAt: users.createdAt,
          latestSubscriptionStatus: sql<string | null>`(
            select s.status::text
            from subscriptions s
            where s.user_id = ${users.id}
            order by s.created_at desc
            limit 1
          )`,
        })
        .from(users)
        .where(where)
        .orderBy(desc(users.createdAt))
        .limit(pageSize)
        .offset(offset);

      const [countRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(users)
        .where(where);

      return {
        page,
        pageSize,
        total: Number(countRow?.count ?? 0),
        items: rows.map((row) => ({
          id: row.id,
          email: row.email,
          full_name: row.fullName,
          status: row.status,
          subscription_status: row.latestSubscriptionStatus,
          join_date: row.createdAt,
        })),
      };
    },
  );

  app.get(
    '/admin/users/:id',
    { preHandler: [requireAdmin, requireAdminRole(['super_admin', 'support_admin'])] },
    async (request, reply) => {
      const parsed = paramsSchema.safeParse(request.params);

      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid user id' });
      }

      const userId = parsed.data.id;

      const [user] = await db
        .select({
          id: users.id,
          email: users.email,
          fullName: users.fullName,
          referralCode: users.referralCode,
          referredByUserId: users.referredByUserId,
          emailVerified: users.emailVerified,
          status: users.status,
          createdAt: users.createdAt,
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
        .where(eq(users.id, userId))
        .limit(1);

      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      const [referrer] = user.referredByUserId
        ? await db
            .select({ id: users.id, email: users.email, fullName: users.fullName })
            .from(users)
            .where(eq(users.id, user.referredByUserId))
            .limit(1)
        : [];

      const subscriptionHistory = await db
        .select({
          id: subscriptions.id,
          status: subscriptions.status,
          currentPeriodStart: subscriptions.currentPeriodStart,
          currentPeriodEnd: subscriptions.currentPeriodEnd,
          cancelAtPeriodEnd: subscriptions.cancelAtPeriodEnd,
          createdAt: subscriptions.createdAt,
        })
        .from(subscriptions)
        .where(eq(subscriptions.userId, userId))
        .orderBy(desc(subscriptions.createdAt));

      const referralsMade = await db
        .select({
          id: referrals.id,
          referredUserId: referrals.referredUserId,
          referralCode: referrals.referralCode,
          status: referrals.status,
          orderId: referrals.orderId,
          fraudReason: referrals.fraudReason,
          createdAt: referrals.createdAt,
          referredEmail: sql<string>`referred_users.email`,
          referredFullName: sql<string>`referred_users.full_name`,
        })
        .from(referrals)
        .innerJoin(sql`users as referred_users`, sql`referred_users.id = ${referrals.referredUserId}`)
        .where(eq(referrals.referrerUserId, userId))
        .orderBy(desc(referrals.createdAt));

      const [referralsMadeCount] = await db
        .select({ count: sql<number>`count(*)` })
        .from(referrals)
        .where(eq(referrals.referrerUserId, userId));

      const credits = await db
        .select()
        .from(referralRewardsLedger)
        .where(eq(referralRewardsLedger.userId, userId))
        .orderBy(desc(referralRewardsLedger.createdAt));

      const auditTrail = await db
        .select({
          id: adminAuditLog.id,
          adminUserId: adminAuditLog.adminUserId,
          action: adminAuditLog.action,
          payloadSummary: adminAuditLog.payloadSummary,
          ipAddress: adminAuditLog.ipAddress,
          createdAt: adminAuditLog.createdAt,
          adminEmail: sql<string>`admins.email`,
          adminFullName: sql<string>`admins.full_name`,
        })
        .from(adminAuditLog)
        .innerJoin(sql`admin_users as admins`, sql`admins.id = ${adminAuditLog.adminUserId}`)
        .where(and(eq(adminAuditLog.targetType, 'user'), eq(adminAuditLog.targetId, userId)))
        .orderBy(desc(adminAuditLog.createdAt));

      return {
        profile: {
          id: user.id,
          email: user.email,
          full_name: user.fullName,
          referral_code: user.referralCode,
          email_verified: user.emailVerified,
          status: user.status,
          created_at: user.createdAt,
          account_type: user.accountType,
          company_name: user.companyName,
          tax_id: user.taxId,
          phone: user.phone,
          country: user.country,
          onboarding_state: user.onboardingState,
        },
        subscription_history: subscriptionHistory.map((item) => ({
          id: item.id,
          status: item.status,
          current_period_start: item.currentPeriodStart,
          current_period_end: item.currentPeriodEnd,
          cancel_at_period_end: item.cancelAtPeriodEnd,
          created_at: item.createdAt,
          status_timeline: [
            {
              status: item.status,
              at: item.createdAt,
            },
          ],
        })),
        referral_history: {
          referred_by: referrer
            ? {
                id: referrer.id,
                email: referrer.email,
                full_name: referrer.fullName,
              }
            : null,
          referred_count: Number(referralsMadeCount?.count ?? 0),
          referrals_made: referralsMade.map((item) => ({
            id: item.id,
            referred_user_id: item.referredUserId,
            referred_email: item.referredEmail,
            referred_full_name: item.referredFullName,
            referral_code: item.referralCode,
            status: item.status,
            order_id: item.orderId,
            fraud_reason: item.fraudReason,
            created_at: item.createdAt,
          })),
          credit_history: credits,
        },
        audit_trail: auditTrail.map((item) => ({
          id: item.id,
          admin_user_id: item.adminUserId,
          admin_email: item.adminEmail,
          admin_full_name: item.adminFullName,
          action: item.action,
          payload_summary: item.payloadSummary,
          ip_address: item.ipAddress,
          created_at: item.createdAt,
        })),
      };
    },
  );

  app.post(
    '/admin/users/:id/suspend',
    { preHandler: [requireAdmin, requireAdminRole(['super_admin', 'support_admin'])] },
    async (request, reply) => {
      const parsed = paramsSchema.safeParse(request.params);

      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid user id' });
      }

      const [updated] = await db
        .update(users)
        .set({ status: 'suspended' })
        .where(eq(users.id, parsed.data.id))
        .returning({ id: users.id, status: users.status });

      if (!updated) {
        return reply.status(404).send({ error: 'User not found' });
      }

      await insertAuditLog({
        request,
        action: 'user.suspended',
        targetId: parsed.data.id,
        payloadSummary: { status: 'suspended' },
      });

      return updated;
    },
  );

  app.post(
    '/admin/users/:id/reactivate',
    { preHandler: [requireAdmin, requireAdminRole(['super_admin', 'support_admin'])] },
    async (request, reply) => {
      const parsed = paramsSchema.safeParse(request.params);

      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid user id' });
      }

      const [updated] = await db
        .update(users)
        .set({ status: 'active' })
        .where(eq(users.id, parsed.data.id))
        .returning({ id: users.id, status: users.status });

      if (!updated) {
        return reply.status(404).send({ error: 'User not found' });
      }

      await insertAuditLog({
        request,
        action: 'user.reactivated',
        targetId: parsed.data.id,
        payloadSummary: { status: 'active' },
      });

      return updated;
    },
  );

  app.post(
    '/admin/users/:id/subscription-credit',
    { preHandler: [requireAdmin, requireAdminRole(['super_admin', 'billing_admin'])] },
    async (request, reply) => {
      const params = paramsSchema.safeParse(request.params);
      const parsed = creditSchema.safeParse(request.body);

      if (!params.success || !parsed.success) {
        return reply.status(400).send({ error: 'Invalid request' });
      }

      const [user] = await db.select({ id: users.id }).from(users).where(eq(users.id, params.data.id)).limit(1);

      if (!user) {
        return reply.status(404).send({ error: 'User not found' });
      }

      const [ledgerEntry] = await db
        .insert(referralRewardsLedger)
        .values({
          referralId: sql`null`,
          userId: user.id,
          rewardType: 'subscription_credit',
          amountCents: parsed.data.amount_cents,
          status: 'pending',
          appliedToSubscriptionId: null,
          reason: parsed.data.reason,
        } as typeof referralRewardsLedger.$inferInsert)
        .returning();

      await insertAuditLog({
        request,
        action: 'user.subscription_credit_added',
        targetId: user.id,
        payloadSummary: {
          amount_cents: parsed.data.amount_cents,
          reason: parsed.data.reason,
          ledger_id: ledgerEntry.id,
        },
      });

      return reply.status(201).send({
        id: ledgerEntry.id,
        user_id: ledgerEntry.userId,
        amount_cents: ledgerEntry.amountCents,
        status: ledgerEntry.status,
        reason: ledgerEntry.reason,
        created_at: ledgerEntry.createdAt,
      });
    },
  );
}
