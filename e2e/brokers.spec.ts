import { expect, test } from '@playwright/test';
import { signInAndWaitForDashboard } from './support/login';

test.describe('brokers and commission', () => {
  test('the Brokers page opens for a Super Admin with its tabs and filters', async ({ page }) => {
    await signInAndWaitForDashboard(page);
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Brokers' })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Brokers' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Commissions' })).toBeVisible();
    await expect(page.getByLabel('Search brokers')).toBeVisible();
    await expect(page.getByLabel('Broker status')).toBeVisible();
    await expect(page.getByRole('button', { name: 'New broker' })).toBeVisible();
  });

  test('refuses a broker that has no name', async ({ page }) => {
    await signInAndWaitForDashboard(page);
    await page.goto('/brokers');
    await page.getByRole('button', { name: 'New broker' }).click();
    const dialog = page.getByRole('dialog', { name: 'New broker' });
    await dialog.getByRole('button', { name: 'Add broker' }).click();
    await expect(dialog.getByLabel('Name')).toHaveAttribute('aria-invalid', 'true');
  });

  test('the Commissions tab opens with its search and status filter', async ({ page }) => {
    await signInAndWaitForDashboard(page);
    await page.goto('/brokers');
    await page.getByRole('tab', { name: 'Commissions' }).click();
    await expect(page.getByLabel('Search commissions')).toBeVisible();
    await expect(page.getByLabel('Commission status')).toBeVisible();
  });
});
