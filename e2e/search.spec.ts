import { expect, test } from '@playwright/test';
import { signInAndWaitForDashboard } from './support/login';

test.describe('global search', () => {
  test('the header search asks for two characters and then reports what it found', async ({
    page,
  }) => {
    await signInAndWaitForDashboard(page);
    const box = page.getByRole('textbox', { name: 'Find anything' });
    await box.fill('x');
    await expect(page.getByText('Type at least 2 characters')).toBeVisible();
    await box.fill('zzzzzzzz');
    await expect(page.getByText('Nothing found for “zzzzzzzz”')).toBeVisible();
    await box.press('Escape');
    await expect(page.getByText('Nothing found for “zzzzzzzz”')).toBeHidden();
  });
});
