import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';
import { z } from 'zod';

import { requireAdmin, requireAdminRole } from '../../admin-auth.js';
import { db } from '@psi/db';
import { cmsContent } from '@psi/db/schema';
import { invalidatePublicCmsCache } from './cache.js';

const allowedCmsKeys = [
  'hero_headline',
  'hero_subheadline',
  'hero_cta_text',
  'product_card_footer_note',
  'faq_entries',
  'footer_tagline',
] as const;

const keySchema = z.object({
  key: z.enum(allowedCmsKeys),
});

const bodySchema = z.object({
  value: z.union([
    z.string(),
    z.array(
      z.object({
        q: z.string(),
        a: z.string(),
      }),
    ),
  ]),
});

function toAdminCmsRow(row: typeof cmsContent.$inferSelect) {
  return {
    key: row.key,
    value:
      row.key === 'faq_entries'
        ? (() => {
            try {
              return JSON.parse(row.value);
            } catch {
              return [];
            }
          })()
        : row.value,
    updated_at: row.updatedAt,
    updated_by_admin_id: row.updatedByAdminId,
  };
}

export async function registerAdminCmsRoutes(app: FastifyInstance) {
  app.get(
    '/admin/cms',
    { preHandler: [requireAdmin] },
    async () => {
      const rows = await db.select().from(cmsContent).where(inArray(cmsContent.key, [...allowedCmsKeys]));
      return rows.map(toAdminCmsRow);
    },
  );

  app.patch(
    '/admin/cms/:key',
    { preHandler: [requireAdmin, requireAdminRole(['super_admin', 'content_admin'])] },
    async (request, reply) => {
      const params = keySchema.safeParse(request.params);
      const parsed = bodySchema.safeParse(request.body);

      if (!params.success || !parsed.success) {
        return reply.status(400).send({ error: 'Invalid request' });
      }

      const serializedValue =
        params.data.key === 'faq_entries' ? JSON.stringify(parsed.data.value) : String(parsed.data.value);

      const [saved] = await db
        .insert(cmsContent)
        .values({
          key: params.data.key,
          value: serializedValue,
          updatedAt: new Date(),
          updatedByAdminId: request.admin.sub,
        })
        .onConflictDoUpdate({
          target: cmsContent.key,
          set: {
            value: serializedValue,
            updatedAt: new Date(),
            updatedByAdminId: request.admin.sub,
          },
        })
        .returning();

      await invalidatePublicCmsCache();
      return toAdminCmsRow(saved);
    },
  );
}
