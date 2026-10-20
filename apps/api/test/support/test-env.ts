import { loadEnv } from '../../src/common/config/env.js';
import type { Env } from '../../src/common/config/env.js';
import { loadRootEnv } from './load-root-env.js';

loadRootEnv();

export const TEST_DATABASE_URL =
  process.env['DATABASE_URL_TEST'] ?? 'postgresql://erp:erp@localhost:5432/erp_test';

function withCredentials(url: string, user: string, password: string): string {
  const parsed = new URL(url);
  parsed.username = user;
  parsed.password = password;
  return parsed.toString();
}

export const TEST_APP_DATABASE_URL = withCredentials(TEST_DATABASE_URL, 'erp_app', 'erp_app');
export const TEST_WORKER_DATABASE_URL = withCredentials(
  TEST_DATABASE_URL,
  'erp_worker',
  'erp_worker',
);

export function testEnv(overrides: Record<string, string> = {}): Env {
  return loadEnv({
    NODE_ENV: 'test',
    LOG_LEVEL: 'silent',
    DATABASE_URL: TEST_APP_DATABASE_URL,
    SESSION_SECRET: 'test-session-secret-0123456789-abcdefghij',
    ...overrides,
  });
}
