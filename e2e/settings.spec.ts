import { expect, test } from '@playwright/test';
import { signInAndWaitForDashboard } from './support/login';

test.describe('settings', () => {
  test('a Super Admin sees every settings section', async ({ page }) => {
    await signInAndWaitForDashboard(page);
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Settings' })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Settings' })).toBeVisible();
    await expect(page.getByLabel('Company name')).toBeVisible();
    await page.getByRole('tab', { name: 'Document numbers' }).click();
    await expect(page.getByLabel('Financial year')).toBeVisible();
    await page.getByRole('tab', { name: 'Tax rates' }).click();
    await expect(page.getByRole('table', { name: 'GST rates' })).toBeVisible();
    await page.getByRole('tab', { name: 'Audit log' }).click();
    await expect(page.getByLabel('Contains')).toBeVisible();
  });

  test('a saved company name is kept', async ({ page }) => {
    await signInAndWaitForDashboard(page);
    await page.goto('/settings');
    const name = `E2E Motors ${Date.now()}`;
    await page.getByLabel('Company name').fill(name);
    await page.getByRole('button', { name: 'Save' }).first().click();
    await expect(page.getByText('Saved').first()).toBeVisible();
    await page.reload();
    await expect(page.getByLabel('Company name')).toHaveValue(name);
  });
});
