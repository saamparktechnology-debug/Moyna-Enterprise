import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const rootEnv = fileURLToPath(new URL('../../../.env', import.meta.url));
if (existsSync(rootEnv)) process.loadEnvFile(rootEnv);

export const OWNER_URL =
  process.env['DATABASE_URL_TEST'] ?? 'postgresql://erp:erp@localhost:5432/erp_test';

function withCredentials(url: string, user: string, password: string): string {
  const parsed = new URL(url);
  parsed.username = user;
  parsed.password = password;
  return parsed.toString();
}

export const WORKER_URL = withCredentials(OWNER_URL, 'erp_worker', 'erp_worker');
