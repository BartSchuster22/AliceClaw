import Stripe from 'stripe';
import { randomUUID } from 'node:crypto';
import { eq } from 'drizzle-orm';

import { db } from '@psi/db';
import { billingEventsLog, products, subscriptions } from '@psi/db/schema';

import type { BillingEvent, BillingProvider } from './types.js';
import { BillingEventEmitter } from './emitter.js';

function getStripeClient() {
  const apiKey = process.env.STRIPE_SECRET_KEY;

  if (!apiKey) {
    throw new Error('STRIPE_SECRET_KEY is required');
  }

  return new Stripe(apiKey);
}

function getWebhookSecret() {
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret) {
    throw new Error('STRIPE_WEBHOOK_SECRET is required');
  }

  return secret;
}

function getFrontendAppUrl() {
  return process.env.FRONTEND_APP_URL ?? 'https://app.canariaslibre.com';
}

function getFrontendWebUrl() {
  return process.env.FRONTEND_WEB_URL ?? 'https://web.canariaslibre.com';
}

export class StripeAdapter implements BillingProvider {
  constructor(private readonly eventEmitter: BillingEventEmitter) {}

  async createCheckoutSession(params: {
    userId: string;
    productId: string;
    referralCodeUsed?: string;
  }): Promise<{ url: string; sessionId: string }> {
    const stripe = getStripeClient();
    const [product] = await db.select().from(products).where(eq(products.id, params.productId)).limit(1);

    if (!product) {
      throw new Error('Product not found');
    }

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      success_url: `${getFrontendAppUrl()}/onboarding?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${getFrontendWebUrl()}/pricing`,
      metadata: {
        userId: params.userId,
        productId: params.productId,
        referralCodeUsed: params.referralCodeUsed ?? '',
      },
      line_items: [
        {
          price_data: {
            currency: 'eur',
            product_data: {
              name: product.name,
              description: product.description,
            },
            recurring: {
              interval: product.billingCycle === 'annual' ? 'year' : 'month',
            },
            unit_amount: product.priceCents,
          },
          quantity: 1,
        },
      ],
    });

    if (!session.url) {
      throw new Error('Stripe checkout session did not return a URL');
    }

    return {
      url: session.url,
      sessionId: session.id,
    };
  }

  async cancelSubscription(billingSubscriptionId: string): Promise<void> {
    const stripe = getStripeClient();
    await stripe.subscriptions.cancel(billingSubscriptionId);
  }

  async getSubscription(
    billingSubscriptionId: string,
  ): Promise<{ status: string; currentPeriodEnd: Date }> {
    const stripe = getStripeClient();
    const subscription = await stripe.subscriptions.retrieve(billingSubscriptionId);

    return {
      status: subscription.status,
      currentPeriodEnd: new Date(subscription.current_period_end * 1000),
    };
  }

  async createWebhookHandler(rawBody: Buffer, signature: string): Promise<void> {
    const stripe = getStripeClient();
    const event = stripe.webhooks.constructEvent(rawBody, signature, getWebhookSecret());

    const normalizedEvent = await this.mapStripeEvent(event);

    if (normalizedEvent) {
      await db.insert(billingEventsLog).values({
        subscriptionId: normalizedEvent.subscriptionId,
        eventType: event.type,
        provider: 'stripe',
        providerEventId: event.id,
        payload: event as unknown as Record<string, unknown>,
        processedAt: new Date(),
      });

      queueMicrotask(() => {
        this.eventEmitter.emit(normalizedEvent);
      });
    }
  }

  private async mapStripeEvent(event: Stripe.Event): Promise<BillingEvent | null> {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const billingProviderSubscriptionId = String(session.subscription ?? '');
        const userId = session.metadata?.userId;
        const productId = session.metadata?.productId;

        if (!billingProviderSubscriptionId || !userId || !productId) {
          return null;
        }

        const [existingSubscription] = await db
          .select({ id: subscriptions.id })
          .from(subscriptions)
          .where(eq(subscriptions.billingProviderSubscriptionId, billingProviderSubscriptionId))
          .limit(1);

        const subscriptionId = existingSubscription?.id ?? randomUUID();

        return {
          type: 'subscription.activated',
          subscriptionId,
          billingProviderSubscriptionId,
          userId,
          productId,
        };
      }

      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;

        if ((invoice.billing_reason ?? '') === 'subscription_create') {
          return null;
        }

        const billingProviderSubscriptionId = typeof invoice.subscription === 'string'
          ? invoice.subscription
          : invoice.subscription?.id;

        if (!billingProviderSubscriptionId) {
          return null;
        }

        const [subscription] = await db
          .select({ id: subscriptions.id })
          .from(subscriptions)
          .where(eq(subscriptions.billingProviderSubscriptionId, billingProviderSubscriptionId))
          .limit(1);

        if (!subscription) {
          return null;
        }

        return {
          type: 'subscription.renewed',
          subscriptionId: subscription.id,
          billingProviderSubscriptionId,
        };
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const billingProviderSubscriptionId = typeof invoice.subscription === 'string'
          ? invoice.subscription
          : invoice.subscription?.id;

        if (!billingProviderSubscriptionId) {
          return null;
        }

        const [subscription] = await db
          .select({ id: subscriptions.id })
          .from(subscriptions)
          .where(eq(subscriptions.billingProviderSubscriptionId, billingProviderSubscriptionId))
          .limit(1);

        if (!subscription) {
          return null;
        }

        return {
          type: 'subscription.payment_failed',
          subscriptionId: subscription.id,
          billingProviderSubscriptionId,
        };
      }

      case 'customer.subscription.deleted': {
        const stripeSubscription = event.data.object as Stripe.Subscription;
        const billingProviderSubscriptionId = stripeSubscription.id;
        const [subscription] = await db
          .select({ id: subscriptions.id })
          .from(subscriptions)
          .where(eq(subscriptions.billingProviderSubscriptionId, billingProviderSubscriptionId))
          .limit(1);

        if (!subscription) {
          return null;
        }

        return {
          type: 'subscription.cancelled',
          subscriptionId: subscription.id,
          billingProviderSubscriptionId,
        };
      }

      default:
        return null;
    }
  }
}

export const billingEventEmitter = new BillingEventEmitter();
export const stripeAdapter = new StripeAdapter(billingEventEmitter);
