import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  ADJUSTMENT_SORT_FIELDS,
  DISCREPANCY_SORT_FIELDS,
  GOODS_RECEIPT_SORT_FIELDS,
  LOW_STOCK_SORT_FIELDS,
  MOVEMENT_SORT_FIELDS,
  PURCHASE_RETURN_SORT_FIELDS,
  REFUND_SORT_FIELDS,
  TRANSFER_SORT_FIELDS,
} from '@erp/contracts';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAuthWorld, loggedIn } from '../support/auth-world.js';
import type { TestClient } from '../support/auth-world.js';
import { createTestApp } from '../support/create-test-app.js';
import { createOwnerPrisma } from '../support/fixtures.js';

/** Every paginated list in the system. */
const LISTS = [
  '/batteries',
  '/branches',
  '/brokers',
  '/commissions',
  '/credit-notes',
  '/customers',
  '/dues',
  '/exchanges',
  '/invoices',
  '/items',
  '/leads',
  '/payments',
  '/quotations',
  '/refunds',
  '/stock/adjustments',
  '/stock/balances',
  '/stock/low-stock',
  '/stock/movements',
  '/stock/serial-units',
  '/transfers',
  '/users',
  '/suppliers',
  '/purchase-orders',
  '/goods-receipts',
  '/discrepancies',
  '/purchase-returns',
  '/leave',
  '/payroll',
  '/staff',
  '/followups',
] as const;

/** Lists whose sort fields were added in module 5.3, with every field they accept. */
const SORTED: Record<string, readonly string[]> = {
  '/refunds': REFUND_SORT_FIELDS,
  '/stock/adjustments': ADJUSTMENT_SORT_FIELDS,
  '/stock/movements': MOVEMENT_SORT_FIELDS,
  '/stock/low-stock': LOW_STOCK_SORT_FIELDS,
  '/transfers': TRANSFER_SORT_FIELDS,
  '/goods-receipts': GOODS_RECEIPT_SORT_FIELDS,
  '/discrepancies': DISCREPANCY_SORT_FIELDS,
  '/purchase-returns': PURCHASE_RETURN_SORT_FIELDS,
};

describe('every list is paged, sorted and filtered on the server', () => {
  let app: NestExpressApplication;
  let superAdmin: TestClient;
  beforeAll(async () => {
    app = await createTestApp();
    await createAuthWorld(createOwnerPrisma());
    superAdmin = await loggedIn(app, 'superadmin', 'super admin passphrase 42');
  });

  it.each(LISTS)('%s returns a page with its totals', async (path) => {
    const response = await superAdmin.get(`${path}?page=1&pageSize=1`);
    expect(response.status, path).toBe(200);
    for (const key of ['items', 'page', 'pageSize', 'total', 'totalPages'])
      expect(response.body, `${path} ${key}`).toHaveProperty(key);
    expect(response.body.items.length).toBeLessThanOrEqual(1);
    expect(response.body.pageSize).toBe(1);
  });

  it.each(LISTS)('%s refuses a page size over 100 and a page below 1', async (path) => {
    expect((await superAdmin.get(`${path}?pageSize=101`)).status, path).toBe(400);
    expect((await superAdmin.get(`${path}?page=0`)).status, path).toBe(400);
  });

  it.each(LISTS)('%s refuses a sort field it does not have', async (path) => {
    const response = await superAdmin.get(`${path}?sortBy=__nope__`);
    expect(response.status, path).toBe(400);
    expect(response.body.code).toBe('VALIDATION_ERROR');
  });

  it.each(Object.entries(SORTED))(
    '%s accepts each of its sort fields, both ways',
    async (path, fields) => {
      for (const field of fields)
        for (const order of ['asc', 'desc']) {
          const response = await superAdmin.get(
            `${path}?sortBy=${field}&sortOrder=${order}&pageSize=5`,
          );
          expect(response.status, `${path} ${field} ${order}`).toBe(200);
        }
    },
  );

  it('keeps the two small lookup lists unpaged: lead sources and item categories', async () => {
    for (const path of ['/lead-sources', '/item-categories']) {
      const response = await superAdmin.get(path);
      expect(response.status).toBe(200);
      expect(Array.isArray(response.body)).toBe(true);
    }
  });
});
