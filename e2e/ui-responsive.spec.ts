import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { signInAndWaitForDashboard } from './support/login';

const SCREENS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

const PAGES = [
  '/',
  '/items',
  '/inventory',
  '/customers',
  '/sales',
  '/payments',
  '/reports',
  '/settings',
];

const horizontalOverflow = (page: Page): Promise<number> =>
  page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);

for (const screen of SCREENS) {
  test.describe(`${screen.name} (${screen.width}px)`, () => {
    test.use({ viewport: { width: screen.width, height: screen.height } });

    test('no page scrolls sideways', async ({ page }) => {
      await signInAndWaitForDashboard(page);
      for (const path of PAGES) {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        expect(await horizontalOverflow(page), `${path} overflows sideways`).toBeLessThanOrEqual(0);
      }
    });

    test('a dialog fits the screen and its buttons stay reachable', async ({ page }) => {
      await signInAndWaitForDashboard(page);
      await page.goto('/items');
      await page.getByRole('button', { name: 'New item' }).click();
      const dialog = page.getByRole('dialog');
      await expect(dialog).toBeVisible();
      const box = await dialog.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeLessThanOrEqual(screen.width);
      expect(box!.y).toBeGreaterThanOrEqual(0);
      expect(box!.y + box!.height).toBeLessThanOrEqual(screen.height);
      await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeInViewport();
      await expect(dialog.getByRole('button', { name: /Create item/ })).toBeInViewport();
    });

    test('a wide table scrolls inside its own box, not the page', async ({ page }) => {
      await signInAndWaitForDashboard(page);
      await page.goto('/roles');
      const region = page.getByRole('region', { name: /Roles, scrollable/ });
      await expect(region).toBeVisible();
      expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    });
  });
}

test.describe('navigation by screen size', () => {
  test('phone: the menu is a drawer that opens, navigates and closes', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await signInAndWaitForDashboard(page);
    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeHidden();

    await page.getByRole('button', { name: /menu/i }).first().click();
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav).toBeVisible();
    await nav.getByRole('link', { name: 'Inventory' }).click();

    await expect(page).toHaveURL(/\/inventory$/);
    await expect(nav).toBeHidden();
  });

  test('desktop: the sidebar is always there and can be collapsed to icons', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await signInAndWaitForDashboard(page);
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav).toBeVisible();
    const wide = (await nav.boundingBox())!.width;
    await page
      .getByRole('button', { name: /collapse|sidebar/i })
      .first()
      .click();
    await expect.poll(async () => (await nav.boundingBox())!.width).toBeLessThan(wide);
    await expect(nav.getByRole('link', { name: 'Inventory' })).toBeVisible();
  });
});
