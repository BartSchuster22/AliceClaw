import Fastify from 'fastify';
import cors from '@fastify/cors';

import { registerAuthModule, requireAuth } from './auth.js';
import { registerAdminAuthModule, requireAdmin, requireAdminRole } from './admin-auth.js';
import { registerBillingRoutes } from './modules/billing/index.js';

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required');
}

const app = Fastify({ logger: true });
const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? '0.0.0.0';

app.addContentTypeParser('*', { parseAs: 'buffer' }, (_request, payload, done) => {
  done(null, payload);
});

await app.register(cors, {
  origin: true,
  credentials: true,
});

await registerAuthModule(app);
await registerAdminAuthModule(app);
await registerBillingRoutes(app);

app.get('/health', async () => ({
  status: 'ok',
  timestamp: new Date().toISOString(),
}));

app.get('/health/auth', { preHandler: requireAuth }, async () => ({
  status: 'ok',
  timestamp: new Date().toISOString(),
}));

app.get(
  '/admin/health/auth',
  { preHandler: [requireAdmin, requireAdminRole(['super_admin', 'support_admin'])] },
  async () => ({
    status: 'ok',
    timestamp: new Date().toISOString(),
  }),
);

await app.listen({ host, port });
