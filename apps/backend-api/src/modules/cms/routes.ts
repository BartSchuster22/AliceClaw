import { eq, inArray } from 'drizzle-orm';
import type { FastifyInstance } from 'fastify';

import { db } from '@psi/db';
import { cmsContent } from '@psi/db/schema';
import { getCachedPublicCms, setCachedPublicCms } from './cache.js';

const PUBLIC_CMS_KEYS = [
  'hero_headline',
  'hero_subheadline',
  'hero_cta_text',
  'product_card_footer_note',
  'faq_entries',
  'footer_tagline',
] as const;

export async function registerCmsRoutes(app: FastifyInstance) {
  app.get('/cms/public', async () => {
    const cached = await getCachedPublicCms();
    if (cached) {
      return cached;
    }

    const rows = await db.select().from(cmsContent).where(inArray(cmsContent.key, [...PUBLIC_CMS_KEYS]));

    const payload: Record<string, unknown> = {};

    for (const row of rows) {
      if (row.key === 'faq_entries') {
        try {
          payload[row.key] = JSON.parse(row.value);
        } catch {
          payload[row.key] = [];
        }
      } else {
        payload[row.key] = row.value;
      }
    }

    await setCachedPublicCms(payload);
    return payload;
  });
}
