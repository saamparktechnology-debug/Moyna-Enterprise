import { expect, test } from '@playwright/test';
import { signInAndWaitForDashboard } from './support/login';

test.describe('dashboards', () => {
  test('a Super Admin sees the company dashboard with its period and branch table', async ({
    page,
  }) => {
    await signInAndWaitForDashboard(page);
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await expect(page.getByLabel('Dashboard period')).toBeVisible();
    await expect(page.getByRole('region', { name: 'Sales and money' })).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Branch performance' })).toBeVisible();
    await expect(page.getByRole('region', { name: 'Alerts' })).toBeVisible();
  });

  test('picking a branch shows its dashboard and going back shows the company again', async ({
    page,
  }) => {
    await signInAndWaitForDashboard(page);
    const show = page.getByLabel('Show');
    await expect(show).toBeVisible();
    await show.selectOption({ index: 1 });
    await expect(page.getByRole('region', { name: 'Stock and transfers' })).toBeVisible();
    await show.selectOption('');
    await expect(page.getByRole('heading', { name: 'Branch performance' })).toBeVisible();
  });

  test('a back-to-front period is refused on the page', async ({ page }) => {
    await signInAndWaitForDashboard(page);
    await page.getByLabel('To', { exact: true }).fill('2020-01-01');
    await expect(page.getByRole('alert')).toContainText('The end date is before the start');
  });
});
