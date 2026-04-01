import { and, eq } from 'drizzle-orm';

import crypto from 'node:crypto';

import { db } from '@psi/db';
import {
  billingEventsLog,
  containerInstances,
  emailVerifications,
  orders,
  productDefinitions,
  provisioningJobs,
  referralSettings,
  referrals,
  subscriptions,
} from '@psi/db/schema';

import type { BillingEventEmitter } from './emitter.js';
import { enqueueVestReferralReward } from './referral-jobs.js';
import { notificationService } from '../../services/notification-service.js';

function getBackendApiUrl() {
  return process.env.BACKEND_API_URL ?? 'http://localhost:4000';
}

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

export function registerBillingHandlers(eventEmitter: BillingEventEmitter) {
  eventEmitter.on('subscription.activated', async (event) => {
    const [order] = await db
      .select({ id: orders.id, productId: orders.productId, userId: orders.userId })
      .from(orders)
      .where(and(eq(orders.userId, event.userId), eq(orders.productId, event.productId), eq(orders.status, 'paid')))
      .limit(1);

    if (!order) {
      throw new Error(`Paid order not found for activation event: user=${event.userId} product=${event.productId}`);
    }

    const [subscription] = await db
      .insert(subscriptions)
      .values({
        id: event.subscriptionId,
        userId: event.userId,
        productId: event.productId,
        orderId: order.id,
        billingProvider: 'stripe',
        billingProviderSubscriptionId: event.billingProviderSubscriptionId,
        status: 'active',
        currentPeriodStart: new Date(),
        currentPeriodEnd: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000),
        cancelAtPeriodEnd: false,
      })
      .onConflictDoUpdate({
        target: subscriptions.id,
        set: {
          status: 'active',
          orderId: order.id,
          billingProviderSubscriptionId: event.billingProviderSubscriptionId,
          cancelAtPeriodEnd: false,
        },
      })
      .returning();

    await db.insert(billingEventsLog).values({
      subscriptionId: subscription.id,
      eventType: event.type,
      provider: 'internal',
      providerEventId: `internal:${event.type}:${event.billingProviderSubscriptionId}`,
      payload: { ...event, orderId: order.id } as unknown as Record<string, unknown>,
      processedAt: new Date(),
    });

    const [productDefinition] = await db
      .select()
      .from(productDefinitions)
      .where(and(eq(productDefinitions.productId, event.productId), eq(productDefinitions.active, true)))
      .limit(1);

    if (!productDefinition) {
      console.error('[billing] no active product definition for subscription activation', {
        subscriptionId: subscription.id,
        productId: event.productId,
      });
    } else {
      const [containerInstance] = await db
        .insert(containerInstances)
        .values({
          subscriptionId: subscription.id,
          userId: event.userId,
          productDefinitionId: productDefinition.id,
          status: 'pending_verification',
        })
        .returning();

      await db.insert(provisioningJobs).values({
        containerInstanceId: containerInstance.id,
        subscriptionId: subscription.id,
        status: 'queued',
        currentStep: 'waiting_for_email_verification',
      });

      const rawToken = crypto.randomBytes(32).toString('hex');
      const tokenHash = hashToken(rawToken);
      const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000);

      await db.insert(emailVerifications).values({
        userId: event.userId,
        subscriptionId: subscription.id,
        tokenHash,
        expiresAt,
      });

      const verificationUrl = `${getBackendApiUrl()}/auth/verify-email?token=${rawToken}`;
      await notificationService.sendVerificationEmail({
        userId: event.userId,
        subscriptionId: subscription.id,
        productName: 'PSI Agent',
        verificationUrl,
      });
    }

    const [pendingReferral] = await db
      .select()
      .from(referrals)
      .where(and(eq(referrals.referredUserId, event.userId), eq(referrals.status, 'pending')))
      .limit(1);

    if (pendingReferral) {
      await db
        .update(referrals)
        .set({
          orderId: order.id,
          status: 'converted',
        })
        .where(eq(referrals.id, pendingReferral.id));

      const [settings] = await db.select().from(referralSettings).where(eq(referralSettings.id, 1)).limit(1);
      const coolingPeriodDays = settings?.coolingPeriodDays ?? 14;

      try {
        await enqueueVestReferralReward({
          referralId: pendingReferral.id,
          delayMs: coolingPeriodDays * 24 * 60 * 60 * 1000,
        });
      } catch (error) {
        console.error('[billing] failed to enqueue vest-referral-reward job:', error);
      }
    }
  });

  eventEmitter.on('subscription.payment_failed', async (event) => {
    await db
      .update(subscriptions)
      .set({
        status: 'suspended',
      })
      .where(eq(subscriptions.id, event.subscriptionId));

    await db.insert(billingEventsLog).values({
      subscriptionId: event.subscriptionId,
      eventType: event.type,
      provider: 'internal',
      providerEventId: `${event.type}:${event.subscriptionId}`,
      payload: event as unknown as Record<string, unknown>,
      processedAt: new Date(),
    });
  });

  eventEmitter.on('subscription.cancelled', async (event) => {
    await db
      .update(subscriptions)
      .set({
        status: 'cancelled',
        cancelAtPeriodEnd: true,
      })
      .where(eq(subscriptions.id, event.subscriptionId));
  });
}
