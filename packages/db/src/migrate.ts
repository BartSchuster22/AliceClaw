import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { drizzle } from 'drizzle-orm/postgres-js';
import postgres from 'postgres';

const connectionString =
  process.env.DATABASE_URL ?? 'postgres://openclaw:dev_password@postgres:5432/openclaw';

const sql = postgres(connectionString, { max: 1 });
const db = drizzle(sql);

async function main() {
  await migrate(db, {
    migrationsFolder: 'drizzle',
  });

  console.log('Migrations applied successfully.');
}

main()
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await sql.end();
  });
