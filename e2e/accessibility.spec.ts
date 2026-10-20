import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { signInAndWaitForDashboard } from './support/login';

const TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'];
const PAGES = [
  ['dashboard', '/'],
  ['items', '/items'],
  ['inventory', '/inventory'],
  ['customers', '/customers'],
  ['sales', '/sales'],
  ['payments', '/payments'],
  ['purchasing', '/purchasing'],
  ['reports', '/reports'],
  ['settings', '/settings'],
] as const;

async function violations(page: Page): Promise<string[]> {
  const result = await new AxeBuilder({ page }).withTags(TAGS).analyze();
  return result.violations.map(
    (item) =>
      `${item.impact ?? 'unknown'}: ${item.id} (${item.nodes.length}) ${item.nodes
        .slice(0, 2)
        .map((node) => node.target.join(' '))
        .join(' | ')}`,
  );
}

for (const theme of ['light', 'dark'] as const) {
  test.describe(`axe, ${theme} theme`, () => {
    test.beforeEach(async ({ page }) => {
      await page.emulateMedia({ colorScheme: theme });
      await signInAndWaitForDashboard(page);
      if (theme === 'dark') {
        await page.evaluate(() => document.documentElement.classList.add('dark'));
      }
    });

    for (const [name, path] of PAGES) {
      test(`${name} has no WCAG A or AA violations`, async ({ page }) => {
        await page.goto(path);
        await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
        expect(await violations(page)).toEqual([]);
      });
    }

    test('an open dialog has no violations', async ({ page }) => {
      await page.goto('/items');
      await page.getByRole('button', { name: 'New item' }).click();
      await expect(page.getByRole('dialog')).toBeVisible();
      expect(await violations(page)).toEqual([]);
    });
  });
}

test.describe('keyboard use', () => {
  test('Ctrl+K opens the command palette, filters, opens a screen and Escape closes it', async ({
    page,
  }) => {
    await signInAndWaitForDashboard(page);
    await page.keyboard.press('Control+K');
    const palette = page.getByRole('dialog');
    await expect(palette).toBeVisible();
    await page.keyboard.type('inventory');
    await page.keyboard.press('Enter');
    await expect(page).toHaveURL(/\/inventory$/);
    await expect(palette).toBeHidden();

    await page.keyboard.press('Control+K');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
  });

  test('the skip link is the first tab stop and moves focus to the content', async ({ page }) => {
    await signInAndWaitForDashboard(page);
    await page.goto('/items');
    await expect(page.getByRole('heading', { level: 1, name: 'Items' })).toBeVisible();
    await page.keyboard.press('Tab');
    const skip = page.getByRole('link', { name: 'Skip to main content' });
    await expect(skip).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();
  });

  test('closing a dialog returns focus to the button that opened it', async ({ page }) => {
    await signInAndWaitForDashboard(page);
    await page.goto('/items');
    const opener = page.getByRole('button', { name: 'New item' });
    await opener.focus();
    await page.keyboard.press('Enter');
    await expect(page.getByRole('dialog')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toBeHidden();
    await expect(opener).toBeFocused();
  });

  test('every control on the items screen shows a focus indicator', async ({ page }) => {
    await signInAndWaitForDashboard(page);
    await page.goto('/items');
    const missing: string[] = [];
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      const state = await page.evaluate(() => {
        const element = document.activeElement as HTMLElement | null;
        if (!element || element === document.body) return null;
        const style = getComputedStyle(element);
        const visible =
          (style.outlineStyle !== 'none' && parseFloat(style.outlineWidth) > 0) ||
          style.boxShadow !== 'none';
        return {
          name:
            element.getAttribute('aria-label') ?? element.textContent?.trim() ?? element.tagName,
          visible,
        };
      });
      if (state && !state.visible) missing.push(state.name);
    }
    expect(missing).toEqual([]);
  });
});
