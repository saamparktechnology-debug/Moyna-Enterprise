import pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { resetDatabase } from '../support/reset-database.js';
import { TEST_DATABASE_URL } from '../support/test-env.js';

describe('resetDatabase', () => {
  const client = new pg.Client({ connectionString: TEST_DATABASE_URL });

  beforeAll(async () => {
    await client.connect();
  });

  afterAll(async () => {
    await client.query('DROP TABLE IF EXISTS reset_probe, _prisma_migrations');
    await client.end();
  });

  it('empties application tables and restarts identity counters', async () => {
    await client.query(
      'CREATE TABLE IF NOT EXISTS reset_probe (id serial PRIMARY KEY, label text)',
    );
    await client.query("INSERT INTO reset_probe (label) VALUES ('a'), ('b')");

    await resetDatabase();

    const count = await client.query('SELECT count(*)::int AS n FROM reset_probe');
    expect(count.rows[0].n).toBe(0);
    const inserted = await client.query(
      "INSERT INTO reset_probe (label) VALUES ('c') RETURNING id",
    );
    expect(inserted.rows[0].id).toBe(1);
  });

  it('leaves the Prisma migration history untouched', async () => {
    await client.query('CREATE TABLE IF NOT EXISTS _prisma_migrations (name text)');
    await client.query("INSERT INTO _prisma_migrations (name) VALUES ('0001_init')");

    await resetDatabase();

    const count = await client.query('SELECT count(*)::int AS n FROM _prisma_migrations');
    expect(count.rows[0].n).toBe(1);
  });
});
