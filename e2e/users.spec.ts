import { expect, test } from '@playwright/test';
import type { Page } from '@playwright/test';
import { ADMIN_PASSWORD, ADMIN_USERNAME, signIn, signInAndWaitForDashboard } from './support/login';

const NEW_PASSWORD = 'e2e brand new passphrase 2026';
const run = Date.now().toString(36).slice(-5);
const letters = 'ABCDEFGHJKLMNPQRSTUVWXYZ';
const code = Array.from(
  { length: 3 },
  () => letters[Math.floor(Math.random() * letters.length)],
).join('');
const branchName = `E2E Branch ${run}`;
const adminUser = {
  username: `e2e.admin.${run}`,
  fullName: `E2E Admin ${run}`,
  email: `e2e.admin.${run}@example.com`,
};
const staffUser = {
  username: `e2e.staff.${run}`,
  fullName: `E2E Staff ${run}`,
  email: `e2e.staff.${run}@example.com`,
};

async function createBranch(page: Page): Promise<void> {
  await page.goto('/branches');
  await page.getByRole('button', { name: 'New branch' }).click();
  const dialog = page.getByRole('dialog', { name: 'New branch' });
  await dialog.getByLabel('Code').fill(code);
  await dialog.getByLabel('Name').fill(branchName);
  await dialog.getByLabel('State').selectOption('19');
  await dialog.getByRole('button', { name: 'Create branch' }).click();
  await expect(page.getByText(`Branch ${code} created`)).toBeVisible();
}

async function createUser(
  page: Page,
  person: typeof adminUser,
  role: 'ADMIN' | 'STAFF',
): Promise<string> {
  await page.goto('/users');
  await page.getByRole('button', { name: 'New user' }).click();
  const dialog = page.getByRole('dialog', { name: 'New user' });
  await dialog.getByLabel('Username').fill(person.username);
  await dialog.getByLabel('Full name').fill(person.fullName);
  await dialog.getByLabel('Email').fill(person.email);
  await dialog.getByLabel('Role').selectOption({ label: role });
  await dialog.getByRole('checkbox', { name: new RegExp(`${code} · `) }).check();
  await dialog.getByRole('button', { name: 'Create user' }).click();
  const issued = page.getByRole('dialog', { name: 'Account created' });
  const password = (await issued.getByLabel('Temporary password').textContent()) ?? '';
  expect(password).toMatch(/^[A-Za-z0-9]{16}$/);
  await issued.getByRole('button', { name: 'Done' }).click();
  return password;
}

async function firstSignIn(page: Page, username: string, temporary: string): Promise<void> {
  await signIn(page, username, temporary);
  await expect(page.getByRole('heading', { level: 1, name: 'Change password' })).toBeVisible();
  await page.getByLabel('Current password').fill(temporary);
  await page.getByLabel('New password', { exact: true }).fill(NEW_PASSWORD);
  await page.getByLabel('Repeat new password').fill(NEW_PASSWORD);
  await page.getByRole('button', { name: 'Change password' }).click();
  await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
}

test.describe.serial('a Super Admin sets up a branch and its people', () => {
  let adminTemporary = '';
  let staffTemporary = '';

  test('the Super Admin creates a branch, an Admin and a Staff user', async ({ page }) => {
    await signInAndWaitForDashboard(page);
    await createBranch(page);
    adminTemporary = await createUser(page, adminUser, 'ADMIN');
    staffTemporary = await createUser(page, staffUser, 'STAFF');
    await expect(page.getByRole('table', { name: 'Users' })).toContainText(staffUser.fullName);
    await expect(page.getByRole('table', { name: 'Users' })).toContainText(adminUser.fullName);
  });

  test('the Admin must choose a password, then sees only their own branch and people', async ({
    page,
  }) => {
    await firstSignIn(page, adminUser.username, adminTemporary);
    const nav = page.getByRole('navigation', { name: 'Main navigation' });
    await expect(nav.getByRole('link', { name: 'Users' })).toBeVisible();
    // An Admin holds the audit-log permission, so Settings is offered (the audit log is its only section).
    await expect(nav.getByRole('link', { name: 'Settings' })).toBeVisible();
    await expect(page.getByLabel('Working branch')).toContainText(code);

    await page.goto('/branches');
    await expect(page.getByRole('table', { name: 'Branches' })).toContainText(branchName);
    await expect(page.getByRole('table', { name: 'Branches' }).getByRole('row')).toHaveCount(2);
    await expect(page.getByRole('button', { name: 'New branch' })).toHaveCount(0);

    await page.goto('/users');
    const table = page.getByRole('table', { name: 'Users' });
    await expect(table).toContainText(staffUser.fullName);
    await expect(table).not.toContainText(ADMIN_USERNAME);
    await expect(page.getByRole('button', { name: `Edit ${staffUser.username}` })).toBeVisible();
    await expect(page.getByRole('button', { name: `Edit ${adminUser.username}` })).toHaveCount(0);
    await expect(
      page.getByRole('button', { name: `Deactivate ${adminUser.username}` }),
    ).toHaveCount(0);

    await page.goto('/roles');
    await expect(page.getByRole('button', { name: 'New role' })).toHaveCount(0);
  });

  test('the Staff user must choose a password, then can look but not manage', async ({ page }) => {
    await firstSignIn(page, staffUser.username, staffTemporary);
    await page.goto('/users');
    await expect(page.getByRole('button', { name: 'New user' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: /^Edit / })).toHaveCount(0);
    await page.goto('/branches');
    await expect(page.getByRole('table', { name: 'Branches' }).getByRole('row')).toHaveCount(2);
    await page.goto('/settings');
    await expect(
      page.getByRole('heading', { level: 1, name: 'You do not have access' }),
    ).toBeVisible();
  });

  test('a deactivated user cannot sign in any more', async ({ page }) => {
    await signIn(page, ADMIN_USERNAME, ADMIN_PASSWORD);
    // Wait for the sign-in to finish before moving on, or the next page can load signed out.
    await expect(page.getByRole('heading', { level: 1, name: 'Dashboard' })).toBeVisible();
    await page.goto('/users');
    await page.getByRole('button', { name: `Deactivate ${staffUser.username}` }).click();
    await page.getByRole('dialog').getByRole('button', { name: 'Deactivate' }).click();
    await expect(page.getByText(`${staffUser.fullName} deactivated`)).toBeVisible();

    await page.getByRole('button', { name: 'Account menu' }).click();
    await page.getByRole('menuitem', { name: 'Sign out' }).click();
    await signIn(page, staffUser.username, NEW_PASSWORD);
    await expect(page.getByRole('alert')).toHaveText('Invalid username or password');
  });
});
