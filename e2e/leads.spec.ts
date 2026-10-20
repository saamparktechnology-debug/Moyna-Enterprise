import { expect, test } from '@playwright/test';
import { signInAndWaitForDashboard } from './support/login';

test.describe('leads and follow-ups', () => {
  test('the Leads page opens for a Super Admin with its list and filters', async ({ page }) => {
    await signInAndWaitForDashboard(page);
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Leads' })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Leads' })).toBeVisible();
    await expect(page.getByLabel('Search leads')).toBeVisible();
    await expect(page.getByLabel('Stage')).toBeVisible();
    await expect(page.getByLabel('Looked after by')).toBeVisible();
    await expect(page.getByRole('button', { name: 'New lead' })).toBeVisible();
  });

  test('refuses a lead that has no name, phone or source', async ({ page }) => {
    await signInAndWaitForDashboard(page);
    await page.goto('/leads');
    await page.getByRole('button', { name: 'New lead' }).click();
    const dialog = page.getByRole('dialog', { name: 'New lead' });
    await dialog.getByRole('button', { name: 'Add lead' }).click();
    await expect(dialog.getByLabel('Name')).toHaveAttribute('aria-invalid', 'true');
    await expect(dialog.getByLabel('Phone')).toHaveAttribute('aria-invalid', 'true');
    await expect(dialog.getByLabel('Where the lead came from')).toHaveAttribute(
      'aria-invalid',
      'true',
    );
  });

  test('the Follow-ups tab opens with its counts and scope filter', async ({ page }) => {
    await signInAndWaitForDashboard(page);
    await page.goto('/leads');
    await page.getByRole('tab', { name: 'Follow-ups' }).click();
    await expect(page.getByLabel('Show follow-ups')).toBeVisible();
    await expect(page.getByLabel('Only my leads')).toBeVisible();
  });
});
