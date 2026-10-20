import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  GstRateListResponseSchema,
  HsnListResponseSchema,
  ItemCategoryListResponseSchema,
  ItemCategorySchema,
  ItemListResponseSchema,
  ItemSchema,
  LabelResponseSchema,
  UnitListResponseSchema,
  isValidEan13,
} from '@erp/contracts';
import type { Item, ItemCategory } from '@erp/contracts';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../support/create-test-app.js';
import { createOwnerPrisma } from '../support/fixtures.js';
import { createAuthWorld, loggedIn, SUPER_PASSWORD } from '../support/auth-world.js';
import type { AuthWorld, TestClient } from '../support/auth-world.js';

describe('items, barcodes and categories', () => {
  let app: NestExpressApplication;
  let w: AuthWorld;
  let superAdmin: TestClient;
  let adminA: TestClient;
  let adminB: TestClient;
  let staffA: TestClient;
  let staffB: TestClient;
  let categoryId: string;
  const owner = createOwnerPrisma();
  let counter = 0;
  const unique = (prefix: string): string =>
    `${prefix}${(counter += 1).toString().padStart(4, '0')}`;
  const barcodeFor = (): string =>
    `BC${unique('')}${Math.random().toString(36).slice(2, 6)}`.toUpperCase();

  const body = (over: object = {}) => ({
    itemCode: unique('IT'),
    name: 'Test item',
    categoryId,
    unitCode: 'PCS',
    ...over,
  });
  const make = async (over: object = {}, client: TestClient = superAdmin): Promise<Item> => {
    const response = await client.post('/items', body(over));
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return ItemSchema.parse(response.body);
  };
  const audits = (action: string, entityId: string) =>
    owner.auditLog.findMany({ where: { action, entityId } });

  beforeAll(async () => {
    w = await createAuthWorld(owner);
    categoryId = (await owner.itemCategory.findFirstOrThrow({ where: { name: 'Vehicles' } })).id;
    app = await createTestApp();
    superAdmin = await loggedIn(app, 'superadmin', SUPER_PASSWORD);
    adminA = await loggedIn(app, 'admin_a');
    adminB = await loggedIn(app, 'admin_b');
    staffA = await loggedIn(app, 'staff_a');
    staffB = await loggedIn(app, 'staff_b');
    return async () => {
      await app.close();
      await owner.$disconnect();
    };
  });

  describe('who may call what', () => {
    it('answers every endpoint with 401 when signed out', async () => {
      const id = w.itemId;
      const origin = 'http://localhost:5173';
      const http = () => request(app.getHttpServer());
      const attempts = [
        http().get('/items'),
        http().get(`/items/${id}`),
        http().get('/items/lookup?barcode=X'),
        http().post('/items/labels').set('Origin', origin).send({}),
        http().post('/items').set('Origin', origin).send({}),
        http().patch(`/items/${id}`).set('Origin', origin).send({}),
        http().post(`/items/${id}/deactivate`).set('Origin', origin).send({}),
        http().post(`/items/${id}/reactivate`).set('Origin', origin).send({}),
        http().post(`/items/${id}/barcodes`).set('Origin', origin).send({}),
        http().post(`/items/${id}/barcodes/${id}/remove`).set('Origin', origin).send({}),
        http().get('/item-categories'),
        http().post('/item-categories').set('Origin', origin).send({}),
        http().patch(`/item-categories/${id}`).set('Origin', origin).send({}),
        http().get('/reference/units'),
        http().get('/reference/gst-rates'),
        http().get('/reference/hsn-codes'),
      ];
      for (const response of await Promise.all(attempts)) expect(response.status).toBe(401);
    });

    it('lets Staff look items up and print labels but not change anything', async () => {
      expect((await staffA.get('/items')).status).toBe(200);
      expect((await staffA.get(`/items/${w.itemId}`)).status).toBe(200);
      expect((await staffA.get('/item-categories')).status).toBe(200);
      const denied = [
        staffA.post('/items', body()),
        staffA.patch(`/items/${w.itemId}`, { name: 'Renamed', rowVersion: 1 }),
        staffA.post(`/items/${w.itemId}/deactivate`),
        staffA.post(`/items/${w.itemId}/reactivate`),
        staffA.post(`/items/${w.itemId}/barcodes`, { generate: true }),
        staffA.post(`/items/${w.itemId}/barcodes/${w.itemId}/remove`),
        staffA.post('/item-categories', { name: 'Staff category' }),
        staffA.patch(`/item-categories/${categoryId}`, { name: 'Renamed', rowVersion: 1 }),
      ];
      for (const response of await Promise.all(denied)) expect(response.status).toBe(403);
    });

    it('lets a branch Admin manage items, which are shared by the whole company', async () => {
      const item = await make({}, adminA);
      expect((await adminB.get(`/items/${item.id}`)).status).toBe(200);
      expect((await staffB.get(`/items/${item.id}`)).body).toEqual(
        (await staffA.get(`/items/${item.id}`)).body,
      );
    });
  });

  describe('creating items', () => {
    it('creates an item, upper-cases the code, takes the GST rate from the HSN code and audits it', async () => {
      const code = unique('lc');
      const item = await make({ itemCode: code, hsnCode: '8703', reorderLevel: 4 });
      expect(item).toMatchObject({
        itemCode: code.toUpperCase(),
        hsnCode: '8703',
        taxRate: '5.00',
        unitName: 'Pieces',
        categoryName: 'Vehicles',
        reorderLevel: 4,
        isSerialized: false,
        isActive: true,
        barcodes: [],
      });
      const [entry] = await audits('ITEM_CREATED', item.id);
      expect(entry?.actorId).toBe(w.users.super);
    });

    it('keeps an explicit GST rate even when the HSN code suggests another', async () => {
      const item = await make({ hsnCode: '8703', taxRate: '18' });
      expect(item.taxRate).toBe('18.00');
    });

    it('stores a typed barcode and generates a valid internal EAN-13 on request', async () => {
      const typed = barcodeFor();
      const withTyped = await make({ barcode: typed });
      expect(withTyped.barcodes.map((b) => b.barcode)).toEqual([typed]);
      const generated = await make({ generateBarcode: true });
      const [first] = generated.barcodes;
      expect(first && isValidEan13(first.barcode)).toBe(true);
      expect(first?.barcode.startsWith('20')).toBe(true);
    });

    it('generates unique barcodes when many items are created at once', async () => {
      const results = await Promise.all(
        Array.from({ length: 12 }, () =>
          superAdmin.post('/items', body({ generateBarcode: true })),
        ),
      );
      const codes = results.map((r) => ItemSchema.parse(r.body).barcodes[0]?.barcode);
      expect(results.every((r) => r.status === 201)).toBe(true);
      expect(new Set(codes).size).toBe(12);
    });

    it('refuses a duplicate item code, whatever its case', async () => {
      const item = await make();
      const response = await superAdmin.post(
        '/items',
        body({ itemCode: item.itemCode.toLowerCase() }),
      );
      expect(response.status).toBe(409);
      expect(response.body.code).toBe('CONFLICT');
      expect(response.body.details[0].field).toBe('itemCode');
    });

    it('refuses a barcode that another item already has and names that item', async () => {
      const taken = barcodeFor();
      const first = await make({ barcode: taken });
      const response = await superAdmin.post('/items', body({ barcode: taken }));
      expect(response.status).toBe(409);
      expect(response.body.details[0]).toEqual({
        field: 'barcode',
        message: `Already used by item ${first.itemCode}`,
      });
    });

    it('refuses bad input with a message for each field', async () => {
      const response = await superAdmin.post(
        '/items',
        body({
          itemCode: 'x',
          name: ' ',
          reorderLevel: -1,
          barcode: '4006381333932',
          taxRate: 'five',
        }),
      );
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      const fields = response.body.details.map((d: { field: string }) => d.field);
      expect(fields).toEqual(
        expect.arrayContaining(['itemCode', 'name', 'reorderLevel', 'barcode', 'taxRate']),
      );
    });

    it('refuses asking for a typed and a generated barcode together', async () => {
      const response = await superAdmin.post(
        '/items',
        body({ barcode: barcodeFor(), generateBarcode: true }),
      );
      expect(response.status).toBe(400);
      expect(response.body.details[0].field).toBe('barcode');
    });

    it('refuses references that do not exist or are inactive', async () => {
      const inactive = await owner.itemCategory.create({
        data: { name: unique('Retired'), isActive: false },
      });
      const response = await superAdmin.post(
        '/items',
        body({
          categoryId: inactive.id,
          unitCode: 'NOPE',
          hsnCode: '99999999',
          taxRate: '7.00',
        }),
      );
      expect(response.status).toBe(400);
      expect(response.body.details.map((d: { field: string }) => d.field).sort()).toEqual([
        'categoryId',
        'hsnCode',
        'taxRate',
        'unitCode',
      ]);
    });
  });

  describe('barcodes', () => {
    it('adds a typed and a generated barcode and removes one', async () => {
      const item = await make();
      const typed = barcodeFor();
      const one = await superAdmin.post(`/items/${item.id}/barcodes`, { barcode: typed });
      expect(one.status).toBe(201);
      const two = await superAdmin.post(`/items/${item.id}/barcodes`, { generate: true });
      const current = ItemSchema.parse(two.body);
      expect(current.barcodes).toHaveLength(2);
      const generated = current.barcodes.find((b) => b.barcode !== typed);
      expect(generated && isValidEan13(generated.barcode)).toBe(true);

      const removed = await superAdmin.post(
        `/items/${item.id}/barcodes/${current.barcodes.find((b) => b.barcode === typed)?.id}/remove`,
      );
      expect(removed.status).toBe(200);
      expect(ItemSchema.parse(removed.body).barcodes.map((b) => b.barcode)).toEqual([
        generated?.barcode,
      ]);
      expect(await audits('ITEM_BARCODE_ADDED', item.id)).toHaveLength(2);
      expect(await audits('ITEM_BARCODE_REMOVED', item.id)).toHaveLength(1);
    });

    it('refuses a barcode another item has, a wrong EAN-13 check digit and an eleventh barcode', async () => {
      const other = await make({ barcode: barcodeFor() });
      const item = await make();
      const clash = await superAdmin.post(`/items/${item.id}/barcodes`, {
        barcode: other.barcodes[0]?.barcode,
      });
      expect(clash.status).toBe(409);
      expect(clash.body.details[0].field).toBe('barcode');
      const bad = await superAdmin.post(`/items/${item.id}/barcodes`, { barcode: '4006381333932' });
      expect(bad.status).toBe(400);
      for (let i = 0; i < 10; i += 1)
        expect(
          (await superAdmin.post(`/items/${item.id}/barcodes`, { generate: true })).status,
        ).toBe(201);
      const eleventh = await superAdmin.post(`/items/${item.id}/barcodes`, { generate: true });
      expect(eleventh.status).toBe(422);
    });

    it('cannot remove a barcode that belongs to another item', async () => {
      const first = await make({ barcode: barcodeFor() });
      const second = await make();
      const response = await superAdmin.post(
        `/items/${second.id}/barcodes/${first.barcodes[0]?.id}/remove`,
      );
      expect(response.status).toBe(404);
    });

    it('gives the same barcode to only one of several parallel requests', async () => {
      const items = await Promise.all([make(), make(), make(), make()]);
      const shared = barcodeFor();
      const results = await Promise.all(
        items.map((item) => superAdmin.post(`/items/${item.id}/barcodes`, { barcode: shared })),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(3);
    });
  });

  describe('scan lookup', () => {
    it('finds an item by barcode and reports whether it needs a serial number', async () => {
      const code = barcodeFor();
      const item = await make({ barcode: code, isSerialized: true });
      const response = await staffA.get(`/items/lookup?barcode=${code}`);
      expect(response.status).toBe(200);
      expect(ItemSchema.parse(response.body)).toMatchObject({ id: item.id, isSerialized: true });
    });

    it('also accepts an item code typed by hand, in any case', async () => {
      const item = await make();
      const response = await staffA.get(`/items/lookup?barcode=${item.itemCode.toLowerCase()}`);
      expect(response.status).toBe(200);
      expect(response.body.id).toBe(item.id);
    });

    it('answers 404 for an unknown barcode and 400 for an empty one', async () => {
      expect((await staffA.get('/items/lookup?barcode=NO-SUCH-CODE-1')).status).toBe(404);
      expect((await staffA.get('/items/lookup?barcode=')).status).toBe(400);
      expect((await staffA.get('/items/lookup')).status).toBe(400);
    });

    it('refuses an inactive item with a clear message', async () => {
      const code = barcodeFor();
      const item = await make({ barcode: code });
      await superAdmin.post(`/items/${item.id}/deactivate`);
      const response = await staffA.get(`/items/lookup?barcode=${code}`);
      expect(response.status).toBe(422);
      expect(response.body.code).toBe('BUSINESS_RULE_VIOLATION');
      expect(response.body.message).toMatch(/inactive/);
    });
  });

  describe('editing items', () => {
    it('changes fields, bumps the version and records old and new values', async () => {
      const item = await make({ reorderLevel: 2 });
      const response = await superAdmin.patch(`/items/${item.id}`, {
        name: 'Renamed item',
        reorderLevel: 9,
        rowVersion: item.rowVersion,
      });
      expect(response.status).toBe(200);
      const updated = ItemSchema.parse(response.body);
      expect(updated).toMatchObject({ name: 'Renamed item', reorderLevel: 9 });
      expect(updated.rowVersion).toBe(item.rowVersion + 1);
      const [entry] = await audits('ITEM_UPDATED', item.id);
      expect(entry?.oldValue).toMatchObject({ name: 'Test item', reorderLevel: 2 });
      expect(entry?.newValue).toMatchObject({ name: 'Renamed item', reorderLevel: 9 });
    });

    it('rejects a stale version and leaves the item alone', async () => {
      const item = await make();
      await superAdmin.patch(`/items/${item.id}`, { name: 'First', rowVersion: item.rowVersion });
      const response = await superAdmin.patch(`/items/${item.id}`, {
        name: 'Second',
        rowVersion: item.rowVersion,
      });
      expect(response.status).toBe(409);
      expect((await superAdmin.get(`/items/${item.id}`)).body.name).toBe('First');
    });

    it('lets only one of two parallel edits with the same version win', async () => {
      const item = await make();
      const results = await Promise.all(
        ['One', 'Two'].map((name) =>
          superAdmin.patch(`/items/${item.id}`, { name, rowVersion: item.rowVersion }),
        ),
      );
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    });

    it('does nothing, and writes no audit row, when nothing really changes', async () => {
      const item = await make();
      const response = await superAdmin.patch(`/items/${item.id}`, {
        name: item.name,
        rowVersion: item.rowVersion,
      });
      expect(response.status).toBe(200);
      expect(response.body.rowVersion).toBe(item.rowVersion);
      expect(await audits('ITEM_UPDATED', item.id)).toHaveLength(0);
    });

    it('needs at least one field, a known item and valid references', async () => {
      const item = await make();
      expect((await superAdmin.patch(`/items/${item.id}`, { rowVersion: 1 })).status).toBe(400);
      const missing = await superAdmin.patch('/items/00000000-0000-4000-8000-000000000000', {
        name: 'Ghost',
        rowVersion: 1,
      });
      expect(missing.status).toBe(404);
      const badUnit = await superAdmin.patch(`/items/${item.id}`, {
        unitCode: 'NOPE',
        rowVersion: item.rowVersion,
      });
      expect(badUnit.status).toBe(400);
      expect(badUnit.body.details[0].field).toBe('unitCode');
    });

    it('lets the serial-number setting change only while the item has no stock history', async () => {
      const fresh = await make({ isSerialized: false });
      const ok = await superAdmin.patch(`/items/${fresh.id}`, {
        isSerialized: true,
        rowVersion: fresh.rowVersion,
      });
      expect(ok.status).toBe(200);

      const withStock = await superAdmin.patch(`/items/${w.itemId}`, {
        isSerialized: false,
        rowVersion: (await superAdmin.get(`/items/${w.itemId}`)).body.rowVersion,
      });
      expect(withStock.status).toBe(422);
      expect(withStock.body.details[0].field).toBe('isSerialized');
    });

    it('sees stock history held in branches the caller cannot see', async () => {
      const item = await make({ isSerialized: false });
      await owner.stockBalance.create({
        data: { branchId: w.branchA, itemId: item.id, state: 'AVAILABLE', quantity: 2 },
      });
      const response = await adminB.patch(`/items/${item.id}`, {
        isSerialized: true,
        rowVersion: item.rowVersion,
      });
      expect(response.status).toBe(422);
    });
  });

  describe('deactivating items', () => {
    it('refuses while stock remains, even in a branch the caller cannot see', async () => {
      const item = await make();
      await owner.stockBalance.create({
        data: { branchId: w.branchA, itemId: item.id, state: 'AVAILABLE', quantity: 3 },
      });
      const response = await adminB.post(`/items/${item.id}/deactivate`);
      expect(response.status).toBe(422);
      expect(response.body.details[0].message).toMatch(/3 units are still in stock/);
      expect((await superAdmin.get(`/items/${item.id}`)).body.isActive).toBe(true);
    });

    it('deactivates and reactivates, safely repeated, with one audit row per real change', async () => {
      const item = await make();
      expect((await adminA.post(`/items/${item.id}/deactivate`)).body.isActive).toBe(false);
      expect((await adminA.post(`/items/${item.id}/deactivate`)).body.isActive).toBe(false);
      expect((await adminA.post(`/items/${item.id}/reactivate`)).body.isActive).toBe(true);
      expect((await adminA.post(`/items/${item.id}/reactivate`)).body.isActive).toBe(true);
      expect(await audits('ITEM_DEACTIVATED', item.id)).toHaveLength(1);
      expect(await audits('ITEM_REACTIVATED', item.id)).toHaveLength(1);
    });

    it('answers 404 for an unknown item', async () => {
      const response = await adminA.post('/items/00000000-0000-4000-8000-000000000000/deactivate');
      expect(response.status).toBe(404);
    });
  });

  describe('listing items', () => {
    it('shows active items by default and filters by status and tracking', async () => {
      const tag = unique('LST');
      const live = await make({ itemCode: `${tag}-A`, isSerialized: true });
      const gone = await make({ itemCode: `${tag}-B` });
      await superAdmin.post(`/items/${gone.id}/deactivate`);
      const ids = async (query: string) =>
        ItemListResponseSchema.parse(
          (await staffA.get(`/items?search=${tag}&${query}`)).body,
        ).items.map((item) => item.id);
      expect(await ids('')).toEqual([live.id]);
      expect(await ids('status=inactive')).toEqual([gone.id]);
      expect((await ids('status=all')).sort()).toEqual([live.id, gone.id].sort());
      expect(await ids('status=all&tracking=serialized')).toEqual([live.id]);
      expect(await ids('status=all&tracking=plain')).toEqual([gone.id]);
    });

    it('searches code, name and exact barcode, treating % and _ as ordinary characters', async () => {
      const tag = unique('SRCH');
      const code = barcodeFor();
      const byCode = await make({ itemCode: `${tag}-X`, name: 'Alpha part' });
      const byBarcode = await make({ name: 'Bravo part', barcode: code });
      const percent = await make({ name: `Ten%off ${tag}` });
      const search = async (term: string) =>
        ItemListResponseSchema.parse(
          (await staffA.get(`/items?search=${encodeURIComponent(term)}`)).body,
        ).items.map((item) => item.id);
      expect(await search(tag.toLowerCase())).toEqual(
        expect.arrayContaining([byCode.id, percent.id]),
      );
      expect(await search('Bravo part')).toContain(byBarcode.id);
      expect(await search(code)).toEqual([byBarcode.id]);
      expect(await search('%')).toEqual([percent.id]);
      expect(await search('Ten_off')).toEqual([]);
    });

    it('includes items in subcategories when filtering by a category', async () => {
      const parent = await owner.itemCategory.create({ data: { name: unique('Parent') } });
      const child = await owner.itemCategory.create({
        data: { name: unique('Child'), parentId: parent.id },
      });
      const inParent = await make({ categoryId: parent.id });
      const inChild = await make({ categoryId: child.id });
      const ids = ItemListResponseSchema.parse(
        (await staffA.get(`/items?categoryId=${parent.id}`)).body,
      ).items.map((item) => item.id);
      expect(ids.sort()).toEqual([inParent.id, inChild.id].sort());
    });

    it('pages and sorts on the server and rejects an unknown sort field', async () => {
      const tag = unique('PG');
      for (const letter of ['C', 'A', 'B']) await make({ itemCode: `${tag}-${letter}` });
      const first = await staffA.get(
        `/items?search=${tag}&pageSize=2&sortBy=itemCode&sortOrder=asc`,
      );
      const second = await staffA.get(
        `/items?search=${tag}&pageSize=2&page=2&sortBy=itemCode&sortOrder=asc`,
      );
      expect(first.body.items.map((i: Item) => i.itemCode)).toEqual([`${tag}-A`, `${tag}-B`]);
      expect(second.body.items.map((i: Item) => i.itemCode)).toEqual([`${tag}-C`]);
      expect(first.body).toMatchObject({ total: 3, totalPages: 2, page: 1, pageSize: 2 });
      expect((await staffA.get('/items?sortBy=password')).status).toBe(400);
      expect((await staffA.get('/items?pageSize=1000')).status).toBe(400);
      expect((await staffA.get(`/items?search=${tag}&page=9`)).body.items).toEqual([]);
    });
  });

  describe('labels', () => {
    it('repeats each item as many times as asked and prefers its EAN-13 barcode', async () => {
      const both = await make({ barcode: barcodeFor() });
      const added = await superAdmin.post(`/items/${both.id}/barcodes`, { generate: true });
      const ean = ItemSchema.parse(added.body).barcodes.find((b) => isValidEan13(b.barcode));
      const plain = await make({ barcode: barcodeFor() });
      const response = await staffA.post('/items/labels', {
        items: [
          { itemId: both.id, copies: 3 },
          { itemId: plain.id, copies: 2 },
        ],
      });
      expect(response.status).toBe(200);
      const { labels } = LabelResponseSchema.parse(response.body);
      expect(labels).toHaveLength(5);
      expect(
        labels.filter((l) => l.itemId === both.id).every((l) => l.barcode === ean?.barcode),
      ).toBe(true);
      expect(await audits('ITEM_LABELS_PRINTED', both.id)).toHaveLength(1);
    });

    it('refuses inactive items, items without a barcode, unknown items and oversized runs', async () => {
      const gone = await make({ barcode: barcodeFor() });
      await superAdmin.post(`/items/${gone.id}/deactivate`);
      const bare = await make();
      const post = (items: object[]) => staffA.post('/items/labels', { items });
      expect((await post([{ itemId: gone.id, copies: 1 }])).status).toBe(422);
      const noBarcode = await post([{ itemId: bare.id, copies: 1 }]);
      expect(noBarcode.status).toBe(422);
      expect(noBarcode.body.details[0].message).toBe(`${bare.itemCode} has no barcode`);
      expect(
        (await post([{ itemId: '00000000-0000-4000-8000-000000000000', copies: 1 }])).status,
      ).toBe(404);
      expect((await post([{ itemId: bare.id, copies: 201 }])).status).toBe(400);
      expect(
        (
          await post([
            { itemId: bare.id, copies: 200 },
            { itemId: gone.id, copies: 200 },
            { itemId: w.itemId, copies: 101 },
          ])
        ).status,
      ).toBe(400);
      expect(
        (
          await post([
            { itemId: bare.id, copies: 1 },
            { itemId: bare.id, copies: 1 },
          ])
        ).status,
      ).toBe(400);
      expect((await post([])).status).toBe(400);
    });
  });

  describe('categories', () => {
    const create = async (name: string, parentId: string | null = null): Promise<ItemCategory> => {
      const response = await superAdmin.post('/item-categories', { name, parentId });
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      return ItemCategorySchema.parse(response.body);
    };

    it('lists categories with their parent and how many items use them', async () => {
      const parent = await create(unique('Tools'));
      const child = await create(unique('Spanners'), parent.id);
      await make({ categoryId: child.id });
      const list = ItemCategoryListResponseSchema.parse(
        (await staffA.get('/item-categories')).body,
      );
      expect(list.find((c) => c.id === child.id)).toMatchObject({
        parentName: parent.name,
        itemCount: 1,
      });
    });

    it('refuses a duplicate name among siblings, in any case, but allows it under another parent', async () => {
      const a = await create(unique('Left'));
      const b = await create(unique('Right'));
      const name = unique('Shared');
      await create(name, a.id);
      const clash = await superAdmin.post('/item-categories', {
        name: name.toLowerCase(),
        parentId: a.id,
      });
      expect(clash.status).toBe(409);
      expect(clash.body.details[0].field).toBe('name');
      expect((await superAdmin.post('/item-categories', { name, parentId: b.id })).status).toBe(
        201,
      );
      const rootName = unique('Root');
      await create(rootName);
      expect(
        (await superAdmin.post('/item-categories', { name: rootName.toUpperCase() })).status,
      ).toBe(409);
    });

    it('stops loops, unknown parents and trees deeper than three levels', async () => {
      const one = await create(unique('L1'));
      const two = await create(unique('L2'), one.id);
      const three = await create(unique('L3'), two.id);
      const tooDeep = await superAdmin.post('/item-categories', {
        name: unique('L4'),
        parentId: three.id,
      });
      expect(tooDeep.status).toBe(400);
      expect(tooDeep.body.details[0].field).toBe('parentId');
      const loop = await superAdmin.patch(`/item-categories/${one.id}`, {
        parentId: three.id,
        rowVersion: one.rowVersion,
      });
      expect(loop.status).toBe(400);
      const self = await superAdmin.patch(`/item-categories/${one.id}`, {
        parentId: one.id,
        rowVersion: one.rowVersion,
      });
      expect(self.status).toBe(400);
      const unknown = await superAdmin.post('/item-categories', {
        name: unique('Orphan'),
        parentId: '00000000-0000-4000-8000-000000000000',
      });
      expect(unknown.status).toBe(400);
    });

    it('renames, moves and deactivates, and refuses deactivating a category still in use', async () => {
      const parent = await create(unique('Group'));
      const child = await create(unique('Part'), parent.id);
      const item = await make({ categoryId: child.id });

      const renamed = await superAdmin.patch(`/item-categories/${child.id}`, {
        name: unique('Renamed'),
        rowVersion: child.rowVersion,
      });
      expect(renamed.status).toBe(200);
      const stale = await superAdmin.patch(`/item-categories/${child.id}`, {
        name: 'Late',
        rowVersion: child.rowVersion,
      });
      expect(stale.status).toBe(409);

      const current = ItemCategorySchema.parse(renamed.body);
      const blocked = await superAdmin.patch(`/item-categories/${current.id}`, {
        isActive: false,
        rowVersion: current.rowVersion,
      });
      expect(blocked.status).toBe(422);
      const parentBlocked = await superAdmin.patch(`/item-categories/${parent.id}`, {
        isActive: false,
        rowVersion: parent.rowVersion,
      });
      expect(parentBlocked.status).toBe(422);

      await superAdmin.post(`/items/${item.id}/deactivate`);
      const done = await superAdmin.patch(`/item-categories/${current.id}`, {
        isActive: false,
        rowVersion: current.rowVersion,
      });
      expect(done.status).toBe(200);
      expect(done.body.isActive).toBe(false);
      expect(await audits('ITEM_CATEGORY_UPDATED', current.id)).toHaveLength(2);
    });

    it('answers 404 for an unknown category', async () => {
      const response = await superAdmin.patch(
        '/item-categories/00000000-0000-4000-8000-000000000000',
        {
          name: 'Ghost',
          rowVersion: 1,
        },
      );
      expect(response.status).toBe(404);
    });
  });

  describe('reference lists', () => {
    it('serves units, GST rates and HSN codes to any signed-in user', async () => {
      const units = UnitListResponseSchema.parse((await staffA.get('/reference/units')).body);
      expect(units.map((u) => u.code)).toContain('PCS');
      const rates = GstRateListResponseSchema.parse(
        (await staffA.get('/reference/gst-rates')).body,
      );
      expect(rates.map((r) => r.rate)).toEqual(expect.arrayContaining(['0.00', '5.00', '18.00']));
      const hsn = HsnListResponseSchema.parse(
        (await staffA.get('/reference/hsn-codes?search=8703')).body,
      );
      expect(hsn.items[0]).toMatchObject({ code: '8703', gstRate: '5.00' });
    });

    it('searches HSN codes by description, pages them and treats % as a plain character', async () => {
      const byText = await staffA.get('/reference/hsn-codes?search=tyres');
      expect(byText.body.items.map((h: { code: string }) => h.code)).toContain('4011');
      const paged = await staffA.get('/reference/hsn-codes?pageSize=2&page=2');
      expect(paged.body.items).toHaveLength(2);
      expect(paged.body.total).toBeGreaterThan(2);
      expect((await staffA.get('/reference/hsn-codes?search=%25')).body.items).toEqual([]);
    });
  });

  describe('database guards', () => {
    it('rejects item codes and barcodes the application would never write', async () => {
      await expect(
        owner.item.create({
          data: { itemCode: 'lower-case', name: 'Bad', categoryId, unitCode: 'PCS' },
        }),
      ).rejects.toThrow();
      const item = await make();
      await expect(
        owner.itemBarcode.create({ data: { itemId: item.id, barcode: 'ab' } }),
      ).rejects.toThrow();
      await expect(
        owner.itemBarcode.create({ data: { itemId: item.id, barcode: 'has space' } }),
      ).rejects.toThrow();
    });

    it('refuses two sibling categories whose names differ only in case, even for the owner', async () => {
      const name = unique('Case');
      await owner.itemCategory.create({ data: { name } });
      await expect(
        owner.itemCategory.create({ data: { name: name.toUpperCase() } }),
      ).rejects.toThrow();
    });
  });
});
