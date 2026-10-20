import { expect, test } from '@playwright/test';
import { ADMIN_USERNAME, signIn, signInAndWaitForDashboard } from './support/login';

test.describe('authentication', () => {
  test('sends a signed-out visitor to the sign-in page and back to the page they wanted', async ({
    page,
  }) => {
    await page.goto('/inventory');
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole('heading', { name: 'Sign in to ERP' })).toBeVisible();

    await signIn(page);

    await expect(page).toHaveURL(/\/inventory$/);
    await expect(page.getByRole('heading', { level: 1, name: 'Inventory' })).toBeVisible();
  });

  test('shows one generic message for a wrong password and stays on the sign-in page', async ({
    page,
  }) => {
    await signIn(page, ADMIN_USERNAME, 'definitely not the password');

    await expect(page.getByRole('alert')).toHaveText('Invalid username or password');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('signs in, shows the user and the permitted navigation, and signs out', async ({ page }) => {
    await signInAndWaitForDashboard(page);
    await page.getByRole('button', { name: 'Account menu' }).click();
    await expect(page.getByLabel('Signed in user')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(
      page
        .getByRole('navigation', { name: 'Main navigation' })
        .getByRole('link', { name: 'Settings' }),
    ).toBeVisible();

    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();

    await expect(page).toHaveURL(/\/login$/);
    await page.goto('/');
    await expect(page).toHaveURL(/\/login$/);
  });

  test('keeps the user signed in across a page reload', async ({ page }) => {
    await signInAndWaitForDashboard(page);
    await page.reload();
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
  });

  test('checks the change-password form before sending it', async ({ page }) => {
    await signInAndWaitForDashboard(page);
    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: 'Change password' }).click();
    await page.getByRole('button', { name: 'Change password' }).click();
    await expect(page.getByText('Enter your current password')).toBeVisible();
    await expect(page.getByText('Use at least 12 characters')).toBeVisible();
  });
});
