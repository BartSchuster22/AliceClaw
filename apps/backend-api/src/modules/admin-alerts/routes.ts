import { and, desc, eq, isNull } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAdmin, requireAdminRole } from '../../admin-auth.js';
import { db } from '@psi/db';
import { adminAlerts } from '@psi/db/schema';

const internalAlertSchema = z.object({
  type: z.string().min(1),
  severity: z.string().min(1).optional(),
  entityType: z.string().min(1),
  entityId: z.string().uuid(),
  message: z.string().min(1),
  dedupeKey: z.string().min(1).optional(),
});

export async function registerAdminAlertRoutes(app: FastifyInstance) {
  app.post('/internal/alerts', async (request, reply) => {
    const secret = request.headers['x-internal-secret'];
    if (!secret || secret !== process.env.INTERNAL_SECRET) {
      return reply.status(401).send({ error: 'Unauthorized' });
    }

    const parsed = internalAlertSchema.safeParse(request.body);
    if (!parsed.success) {
      return reply.status(400).send({ error: 'Invalid request body', details: parsed.error.flatten() });
    }

    const dedupeKey = parsed.data.dedupeKey ?? `${parsed.data.type}:${parsed.data.entityId}`;
    const [existing] = await db
      .select()
      .from(adminAlerts)
      .where(and(eq(adminAlerts.dedupeKey, dedupeKey), isNull(adminAlerts.resolvedAt)))
      .limit(1);

    if (existing) {
      return existing;
    }

    const [created] = await db
      .insert(adminAlerts)
      .values({
        type: parsed.data.type,
        severity: parsed.data.severity ?? 'warning',
        entityType: parsed.data.entityType,
        entityId: parsed.data.entityId,
        message: parsed.data.message,
        dedupeKey,
      })
      .returning();

    return created;
  });

  app.get(
    '/admin/alerts',
    { preHandler: [requireAdmin, requireAdminRole(['super_admin', 'provisioning_admin'])] },
    async (request) => {
      const query = z
        .object({
          type: z.string().optional(),
          resolved: z.enum(['true', 'false']).optional(),
        })
        .safeParse(request.query);

      const filters = [];
      if (query.success && query.data.type) {
        filters.push(eq(adminAlerts.type, query.data.type));
      }
      if (query.success && query.data.resolved === 'true') {
        filters.push(isNull(adminAlerts.resolvedAt));
      }

      return db.select().from(adminAlerts).orderBy(desc(adminAlerts.createdAt));
    },
  );

  app.patch(
    '/admin/alerts/:id/resolve',
    { preHandler: [requireAdmin, requireAdminRole(['super_admin', 'provisioning_admin'])] },
    async (request, reply) => {
      const params = z.object({ id: z.string().uuid() }).safeParse(request.params);
      if (!params.success) {
        return reply.status(400).send({ error: 'Invalid alert id' });
      }

      const [updated] = await db
        .update(adminAlerts)
        .set({ resolvedAt: new Date() })
        .where(eq(adminAlerts.id, params.data.id))
        .returning();

      if (!updated) {
        return reply.status(404).send({ error: 'Alert not found' });
      }

      return { success: true };
    },
  );
}
