import Fastify from 'fastify';
import cors from '@fastify/cors';

import { registerAuthModule, requireAuth } from './auth.js';

if (!process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET is required');
}

const app = Fastify({ logger: true });
const port = Number(process.env.PORT ?? 4000);
const host = process.env.HOST ?? '0.0.0.0';

await app.register(cors, {
  origin: true,
  credentials: true,
});

await registerAuthModule(app);

app.get('/health', async () => ({
  status: 'ok',
  timestamp: new Date().toISOString(),
}));

app.get('/health/auth', { preHandler: requireAuth }, async () => ({
  status: 'ok',
  timestamp: new Date().toISOString(),
}));

await app.listen({ host, port });
