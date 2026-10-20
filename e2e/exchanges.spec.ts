import { expect, test } from '@playwright/test';
import { signInAndWaitForDashboard } from './support/login';

test.describe('exchanges', () => {
  test('the Exchanges page opens for a Super Admin with its list and filters', async ({ page }) => {
    await signInAndWaitForDashboard(page);
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Exchanges' })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Exchanges' })).toBeVisible();
    await expect(page.getByLabel('Search exchanges')).toBeVisible();
    await expect(page.getByLabel('Exchange status')).toBeVisible();
    await expect(page.getByLabel('Kind of exchange')).toBeVisible();
    await expect(page.getByRole('button', { name: 'New exchange' })).toBeVisible();
  });

  test('asks for the delivery invoice before anything else', async ({ page }) => {
    await signInAndWaitForDashboard(page);
    await page.goto('/exchanges');
    await page.getByRole('button', { name: 'New exchange' }).click();
    const dialog = page.getByRole('dialog', { name: 'New exchange' });
    await expect(dialog.getByLabel('Delivery invoice')).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Ask for approval' })).toBeDisabled();
  });
});
