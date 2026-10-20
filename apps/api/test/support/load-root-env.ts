import { existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT_ENV_FILE = fileURLToPath(new URL('../../../../.env', import.meta.url));

export function loadRootEnv(path: string = ROOT_ENV_FILE): void {
  if (existsSync(path)) {
    process.loadEnvFile(path);
  }
}
