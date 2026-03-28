import { eq } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { db } from '@psi/db';
import { products } from '@psi/db/schema';

import { requireAdmin, requireAdminRole } from '../../admin-auth.js';

const productInputSchema = z.object({
  name: z.string().min(1),
  slug: z.string().min(1),
  description: z.string().min(1),
  price_cents: z.number().int().nonnegative(),
  billing_cycle: z.enum(['monthly', 'annual']),
  vps_spec: z.record(z.string(), z.unknown()),
  provisioning_template_id: z.string().min(1),
  active: z.boolean().optional(),
});

const productUpdateSchema = productInputSchema.partial();

function toPublicProduct(product: typeof products.$inferSelect) {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    price_cents: product.priceCents,
    billing_cycle: product.billingCycle,
    vps_spec: product.vpsSpec,
  };
}

function toAdminProduct(product: typeof products.$inferSelect) {
  return {
    id: product.id,
    name: product.name,
    slug: product.slug,
    description: product.description,
    price_cents: product.priceCents,
    billing_cycle: product.billingCycle,
    vps_spec: product.vpsSpec,
    provisioning_template_id: product.provisioningTemplateId,
    active: product.active,
    created_at: product.createdAt,
  };
}

export async function registerProductRoutes(app: FastifyInstance) {
  app.get('/products', async () => {
    const rows = await db.select().from(products).where(eq(products.active, true));
    return rows.map(toPublicProduct);
  });

  app.get('/products/:slug', async (request, reply) => {
    const params = z.object({ slug: z.string().min(1) }).safeParse(request.params);

    if (!params.success) {
      return reply.status(400).send({ error: 'Invalid slug' });
    }

    const [product] = await db
      .select()
      .from(products)
      .where(eq(products.slug, params.data.slug))
      .limit(1);

    if (!product || !product.active) {
      return reply.status(404).send({ error: 'Product not found' });
    }

    return toPublicProduct(product);
  });

  app.get('/admin/products', { preHandler: [requireAdmin] }, async () => {
    const rows = await db.select().from(products);
    return rows.map(toAdminProduct);
  });

  app.post(
    '/admin/products',
    { preHandler: [requireAdmin, requireAdminRole(['super_admin', 'content_admin'])] },
    async (request, reply) => {
      const parsed = productInputSchema.safeParse(request.body);

      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.flatten() });
      }

      const input = parsed.data;
      const [created] = await db
        .insert(products)
        .values({
          name: input.name,
          slug: input.slug,
          description: input.description,
          priceCents: input.price_cents,
          billingCycle: input.billing_cycle,
          vpsSpec: input.vps_spec,
          provisioningTemplateId: input.provisioning_template_id,
          active: input.active ?? true,
        })
        .returning();

      return reply.status(201).send(toAdminProduct(created));
    },
  );

  app.patch(
    '/admin/products/:id',
    { preHandler: [requireAdmin, requireAdminRole(['super_admin', 'content_admin'])] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
      const parsed = productUpdateSchema.safeParse(request.body);

      if (!params.success || !parsed.success) {
        return reply.status(400).send({ error: 'Invalid request' });
      }

      const input = parsed.data;
      const updateValues: Partial<typeof products.$inferInsert> = {};

      if (input.name !== undefined) updateValues.name = input.name;
      if (input.slug !== undefined) updateValues.slug = input.slug;
      if (input.description !== undefined) updateValues.description = input.description;
      if (input.price_cents !== undefined) updateValues.priceCents = input.price_cents;
      if (input.billing_cycle !== undefined) updateValues.billingCycle = input.billing_cycle;
      if (input.vps_spec !== undefined) updateValues.vpsSpec = input.vps_spec;
      if (input.provisioning_template_id !== undefined) {
        updateValues.provisioningTemplateId = input.provisioning_template_id;
      }
      if (input.active !== undefined) updateValues.active = input.active;

      const [updated] = await db
        .update(products)
        .set(updateValues)
        .where(eq(products.id, params.data.id))
        .returning();

      if (!updated) {
        return reply.status(404).send({ error: 'Product not found' });
      }

      return toAdminProduct(updated);
    },
  );

  app.delete(
    '/admin/products/:id',
    { preHandler: [requireAdmin, requireAdminRole(['super_admin'])] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).safeParse(request.params);

      if (!params.success) {
        return reply.status(400).send({ error: 'Invalid product id' });
      }

      const [updated] = await db
        .update(products)
        .set({ active: false })
        .where(eq(products.id, params.data.id))
        .returning();

      if (!updated) {
        return reply.status(404).send({ error: 'Product not found' });
      }

      return reply.status(204).send();
    },
  );
}
