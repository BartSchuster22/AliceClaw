import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';
import * as schema from './schema.js';

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://openclaw:dev_password@postgres:5432/openclaw';

const client = postgres(connectionString, {
  max: 1,
});

export const db = drizzle(client, { schema });
export { client, schema };
