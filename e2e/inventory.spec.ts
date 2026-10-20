import { expect, test } from '@playwright/test';
import { signInAndWaitForDashboard } from './support/login';

const uniqueCode = (): string => `STK-${Math.random().toString(36).slice(2, 7).toUpperCase()}`;

test.describe('inventory', () => {
  test('a Super Admin puts stock in through an adjustment and sees it by state and in the history', async ({
    page,
  }) => {
    const code = uniqueCode();
    await signInAndWaitForDashboard(page);

    await page.goto('/items');
    await page.getByRole('button', { name: 'New item' }).click();
    const itemForm = page.getByRole('dialog');
    await itemForm.getByLabel('Item code').fill(code);
    await itemForm.getByLabel('Name').fill('End to end stock item');
    await itemForm.getByLabel('Category').selectOption({ index: 1 });
    await itemForm.getByLabel('Unit', { exact: true }).selectOption('PCS');
    await itemForm.getByRole('button', { name: 'Create item' }).click();
    await expect(page.getByText(`Item ${code} created`)).toBeVisible();

    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Inventory' })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Inventory' })).toBeVisible();

    await page.getByRole('tab', { name: 'Adjustments' }).click();
    await page.getByRole('button', { name: 'Request adjustment' }).first().click();
    const form = page.getByRole('dialog');
    const branch = form.getByLabel('Branch');
    if (await branch.count()) await branch.selectOption({ index: 1 });
    await form.getByLabel('Find item').fill(code);
    await form.getByLabel('Matching items').selectOption({ index: 1 });
    await form.getByLabel('Quantity').fill('12');
    await form.getByLabel('Reason').fill('Opening stock for the end to end test');
    await form.getByRole('button', { name: 'Request adjustment' }).click();

    const row = page.getByRole('row', { name: new RegExp(code) });
    await expect(row).toContainText('Waiting for approval');
    await row.getByRole('button', { name: /^Approve/ }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Approve' }).click();
    await expect(page.getByText('Adjustment approved. The stock has been updated.')).toBeVisible();

    await page.getByRole('tab', { name: 'Stock', exact: true }).click();
    await page.getByLabel('Search', { exact: true }).fill(code);
    await expect(page.getByRole('row', { name: new RegExp(code) })).toContainText('12');

    await page.getByRole('tab', { name: 'Movements' }).click();
    await expect(page.getByRole('row', { name: new RegExp(code) }).first()).toContainText('12');
  });
});
