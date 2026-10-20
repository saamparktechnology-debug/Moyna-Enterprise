import { expect, test } from '@playwright/test';
import type { Locator, Page } from '@playwright/test';
import { signInAndWaitForDashboard } from './support/login';

const SCREENS = [
  { name: 'phone', width: 390, height: 844 },
  { name: 'tablet', width: 820, height: 1180 },
  { name: 'desktop', width: 1440, height: 900 },
] as const;

const unique = (prefix: string): string =>
  `${prefix}${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
const uniquePhone = (): string => `9${Math.floor(100000000 + Math.random() * 899999999)}`;

/** The pickers keep showing the last search while the new one loads, so wait for the one we typed. */
async function pick(dialog: Locator, listLabel: string, text: string) {
  const list = dialog.getByLabel(listLabel, { exact: true });
  await expect(list.getByRole('option', { name: new RegExp(text) })).toHaveCount(1);
  await expect(list.getByRole('option')).toHaveCount(2); // the prompt and the one match
  await list.selectOption({ index: 1 });
}

/** Both ends of a form must be usable without scrolling the page: buttons on screen, nothing wider than the screen. */
async function expectFits(page: Page, dialog: Locator, width: number, height: number) {
  const box = await dialog.boundingBox();
  expect(box, 'dialog is on the page').not.toBeNull();
  expect(box!.width).toBeLessThanOrEqual(width);
  expect(box!.y).toBeGreaterThanOrEqual(0);
  expect(box!.y + box!.height).toBeLessThanOrEqual(height + 1);
  await expect(dialog.getByRole('button', { name: /^(Cancel|Close)$/ })).toBeInViewport();
  expect(
    await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
  ).toBeLessThanOrEqual(0);
}

for (const screen of SCREENS) {
  test(`buy, receive, sell and print at ${screen.name} (${screen.width}px)`, async ({ page }) => {
    test.setTimeout(240_000);
    await page.setViewportSize({ width: screen.width, height: screen.height });
    const code = unique('TX');
    const supplierName = `Supplier ${unique('S')}`;
    const customerName = `Customer ${unique('C')}`;
    await signInAndWaitForDashboard(page);

    // An item to trade.
    await page.goto('/items');
    await page.getByRole('button', { name: 'New item' }).click();
    let dialog = page.getByRole('dialog');
    await dialog.getByLabel('Item code').fill(code);
    await dialog.getByLabel('Name').fill('Transaction test item');
    await dialog.getByLabel('Category').selectOption({ index: 1 });
    await dialog.getByLabel('Unit', { exact: true }).selectOption('PCS');
    await expectFits(page, dialog, screen.width, screen.height);
    await dialog.getByRole('button', { name: 'Create item' }).click();
    await expect(page.getByText(`Item ${code} created`)).toBeVisible();

    // A supplier.
    await page.goto('/purchasing');
    await page.getByRole('tab', { name: 'Suppliers' }).click();
    await page.getByRole('button', { name: 'New supplier' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill(supplierName);
    await dialog.getByRole('button', { name: 'Create supplier' }).click();
    await expect(dialog).toBeHidden();

    // A purchase order.
    await page.getByRole('tab', { name: 'Orders' }).click();
    await page.getByRole('button', { name: 'New purchase order' }).click();
    dialog = page.getByRole('dialog');
    if (await dialog.getByLabel('Branch', { exact: true }).count())
      await dialog.getByLabel('Branch', { exact: true }).selectOption({ index: 1 });
    await dialog.getByLabel('Find the supplier').fill(supplierName);
    await pick(dialog, 'Matching suppliers', supplierName);
    await dialog.getByLabel('Item for line 1').fill(code);
    await pick(dialog, 'Matching items for Item for line 1', code);
    await dialog.getByLabel('Quantity for line 1').fill('10');
    await dialog.getByLabel('Unit cost for line 1').fill('100.00');
    await expectFits(page, dialog, screen.width, screen.height);
    await dialog.getByRole('button', { name: 'Create order' }).click();
    await expect(dialog).toBeHidden();

    // Approve it, then receive the goods.
    await page.getByLabel('Search', { exact: true }).fill(supplierName);
    await page
      .getByRole('row', { name: new RegExp(supplierName) })
      .getByRole('button', { name: /^Open / })
      .click();
    dialog = page.getByRole('dialog');
    await expectFits(page, dialog, screen.width, screen.height);
    await dialog.getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText(/approved/)).toBeVisible();
    // Approving closes the order; open it again to receive the goods.
    await expect(dialog).toBeHidden();
    await page
      .getByRole('row', { name: new RegExp(supplierName) })
      .getByRole('button', { name: /^Open / })
      .click();
    await page.getByRole('dialog').getByRole('button', { name: 'Receive goods' }).click();
    dialog = page.getByRole('dialog', { name: /Receive goods for/ });
    await dialog.getByLabel(`Arrived for ${code}`).fill('10');
    await expectFits(page, dialog, screen.width, screen.height);
    await dialog.getByRole('button', { name: 'Record goods receipt' }).click();
    await expect(dialog).toBeHidden();

    // The stock is there.
    await page.goto('/inventory');
    await page.getByLabel('Search', { exact: true }).fill(code);
    await expect(page.getByRole('row', { name: new RegExp(code) })).toContainText('10');

    // A customer.
    await page.goto('/customers');
    await page.getByRole('button', { name: 'New customer' }).click();
    dialog = page.getByRole('dialog');
    await dialog.getByLabel('Name').fill(customerName);
    await dialog.getByLabel('Phone').fill(uniquePhone());
    await dialog.getByRole('button', { name: 'Create customer' }).click();
    await expect(dialog).toBeHidden();

    // An invoice for two of them.
    await page.goto('/sales');
    await page.getByRole('button', { name: 'New invoice' }).click();
    dialog = page.getByRole('dialog');
    if (await dialog.getByLabel('Branch', { exact: true }).count())
      await dialog.getByLabel('Branch', { exact: true }).selectOption({ index: 1 });
    await dialog.getByLabel('Kind of invoice').selectOption('NON_GST');
    await dialog.getByLabel('Customer', { exact: true }).fill(customerName);
    await pick(dialog, 'Matching customers', customerName);
    await dialog.getByLabel('Item for line 1').fill(code);
    await pick(dialog, 'Matching items for Item for line 1', code);
    await dialog.getByLabel('Quantity for line 1').fill('2');
    await dialog.getByLabel('Price for line 1').fill('150.00');
    await expect(dialog.getByLabel('Invoice totals')).toContainText('300.00');
    await expectFits(page, dialog, screen.width, screen.height);
    await dialog.getByRole('button', { name: 'Save draft' }).click();
    await expect(page.getByText('Draft invoice created')).toBeVisible();

    // Issue it.
    dialog = page.getByRole('dialog');
    await dialog.getByRole('button', { name: 'Issue invoice' }).click();
    await expect(page.getByText(/Invoice .+ issued/)).toBeVisible();

    // Open it again and print.
    await page.goto('/sales');
    await page.getByLabel('Search', { exact: true }).fill(customerName);
    await page
      .getByRole('row', { name: new RegExp(customerName) })
      .getByRole('button', { name: /^Open / })
      .click();
    dialog = page.getByRole('dialog');
    await expect(dialog.getByRole('table', { name: 'Invoice lines' })).toBeVisible();
    await page.emulateMedia({ media: 'print' });

    await expect(page.getByRole('navigation', { name: 'Main navigation' })).toBeHidden();
    await expect(page.getByRole('banner')).toBeHidden();
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('table', { name: 'Invoice lines' })).toContainText(code);
    await expect(dialog.getByRole('button', { name: 'Close' })).toBeHidden();
    const printed = await dialog.boundingBox();
    expect(printed!.x).toBeLessThanOrEqual(1);
    expect(printed!.width).toBeGreaterThanOrEqual(screen.width - 2);
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth - innerWidth),
    ).toBeLessThanOrEqual(0);
  });
}
