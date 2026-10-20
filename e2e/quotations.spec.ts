import { expect, test } from '@playwright/test';
import { signInAndWaitForDashboard } from './support/login';

test.describe('quotations and customized orders', () => {
  test('the Quotations page opens for a Super Admin with its list and filters', async ({
    page,
  }) => {
    await signInAndWaitForDashboard(page);
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Quotations' })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Quotations' })).toBeVisible();
    await expect(page.getByLabel('Search quotations')).toBeVisible();
    await expect(page.getByLabel('Quotation status')).toBeVisible();
    await expect(page.getByRole('button', { name: 'New quotation' })).toBeVisible();
  });

  test('refuses a quotation that has no customer or lines', async ({ page }) => {
    await signInAndWaitForDashboard(page);
    await page.goto('/quotations');
    await page.getByRole('button', { name: 'New quotation' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Save draft' }).click();
    await expect(dialog.getByLabel('Customer')).toHaveAttribute('aria-invalid', 'true');
    await expect(dialog.getByLabel('Item for line 1')).toHaveAttribute('aria-invalid', 'true');
  });

  test('asks what is to be built when the order is customized', async ({ page }) => {
    await signInAndWaitForDashboard(page);
    await page.goto('/quotations');
    await page.getByRole('button', { name: 'New quotation' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByLabel('A customized build').check();
    await expect(dialog.getByLabel('What is to be built')).toBeVisible();
  });
});
