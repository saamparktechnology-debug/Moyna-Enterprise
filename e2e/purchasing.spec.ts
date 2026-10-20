import { expect, test } from '@playwright/test';
import { signInAndWaitForDashboard } from './support/login';

test.describe('purchasing', () => {
  test('the purchasing page opens for a Super Admin with every section', async ({ page }) => {
    await signInAndWaitForDashboard(page);
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Purchasing' })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Purchasing' })).toBeVisible();
    const tabs = page.getByRole('tablist', { name: 'Purchasing sections' });
    for (const name of ['Orders', 'Receipts', 'Discrepancies', 'Returns', 'Suppliers'])
      await expect(tabs.getByRole('tab', { name })).toBeVisible();
    await expect(page.getByRole('button', { name: 'New purchase order' })).toBeVisible();
  });

  test('creates a supplier, then asks for a supplier when an order is started without one', async ({
    page,
  }) => {
    const name = `E2E Supplier ${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    await signInAndWaitForDashboard(page);
    await page.goto('/purchasing');
    await page.getByRole('tab', { name: 'Suppliers' }).click();
    await page.getByRole('button', { name: 'New supplier' }).click();
    const supplier = page.getByRole('dialog');
    await supplier.getByRole('button', { name: 'Create supplier' }).click();
    await expect(supplier.getByLabel('Name')).toHaveAttribute('aria-invalid', 'true');
    await supplier.getByLabel('Name').fill(name);
    await supplier.getByRole('button', { name: 'Create supplier' }).click();
    await expect(page.getByText(`Supplier ${name} created`)).toBeVisible();

    await page.getByRole('tab', { name: 'Orders' }).click();
    await page.getByRole('button', { name: 'New purchase order' }).click();
    const order = page.getByRole('dialog');
    await order.getByRole('button', { name: 'Create order' }).click();
    await expect(order.getByLabel('Find the supplier')).toHaveAttribute('aria-invalid', 'true');
  });
});
