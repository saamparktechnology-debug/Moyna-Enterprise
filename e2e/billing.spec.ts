import { expect, test } from '@playwright/test';
import { signInAndWaitForDashboard } from './support/login';

test.describe('sales and invoices', () => {
  test('the Sales page opens for a Super Admin with its list and filters', async ({ page }) => {
    await signInAndWaitForDashboard(page);
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Sales' })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Sales' })).toBeVisible();
    await expect(page.getByLabel('Search', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Status')).toBeVisible();
    await expect(page.getByRole('button', { name: 'New invoice' })).toBeVisible();
  });

  test('refuses a draft invoice that has no customer, item or price', async ({ page }) => {
    await signInAndWaitForDashboard(page);
    await page.goto('/sales');
    await page.getByRole('button', { name: 'New invoice' }).click();
    const dialog = page.getByRole('dialog', { name: 'New invoice' });
    await dialog.getByRole('button', { name: 'Save draft' }).click();
    await expect(dialog.getByLabel('Customer')).toHaveAttribute('aria-invalid', 'true');
    await expect(dialog.getByLabel('Item for line 1')).toHaveAttribute('aria-invalid', 'true');
    await expect(dialog.getByLabel('Price for line 1')).toHaveAttribute('aria-invalid', 'true');
  });

  test('the Credit notes tab opens with its search and status filter', async ({ page }) => {
    await signInAndWaitForDashboard(page);
    await page.goto('/sales');
    await page.getByRole('tab', { name: 'Credit notes' }).click();
    await expect(page.getByLabel('Search credit notes')).toBeVisible();
    await expect(page.getByLabel('Credit note status')).toBeVisible();
  });
});
