import Fastify from 'fastify';
import cors from '@fastify/cors';

import { registerAuthModule } from './auth.js';

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

await app.listen({ host, port });
