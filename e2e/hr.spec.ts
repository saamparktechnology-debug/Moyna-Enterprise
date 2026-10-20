import { expect, test } from '@playwright/test';
import { signInAndWaitForDashboard } from './support/login';

test.describe('staff and HR', () => {
  test('the HR page opens for a Super Admin with its sections', async ({ page }) => {
    await signInAndWaitForDashboard(page);
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'HR' })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Staff and HR' })).toBeVisible();
    const sections = page.getByRole('tablist', { name: 'HR sections' });
    for (const name of ['Leave', 'Attendance', 'Payroll', 'Staff'])
      await expect(sections.getByRole('tab', { name })).toBeVisible();
  });

  test('a manager can open the staff list and the add-staff dialog', async ({ page }) => {
    await signInAndWaitForDashboard(page);
    await page.goto('/hr');
    await page.getByRole('tab', { name: 'Staff' }).click();
    await expect(page.getByLabel('Search staff')).toBeVisible();
    await page.getByRole('button', { name: 'Add staff' }).click();
    const dialog = page.getByRole('dialog', { name: 'Add staff' });
    await expect(dialog.getByLabel('Employee code')).toBeVisible();
    await expect(dialog.getByLabel('Monthly salary')).toBeVisible();
  });

  test('payroll opens on the latest month that can be made, and attendance asks for a month', async ({
    page,
  }) => {
    await signInAndWaitForDashboard(page);
    await page.goto('/hr');
    await page.getByRole('tab', { name: 'Payroll' }).click();
    await expect(page.getByLabel('Payroll month')).toBeVisible();
    await expect(page.getByRole('button', { name: 'Make payroll for the month' })).toBeVisible();
    await page.getByRole('tab', { name: 'Attendance' }).click();
    await expect(page.getByLabel('Attendance month')).toBeVisible();
  });
});
