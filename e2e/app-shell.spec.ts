import { expect, test } from '@playwright/test';
import { signInAndWaitForDashboard } from './support/login';

test.describe('application shell', () => {
  test('shows the layout, navigation and live system status', async ({ page }) => {
    await signInAndWaitForDashboard(page);

    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav).toBeVisible();
    for (const label of ['Dashboard', 'Inventory', 'Sales', 'Customers', 'Reports', 'Settings']) {
      await expect(nav.getByRole('link', { name: label })).toBeVisible();
    }
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await expect(page.getByText(/System healthy/)).toContainText('database up');
  });

  test('routes between screens', async ({ page }) => {
    await signInAndWaitForDashboard(page);

    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Inventory' })
      .click();

    await expect(page).toHaveURL(/\/inventory$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Inventory' })).toBeVisible();
    await expect(page.getByRole('tab', { name: 'Stock', exact: true })).toHaveAttribute(
      'aria-selected',
      'true',
    );
  });

  test('shows a not-found page inside the layout for an unknown route', async ({ page }) => {
    await signInAndWaitForDashboard(page);
    await page.goto('/no-such-page');

    await expect(page.getByRole('heading', { level: 1, name: 'Page not found' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeVisible();
  });
});
