import { expect, test } from '@playwright/test';

test.describe('API through the web proxy', () => {
  test('GET /api/health reports a healthy database', async ({ request }) => {
    const response = await request.get('/api/health');

    expect(response.status()).toBe(200);
    expect(await response.json()).toMatchObject({ status: 'ok', database: 'up' });
  });

  test('an unknown API route returns the standard error shape', async ({ request }) => {
    const response = await request.get('/api/no-such-route');

    expect(response.status()).toBe(404);
    expect(await response.json()).toMatchObject({ code: 'NOT_FOUND', details: [] });
  });
});
