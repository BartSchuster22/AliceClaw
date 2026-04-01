import { ServerClient } from 'postmark';
import { eq } from 'drizzle-orm';

import { db } from '@psi/db';
import { users } from '@psi/db/schema';

function getPostmarkClient() {
  const token = process.env.POSTMARK_API_TOKEN;

  if (!token) {
    return null;
  }

  return new ServerClient(token);
}

function getFromEmail() {
  return process.env.POSTMARK_FROM_EMAIL ?? 'hello@psi.local';
}

function logSkippedEmail(kind: string, payload: Record<string, unknown>) {
  console.warn(`[worker][notifications] skipping ${kind} email because POSTMARK_API_TOKEN is not configured`, payload);
}

export const notificationService = {
  async sendVerificationEmail(params: {
    userId: string;
    subscriptionId: string;
    productName: string;
    verificationUrl: string;
  }) {
    const [user] = await db
      .select({ email: users.email, fullName: users.fullName })
      .from(users)
      .where(eq(users.id, params.userId))
      .limit(1);

    if (!user) {
      throw new Error('User not found for verification email');
    }

    const client = getPostmarkClient();
    const body = [
      `Hi ${user.fullName},`,
      '',
      `You’ve purchased ${params.productName}.`,
      'Confirm your email to start setting up your agent.',
      '',
      params.verificationUrl,
      '',
      'This link is valid for 24 hours.',
      'If you did not make this purchase, you can safely ignore this email.',
    ].join('\n');

    if (!client) {
      logSkippedEmail('verification', {
        userId: params.userId,
        subscriptionId: params.subscriptionId,
        email: user.email,
        verificationUrl: params.verificationUrl,
      });
      return;
    }

    await client.sendEmail({
      From: getFromEmail(),
      To: user.email,
      Subject: `Confirm your email to start your ${params.productName} setup`,
      TextBody: body,
    });
  },

  async sendAgentReadyEmail(params: { userId: string; productName: string; agentUrl: string }) {
    const [user] = await db
      .select({ email: users.email, fullName: users.fullName })
      .from(users)
      .where(eq(users.id, params.userId))
      .limit(1);

    if (!user) {
      throw new Error('User not found for ready email');
    }

    const client = getPostmarkClient();
    const body = [
      `Hi ${user.fullName},`,
      '',
      'Your agent has been set up successfully.',
      `Access it here: ${params.agentUrl}`,
      'Bookmark this link for quick access.',
      'Open the link above to begin using your agent.',
    ].join('\n');

    if (!client) {
      logSkippedEmail('agent-ready', {
        userId: params.userId,
        email: user.email,
        agentUrl: params.agentUrl,
      });
      return;
    }

    await client.sendEmail({
      From: getFromEmail(),
      To: user.email,
      Subject: `Your ${params.productName} agent is ready`,
      TextBody: body,
    });
  },
};
