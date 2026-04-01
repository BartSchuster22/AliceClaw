import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import type { FastifyInstance, FastifyRequest } from 'fastify';
import { z } from 'zod';

import { requireAdmin, requireAdminRole } from '../../admin-auth.js';
import { db } from '@psi/db';
import { adminAuditLog, products, referralRewardsLedger, subscriptions, users } from '@psi/db/schema';
import { stripeAdapter } from '../billing/stripe-adapter.js';

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  status: z.enum(['active', 'suspended', 'cancelled', 'expired', 'provisioning_failed']).optional(),
  product_id: z.string().uuid().optional(),
  created_from: z.string().datetime().optional(),
  created_to: z.string().datetime().optional(),
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

function getStripeDashboardBaseUrl() {
  return process.env.STRIPE_DASHBOARD_BASE_URL ?? 'https://dashboard.stripe.com';
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
    targetType: 'subscription',
    targetId: params.targetId,
    payloadSummary: params.payloadSummary,
    ipAddress: getRequestIp(params.request),
    createdAt: new Date(),
  });
}

export async function registerAdminSubscriptionRoutes(app: FastifyInstance) {
  app.get(
    '/admin/subscriptions',
    { preHandler: [requireAdmin, requireAdminRole(['super_admin', 'billing_admin'])] },
    async (request, reply) => {
      const parsed = listQuerySchema.safeParse(request.query);

      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid query params', details: parsed.error.flatten() });
      }

      const { page, pageSize, status, product_id, created_from, created_to } = parsed.data;
      const offset = (page - 1) * pageSize;

      const whereClauses = [];
      if (status) whereClauses.push(eq(subscriptions.status, status));
      if (product_id) whereClauses.push(eq(subscriptions.productId, product_id));
      if (created_from) whereClauses.push(gte(subscriptions.createdAt, new Date(created_from)));
      if (created_to) whereClauses.push(lte(subscriptions.createdAt, new Date(created_to)));
      const where = whereClauses.length ? and(...whereClauses) : undefined;

      const rows = await db
        .select({
          id: subscriptions.id,
          userEmail: users.email,
          productName: products.name,
          productId: products.id,
          status: subscriptions.status,
          billingProvider: subscriptions.billingProvider,
          billingProviderSubscriptionId: subscriptions.billingProviderSubscriptionId,
          currentPeriodEnd: subscriptions.currentPeriodEnd,
          createdAt: subscriptions.createdAt,
        })
        .from(subscriptions)
        .innerJoin(users, eq(users.id, subscriptions.userId))
        .innerJoin(products, eq(products.id, subscriptions.productId))
        .where(where)
        .orderBy(desc(subscriptions.createdAt))
        .limit(pageSize)
        .offset(offset);

      const [countRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(subscriptions)
        .where(where);

      return {
        page,
        pageSize,
        total: Number(countRow?.count ?? 0),
        items: rows.map((row) => ({
          id: row.id,
          user_email: row.userEmail,
          product: row.productName,
          product_id: row.productId,
          status: row.status,
          billing_provider: row.billingProvider,
          period_end: row.currentPeriodEnd,
          created: row.createdAt,
          stripe_url: row.billingProvider === 'stripe' && row.billingProviderSubscriptionId
            ? `${getStripeDashboardBaseUrl()}/subscriptions/${row.billingProviderSubscriptionId}`
            : null,
        })),
      };
    },
  );

  app.post(
    '/admin/subscriptions/:id/cancel',
    { preHandler: [requireAdmin, requireAdminRole(['super_admin', 'billing_admin'])] },
    async (request, reply) => {
      const parsed = paramsSchema.safeParse(request.params);

      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid subscription id' });
      }

      const [subscription] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, parsed.data.id))
        .limit(1);

      if (!subscription) {
        return reply.status(404).send({ error: 'Subscription not found' });
      }

      if (subscription.billingProvider !== 'stripe' || !subscription.billingProviderSubscriptionId) {
        return reply.status(400).send({ error: 'Subscription cannot be cancelled via provider' });
      }

      await stripeAdapter.cancelSubscription(subscription.billingProviderSubscriptionId);

      const [updated] = await db
        .update(subscriptions)
        .set({
          status: 'cancelled',
          cancelAtPeriodEnd: true,
        })
        .where(eq(subscriptions.id, parsed.data.id))
        .returning();

      await insertAuditLog({
        request,
        action: 'subscription.cancelled',
        targetId: parsed.data.id,
        payloadSummary: {
          billing_provider: subscription.billingProvider,
          billing_provider_subscription_id: subscription.billingProviderSubscriptionId,
        },
      });

      return {
        id: updated.id,
        status: updated.status,
        cancel_at_period_end: updated.cancelAtPeriodEnd,
      };
    },
  );

  app.post(
    '/admin/subscriptions/:id/credit',
    { preHandler: [requireAdmin, requireAdminRole(['super_admin', 'billing_admin'])] },
    async (request, reply) => {
      const params = paramsSchema.safeParse(request.params);
      const parsed = creditSchema.safeParse(request.body);

      if (!params.success || !parsed.success) {
        return reply.status(400).send({ error: 'Invalid request' });
      }

      const [subscription] = await db
        .select()
        .from(subscriptions)
        .where(eq(subscriptions.id, params.data.id))
        .limit(1);

      if (!subscription) {
        return reply.status(404).send({ error: 'Subscription not found' });
      }

      const [ledgerEntry] = await db
        .insert(referralRewardsLedger)
        .values({
          referralId: null,
          userId: subscription.userId,
          rewardType: 'subscription_credit',
          amountCents: parsed.data.amount_cents,
          status: 'pending',
          appliedToSubscriptionId: subscription.id,
          reason: parsed.data.reason,
        })
        .returning();

      await insertAuditLog({
        request,
        action: 'subscription.credit_added',
        targetId: subscription.id,
        payloadSummary: {
          amount_cents: parsed.data.amount_cents,
          reason: parsed.data.reason,
          ledger_id: ledgerEntry.id,
        },
      });

      return reply.status(201).send({
        id: ledgerEntry.id,
        amount_cents: ledgerEntry.amountCents,
        status: ledgerEntry.status,
        reason: ledgerEntry.reason,
        created_at: ledgerEntry.createdAt,
      });
    },
  );
}
