import Stripe from 'stripe';
import { db } from '@psi/db';
import { billingEventsLog, subscriptions } from '@psi/db/schema';

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

    const session = await stripe.checkout.sessions.create({
      mode: 'subscription',
      success_url: `${getFrontendAppUrl()}/onboarding?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${getFrontendWebUrl()}/pricing`,
      metadata: {
        userId: params.userId,
        productId: params.productId,
        referralCodeUsed: params.referralCodeUsed ?? '',
      },
      line_items: [],
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

    const subscriptionId = this.extractSubscriptionId(event);

    await db.insert(billingEventsLog).values({
      subscriptionId,
      eventType: event.type,
      provider: 'stripe',
      providerEventId: event.id,
      payload: event as unknown as Record<string, unknown>,
      processedAt: new Date(),
    });

    if (normalizedEvent) {
      queueMicrotask(() => {
        this.eventEmitter.emit(normalizedEvent);
      });
    }
  }

  private async mapStripeEvent(event: Stripe.Event): Promise<BillingEvent | null> {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        const subscriptionId = String(session.subscription ?? '');
        const userId = session.metadata?.userId;
        const productId = session.metadata?.productId;

        if (!subscriptionId || !userId || !productId) {
          return null;
        }

        return {
          type: 'subscription.activated',
          subscriptionId,
          userId,
          productId,
        };
      }

      case 'invoice.paid': {
        const invoice = event.data.object as Stripe.Invoice;

        if ((invoice.billing_reason ?? '') === 'subscription_create') {
          return null;
        }

        const subscriptionId = typeof invoice.subscription === 'string'
          ? invoice.subscription
          : invoice.subscription?.id;

        if (!subscriptionId) {
          return null;
        }

        return {
          type: 'subscription.renewed',
          subscriptionId,
        };
      }

      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        const subscriptionId = typeof invoice.subscription === 'string'
          ? invoice.subscription
          : invoice.subscription?.id;

        if (!subscriptionId) {
          return null;
        }

        return {
          type: 'subscription.payment_failed',
          subscriptionId,
        };
      }

      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;

        return {
          type: 'subscription.cancelled',
          subscriptionId: subscription.id,
        };
      }

      default:
        return null;
    }
  }

  private extractSubscriptionId(event: Stripe.Event): string {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session = event.data.object as Stripe.Checkout.Session;
        return String(session.subscription ?? 'unknown');
      }
      case 'invoice.paid':
      case 'invoice.payment_failed': {
        const invoice = event.data.object as Stripe.Invoice;
        return typeof invoice.subscription === 'string'
          ? invoice.subscription
          : invoice.subscription?.id ?? 'unknown';
      }
      case 'customer.subscription.deleted': {
        const subscription = event.data.object as Stripe.Subscription;
        return subscription.id;
      }
      default:
        return 'unknown';
    }
  }
}

export const billingEventEmitter = new BillingEventEmitter();
export const stripeAdapter = new StripeAdapter(billingEventEmitter);
