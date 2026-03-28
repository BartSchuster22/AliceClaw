import { eq } from 'drizzle-orm';
import { Queue } from 'bullmq';

import { db } from '@psi/db';
import {
  billingEventsLog,
  orders,
  provisioningJobs,
  subscriptions,
  vpsInstances,
} from '@psi/db/schema';

import type { BillingEventEmitter } from './emitter.js';

async function enqueueProvisionInstanceJob(payload: {
  subscriptionId: string;
  vpsInstanceId: string;
  jobId: string;
}) {
  const queue = new Queue('provision-instance', {
    connection: {
      url: process.env.REDIS_URL ?? 'redis://redis:6379',
    },
  });

  try {
    await queue.add('provision-instance', payload);
  } finally {
    await queue.close();
  }
}

export function registerBillingHandlers(eventEmitter: BillingEventEmitter) {
  eventEmitter.on('subscription.activated', async (event) => {
    const [existingOrder] = await db
      .select({ id: orders.id })
      .from(orders)
      .where(eq(orders.id, event.subscriptionId))
      .limit(1);

    const [order] = existingOrder
      ? [existingOrder]
      : await db
          .insert(orders)
          .values({
            id: event.subscriptionId,
            userId: event.userId,
            productId: event.productId,
            status: 'paid',
          })
          .returning();

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
          billingProviderSubscriptionId: event.billingProviderSubscriptionId,
          cancelAtPeriodEnd: false,
        },
      })
      .returning();

    const [vpsInstance] = await db
      .insert(vpsInstances)
      .values({
        subscriptionId: subscription.id,
        userId: event.userId,
        region: 'eu-central',
        status: 'queued',
      })
      .onConflictDoUpdate({
        target: vpsInstances.subscriptionId,
        set: {
          status: 'queued',
        },
      })
      .returning();

    const [job] = await db
      .insert(provisioningJobs)
      .values({
        vpsInstanceId: vpsInstance.id,
        subscriptionId: subscription.id,
        status: 'queued',
      })
      .returning();

    try {
      await enqueueProvisionInstanceJob({
        subscriptionId: subscription.id,
        vpsInstanceId: vpsInstance.id,
        jobId: job.id,
      });
    } catch (error) {
      console.error('[billing] failed to enqueue provision-instance job:', error);
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
