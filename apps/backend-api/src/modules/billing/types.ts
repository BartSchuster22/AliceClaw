export type BillingEvent =
  | {
      type: 'subscription.activated';
      subscriptionId: string;
      billingProviderSubscriptionId: string;
      userId: string;
      productId: string;
    }
  | {
      type: 'subscription.renewed';
      subscriptionId: string;
      billingProviderSubscriptionId: string;
    }
  | {
      type: 'subscription.payment_failed';
      subscriptionId: string;
      billingProviderSubscriptionId: string;
    }
  | {
      type: 'subscription.cancelled';
      subscriptionId: string;
      billingProviderSubscriptionId: string;
    }
  | {
      type: 'subscription.grace_period_ended';
      subscriptionId: string;
    };

export interface BillingProvider {
  createCheckoutSession(params: {
    userId: string;
    productId: string;
    referralCodeUsed?: string;
  }): Promise<{ url: string; sessionId: string }>;
  cancelSubscription(billingSubscriptionId: string): Promise<void>;
  getSubscription(
    billingSubscriptionId: string,
  ): Promise<{ status: string; currentPeriodEnd: Date }>;
}

export type BillingEventHandler<TType extends BillingEvent['type']> = (
  event: Extract<BillingEvent, { type: TType }>,
) => void | Promise<void>;
