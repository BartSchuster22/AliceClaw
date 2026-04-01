import { Queue } from 'bullmq';
import { and, eq } from 'drizzle-orm';

import { db } from '@psi/db';
import {
  orders,
  products,
  referralRewardsLedger,
  referrals,
  referralSettings,
  referralUserOverrides,
  subscriptions,
} from '@psi/db/schema';

export type VestReferralRewardPayload = {
  referralId: string;
};

function getRedisUrl() {
  return process.env.REDIS_URL ?? 'redis://redis:6379';
}

async function getReferralQueue() {
  return new Queue<VestReferralRewardPayload>('vest-referral-reward', {
    connection: { url: getRedisUrl() },
  });
}

export async function enqueueVestReferralReward(params: { referralId: string; delayMs: number }) {
  const queue = await getReferralQueue();

  try {
    await queue.add(
      'vest-referral-reward',
      { referralId: params.referralId },
      {
        jobId: `vest-referral-reward-${params.referralId}`,
        delay: params.delayMs,
        removeOnComplete: true,
        removeOnFail: false,
      },
    );
  } finally {
    await queue.close();
  }
}

function getMockStripeMode() {
  return !process.env.STRIPE_SECRET_KEY;
}

async function applyReferralCredit(params: {
  referrerUserId: string;
  amountCents: number;
  referralId: string;
  subscriptionId: string;
}): Promise<'applied' | 'deferred'> {
  if (getMockStripeMode()) {
    console.log('[referrals] mock apply credit', params);
    return 'applied';
  }

  console.warn('[referrals] live Stripe credit application is not yet implemented; leaving ledger entry pending', params);
  return 'deferred';
}

async function syncReferralStatusFromLedger(referralId: string) {
  const ledgerRows = await db
    .select({ status: referralRewardsLedger.status })
    .from(referralRewardsLedger)
    .where(eq(referralRewardsLedger.referralId, referralId));

  const nextReferralStatus = ledgerRows.some((row) => row.status === 'applied') ? 'rewarded' : 'converted';

  await db.update(referrals).set({ status: nextReferralStatus }).where(eq(referrals.id, referralId));
}

export async function processVestReferralReward(payload: VestReferralRewardPayload) {
  const [referral] = await db.select().from(referrals).where(eq(referrals.id, payload.referralId)).limit(1);

  if (!referral) {
    throw new Error('Referral not found');
  }

  if (!referral.orderId) {
    throw new Error('Referral has no orderId');
  }

  if (referral.status === 'fraud_flagged') {
    return;
  }

  const [subscription] = await db
    .select()
    .from(subscriptions)
    .where(and(eq(subscriptions.userId, referral.referredUserId), eq(subscriptions.orderId, referral.orderId)))
    .limit(1);

  if (!subscription || subscription.status !== 'active') {
    await db.update(referrals).set({ status: 'voided' }).where(eq(referrals.id, referral.id));
    return;
  }

  const [existingLedger] = await db
    .select({ id: referralRewardsLedger.id })
    .from(referralRewardsLedger)
    .where(eq(referralRewardsLedger.referralId, referral.id))
    .limit(1);

  if (existingLedger) {
    return;
  }

  const [override] = await db
    .select()
    .from(referralUserOverrides)
    .where(eq(referralUserOverrides.userId, referral.referrerUserId))
    .limit(1);

  const [globalSettings] = await db.select().from(referralSettings).where(eq(referralSettings.id, 1)).limit(1);

  const rewardRate = override
    ? Number(override.customRewardRatePercent)
    : Number(globalSettings?.globalRewardRatePercent ?? '10.00');

  const [order] = await db.select().from(orders).where(eq(orders.id, referral.orderId)).limit(1);

  if (!order) {
    throw new Error('Order not found for referral');
  }

  const [product] = await db.select().from(products).where(eq(products.id, order.productId)).limit(1);

  if (!product) {
    throw new Error('Product not found for referral');
  }

  const amountCents = Math.round((product.priceCents * rewardRate) / 100);

  const [ledger] = await db
    .insert(referralRewardsLedger)
    .values({
      referralId: referral.id,
      userId: referral.referrerUserId,
      rewardType: 'subscription_credit',
      amountCents,
      status: 'pending',
      appliedToSubscriptionId: subscription.id,
      reason: `Referral reward for referral ${referral.id}`,
    })
    .returning();

  const creditResult = await applyReferralCredit({
    referrerUserId: referral.referrerUserId,
    amountCents,
    referralId: referral.id,
    subscriptionId: subscription.id,
  });

  if (creditResult === 'applied') {
    await db
      .update(referralRewardsLedger)
      .set({ status: 'applied' })
      .where(eq(referralRewardsLedger.id, ledger.id));
  }

  await syncReferralStatusFromLedger(referral.id);
}
