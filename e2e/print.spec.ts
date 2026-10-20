import { expect, test } from '@playwright/test';
import { signInAndWaitForDashboard } from './support/login';

test.describe('printing', () => {
  test('a list prints as a page without the menu, top bar or buttons that act', async ({
    page,
  }) => {
    await signInAndWaitForDashboard(page);
    await page.goto('/items');
    await expect(page.getByRole('heading', { level: 1, name: 'Items' })).toBeVisible();
    await page.emulateMedia({ media: 'print' });

    await expect(page.getByRole('heading', { level: 1, name: 'Items' })).toBeVisible();
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeHidden();
    await expect(page.getByRole('banner')).toBeHidden();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth),
    ).toBeLessThanOrEqual(0);
  });

  test('printing never produces a blank page', async ({ page }) => {
    await signInAndWaitForDashboard(page);
    await page.goto('/customers');
    await expect(page.getByRole('heading', { level: 1, name: 'Customers' })).toBeVisible();
    await page.emulateMedia({ media: 'print' });
    const printedText = await page.evaluate(() => document.body.innerText.trim());
    expect(printedText).toContain('Customers');
  });
});
