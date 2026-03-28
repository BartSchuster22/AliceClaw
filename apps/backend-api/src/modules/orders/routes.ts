import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAuth } from '../../auth.js';
import { db } from '@psi/db';
import { orders, products } from '@psi/db/schema';
import { stripeAdapter } from '../billing/index.js';

const createOrderSchema = z.object({
  productId: z.string().uuid(),
  referralCodeUsed: z.string().trim().min(1).optional(),
});

export async function registerOrderRoutes(app: FastifyInstance) {
  app.post('/orders/create', { preHandler: requireAuth }, async (request, reply) => {
    const parsed = createOrderSchema.safeParse(request.body);

    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.flatten() });
    }

    const { productId, referralCodeUsed } = parsed.data;

    const [product] = await db
      .select({ id: products.id, active: products.active })
      .from(products)
      .where(eq(products.id, productId))
      .limit(1);

    if (!product || !product.active) {
      return reply.status(404).send({ error: 'Product not found' });
    }

    const checkoutSession = await stripeAdapter.createCheckoutSession({
      userId: request.user.sub,
      productId,
      referralCodeUsed,
    });

    await db.insert(orders).values({
      userId: request.user.sub,
      productId,
      status: 'pending',
      referralCodeUsed: referralCodeUsed ?? null,
      stripeSessionId: checkoutSession.sessionId,
    });

    return reply.send({ checkoutUrl: checkoutSession.url });
  });
}
