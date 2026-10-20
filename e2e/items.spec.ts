import { expect, test } from '@playwright/test';
import { signInAndWaitForDashboard } from './support/login';

const uniqueCode = (): string => `E2E-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

test.describe('items and barcodes', () => {
  test('a Super Admin creates an item with a generated barcode, scans it, prints its label and deactivates it', async ({
    page,
  }) => {
    const code = uniqueCode();
    // Registered before the page loads, so the stub is in place for the whole session.
    await page.addInitScript(() => {
      (window as unknown as { printCalls: number }).printCalls = 0;
      window.print = () => {
        (window as unknown as { printCalls: number }).printCalls += 1;
      };
    });
    await signInAndWaitForDashboard(page);
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Items' })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Items' })).toBeVisible();

    await page.getByRole('button', { name: 'New item' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Create item' }).click();
    await expect(dialog.getByLabel('Category')).toHaveAttribute('aria-invalid', 'true');

    await dialog.getByLabel('Item code').fill(code.toLowerCase());
    await dialog.getByLabel('Name').fill('End to end item');
    await dialog.getByLabel('Category').selectOption({ index: 1 });
    await dialog.getByLabel('Unit', { exact: true }).selectOption('PCS');
    await dialog.getByLabel('HSN code').fill('8703');
    await expect(dialog.getByLabel('GST rate')).toHaveValue('5.00');
    await dialog.getByLabel('Generate a barcode for this item').check();
    await dialog.getByRole('button', { name: 'Create item' }).click();
    await expect(page.getByText(`Item ${code} created`)).toBeVisible();

    await page.getByLabel('Search', { exact: true }).fill(code);
    const row = page.getByRole('row', { name: new RegExp(code) });
    await expect(row).toContainText('End to end item');
    await expect(row).toContainText('5.00%');
    const barcode = (await row.getByText(/^20\d{11}$/).innerText()).trim();

    await page.getByLabel('Scan or type a barcode').fill(barcode);
    await page.getByLabel('Scan or type a barcode').press('Enter');
    await expect(page.getByText(/End to end item/).first()).toBeVisible();

    await row.getByRole('checkbox', { name: `Select ${code} for labels` }).check();
    await page.getByRole('button', { name: 'Print labels (1)' }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Prepare labels' }).click();
    await expect(page.getByRole('img', { name: `Barcode ${barcode}` }).first()).toBeVisible();
    await page.getByRole('dialog').getByRole('button', { name: 'Print', exact: true }).click();
    expect(
      await page.evaluate(() => (window as unknown as { printCalls: number }).printCalls),
    ).toBe(1);
    await page.getByRole('dialog').getByRole('button', { name: 'Close' }).click();

    await row.getByRole('button', { name: `Deactivate ${code}` }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Deactivate' }).click();
    await expect(page.getByText(`Item ${code} deactivated`)).toBeVisible();
    await page.getByLabel('Scan or type a barcode').fill(barcode);
    await page.getByLabel('Scan or type a barcode').press('Enter');
    await expect(page.getByText('This item is inactive and cannot be used.')).toBeVisible();
  });

  test('refuses a duplicate item code with a message next to the field', async ({ page }) => {
    const code = uniqueCode();
    await signInAndWaitForDashboard(page);
    await page.goto('/items');
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await page.getByRole('button', { name: 'New item' }).click();
      const dialog = page.getByRole('dialog');
      await dialog.getByLabel('Item code').fill(code);
      await dialog.getByLabel('Name').fill('Duplicate test');
      await dialog.getByLabel('Category').selectOption({ index: 1 });
      await dialog.getByLabel('Unit', { exact: true }).selectOption('PCS');
      await dialog.getByRole('button', { name: 'Create item' }).click();
      if (attempt === 0) await expect(page.getByText(`Item ${code} created`)).toBeVisible();
    }
    await expect(page.getByText('This code is already used by another item')).toBeVisible();
  });

  test('manages item categories', async ({ page }) => {
    const name = `Cat ${uniqueCode()}`;
    await signInAndWaitForDashboard(page);
    await page.goto('/items');
    await page.getByRole('button', { name: 'Categories' }).click();
    const dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'New category' }).click();
    await dialog.getByLabel('Category name').fill(name);
    await dialog.getByRole('button', { name: 'Add category' }).click();
    await expect(dialog.getByText(`Category ${name} created`)).toBeVisible();
    await dialog.getByRole('button', { name: 'New category' }).click();
    await dialog.getByLabel('Category name').fill(name.toLowerCase());
    await dialog.getByRole('button', { name: 'Add category' }).click();
    await expect(dialog.getByText(/already exists here/)).toBeVisible();
  });
});
