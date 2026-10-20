import { expect, test } from '@playwright/test';
import { signInAndWaitForDashboard } from './support/login';

test.describe('reports', () => {
  test('a Super Admin picks a report, sees its filters and totals, and gets download links', async ({
    page,
  }) => {
    await signInAndWaitForDashboard(page);
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Reports' })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Reports' })).toBeVisible();
    await page.getByRole('combobox', { name: 'Report', exact: true }).selectOption('SALES');
    await expect(page.getByLabel('From', { exact: true })).toBeVisible();
    await expect(page.getByLabel('To', { exact: true })).toBeVisible();
    await expect(page.getByRole('combobox', { name: 'Branch', exact: true })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Download Excel' })).toBeVisible();
    await expect(page.getByRole('link', { name: 'Download PDF' })).toBeVisible();
  });

  test('a report about today hides the dates', async ({ page }) => {
    await signInAndWaitForDashboard(page);
    await page.goto('/reports');
    await page.getByRole('combobox', { name: 'Report', exact: true }).selectOption('STOCK');
    await expect(page.getByText(/the dates do not apply/)).toBeVisible();
    await expect(page.getByLabel('From', { exact: true })).toBeHidden();
  });
});
