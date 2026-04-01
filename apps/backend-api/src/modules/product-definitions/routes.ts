import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAdmin, requireAdminRole } from '../../admin-auth.js';
import { db } from '@psi/db';
import { containerInstances, productDefinitions, products, subscriptions } from '@psi/db/schema';

const createDefinitionSchema = z.object({
  productId: z.string().uuid(),
  dockerImage: z.string().min(1),
  dockerTag: z.string().min(1).default('latest'),
  cpuMillicores: z.number().int().positive(),
  memoryMb: z.number().int().positive(),
  diskGb: z.number().int().positive(),
  envTemplate: z.record(z.string(), z.string()),
  port: z.number().int().min(1000).max(9999),
  healthCheckPath: z.string().min(1).default('/health'),
  startupTimeoutSeconds: z.number().int().min(30).max(600).default(120),
});

const updateDefinitionSchema = createDefinitionSchema.omit({ productId: true }).partial().extend({
  active: z.boolean().optional(),
});

const allowedTemplateVariables = new Set(['user_id', 'subscription_id', 'container_name', 'host_ip']);
const activeDependencyStatuses = [
  'pending_verification',
  'queued',
  'allocating',
  'deploying',
  'starting',
  'running',
  'unhealthy',
  'stopped',
] as const;

function validateEnvTemplate(envTemplate: Record<string, string>) {
  for (const [key, value] of Object.entries(envTemplate)) {
    if (!key.trim()) {
      throw new Error('Environment template keys must not be empty');
    }

    const matches = [...value.matchAll(/{{\s*([a-zA-Z0-9_]+)\s*}}/g)];
    for (const match of matches) {
      const variableName = match[1];
      if (!allowedTemplateVariables.has(variableName)) {
        throw new Error(`Unsupported template variable: ${variableName}`);
      }
    }
  }
}

async function countActiveDependencies(productDefinitionId: string) {
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(containerInstances)
    .where(
      and(
        eq(containerInstances.productDefinitionId, productDefinitionId),
        inArray(containerInstances.status, [...activeDependencyStatuses]),
      ),
    );

  return Number(row?.count ?? 0);
}

export async function registerProductDefinitionRoutes(app: FastifyInstance) {
  app.get(
    '/admin/product-definitions',
    { preHandler: [requireAdmin, requireAdminRole(['super_admin', 'content_admin'])] },
    async () => {
      const rows = await db
        .select({
          id: productDefinitions.id,
          productId: productDefinitions.productId,
          productName: products.name,
          dockerImage: productDefinitions.dockerImage,
          dockerTag: productDefinitions.dockerTag,
          cpuMillicores: productDefinitions.cpuMillicores,
          memoryMb: productDefinitions.memoryMb,
          diskGb: productDefinitions.diskGb,
          port: productDefinitions.port,
          healthCheckPath: productDefinitions.healthCheckPath,
          startupTimeoutSeconds: productDefinitions.startupTimeoutSeconds,
          active: productDefinitions.active,
          createdAt: productDefinitions.createdAt,
          activeInstanceCount: sql<number>`(
            select count(*)
            from container_instances ci
            where ci.product_definition_id = ${productDefinitions.id}
              and ci.status in ('allocating', 'deploying', 'starting', 'running', 'unhealthy')
          )`,
        })
        .from(productDefinitions)
        .innerJoin(products, eq(products.id, productDefinitions.productId))
        .orderBy(desc(productDefinitions.createdAt));

      return rows;
    },
  );

  app.post(
    '/admin/product-definitions',
    { preHandler: [requireAdmin, requireAdminRole(['super_admin', 'content_admin'])] },
    async (request, reply) => {
      const parsed = createDefinitionSchema.safeParse(request.body);
      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.flatten() });
      }

      try {
        validateEnvTemplate(parsed.data.envTemplate);
      } catch (error) {
        return reply.status(400).send({ error: error instanceof Error ? error.message : String(error) });
      }

      const [product] = await db.select().from(products).where(eq(products.id, parsed.data.productId)).limit(1);
      if (!product) {
        return reply.status(404).send({ error: 'Product not found' });
      }

      const [existingActive] = await db
        .select({ id: productDefinitions.id })
        .from(productDefinitions)
        .where(and(eq(productDefinitions.productId, parsed.data.productId), eq(productDefinitions.active, true)))
        .limit(1);

      if (existingActive) {
        return reply.status(409).send({ error: 'An active product definition already exists for this product' });
      }

      const [latestVersion] = await db
        .select({ version: productDefinitions.version })
        .from(productDefinitions)
        .where(eq(productDefinitions.productId, parsed.data.productId))
        .orderBy(desc(productDefinitions.version))
        .limit(1);

      const [created] = await db
        .insert(productDefinitions)
        .values({
          ...parsed.data,
          version: (latestVersion?.version ?? 0) + 1,
          active: true,
        })
        .returning();

      return created;
    },
  );

  app.patch(
    '/admin/product-definitions/:id',
    { preHandler: [requireAdmin, requireAdminRole(['super_admin', 'content_admin'])] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
      const parsed = updateDefinitionSchema.safeParse(request.body);

      if (!params.success || !parsed.success) {
        return reply.status(400).send({ error: 'Invalid request', details: parsed.success ? undefined : parsed.error.flatten() });
      }

      const [definition] = await db
        .select()
        .from(productDefinitions)
        .where(eq(productDefinitions.id, params.data.id))
        .limit(1);

      if (!definition) {
        return reply.status(404).send({ error: 'Product definition not found' });
      }

      if (parsed.data.envTemplate) {
        try {
          validateEnvTemplate(parsed.data.envTemplate);
        } catch (error) {
          return reply.status(400).send({ error: error instanceof Error ? error.message : String(error) });
        }
      }

      const dependencyCount = await countActiveDependencies(definition.id);
      if (dependencyCount > 0) {
        return reply.status(409).send({ error: 'Definition is in use. Create a new definition version instead.' });
      }

      if (parsed.data.active === true) {
        await db
          .update(productDefinitions)
          .set({ active: false })
          .where(and(eq(productDefinitions.productId, definition.productId), eq(productDefinitions.active, true)));
      }

      const [updated] = await db
        .update(productDefinitions)
        .set(parsed.data)
        .where(eq(productDefinitions.id, definition.id))
        .returning();

      return updated;
    },
  );

  app.post(
    '/admin/product-definitions/:id/deactivate',
    { preHandler: [requireAdmin, requireAdminRole(['super_admin'])] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({ error: 'Invalid definition id' });
      }

      const dependencyCount = await countActiveDependencies(params.data.id);
      if (dependencyCount > 0) {
        return reply.status(409).send({ error: `Cannot deactivate: ${dependencyCount} instances depend on this definition` });
      }

      const [updated] = await db
        .update(productDefinitions)
        .set({ active: false })
        .where(eq(productDefinitions.id, params.data.id))
        .returning();

      if (!updated) {
        return reply.status(404).send({ error: 'Product definition not found' });
      }

      return { success: true };
    },
  );

  app.get(
    '/admin/product-definitions/:id/instances',
    { preHandler: [requireAdmin, requireAdminRole(['super_admin', 'provisioning_admin', 'support_admin'])] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({ error: 'Invalid definition id' });
      }

      const rows = await db
        .select({
          containerInstanceId: containerInstances.id,
          userId: containerInstances.userId,
          subscriptionStatus: subscriptions.status,
          containerStatus: containerInstances.status,
          hostServerId: containerInstances.hostServerId,
          startedAt: containerInstances.startedAt,
          agentUrl: containerInstances.agentUrl,
        })
        .from(containerInstances)
        .innerJoin(subscriptions, eq(subscriptions.id, containerInstances.subscriptionId))
        .where(eq(containerInstances.productDefinitionId, params.data.id))
        .orderBy(desc(containerInstances.createdAt));

      return rows;
    },
  );
}
