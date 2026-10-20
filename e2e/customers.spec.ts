import { expect, test } from '@playwright/test';
import { signInAndWaitForDashboard } from './support/login';

const uniquePhone = (): string =>
  `9${Math.floor(Math.random() * 1_000_000_000)
    .toString()
    .padStart(9, '0')}`;

test.describe('customers and KYC', () => {
  test('a Super Admin creates a customer, uploads a document, sees only a masked number and verifies it', async ({
    page,
  }) => {
    const name = `E2E Customer ${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    await signInAndWaitForDashboard(page);
    await page
      .getByRole('navigation', { name: 'Main navigation' })
      .getByRole('link', { name: 'Customers' })
      .click();
    await expect(page.getByRole('heading', { level: 1, name: 'Customers' })).toBeVisible();

    await page.getByRole('button', { name: 'New customer' }).click();
    const form = page.getByRole('dialog');
    await form.getByRole('button', { name: 'Create customer' }).click();
    await expect(form.getByLabel('Name')).toHaveAttribute('aria-invalid', 'true');
    await form.getByLabel('Name').fill(name);
    await form.getByLabel('Phone').fill(uniquePhone());
    await form.getByRole('button', { name: 'Create customer' }).click();
    await expect(page.getByText(`Customer ${name} created`)).toBeVisible();

    await page.getByLabel('Search', { exact: true }).fill(name);
    await page.getByRole('button', { name: `KYC documents of ${name}` }).click();
    const kyc = page.getByRole('dialog');
    await expect(kyc.getByLabel('KYC status')).toContainText('Not submitted');

    await kyc.getByRole('button', { name: 'Upload document' }).click();
    await expect(kyc.getByText('Choose the kind of document')).toBeVisible();
    await kyc.getByLabel('Kind of document').selectOption('AADHAAR');
    await kyc.getByLabel(/^Document number/).fill('1234 5678 9012');
    await kyc.getByLabel(/^File/).setInputFiles({
      name: 'aadhaar.pdf',
      mimeType: 'application/pdf',
      buffer: Buffer.from('%PDF-1.4 end to end test'),
    });
    await kyc.getByRole('button', { name: 'Upload document' }).click();
    await expect(kyc.getByText('Document uploaded. It is now waiting for review.')).toBeVisible();
    await expect(kyc.getByLabel('KYC status')).toContainText('Waiting for review');
    await expect(kyc.getByText('XXXXXXXX9012')).toBeVisible();
    await expect(kyc.getByText('123456789012')).toHaveCount(0);

    await kyc.getByRole('button', { name: 'Verify Aadhaar card aadhaar.pdf' }).click();
    await expect(kyc.getByText('Aadhaar card verified')).toBeVisible();
    await expect(kyc.getByLabel('KYC status')).toContainText('Verified');
  });

  test('refuses a file that is not a PDF or an image', async ({ page }) => {
    await signInAndWaitForDashboard(page);
    await page.goto('/customers');
    const first = page.getByRole('button', { name: /^KYC documents of / }).first();
    await first.click();
    const kyc = page.getByRole('dialog');
    await kyc.getByLabel('Kind of document').selectOption('PAN');
    await kyc.getByLabel(/^File/).setInputFiles({
      name: 'notes.txt',
      mimeType: 'text/plain',
      buffer: Buffer.from('not a document'),
    });
    await kyc.getByRole('button', { name: 'Upload document' }).click();
    await expect(kyc.getByText('Upload a PDF, JPEG or PNG file')).toBeVisible();
  });

  test('a duplicate phone number is reported next to the field', async ({ page }) => {
    const phone = uniquePhone();
    await signInAndWaitForDashboard(page);
    await page.goto('/customers');
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await page.getByRole('button', { name: 'New customer' }).click();
      const form = page.getByRole('dialog');
      await form.getByLabel('Name').fill(`Twin ${attempt}`);
      await form.getByLabel('Phone').fill(phone);
      await form.getByRole('button', { name: 'Create customer' }).click();
      if (attempt === 0) await expect(page.getByText('Customer Twin 0 created')).toBeVisible();
    }
    await expect(page.getByText(/Already used by Twin 0/)).toBeVisible();
  });
});
