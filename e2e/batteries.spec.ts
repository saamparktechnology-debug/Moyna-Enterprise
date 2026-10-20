import { expect, test } from '@playwright/test';
import { signInAndWaitForDashboard } from './support/login';

test.describe('batteries', () => {
  test('the batteries page opens for a Super Admin with its alerts and filters', async ({
    page,
  }) => {
    await signInAndWaitForDashboard(page);
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Batteries' })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Batteries' })).toBeVisible();
    await expect(page.getByLabel('Expiry alerts')).toBeVisible();
    await expect(page.getByLabel('Search', { exact: true })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Record battery details' })).toBeVisible();
  });

  test('asks for a serial number before recording battery details', async ({ page }) => {
    await signInAndWaitForDashboard(page);
    await page.goto('/batteries');
    await page.getByRole('button', { name: 'Record battery details' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Save details' }).click();
    await expect(dialog.getByText('Choose the serial unit')).toBeVisible();
  });
});
