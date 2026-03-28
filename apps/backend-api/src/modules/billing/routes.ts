import type { FastifyInstance } from 'fastify';

import { stripeAdapter } from './stripe-adapter.js';

export async function registerBillingRoutes(app: FastifyInstance) {
  app.post('/billing/webhook', async (request, reply) => {
    const signature = request.headers['stripe-signature'];

    if (typeof signature !== 'string') {
      return reply.status(400).send({ error: 'Missing stripe-signature header' });
    }

    const rawBody = Buffer.isBuffer(request.body)
      ? request.body
      : Buffer.from(String(request.body ?? ''), 'utf8');

    await stripeAdapter.createWebhookHandler(rawBody, signature);

    return reply.status(200).send({ received: true });
  });
}
