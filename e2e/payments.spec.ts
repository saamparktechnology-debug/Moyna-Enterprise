import { expect, test } from '@playwright/test';
import { signInAndWaitForDashboard } from './support/login';

test.describe('payments and dues', () => {
  test('the Payments page opens for a Super Admin with its tabs and filters', async ({ page }) => {
    await signInAndWaitForDashboard(page);
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Payments' })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Payments' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Invoices due' })).toBeVisible();
    await expect(page.getByLabel('Search dues')).toBeVisible();
    await expect(page.getByLabel('Show')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Record payment' })).toBeVisible();
  });

  test('refuses a payment that has no customer or amount', async ({ page }) => {
    await signInAndWaitForDashboard(page);
    await page.goto('/payments');
    await page.getByRole('button', { name: 'Record payment' }).click();
    const dialog = page.getByRole('dialog', { name: 'Record a payment' });
    await dialog.getByRole('button', { name: 'Record payment' }).click();
    await expect(dialog.getByLabel('Customer')).toHaveAttribute('aria-invalid', 'true');
    await expect(dialog.getByLabel('Amount received')).toHaveAttribute('aria-invalid', 'true');
  });

  test('the Customers and Payments tabs open with their search', async ({ page }) => {
    await signInAndWaitForDashboard(page);
    await page.goto('/payments');
    await page.getByRole('tab', { name: 'Customers' }).click();
    await expect(page.getByLabel('Search customers')).toBeVisible();
    await page.getByRole('tab', { name: 'Payments' }).click();
    await expect(page.getByLabel('Search payments')).toBeVisible();
    await expect(page.getByLabel('Payment status')).toBeVisible();
  });
});
