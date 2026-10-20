import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { assertDatabaseReachable } from './database-preflight.js';
import { TEST_DATABASE_URL } from './test-env.js';

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

export default async function setup(): Promise<void> {
  await assertDatabaseReachable(TEST_DATABASE_URL);
  execFileSync(process.execPath, [`${repoRoot}scripts/db.mjs`, 'prepare-test'], {
    cwd: repoRoot,
    env: { ...process.env, DATABASE_URL_TEST: TEST_DATABASE_URL },
    stdio: 'inherit',
  });
}
