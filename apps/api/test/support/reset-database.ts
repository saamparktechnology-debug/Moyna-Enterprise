import pg from 'pg';
import { TEST_DATABASE_URL } from './test-env.js';

const PRESERVED_TABLES = ['_prisma_migrations'];

export async function resetDatabase(): Promise<void> {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });
  await client.connect();
  try {
    const { rows } = await client.query<{ tablename: string }>(
      `SELECT tablename FROM pg_tables WHERE schemaname = 'public' AND tablename <> ALL($1::text[])`,
      [PRESERVED_TABLES],
    );
    if (rows.length === 0) return;
    const names = rows.map((row) => `"public"."${row.tablename.replaceAll('"', '""')}"`).join(', ');
    await client.query(`TRUNCATE TABLE ${names} RESTART IDENTITY CASCADE`);
  } finally {
    await client.end();
  }
}
