//apps/api/test/integration/purchase-price.int.test.ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  InvoiceListResponseSchema,
  InvoiceSchema,
  ItemListResponseSchema,
  ItemSchema,
} from '@erp/contracts';
import type { Invoice, Item } from '@erp/contracts';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAuthWorld, loggedIn, SUPER_PASSWORD } from '../support/auth-world.js';
import type { AuthWorld, TestClient } from '../support/auth-world.js';
import { createTestApp } from '../support/create-test-app.js';
import { createOwnerPrisma } from '../support/fixtures.js';

describe('purchase price (real and shown) and profit', () => {
  let app: NestExpressApplication;
  let w: AuthWorld;
  let superAdmin: TestClient;
  let adminA: TestClient;
  let staffA: TestClient;
  let categoryId: string;
  const owner = createOwnerPrisma();
  let counter = 0;
  const unique = (prefix: string): string =>
    `${prefix}${(counter += 1).toString().padStart(4, '0')}`;

  const make = async (over: object = {}): Promise<Item> => {
    const response = await superAdmin.post('/items', {
      itemCode: unique('PP'),
      name: 'Priced item',
      categoryId,
      unitCode: 'PCS',
      ...over,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return ItemSchema.parse(response.body);
  };
  const stock = async (itemId: string, qty: number) => {
    await owner.stockBalance.upsert({
      where: { branchId_itemId_state: { branchId: w.branchA, itemId, state: 'AVAILABLE' } },
      create: { branchId: w.branchA, itemId, state: 'AVAILABLE', quantity: qty },
      update: { quantity: { increment: qty } },
    });
    await owner.stockLedger.create({
      data: {
        branchId: w.branchA,
        itemId,
        state: 'AVAILABLE',
        qtyDelta: qty,
        movementType: 'OPENING_BALANCE',
      },
    });
  };
  const sell = async (itemId: string, qty: number): Promise<Invoice> => {
    const created = await staffA.post('/invoices', {
      customerId: w.customerId,
      type: 'NON_GST',
      lines: [{ itemId, qty, unitPrice: '1000.00' }],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const draft = InvoiceSchema.parse(created.body);
    const issued = await staffA.post(`/invoices/${draft.id}/issue`, {
      rowVersion: draft.rowVersion,
    });
    expect(issued.status, JSON.stringify(issued.body)).toBe(200);
    return InvoiceSchema.parse(issued.body);
  };

  beforeAll(async () => {
    w = await createAuthWorld(owner);
    categoryId = (await owner.itemCategory.findFirstOrThrow({ where: { name: 'Vehicles' } })).id;
    app = await createTestApp();
    superAdmin = await loggedIn(app, 'superadmin', SUPER_PASSWORD);
    adminA = await loggedIn(app, 'admin_a');
    staffA = await loggedIn(app, 'staff_a');
    return async () => {
      await app.close();
      await owner.$disconnect();
    };
  });

  describe('who may set and see the prices', () => {
    it('lets a Super Admin set both prices and see both', async () => {
      const item = await make({ actualPurchasePrice: '300', displayPurchasePrice: '400.5' });
      expect(item.actualPurchasePrice).toBe('300.00');
      expect(item.displayPurchasePrice).toBe('400.50');
    });

    it('shows an Admin and staff only the shown price, and never the real one', async () => {
      const item = await make({ actualPurchasePrice: '300', displayPurchasePrice: '400' });
      for (const client of [adminA, staffA]) {
        const one = ItemSchema.parse((await client.get(`/items/${item.id}`)).body);
        expect(one.actualPurchasePrice).toBeNull();
        expect(one.displayPurchasePrice).toBe('400.00');
        const list = ItemListResponseSchema.parse(
          (await client.get(`/items?search=${item.itemCode}`)).body,
        );
        expect(list.items[0]?.actualPurchasePrice).toBeNull();
        expect(JSON.stringify(list)).not.toContain('300.00');
      }
    });

    it('refuses an Admin who tries to set a price, on create and on edit', async () => {
      const created = await adminA.post('/items', {
        itemCode: unique('PP'),
        name: 'Admin item',
        categoryId,
        unitCode: 'PCS',
        displayPurchasePrice: '10',
      });
      expect(created.status).toBe(403);
      const item = await make();
      const edited = await adminA.patch(`/items/${item.id}`, {
        actualPurchasePrice: '10',
        rowVersion: item.rowVersion,
      });
      expect(edited.status).toBe(403);
    });

    it('lets an Admin edit an item without touching its prices', async () => {
      const item = await make({ actualPurchasePrice: '300', displayPurchasePrice: '400' });
      const response = await adminA.patch(`/items/${item.id}`, {
        name: 'Renamed by admin',
        rowVersion: item.rowVersion,
      });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const stored = await owner.item.findUniqueOrThrow({ where: { id: item.id } });
      expect(stored.actualPurchasePrice?.toFixed(2)).toBe('300.00');
      expect(stored.displayPurchasePrice?.toFixed(2)).toBe('400.00');
    });

    it('needs the real price before a shown price, and refuses bad amounts', async () => {
      const bad = await superAdmin.post('/items', {
        itemCode: unique('PP'),
        name: 'No real price',
        categoryId,
        unitCode: 'PCS',
        displayPurchasePrice: '400',
      });
      expect(bad.status).toBe(400);
      const alpha = await superAdmin.post('/items', {
        itemCode: unique('PP'),
        name: 'Bad amount',
        categoryId,
        unitCode: 'PCS',
        actualPurchasePrice: 'abc',
      });
      expect(alpha.status).toBe(400);
      const item = await make({ actualPurchasePrice: '300' });
      const clearing = await superAdmin.patch(`/items/${item.id}`, {
        displayPurchasePrice: '400',
        actualPurchasePrice: null,
        rowVersion: item.rowVersion,
      });
      expect(clearing.status).toBe(400);
    });

    it('keeps the real price out of the audit log, which managers can read', async () => {
      const item = await make({ actualPurchasePrice: '312.34', displayPurchasePrice: '400' });
      const rows = await owner.auditLog.findMany({
        where: { action: 'ITEM_CREATED', entityId: item.id },
      });
      expect(rows).toHaveLength(1);
      const text = JSON.stringify(rows[0]?.newValue);
      expect(text).not.toContain('312.34');
      expect(text).toContain('"actualPurchasePriceSet":true');
    });
  });

  describe('profit in the sale history', () => {
    it('is worked out on the real cost for a Super Admin and on the shown cost for everyone else', async () => {
      const item = await make({ actualPurchasePrice: '300', displayPurchasePrice: '400' });
      await stock(item.id, 5);
      const invoice = await sell(item.id, 2);

      const asSuper = InvoiceSchema.parse((await superAdmin.get(`/invoices/${invoice.id}`)).body);
      expect(asSuper.profit).toBe('1400.00');
      expect(asSuper.lines[0]?.unitCost).toBe('300.00');

      for (const client of [adminA, staffA]) {
        const seen = InvoiceSchema.parse((await client.get(`/invoices/${invoice.id}`)).body);
        expect(seen.profit).toBe('1200.00');
        expect(seen.lines[0]?.unitCost).toBe('400.00');
        expect(JSON.stringify(seen)).not.toContain('300.00');
      }
    });

    it('appears in the invoice list with the same rule', async () => {
      const item = await make({ actualPurchasePrice: '300', displayPurchasePrice: '400' });
      await stock(item.id, 1);
      const invoice = await sell(item.id, 1);
      const find = async (client: TestClient) => {
        const page = InvoiceListResponseSchema.parse(
          (await client.get(`/invoices?search=${encodeURIComponent(invoice.invoiceNo ?? '')}`))
            .body,
        );
        return page.items.find((row) => row.id === invoice.id)?.profit;
      };
      expect(await find(superAdmin)).toBe('700.00');
      expect(await find(adminA)).toBe('600.00');
      expect(await find(staffA)).toBe('600.00');
    });

    it('is not changed by a later price change, and is blank for a draft and for an item with no price', async () => {
      const item = await make({ actualPurchasePrice: '300', displayPurchasePrice: '400' });
      await stock(item.id, 3);
      const invoice = await sell(item.id, 1);
      const fresh = ItemSchema.parse((await superAdmin.get(`/items/${item.id}`)).body);
      const edit = await superAdmin.patch(`/items/${item.id}`, {
        actualPurchasePrice: '900',
        displayPurchasePrice: '950',
        rowVersion: fresh.rowVersion,
      });
      expect(edit.status, JSON.stringify(edit.body)).toBe(200);
      const after = InvoiceSchema.parse((await superAdmin.get(`/invoices/${invoice.id}`)).body);
      expect(after.profit).toBe('700.00');

      const draft = InvoiceSchema.parse(
        (
          await staffA.post('/invoices', {
            customerId: w.customerId,
            type: 'NON_GST',
            lines: [{ itemId: item.id, qty: 1, unitPrice: '1000.00' }],
          })
        ).body,
      );
      expect(draft.profit).toBeNull();

      const unpriced = await make();
      await stock(unpriced.id, 1);
      const sold = await sell(unpriced.id, 1);
      expect(sold.profit).toBeNull();
    });
  });
});
