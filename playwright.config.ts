import { defineConfig, devices } from '@playwright/test';

try {
  process.loadEnvFile();
} catch {
  // No .env file: CI passes everything through the environment.
}

const API_PORT = 3100;
const WEB_PORT = 5173;
const isCi = Boolean(process.env['CI']);
const ownerUrl = process.env['DATABASE_URL_TEST'] ?? 'postgresql://erp:erp@localhost:5432/erp_test';
// The API runs as the restricted application role, exactly as in production. `pnpm db:migrate:test` provisions it.
const appUrl = new URL(ownerUrl);
appUrl.username = 'erp_app';
appUrl.password = 'erp_app';

// Optional: run against a browser that is already installed (for example in a locked-down sandbox).
const chromiumPath = process.env['PLAYWRIGHT_CHROMIUM_PATH'];
const chromiumArgs = process.env['PLAYWRIGHT_CHROMIUM_ARGS']?.split(' ').filter(Boolean) ?? [];

export default defineConfig({
  testDir: 'e2e',
  fullyParallel: true,
  forbidOnly: isCi,
  retries: isCi ? 2 : 0,
  reporter: isCi ? 'github' : 'list',
  use: { baseURL: `http://localhost:${WEB_PORT}`, trace: 'on-first-retry' },
  projects: [
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        ...(chromiumPath
          ? { launchOptions: { executablePath: chromiumPath, args: chromiumArgs } }
          : {}),
      },
    },
  ],
  webServer: [
    {
      command: 'pnpm --filter @erp/api start',
      url: `http://localhost:${API_PORT}/health`,
      env: {
        NODE_ENV: 'test',
        LOG_LEVEL: 'warn',
        API_PORT: String(API_PORT),
        DATABASE_URL: appUrl.toString(),
        WEB_ORIGIN: `http://localhost:${WEB_PORT}`,
        SESSION_SECRET:
          process.env['SESSION_SECRET'] ?? 'e2e-only-session-secret-0123456789-abcdefgh',
      },
      reuseExistingServer: !isCi,
    },
    {
      command: `pnpm --filter @erp/web dev --port ${WEB_PORT} --strictPort`,
      url: `http://localhost:${WEB_PORT}`,
      env: { API_PROXY_TARGET: `http://localhost:${API_PORT}` },
      reuseExistingServer: !isCi,
    },
  ],
});
