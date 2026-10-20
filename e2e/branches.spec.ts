import { gstinCheckCharacter } from '@erp/contracts';
import { expect, test } from '@playwright/test';
import { signInAndWaitForDashboard } from './support/login';

const uniqueCode = (): string => `E${Math.random().toString(36).slice(2, 5).toUpperCase()}`;

test.describe('branches', () => {
  test('a Super Admin creates, renames and deactivates a branch', async ({ page }) => {
    const code = uniqueCode();
    await signInAndWaitForDashboard(page);
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Branches' })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Branches' })).toBeVisible();

    await page.getByRole('button', { name: 'New branch' }).click();
    await page.getByLabel('Code').fill(code.toLowerCase());
    await page.getByLabel('Name').fill('End to end branch');
    await page.getByLabel('State').selectOption({ label: '27 · Maharashtra' });
    // A real-looking GSTIN for Karnataka (29) with a correct check character, entered for Maharashtra (27).
    await page.getByLabel('GSTIN').fill(`29AAPFU0939F1Z${gstinCheckCharacter('29AAPFU0939F1Z')}`);
    await page.getByRole('button', { name: 'Create branch' }).click();
    await expect(page.getByText('The GSTIN must start with the state code 27')).toBeVisible();

    await page.getByLabel('GSTIN').fill('');
    await page.getByRole('button', { name: 'Create branch' }).click();
    await expect(page.getByText(`Branch ${code} created`)).toBeVisible();

    await page.getByLabel('Search', { exact: true }).fill(code);
    const row = page.getByRole('row', { name: new RegExp(code) });
    await expect(row).toContainText('End to end branch');
    await expect(row).toContainText('Maharashtra');

    await page.getByRole('button', { name: `Edit ${code}` }).click();
    await expect(page.getByLabel('Code')).toBeDisabled();
    await page.getByLabel('Name').fill('End to end branch renamed');
    await page.getByRole('button', { name: 'Save changes' }).click();
    await expect(page.getByText(`Branch ${code} saved`)).toBeVisible();
    await expect(row).toContainText('End to end branch renamed');

    await page.getByRole('button', { name: `Deactivate ${code}` }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Deactivate' }).click();
    await expect(page.getByText(`Branch ${code} deactivated`)).toBeVisible();
    await expect(page.getByText(/No branches match/)).toBeVisible();

    await page.getByLabel('Show').selectOption('inactive');
    await expect(page.getByRole('row', { name: new RegExp(code) })).toContainText('Inactive');
  });

  test('refuses a duplicate branch code with a message next to the field', async ({ page }) => {
    await signInAndWaitForDashboard(page);
    await page.goto('/branches');
    await page.getByRole('button', { name: 'New branch' }).click();
    await page.getByLabel('Code').fill('HQ');
    await page.getByLabel('Name').fill('Another head office');
    await page.getByLabel('State').selectOption({ index: 1 });
    await page.getByRole('button', { name: 'Create branch' }).click();
    await expect(page.getByText('This code is already used by another branch')).toBeVisible();
  });
});
