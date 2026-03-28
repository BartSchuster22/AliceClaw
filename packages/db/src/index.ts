import postgres from 'postgres';
import { drizzle } from 'drizzle-orm/postgres-js';

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://openclaw:dev_password@localhost:5432/openclaw';

const client = postgres(connectionString, {
  max: 1,
});

export const db = drizzle(client);
export { client };
