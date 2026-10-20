import { pino } from 'pino';
import { describe, expect, it } from 'vitest';
import { loadWorkerEnv } from './config.js';
import { startWorker } from './worker.js';

/**
 * The worker connects to the queue database as `erp_worker`. Tests use the test database `scripts/db.mjs` prepares, whose
 * worker role has the same name as its password. Set WORKER_DATABASE_URL_TEST to point somewhere else.
 */
const WORKER_URL =
  process.env['WORKER_DATABASE_URL_TEST'] ??
  'postgresql://erp_worker:erp_worker@localhost:5432/erp_test';

describe('startWorker', () => {
  it('starts and stops cleanly', async () => {
    const env = loadWorkerEnv({ WORKER_DATABASE_URL: WORKER_URL });
    const worker = await startWorker(env, pino({ level: 'silent' }));
    await expect(worker.stop('SIGTERM')).resolves.toBeUndefined();
  });

  it('refuses to start, and leaves nothing open, when the database cannot be reached', async () => {
    const env = loadWorkerEnv({
      WORKER_DATABASE_URL: 'postgresql://erp_worker:wrong@localhost:5432/erp_test',
    });
    await expect(startWorker(env, pino({ level: 'silent' }))).rejects.toThrow();
  });
});
