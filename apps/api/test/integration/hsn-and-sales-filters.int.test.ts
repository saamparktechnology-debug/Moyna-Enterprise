//apps/api/test/integration/hsn-and-sales-filters.int.test.ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { InvoiceListResponseSchema, InvoiceSchema, ItemSchema } from '@erp/contracts';
import type { Invoice } from '@erp/contracts';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAuthWorld, loggedIn } from '../support/auth-world.js';
import type { AuthWorld, TestClient } from '../support/auth-world.js';
import { createTestApp } from '../support/create-test-app.js';
import { createOwnerPrisma } from '../support/fixtures.js';

describe('HSN codes and the sale history filters', () => {
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
  /** An 8-digit code no other test or seed uses. */
  const newCode = (): string => String(70000000 + (counter += 1) * 7 + (Date.now() % 1000) * 1000);

  const makeItem = (over: object = {}) =>
    superAdmin.post('/items', {
      itemCode: unique('HS'),
      name: 'HSN test item',
      categoryId,
      unitCode: 'PCS',
      ...over,
    });

  beforeAll(async () => {
    w = await createAuthWorld(owner);
    categoryId = (await owner.itemCategory.findFirstOrThrow({ where: { name: 'Vehicles' } })).id;
    app = await createTestApp();
    superAdmin = await loggedIn(app, 'superadmin', 'correct horse battery staple');
    adminA = await loggedIn(app, 'admin_a');
    staffA = await loggedIn(app, 'staff_a');
    return async () => {
      await app.close();
      await owner.$disconnect();
    };
  });

  describe('HSN codes', () => {
    it('accepts a valid HSN code that is not in the list yet, and adds it with the GST rate', async () => {
      const code = newCode();
      const response = await makeItem({ hsnCode: code, taxRate: '18' });
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      expect(ItemSchema.parse(response.body)).toMatchObject({ hsnCode: code, taxRate: '18.00' });
      const added = await owner.hsnCode.findUniqueOrThrow({ where: { code } });
      expect(added.gstRate?.toFixed(2)).toBe('18.00');
      expect(added.isActive).toBe(true);
    });

    it('adds a new code without a rate when the item has none, and reuses a code that is there', async () => {
      const code = newCode();
      expect((await makeItem({ hsnCode: code })).status).toBe(201);
      expect((await owner.hsnCode.findUniqueOrThrow({ where: { code } })).gstRate).toBeNull();
      const again = await makeItem({ hsnCode: code, taxRate: '5' });
      expect(again.status, JSON.stringify(again.body)).toBe(201);
      expect(await owner.hsnCode.count({ where: { code } })).toBe(1);
    });

    it('lets an Admin do the same, and refuses a code that is not 4 to 8 digits', async () => {
      const code = newCode();
      const admin = await adminA.post('/items', {
        itemCode: unique('HS'),
        name: 'Admin HSN item',
        categoryId,
        unitCode: 'PCS',
        hsnCode: code,
      });
      expect(admin.status, JSON.stringify(admin.body)).toBe(201);
      for (const bad of ['123', '123456789', '12AB34']) {
        const refused = await makeItem({ hsnCode: bad });
        expect(refused.status, bad).toBe(400);
      }
    });

    it('takes the GST rate of a new HSN code for an item that has none, but never over a rate it has', async () => {
      const bare = ItemSchema.parse((await makeItem()).body);
      const set = await superAdmin.patch(`/items/${bare.id}`, {
        hsnCode: '8703',
        rowVersion: bare.rowVersion,
      });
      expect(set.status, JSON.stringify(set.body)).toBe(200);
      expect(ItemSchema.parse(set.body)).toMatchObject({ hsnCode: '8703', taxRate: '5.00' });

      const rated = ItemSchema.parse((await makeItem({ taxRate: '18' })).body);
      const kept = await superAdmin.patch(`/items/${rated.id}`, {
        hsnCode: '8703',
        rowVersion: rated.rowVersion,
      });
      expect(ItemSchema.parse(kept.body)).toMatchObject({ hsnCode: '8703', taxRate: '18.00' });
    });

    it('adds a new code when an item is edited to use it', async () => {
      const item = ItemSchema.parse((await makeItem()).body);
      const code = newCode();
      const edited = await superAdmin.patch(`/items/${item.id}`, {
        hsnCode: code,
        taxRate: '12',
        rowVersion: item.rowVersion,
      });
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      expect((await owner.hsnCode.findUniqueOrThrow({ where: { code } })).gstRate?.toFixed(2)).toBe(
        '12.00',
      );
    });
  });

  describe('sale history filters', () => {
    let group: string;
    let otherGroup: string;
    let categoryOne: string;
    let categoryTwo: string;
    let brokerOne: string;
    let invoiceOne: Invoice;
    let invoiceTwo: Invoice;
    let invoiceThree: Invoice;

    const itemIn = async (category: string): Promise<string> => {
      const item = await owner.item.create({
        data: {
          itemCode: unique('SF'),
          name: 'Filter item',
          categoryId: category,
          unitCode: 'PCS',
          isSerialized: false,
        },
      });
      await owner.stockBalance.create({
        data: { branchId: w.branchA, itemId: item.id, state: 'AVAILABLE', quantity: 20 },
      });
      await owner.stockLedger.create({
        data: {
          branchId: w.branchA,
          itemId: item.id,
          state: 'AVAILABLE',
          qtyDelta: 20,
          movementType: 'OPENING_BALANCE',
        },
      });
      return item.id;
    };
    const sell = async (itemId: string, brokerId: string | null): Promise<Invoice> => {
      const customer = await owner.customer.create({
        data: { name: unique('Buyer '), phone: `7${(counter += 1).toString().padStart(9, '0')}` },
      });
      const created = await staffA.post('/invoices', {
        customerId: customer.id,
        type: 'NON_GST',
        brokerId,
        lines: [{ itemId, qty: 1, unitPrice: '100' }],
      });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const draft = InvoiceSchema.parse(created.body);
      const issued = await staffA.post(`/invoices/${draft.id}/issue`, {
        rowVersion: draft.rowVersion,
      });
      expect(issued.status, JSON.stringify(issued.body)).toBe(200);
      return InvoiceSchema.parse(issued.body);
    };
    const ids = async (query: string): Promise<string[]> => {
      const response = await staffA.get(`/invoices?pageSize=100&${query}`);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      return InvoiceListResponseSchema.parse(response.body).items.map((row) => row.id);
    };
    const mine = (found: string[]): string[] =>
      found.filter((id) => [invoiceOne.id, invoiceTwo.id, invoiceThree.id].includes(id)).sort();

    beforeAll(async () => {
      group = (await owner.itemCategory.create({ data: { name: unique('Group ') } })).id;
      otherGroup = (await owner.itemCategory.create({ data: { name: unique('Group ') } })).id;
      categoryOne = (
        await owner.itemCategory.create({ data: { name: unique('Cat '), parentId: group } })
      ).id;
      categoryTwo = (
        await owner.itemCategory.create({ data: { name: unique('Cat '), parentId: group } })
      ).id;
      const broker = await owner.broker.create({ data: { name: unique('Broker ') } });
      brokerOne = broker.id;
      invoiceOne = await sell(await itemIn(categoryOne), brokerOne);
      invoiceTwo = await sell(await itemIn(categoryTwo), null);
      invoiceThree = await sell(await itemIn(otherGroup), null);
    });

    it('filters by product category', async () => {
      expect(mine(await ids(`categoryId=${categoryOne}`))).toEqual([invoiceOne.id]);
      expect(mine(await ids(`categoryId=${categoryTwo}`))).toEqual([invoiceTwo.id]);
    });

    it('filters by group: everything sold from the group and the categories under it', async () => {
      expect(mine(await ids(`groupId=${group}`))).toEqual([invoiceOne.id, invoiceTwo.id].sort());
      expect(mine(await ids(`groupId=${otherGroup}`))).toEqual([invoiceThree.id]);
    });

    it('filters by broker', async () => {
      expect(mine(await ids(`brokerId=${brokerOne}`))).toEqual([invoiceOne.id]);
    });

    it('combines the filters, and finds nothing for a category nobody sold from', async () => {
      expect(mine(await ids(`groupId=${group}&brokerId=${brokerOne}`))).toEqual([invoiceOne.id]);
      expect(mine(await ids(`categoryId=${categoryTwo}&brokerId=${brokerOne}`))).toEqual([]);
      expect(mine(await ids(`categoryId=${otherGroup}&groupId=${group}`))).toEqual([]);
    });

    it('refuses a filter that is not an id', async () => {
      expect((await staffA.get('/invoices?categoryId=abc')).status).toBe(400);
      expect((await staffA.get('/invoices?brokerId=abc')).status).toBe(400);
    });
  });
});
