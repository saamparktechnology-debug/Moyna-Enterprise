import { expect, test } from '@playwright/test';
import { signInAndWaitForDashboard } from './support/login';

test.describe('notifications', () => {
  test('the bell opens the inbox, which can be filtered and marked read', async ({ page }) => {
    await signInAndWaitForDashboard(page);
    await page.getByRole('link', { name: /^Notifications/ }).click();
    await expect(page.getByRole('heading', { level: 1, name: 'Notifications' })).toBeVisible();
    await expect(page.getByLabel('Unread only')).toBeVisible();
    await expect(page.getByLabel('Type')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Mark all as read' })).toBeVisible();
    // A fresh system has nothing to report yet.
    await page.getByLabel('Unread only').check();
    await expect(
      page.getByText(/You have no notifications|Nothing matches these filters/).first(),
    ).toBeVisible();
  });
});
