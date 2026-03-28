import { ServerClient } from 'postmark';
import { eq } from 'drizzle-orm';

import { db } from '@psi/db';
import { users } from '@psi/db/schema';

function getPostmarkClient() {
  const token = process.env.POSTMARK_API_TOKEN;

  if (!token) {
    throw new Error('POSTMARK_API_TOKEN is required');
  }

  return new ServerClient(token);
}

function getFromEmail() {
  const from = process.env.POSTMARK_FROM_EMAIL;

  if (!from) {
    throw new Error('POSTMARK_FROM_EMAIL is required');
  }

  return from;
}

export const notificationService = {
  async sendDeliveryEmail(params: { userId: string; ip: string; appPassword: string }) {
    const [user] = await db
      .select({ email: users.email, fullName: users.fullName })
      .from(users)
      .where(eq(users.id, params.userId))
      .limit(1);

    if (!user) {
      throw new Error('User not found for delivery email');
    }

    const client = getPostmarkClient();
    const body = [
      `Hello ${user.fullName},`,
      '',
      'Your OpenClaw instance is ready.',
      '',
      `Instance IP address: ${params.ip}`,
      `OpenClaw application URL: http://${params.ip}:8080`,
      `One-time password: ${params.appPassword}`,
      '',
      'Change this password immediately on first login.',
    ].join('\n');

    await client.sendEmail({
      From: getFromEmail(),
      To: user.email,
      Subject: 'Your OpenClaw instance is ready',
      TextBody: body,
    });
  },
};
