import { and, desc, eq, gte, lte, sql } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAdmin, requireAdminRole } from '../../admin-auth.js';
import { db } from '@psi/db';
import { adminAuditLog } from '@psi/db/schema';

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  admin: z.string().email().optional(),
  action: z.string().min(1).optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
});

export async function registerAdminAuditLogRoutes(app: FastifyInstance) {
  app.get(
    '/admin/audit-log',
    { preHandler: [requireAdmin, requireAdminRole(['super_admin'])] },
    async (request, reply) => {
      const parsed = listQuerySchema.safeParse(request.query);

      if (!parsed.success) {
        return reply.status(400).send({ error: 'Invalid query params', details: parsed.error.flatten() });
      }

      const { page, pageSize, admin, action, from, to } = parsed.data;
      const offset = (page - 1) * pageSize;

      const whereClauses = [];
      if (admin) {
        whereClauses.push(sql`admins.email = ${admin}`);
      }
      if (action) {
        whereClauses.push(sql`${adminAuditLog.action} ilike ${`%${action}%`}`);
      }
      if (from) {
        whereClauses.push(gte(adminAuditLog.createdAt, new Date(from)));
      }
      if (to) {
        whereClauses.push(lte(adminAuditLog.createdAt, new Date(to)));
      }
      const where = whereClauses.length ? and(...whereClauses) : undefined;

      const rows = await db
        .select({
          id: adminAuditLog.id,
          adminEmail: sql<string>`admins.email`,
          action: adminAuditLog.action,
          targetType: adminAuditLog.targetType,
          targetId: adminAuditLog.targetId,
          ipAddress: adminAuditLog.ipAddress,
          createdAt: adminAuditLog.createdAt,
          payloadSummary: adminAuditLog.payloadSummary,
        })
        .from(adminAuditLog)
        .innerJoin(sql`admin_users as admins`, sql`admins.id = ${adminAuditLog.adminUserId}`)
        .where(where)
        .orderBy(desc(adminAuditLog.createdAt))
        .limit(pageSize)
        .offset(offset);

      const [countRow] = await db
        .select({ count: sql<number>`count(*)` })
        .from(adminAuditLog)
        .innerJoin(sql`admin_users as admins`, sql`admins.id = ${adminAuditLog.adminUserId}`)
        .where(where);

      return {
        page,
        pageSize,
        total: Number(countRow?.count ?? 0),
        items: rows.map((row) => ({
          id: row.id,
          admin_email: row.adminEmail,
          action: row.action,
          target_type: row.targetType,
          target_id: row.targetId,
          timestamp: row.createdAt,
          ip: row.ipAddress,
          payload_summary: row.payloadSummary,
        })),
      };
    },
  );
}
