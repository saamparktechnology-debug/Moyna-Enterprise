import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { OWNER_URL } from './env.js';

const repoRoot = fileURLToPath(new URL('../../../', import.meta.url));

export default async function setup(): Promise<void> {
  const client = new pg.Client({ connectionString: OWNER_URL, connectionTimeoutMillis: 3000 });
  try {
    await client.connect();
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Cannot reach the test database (${reason}). Start it with "pnpm db:up" and check DATABASE_URL_TEST in .env.`,
      { cause: error },
    );
  } finally {
    await client.end().catch(() => undefined);
  }
  execFileSync(process.execPath, [`${repoRoot}scripts/db.mjs`, 'prepare-test'], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL_TEST: OWNER_URL },
    stdio: 'inherit',
  });
}
