//apps/api/test/integration/hsn-and-sales-filters.int.test.ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  InvoiceListResponseSchema,
  InvoiceSchema,
  ItemSchema,
  ManagedHsnListResponseSchema,
  ManagedHsnSchema,
  ReportResponseSchema,
  todayInIndia,
} from '@erp/contracts';
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

    it('reports, for each group and category, which broker sold how many items', async () => {
      const names = new Map(
        (
          await owner.itemCategory.findMany({
            where: { id: { in: [group, otherGroup, categoryOne, categoryTwo] } },
          })
        ).map((row) => [row.id, row.name]),
      );
      const brokerName = (await owner.broker.findUniqueOrThrow({ where: { id: brokerOne } })).name;
      const day = todayInIndia();
      const response = await superAdmin.get(
        `/reports/SALES_BY_CATEGORY_BROKER?from=${day}&to=${day}&pageSize=200`,
      );
      expect(response.status, JSON.stringify(response.body).slice(0, 300)).toBe(200);
      const report = ReportResponseSchema.parse(response.body);
      const mineRows = report.rows.filter((row) =>
        [names.get(group), names.get(otherGroup)].includes(String(row['group'])),
      );
      const pick = (category: string | undefined, broker: string) =>
        mineRows.find((row) => row['category'] === category && row['broker'] === broker);
      expect(pick(names.get(categoryOne), brokerName)).toMatchObject({
        group: names.get(group),
        units: 1,
        invoices: 1,
      });
      expect(pick(names.get(categoryTwo), 'No broker')).toMatchObject({ units: 1 });
      // a group with no sub-category of its own is its own category
      expect(pick(names.get(otherGroup), 'No broker')).toMatchObject({
        group: names.get(otherGroup),
        units: 1,
      });
      expect(Number(pick(names.get(categoryOne), brokerName)?.['taxable'])).toBe(100);
    });

    it('takes the items of an approved credit note off the report', async () => {
      const returnedCategory = (
        await owner.itemCategory.create({ data: { name: unique('Cat '), parentId: group } })
      ).id;
      const sold = await sell(await itemIn(returnedCategory), brokerOne);
      const line = sold.lines[0];
      const noteResponse = await staffA.post('/credit-notes', {
        invoiceId: sold.id,
        reason: 'Returned',
        lines: [{ invoiceLineId: line?.id, qty: 1 }],
      });
      expect(noteResponse.status, JSON.stringify(noteResponse.body)).toBe(201);
      const note = noteResponse.body as { id: string; rowVersion: number };
      const approved = await superAdmin.post(`/credit-notes/${note.id}/approve`, {
        rowVersion: note.rowVersion,
      });
      expect(approved.status, JSON.stringify(approved.body)).toBe(200);
      const day = todayInIndia();
      const report = ReportResponseSchema.parse(
        (
          await superAdmin.get(
            `/reports/SALES_BY_CATEGORY_BROKER?from=${day}&to=${day}&pageSize=200`,
          )
        ).body,
      );
      const name = (await owner.itemCategory.findUniqueOrThrow({ where: { id: returnedCategory } }))
        .name;
      const row = report.rows.find((entry) => entry['category'] === name);
      expect(row).toMatchObject({ units: 0 });
    });

    it('is only for those who may view reports and invoices', async () => {
      const day = todayInIndia();
      expect(
        (await staffA.get(`/reports/SALES_BY_CATEGORY_BROKER?from=${day}&to=${day}`)).status,
      ).toBe(403);
    });

    it('refuses a filter that is not an id', async () => {
      expect((await staffA.get('/invoices?categoryId=abc')).status).toBe(400);
      expect((await staffA.get('/invoices?brokerId=abc')).status).toBe(400);
    });
  });

  describe('managing the HSN list', () => {
    const add = (client: TestClient, body: Record<string, unknown>) =>
      client.post('/hsn-codes', body);
    const addOk = async (body: Record<string, unknown>) => {
      const response = await add(adminA, body);
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      return ManagedHsnSchema.parse(response.body);
    };

    it('adds a code with its description and GST rate, and lists it with how many items use it', async () => {
      const code = newCode();
      const added = await addOk({ code, description: 'Electric rickshaw parts', gstRate: '18' });
      expect(added).toMatchObject({ code, gstRate: '18.00', isActive: true, usedBy: 0 });
      expect((await makeItem({ hsnCode: code })).status).toBe(201);
      const found = ManagedHsnListResponseSchema.parse(
        (await adminA.get(`/hsn-codes?search=${code}`)).body,
      );
      expect(found.items.map((row) => [row.code, row.usedBy])).toEqual([[code, 1]]);
    });

    it('finds a code by the start of its number or a word of its description, and by status', async () => {
      const code = newCode();
      await addOk({ code, description: 'Zebra stripe fittings' });
      const byWord = ManagedHsnListResponseSchema.parse(
        (await adminA.get('/hsn-codes?search=zebra')).body,
      );
      expect(byWord.items.some((row) => row.code === code)).toBe(true);
      const off = ManagedHsnSchema.parse(
        (await adminA.patch(`/hsn-codes/${code}`, { isActive: false, rowVersion: 1 })).body,
      );
      expect(off.isActive).toBe(false);
      const inactive = ManagedHsnListResponseSchema.parse(
        (await adminA.get('/hsn-codes?status=inactive&search=zebra')).body,
      );
      expect(inactive.items.map((row) => row.code)).toContain(code);
      const active = ManagedHsnListResponseSchema.parse(
        (await adminA.get('/hsn-codes?status=active&search=zebra')).body,
      );
      expect(active.items.map((row) => row.code)).not.toContain(code);
    });

    it('changes the description and the rate with the version that was read, and refuses a stale one', async () => {
      const code = newCode();
      const added = await addOk({ code, description: 'First wording' });
      const changed = await adminA.patch(`/hsn-codes/${code}`, {
        description: 'Better wording',
        gstRate: '5',
        rowVersion: added.rowVersion,
      });
      expect(changed.status, JSON.stringify(changed.body)).toBe(200);
      expect(ManagedHsnSchema.parse(changed.body)).toMatchObject({
        description: 'Better wording',
        gstRate: '5.00',
      });
      const stale = await adminA.patch(`/hsn-codes/${code}`, {
        description: 'Third wording',
        rowVersion: added.rowVersion,
      });
      expect(stale.status).toBe(409);
      expect((await adminA.patch(`/hsn-codes/${code}`, { rowVersion: 2 })).status).toBe(400);
      expect(
        (await adminA.patch('/hsn-codes/99990000', { description: 'x y', rowVersion: 1 })).status,
      ).toBe(404);
    });

    it('refuses a code that is already there, one that is not 4 to 8 digits, and a rate that is not a GST rate', async () => {
      const code = newCode();
      await addOk({ code, description: 'Once only' });
      expect((await add(adminA, { code, description: 'Again' })).status).toBe(409);
      for (const bad of ['12', '123456789', 'AB12']) {
        expect((await add(adminA, { code: bad, description: 'Nope' })).status, bad).toBe(400);
      }
      expect(
        (await add(adminA, { code: newCode(), description: 'Odd rate', gstRate: '7' })).status,
      ).toBe(400);
      expect((await add(adminA, { code: newCode(), description: '' })).status).toBe(400);
    });

    it('keeps a switched-off code on the items that have it, but offers it to no new item', async () => {
      const code = newCode();
      const added = await addOk({ code, description: 'Soon off' });
      const item = ItemSchema.parse((await makeItem({ hsnCode: code })).body);
      await adminA.patch(`/hsn-codes/${code}`, { isActive: false, rowVersion: added.rowVersion });
      expect(ItemSchema.parse((await superAdmin.get(`/items/${item.id}`)).body).hsnCode).toBe(code);
      expect((await makeItem({ hsnCode: code })).status).toBe(400);
    });

    it('can be read by anyone who may view items, and changed only by those who may manage them', async () => {
      expect((await staffA.get('/hsn-codes')).status).toBe(200);
      expect((await add(staffA, { code: newCode(), description: 'Staff try' })).status).toBe(403);
      expect(
        (await staffA.patch('/hsn-codes/8703', { description: 'Staff try', rowVersion: 1 })).status,
      ).toBe(403);
    });
  });
});
