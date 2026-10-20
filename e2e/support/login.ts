import { expect } from '@playwright/test';
import type { Page } from '@playwright/test';

export const ADMIN_USERNAME = process.env['SEED_SUPER_ADMIN_USERNAME'] ?? 'superadmin';
export const ADMIN_PASSWORD =
  process.env['SEED_SUPER_ADMIN_PASSWORD'] ?? 'e2e-super-admin-passphrase';

export async function signIn(
  page: Page,
  username = ADMIN_USERNAME,
  password = ADMIN_PASSWORD,
): Promise<void> {
  await page.goto('/login');
  await page.getByLabel('Username').fill(username);
  await page.getByLabel('Password').fill(password);
  await page.getByRole('button', { name: 'Sign in' }).click();
}

export async function signInAndWaitForDashboard(page: Page): Promise<void> {
  await signIn(page);
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
}
