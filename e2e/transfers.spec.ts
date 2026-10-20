import { expect, test } from '@playwright/test';
import { signInAndWaitForDashboard } from './support/login';

test.describe('transfers', () => {
  test('the transfers page opens for a Super Admin with its filters and the request button', async ({
    page,
  }) => {
    await signInAndWaitForDashboard(page);
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Transfers' })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Transfers' })).toBeVisible();
    await expect(page.getByLabel('Search', { exact: true })).toBeVisible();
    await expect(page.getByLabel('Status')).toBeVisible();
    await expect(page.getByLabel('Direction')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Ask for stock' })).toBeVisible();
  });

  test('asks for the branch, the item and the quantity before a request can be sent', async ({
    page,
  }) => {
    await signInAndWaitForDashboard(page);
    await page.goto('/transfers');
    await page.getByRole('button', { name: 'Ask for stock' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Send request' }).click();
    await expect(dialog.getByLabel('Take stock from')).toHaveAttribute('aria-invalid', 'true');
    await expect(dialog.getByLabel('Item for line 1')).toHaveAttribute('aria-invalid', 'true');
    await expect(dialog.getByLabel('Quantity for line 1')).toHaveAttribute('aria-invalid', 'true');
  });
});
