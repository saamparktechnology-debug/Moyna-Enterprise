import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  DiscrepancySchema,
  GoodsReceiptSchema,
  PurchaseOrderSchema,
  PurchaseReturnSchema,
  SupplierDetailSchema,
  SupplierLedgerResponseSchema,
  SupplierSchema,
  gstinCheckCharacter,
} from '@erp/contracts';
import type { Discrepancy, GoodsReceipt, PurchaseOrder, Supplier } from '@erp/contracts';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAuthWorld, loggedIn, SUPER_PASSWORD } from '../support/auth-world.js';
import type { AuthWorld, TestClient } from '../support/auth-world.js';
import { createTestApp } from '../support/create-test-app.js';
import { createOwnerPrisma } from '../support/fixtures.js';
import { connectApp, sqlState } from '../support/pg.js';

const gstinFor = (state: string, suffix: string) =>
  `${state}${suffix}${gstinCheckCharacter(`${state}${suffix}`)}`;
const NIL = '00000000-0000-4000-8000-000000000000';

describe('purchasing, receiving, returns and supplier payments', () => {
  let app: NestExpressApplication;
  let w: AuthWorld;
  let superAdmin: TestClient;
  let adminA: TestClient;
  let adminB: TestClient;
  let staffA: TestClient;
  let staffB: TestClient;
  let categoryId: string;
  let codeA: string;
  const owner = createOwnerPrisma();
  let counter = 0;
  const unique = (prefix: string): string =>
    `${prefix}${(counter += 1).toString().padStart(4, '0')}`;

  const newItem = (over: { isSerialized?: boolean; isActive?: boolean } = {}) =>
    owner.item.create({
      data: {
        itemCode: unique('PUR'),
        name: 'Purchased item',
        categoryId,
        unitCode: 'PCS',
        ...over,
      },
    });
  const newSupplier = async (client: TestClient = adminA, over: object = {}): Promise<Supplier> => {
    const response = await client.post('/suppliers', { name: `Supplier ${unique('S')}`, ...over });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return SupplierSchema.parse(response.body);
  };
  const draftPo = async (
    supplierId: string,
    lines: { itemId: string; qtyOrdered: number; unitCost?: string }[],
    client: TestClient = adminA,
  ): Promise<PurchaseOrder> => {
    const response = await client.post('/purchase-orders', {
      supplierId,
      lines: lines.map((line) => ({ unitCost: '100.00', ...line })),
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return PurchaseOrderSchema.parse(response.body);
  };
  const approvedPo = async (
    supplierId: string,
    lines: { itemId: string; qtyOrdered: number; unitCost?: string }[],
    client: TestClient = adminA,
  ): Promise<PurchaseOrder> => {
    const draft = await draftPo(supplierId, lines, client);
    const response = await client.post(`/purchase-orders/${draft.id}/approve`, {
      rowVersion: draft.rowVersion,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return PurchaseOrderSchema.parse(response.body);
  };
  const reload = async (id: string, client: TestClient = adminA): Promise<PurchaseOrder> =>
    PurchaseOrderSchema.parse((await client.get(`/purchase-orders/${id}`)).body);
  const receive = (po: PurchaseOrder, body: object, client: TestClient = staffA) =>
    client.post(`/purchase-orders/${po.id}/receive`, body);
  const receiveOk = async (
    po: PurchaseOrder,
    body: object,
    client: TestClient = staffA,
  ): Promise<GoodsReceipt> => {
    const response = await receive(po, body, client);
    expect(response.status, JSON.stringify(response.body)).toBeLessThan(300);
    return GoodsReceiptSchema.parse(response.body);
  };
  const lineFor = (po: PurchaseOrder, itemId: string): string => {
    const line = po.lines.find((candidate) => candidate.itemId === itemId);
    if (!line) throw new Error('That item is not on the order');
    return line.id;
  };
  const lineOf = (po: PurchaseOrder, index = 0): string => {
    const line = po.lines[index];
    if (!line) throw new Error('No such line');
    return line.id;
  };
  const stock = async (
    itemId: string,
    state = 'AVAILABLE',
    branchId = w.branchA,
  ): Promise<number> =>
    (
      await owner.stockBalance.findUnique({
        where: { branchId_itemId_state: { branchId, itemId, state: state as 'AVAILABLE' } },
      })
    )?.quantity ?? 0;
  const drift = (itemId: string) =>
    owner.$queryRaw<
      { branch_id: string }[]
    >`SELECT branch_id FROM stock_balance_drift() WHERE item_id = ${itemId}::uuid`;
  const discrepanciesOf = async (receipt: GoodsReceipt): Promise<Discrepancy[]> => {
    const ids = receipt.lines.flatMap((line) => line.discrepancies.map((d) => d.id));
    return Promise.all(
      ids.map(async (id) =>
        DiscrepancySchema.parse((await adminA.get(`/discrepancies/${id}`)).body),
      ),
    );
  };
  const resolve = (
    d: Discrepancy,
    resolution: string,
    client: TestClient = adminA,
    note?: string,
  ) =>
    client.post(`/discrepancies/${d.id}/resolve`, {
      resolution,
      rowVersion: d.rowVersion,
      ...(note ? { note } : {}),
    });
  const balanceOf = async (supplierId: string, client: TestClient = adminA) =>
    SupplierDetailSchema.parse((await client.get(`/suppliers/${supplierId}`)).body).balance;
  const audits = (action: string, entityId: string) =>
    owner.auditLog.findMany({ where: { action, entityId } });

  beforeAll(async () => {
    w = await createAuthWorld(owner);
    categoryId = (await owner.itemCategory.findFirstOrThrow({ where: { name: 'Vehicles' } })).id;
    codeA = (await owner.branch.findUniqueOrThrow({ where: { id: w.branchA } })).code;
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
      const origin = 'http://localhost:5173';
      const http = () => request(app.getHttpServer());
      const post = (path: string) => http().post(path).set('Origin', origin).send({});
      const attempts = [
        http().get('/suppliers'),
        http().get(`/suppliers/${NIL}`),
        http().get(`/suppliers/${NIL}/ledger`),
        post('/suppliers'),
        http().patch(`/suppliers/${NIL}`).set('Origin', origin).send({}),
        post(`/suppliers/${NIL}/payments`),
        http().get('/purchase-orders'),
        http().get(`/purchase-orders/${NIL}`),
        post('/purchase-orders'),
        http().patch(`/purchase-orders/${NIL}`).set('Origin', origin).send({}),
        post(`/purchase-orders/${NIL}/approve`),
        post(`/purchase-orders/${NIL}/cancel`),
        post(`/purchase-orders/${NIL}/receive`),
        http().get('/goods-receipts'),
        http().get(`/goods-receipts/${NIL}`),
        http().get('/discrepancies'),
        http().get(`/discrepancies/${NIL}`),
        post(`/discrepancies/${NIL}/resolve`),
        http().get('/purchase-returns'),
        http().get(`/purchase-returns/${NIL}`),
        post('/purchase-returns'),
        http().get('/reference/payment-modes'),
      ];
      for (const response of await Promise.all(attempts)) expect(response.status).toBe(401);
    });

    it('lets Staff look, and receive goods, but not buy, approve, return, pay or settle', async () => {
      const supplier = await newSupplier();
      const item = await newItem();
      const po = await approvedPo(supplier.id, [{ itemId: item.id, qtyOrdered: 4 }]);
      for (const path of [
        '/suppliers',
        '/purchase-orders',
        '/goods-receipts',
        '/discrepancies',
        '/purchase-returns',
      ])
        expect((await staffA.get(path)).status, path).toBe(200);
      expect((await staffA.get(`/suppliers/${supplier.id}`)).status).toBe(200);
      const denied = [
        staffA.post('/suppliers', { name: 'Staff supplier' }),
        staffA.patch(`/suppliers/${supplier.id}`, { name: 'Renamed', rowVersion: 1 }),
        staffA.post('/purchase-orders', {
          supplierId: supplier.id,
          lines: [{ itemId: item.id, qtyOrdered: 1, unitCost: '1' }],
        }),
        staffA.patch(`/purchase-orders/${po.id}`, {
          orderDate: '2026-01-01',
          rowVersion: po.rowVersion,
        }),
        staffA.post(`/purchase-orders/${po.id}/approve`, { rowVersion: po.rowVersion }),
        staffA.post(`/purchase-orders/${po.id}/cancel`, {
          rowVersion: po.rowVersion,
          reason: 'No need',
        }),
        staffA.post(`/suppliers/${supplier.id}/payments`, { amount: '10', mode: 'CASH' }),
        staffA.post(`/discrepancies/${NIL}/resolve`, { resolution: 'ACCEPT', rowVersion: 1 }),
        staffA.post('/purchase-returns', {
          poId: po.id,
          reason: 'Not wanted',
          lines: [{ poLineId: lineOf(po), qty: 1 }],
        }),
      ];
      for (const response of await Promise.all(denied)) expect(response.status).toBe(403);
      expect(
        (await receive(po, { lines: [{ poLineId: lineOf(po), received: 4 }] })).status,
      ).toBeLessThan(300);
    });

    it('keeps one branch away from another branch’s orders, receipts and discrepancies', async () => {
      const supplier = await newSupplier();
      const item = await newItem();
      const po = await approvedPo(supplier.id, [{ itemId: item.id, qtyOrdered: 5 }]);
      const receipt = await receiveOk(po, { lines: [{ poLineId: lineOf(po), received: 7 }] });
      expect((await adminB.get(`/purchase-orders/${po.id}`)).status).toBe(404);
      expect(
        (
          await adminB.post(`/purchase-orders/${po.id}/receive`, {
            lines: [{ poLineId: lineOf(po), received: 1 }],
          })
        ).status,
      ).toBe(404);
      expect(
        (await adminB.post(`/purchase-orders/${po.id}/approve`, { rowVersion: po.rowVersion }))
          .status,
      ).toBe(404);
      expect((await adminB.get(`/goods-receipts/${receipt.id}`)).status).toBe(404);
      const [excess] = await discrepanciesOf(receipt);
      expect((await adminB.get(`/discrepancies/${excess?.id}`)).status).toBe(404);
      expect(
        (
          await adminB.post(`/discrepancies/${excess?.id}/resolve`, {
            resolution: 'ACCEPT',
            rowVersion: 1,
          })
        ).status,
      ).toBe(404);
      expect((await staffB.get(`/purchase-orders?search=${po.poNo}`)).body.items).toEqual([]);
      expect((await adminB.get(`/suppliers/${supplier.id}`)).status).toBe(200);
      expect((await balanceOf(supplier.id, adminB)).charged).toBe('0.00');
      expect((await balanceOf(supplier.id, adminA)).charged).toBe('500.00');
    });
  });

  describe('suppliers', () => {
    it('creates a supplier with a checked GSTIN, audits it and refuses a duplicate', async () => {
      const gstin = gstinFor('27', 'ABCDE1234F1Z');
      const supplier = await newSupplier(adminA, {
        gstin,
        stateCode: '27',
        phone: '+91 98765 43210',
      });
      expect(supplier).toMatchObject({ gstin, stateCode: '27', isActive: true, rowVersion: 1 });
      expect(await audits('SUPPLIER_CREATED', supplier.id)).toHaveLength(1);
      const duplicate = await adminA.post('/suppliers', {
        name: 'Same GSTIN',
        gstin,
        stateCode: '27',
      });
      expect(duplicate.status).toBe(409);
      expect(duplicate.body.details[0].field).toBe('gstin');
    });

    it('refuses a GSTIN that is wrong or belongs to another state, and bad names and phones', async () => {
      const wrongState = await adminA.post('/suppliers', {
        name: 'Wrong state',
        gstin: gstinFor('27', 'ZZZZZ9999Z1Z'),
        stateCode: '29',
      });
      expect(wrongState.status).toBeGreaterThanOrEqual(400);
      expect(wrongState.body.details[0].field).toBe('gstin');
      const badCheck = await adminA.post('/suppliers', {
        name: 'Bad check',
        gstin: '27ABCDE1234F1ZX',
      });
      expect(badCheck.status).toBe(400);
      const bad = await adminA.post('/suppliers', { name: 'x', phone: 'call me' });
      expect(bad.status).toBe(400);
      expect(bad.body.details.map((d: { field: string }) => d.field).sort()).toEqual([
        'name',
        'phone',
      ]);
      const unknownState = await adminA.post('/suppliers', {
        name: 'Unknown state',
        stateCode: '88',
      });
      expect(unknownState.status).toBeGreaterThanOrEqual(400);
    });

    it('lists by search and status, pages, and shows a zero balance for a new supplier', async () => {
      const tag = unique('LIST');
      const live = await newSupplier(adminA, { name: `${tag} Alpha` });
      const gone = await newSupplier(adminA, { name: `${tag} Beta` });
      await adminA.patch(`/suppliers/${gone.id}`, { isActive: false, rowVersion: gone.rowVersion });
      const names = async (query: string) =>
        (await staffA.get(`/suppliers?search=${tag}&${query}`)).body.items.map(
          (s: Supplier) => s.id,
        );
      expect(await names('')).toEqual([live.id]);
      expect(await names('status=inactive')).toEqual([gone.id]);
      expect((await names('status=all')).sort()).toEqual([live.id, gone.id].sort());
      expect(
        (await staffA.get(`/suppliers?search=${tag}&status=all&pageSize=1&page=2`)).body.items,
      ).toHaveLength(1);
      expect((await staffA.get('/suppliers?sortBy=password')).status).toBe(400);
      expect(await balanceOf(live.id)).toEqual({
        supplierId: live.id,
        charged: '0.00',
        credited: '0.00',
        paid: '0.00',
        outstanding: '0.00',
      });
    });

    it('edits with the row version, and a stale or parallel edit loses', async () => {
      const supplier = await newSupplier();
      const edited = await adminA.patch(`/suppliers/${supplier.id}`, {
        name: 'Renamed Supplier',
        rowVersion: supplier.rowVersion,
      });
      expect(edited.status).toBe(200);
      expect(edited.body.rowVersion).toBe(supplier.rowVersion + 1);
      expect(
        (
          await adminA.patch(`/suppliers/${supplier.id}`, {
            name: 'Late',
            rowVersion: supplier.rowVersion,
          })
        ).status,
      ).toBe(409);
      const racers = await Promise.all(
        ['One', 'Two'].map((name) =>
          adminA.patch(`/suppliers/${supplier.id}`, {
            name: `Race ${name}`,
            rowVersion: edited.body.rowVersion,
          }),
        ),
      );
      expect(racers.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(
        (await adminA.patch(`/suppliers/${NIL}`, { name: 'Ghost', rowVersion: 1 })).status,
      ).toBe(404);
      expect((await adminA.patch(`/suppliers/${supplier.id}`, { rowVersion: 1 })).status).toBe(400);
    });

    it('refuses to deactivate a supplier with open orders in any branch, then allows it', async () => {
      const supplier = await newSupplier();
      const item = await newItem();
      const po = await approvedPo(supplier.id, [{ itemId: item.id, qtyOrdered: 2 }]);
      const current = SupplierSchema.parse((await adminB.get(`/suppliers/${supplier.id}`)).body);
      const refused = await adminB.patch(`/suppliers/${supplier.id}`, {
        isActive: false,
        rowVersion: current.rowVersion,
      });
      expect(refused.status).toBe(422);
      await receiveOk(po, { lines: [{ poLineId: lineOf(po), received: 2 }] });
      const done = await adminB.patch(`/suppliers/${supplier.id}`, {
        isActive: false,
        rowVersion: current.rowVersion,
      });
      expect(done.status).toBe(200);
      expect(done.body.isActive).toBe(false);
    });
  });

  describe('purchase orders', () => {
    it('creates a draft with line totals, a numbered order and an audit row', async () => {
      const supplier = await newSupplier();
      const [a, b] = [await newItem(), await newItem()];
      const po = await draftPo(supplier.id, [
        { itemId: a.id, qtyOrdered: 3, unitCost: '1250.50' },
        { itemId: b.id, qtyOrdered: 2, unitCost: '10' },
      ]);
      expect(po).toMatchObject({
        status: 'DRAFT',
        branchId: w.branchA,
        total: '3771.50',
        orderedQty: 5,
        remainingQty: 0,
        receiptCount: 0,
      });
      expect(po.lines.map((l) => l.lineTotal)).toEqual(['3751.50', '20.00']);
      expect(po.poNo).toMatch(/PO\/\d{4}\/\d{5}$/);
      expect(await audits('PURCHASE_ORDER_CREATED', po.id)).toHaveLength(1);
      const second = await draftPo(supplier.id, [{ itemId: a.id, qtyOrdered: 1 }]);
      expect(second.poNo).not.toBe(po.poNo);
    });

    it('lists the lines of an order, a receipt and a return by item code, whatever order they were entered in', async () => {
      const supplier = await newSupplier();
      const [first, second, third] = [await newItem(), await newItem(), await newItem()];
      const po = await approvedPo(
        supplier.id,
        [third, first, second].map((item) => ({ itemId: item.id, qtyOrdered: 2 })),
      );
      const expected = [first, second, third].map((item) => item.itemCode);
      expect(po.lines.map((line) => line.itemCode)).toEqual(expected);
      const receipt = await receiveOk(po, {
        lines: [third, second, first].map((item) => ({
          poLineId: lineFor(po, item.id),
          received: 2,
        })),
      });
      expect(receipt.lines.map((line) => line.itemCode)).toEqual(expected);
      const made = await adminA.post('/purchase-returns', {
        poId: po.id,
        reason: 'Order of lines',
        lines: [third, first].map((item) => ({ poLineId: lineFor(po, item.id), qty: 1 })),
      });
      expect(PurchaseReturnSchema.parse(made.body).lines.map((line) => line.itemCode)).toEqual([
        first.itemCode,
        third.itemCode,
      ]);
    });

    it('needs a branch from a Super Admin and refuses bad lines, items and suppliers', async () => {
      const supplier = await newSupplier();
      const item = await newItem();
      const lines = [{ itemId: item.id, qtyOrdered: 1, unitCost: '5' }];
      expect(
        (await superAdmin.post('/purchase-orders', { supplierId: supplier.id, lines })).status,
      ).toBe(400);
      expect(
        (
          await superAdmin.post('/purchase-orders', {
            supplierId: supplier.id,
            lines,
            branchId: w.branchA,
          })
        ).status,
      ).toBe(201);
      const post = (body: object) =>
        adminA.post('/purchase-orders', { supplierId: supplier.id, lines, ...body });
      expect((await post({ lines: [] })).status).toBe(400);
      expect((await post({ lines: [...lines, ...lines] })).status).toBe(400);
      expect(
        (await post({ lines: [{ itemId: item.id, qtyOrdered: 0, unitCost: '5' }] })).status,
      ).toBe(400);
      expect(
        (await post({ lines: [{ itemId: item.id, qtyOrdered: 1, unitCost: '-5' }] })).status,
      ).toBe(400);
      expect(
        (await post({ lines: [{ itemId: NIL, qtyOrdered: 1, unitCost: '5' }] })).status,
      ).toBeGreaterThanOrEqual(400);
      const inactive = await newItem({ isActive: false });
      expect(
        (await post({ lines: [{ itemId: inactive.id, qtyOrdered: 1, unitCost: '5' }] })).status,
      ).toBe(400);
      expect((await post({ supplierId: NIL })).status).toBe(404);
      const gone = await newSupplier();
      await adminA.patch(`/suppliers/${gone.id}`, { isActive: false, rowVersion: gone.rowVersion });
      expect((await post({ supplierId: gone.id })).status).toBe(400);
    });

    it('changes a draft, but not once approved, and refuses a stale version', async () => {
      const supplier = await newSupplier();
      const [a, b] = [await newItem(), await newItem()];
      const draft = await draftPo(supplier.id, [{ itemId: a.id, qtyOrdered: 3 }]);
      const edited = await adminA.patch(`/purchase-orders/${draft.id}`, {
        lines: [{ itemId: b.id, qtyOrdered: 6, unitCost: '20' }],
        rowVersion: draft.rowVersion,
      });
      expect(edited.status).toBe(200);
      expect(PurchaseOrderSchema.parse(edited.body)).toMatchObject({
        total: '120.00',
        orderedQty: 6,
      });
      expect(
        (
          await adminA.patch(`/purchase-orders/${draft.id}`, {
            orderDate: '2026-01-02',
            rowVersion: draft.rowVersion,
          })
        ).status,
      ).toBe(409);
      const current = await reload(draft.id);
      const approved = await adminA.post(`/purchase-orders/${draft.id}/approve`, {
        rowVersion: current.rowVersion,
      });
      expect(approved.body.status).toBe('APPROVED');
      const afterApproval = await adminA.patch(`/purchase-orders/${draft.id}`, {
        orderDate: '2026-01-02',
        rowVersion: approved.body.rowVersion,
      });
      expect(afterApproval.status).toBe(409);
      expect(afterApproval.body.message).toMatch(/Only a draft/);
    });

    it('approves once, audited, and refuses a second approval, a stale version and an inactive supplier', async () => {
      const supplier = await newSupplier();
      const item = await newItem();
      const draft = await draftPo(supplier.id, [{ itemId: item.id, qtyOrdered: 2 }]);
      const racers = await Promise.all(
        [1, 2].map(() =>
          adminA.post(`/purchase-orders/${draft.id}/approve`, { rowVersion: draft.rowVersion }),
        ),
      );
      expect(racers.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await audits('PURCHASE_ORDER_APPROVED', draft.id)).toHaveLength(1);
      const second = await adminA.post(`/purchase-orders/${draft.id}/approve`, {
        rowVersion: (await reload(draft.id)).rowVersion,
      });
      expect(second.status).toBe(409);

      const other = await newSupplier();
      const parked = await draftPo(other.id, [{ itemId: item.id, qtyOrdered: 1 }]);
      // The screen will not deactivate a supplier that has a draft order, so a change made outside it is simulated.
      await owner.supplier.update({ where: { id: other.id }, data: { isActive: false } });
      const refused = await adminA.post(`/purchase-orders/${parked.id}/approve`, {
        rowVersion: parked.rowVersion,
      });
      expect(refused.status).toBe(422);
      expect((await adminA.post(`/purchase-orders/${NIL}/approve`, { rowVersion: 1 })).status).toBe(
        404,
      );
    });

    it('cancels with a reason until goods arrive, and a cancelled order cannot be received', async () => {
      const supplier = await newSupplier();
      const item = await newItem();
      const po = await approvedPo(supplier.id, [{ itemId: item.id, qtyOrdered: 4 }]);
      expect(
        (
          await adminA.post(`/purchase-orders/${po.id}/cancel`, {
            rowVersion: po.rowVersion,
            reason: 'x',
          })
        ).status,
      ).toBe(400);
      const cancelled = await adminA.post(`/purchase-orders/${po.id}/cancel`, {
        rowVersion: po.rowVersion,
        reason: 'Supplier closed',
      });
      expect(cancelled.status).toBe(200);
      expect(cancelled.body.status).toBe('CANCELLED');
      expect(await audits('PURCHASE_ORDER_CANCELLED', po.id)).toHaveLength(1);
      expect((await receive(po, { lines: [{ poLineId: lineOf(po), received: 1 }] })).status).toBe(
        409,
      );
      expect(
        (
          await adminA.post(`/purchase-orders/${po.id}/cancel`, {
            rowVersion: cancelled.body.rowVersion,
            reason: 'Again',
          })
        ).status,
      ).toBe(409);

      const received = await approvedPo(supplier.id, [{ itemId: item.id, qtyOrdered: 2 }]);
      await receiveOk(received, { lines: [{ poLineId: lineOf(received), received: 1 }] });
      const refused = await adminA.post(`/purchase-orders/${received.id}/cancel`, {
        rowVersion: (await reload(received.id)).rowVersion,
        reason: 'Too late',
      });
      expect(refused.status).toBe(409);
      expect(refused.body.message).toMatch(/Goods have been received/);
    });

    it('lists by status, supplier and number, and pages', async () => {
      const supplier = await newSupplier();
      const item = await newItem();
      const draft = await draftPo(supplier.id, [{ itemId: item.id, qtyOrdered: 1 }]);
      const open = await approvedPo(supplier.id, [{ itemId: item.id, qtyOrdered: 1 }]);
      const ids = async (query: string) =>
        (await staffA.get(`/purchase-orders?supplierId=${supplier.id}&${query}`)).body.items.map(
          (p: PurchaseOrder) => p.id,
        );
      expect(await ids('status=DRAFT')).toEqual([draft.id]);
      expect(await ids('status=open')).toEqual(expect.arrayContaining([open.id]));
      expect((await ids('status=all')).sort()).toEqual([draft.id, open.id].sort());
      expect(
        (await staffA.get(`/purchase-orders?search=${open.poNo}`)).body.items.map(
          (p: PurchaseOrder) => p.id,
        ),
      ).toEqual([open.id]);
      expect(
        (await staffA.get(`/purchase-orders?supplierId=${supplier.id}&pageSize=1&page=2`)).body
          .items,
      ).toHaveLength(1);
      expect((await staffA.get('/purchase-orders?status=bogus')).status).toBe(400);
      expect((await staffA.get('/purchase-orders?sortBy=password')).status).toBe(400);
    });
  });

  describe('receiving goods', () => {
    it('puts a full delivery into Available stock, numbers the receipt and completes the order', async () => {
      const supplier = await newSupplier();
      const item = await newItem();
      const po = await approvedPo(supplier.id, [
        { itemId: item.id, qtyOrdered: 10, unitCost: '250' },
      ]);
      const receipt = await receiveOk(po, {
        lines: [{ poLineId: lineOf(po), received: 10 }],
        deliveryNoteNo: 'DN-77',
        note: 'Boxes intact',
      });
      expect(receipt).toMatchObject({
        poNo: po.poNo,
        deliveryNoteNo: 'DN-77',
        note: 'Boxes intact',
        branchId: w.branchA,
      });
      expect(receipt.grnNo).toMatch(/GRN\/\d{4}\/\d{5}$/);
      expect(receipt.lines[0]).toMatchObject({
        qtyReceived: 10,
        qtyAccepted: 10,
        discrepancies: [],
      });
      expect(await stock(item.id)).toBe(10);
      expect(await drift(item.id)).toEqual([]);
      const after = await reload(po.id);
      expect(after).toMatchObject({ status: 'RECEIVED', remainingQty: 0, receiptCount: 1 });
      expect(after.lines[0]).toMatchObject({ accepted: 10, remaining: 0 });
      const entry = await owner.stockLedger.findFirstOrThrow({ where: { itemId: item.id } });
      expect(entry).toMatchObject({
        movementType: 'PURCHASE_RECEIPT',
        qtyDelta: 10,
        state: 'AVAILABLE',
        createdBy: w.users.staffA,
      });
      expect(await audits('GOODS_RECEIVED', receipt.id)).toHaveLength(1);
      expect((await balanceOf(supplier.id)).charged).toBe('2500.00');
    });

    it('takes partial deliveries in turn and shows what is still expected', async () => {
      const supplier = await newSupplier();
      const item = await newItem();
      const po = await approvedPo(supplier.id, [{ itemId: item.id, qtyOrdered: 10 }]);
      await receiveOk(po, { lines: [{ poLineId: lineOf(po), received: 4 }] });
      expect(await reload(po.id)).toMatchObject({
        status: 'PARTIALLY_RECEIVED',
        remainingQty: 6,
        receiptCount: 1,
      });
      await receiveOk(po, { lines: [{ poLineId: lineOf(po), received: 6 }] });
      expect(await reload(po.id)).toMatchObject({
        status: 'RECEIVED',
        remainingQty: 0,
        receiptCount: 2,
      });
      expect(await stock(item.id)).toBe(10);
      const numbers = (await staffA.get(`/goods-receipts?poId=${po.id}`)).body.items.map(
        (g: GoodsReceipt) => g.grnNo,
      );
      expect(new Set(numbers).size).toBe(2);
    });

    it('records a short delivery, and a claim leaves the rest expected while a write-off closes the order', async () => {
      const supplier = await newSupplier();
      const item = await newItem();
      const po = await approvedPo(supplier.id, [{ itemId: item.id, qtyOrdered: 10 }]);
      const receipt = await receiveOk(po, {
        lines: [{ poLineId: lineOf(po), received: 7, deliveryNoteQty: 10 }],
      });
      expect(receipt.lines[0]?.discrepancies).toMatchObject([
        { type: 'SHORT', qty: 3, status: 'OPEN' },
      ]);
      expect(await stock(item.id)).toBe(7);
      const [short] = await discrepanciesOf(receipt);
      expect(short?.allowedResolutions).toEqual(['CLAIM', 'WRITE_OFF']);
      expect((await resolve(short as Discrepancy, 'ACCEPT')).status).toBe(422);
      const claimed = await resolve(short as Discrepancy, 'CLAIM', adminA, 'Told the supplier');
      expect(claimed.status).toBe(200);
      expect(await reload(po.id)).toMatchObject({ status: 'PARTIALLY_RECEIVED', remainingQty: 3 });
      const rest = await receiveOk(po, { lines: [{ poLineId: lineOf(po), received: 3 }] });
      expect(rest.lines[0]?.qtyAccepted).toBe(3);
      expect((await reload(po.id)).status).toBe('RECEIVED');

      const other = await approvedPo(supplier.id, [{ itemId: item.id, qtyOrdered: 5 }]);
      const partial = await receiveOk(other, {
        lines: [{ poLineId: lineOf(other), received: 2, deliveryNoteQty: 5 }],
      });
      const [shortage] = await discrepanciesOf(partial);
      expect((await resolve(shortage as Discrepancy, 'WRITE_OFF')).status).toBe(200);
      expect(await reload(other.id)).toMatchObject({ status: 'RECEIVED', remainingQty: 0 });
      expect(await stock(item.id)).toBe(12);
      expect(await drift(item.id)).toEqual([]);
    });

    it('sends units beyond the order to Quarantine as an excess to settle', async () => {
      const supplier = await newSupplier();
      const item = await newItem();
      const po = await approvedPo(supplier.id, [
        { itemId: item.id, qtyOrdered: 10, unitCost: '100' },
      ]);
      const receipt = await receiveOk(po, { lines: [{ poLineId: lineOf(po), received: 12 }] });
      expect(receipt.lines[0]).toMatchObject({ qtyReceived: 12, qtyAccepted: 10 });
      expect(receipt.lines[0]?.discrepancies).toMatchObject([{ type: 'EXCESS', qty: 2 }]);
      expect(await stock(item.id)).toBe(10);
      expect(await stock(item.id, 'QUARANTINE')).toBe(2);
      expect((await reload(po.id)).status).toBe('RECEIVED');
      const [excess] = await discrepanciesOf(receipt);
      expect(excess?.allowedResolutions).toEqual(['ACCEPT', 'RETURN']);
      expect((await resolve(excess as Discrepancy, 'WRITE_OFF')).status).toBe(422);
      expect((await resolve(excess as Discrepancy, 'ACCEPT')).status).toBe(200);
      expect(await stock(item.id)).toBe(12);
      expect(await stock(item.id, 'QUARANTINE')).toBe(0);
      expect((await balanceOf(supplier.id)).charged).toBe('1200.00');
      expect(await drift(item.id)).toEqual([]);
    });

    it('returns excess stock without charging for it', async () => {
      const supplier = await newSupplier();
      const item = await newItem();
      const po = await approvedPo(supplier.id, [
        { itemId: item.id, qtyOrdered: 4, unitCost: '100' },
      ]);
      const receipt = await receiveOk(po, { lines: [{ poLineId: lineOf(po), received: 6 }] });
      const [excess] = await discrepanciesOf(receipt);
      expect(
        (await resolve(excess as Discrepancy, 'RETURN', adminA, 'Sent back with the driver'))
          .status,
      ).toBe(200);
      expect(await stock(item.id, 'QUARANTINE')).toBe(0);
      expect(await stock(item.id)).toBe(4);
      const made = await owner.purchaseReturn.findFirstOrThrow({
        where: { discrepancyId: excess?.id },
        include: { lines: true },
      });
      expect(made.reason).toBe('Sent back with the driver');
      expect(made.lines.map((l) => [l.qty, l.unitCost.toFixed(2)])).toEqual([[2, '0.00']]);
      expect(
        await owner.stockLedger.count({
          where: { itemId: item.id, movementType: 'PURCHASE_RETURN' },
        }),
      ).toBe(1);
      expect(await balanceOf(supplier.id)).toMatchObject({
        charged: '400.00',
        credited: '0.00',
        outstanding: '400.00',
      });
    });

    it('quarantines damaged units, and each decision settles them differently', async () => {
      const supplier = await newSupplier();
      const item = await newItem();
      const po = await approvedPo(supplier.id, [
        { itemId: item.id, qtyOrdered: 10, unitCost: '100' },
      ]);
      const receipt = await receiveOk(po, {
        lines: [{ poLineId: lineOf(po), received: 10, damaged: 3 }],
      });
      expect(receipt.lines[0]).toMatchObject({ qtyReceived: 10, qtyAccepted: 7 });
      expect(await stock(item.id)).toBe(7);
      expect(await stock(item.id, 'QUARANTINE')).toBe(3);
      expect(await reload(po.id)).toMatchObject({ status: 'PARTIALLY_RECEIVED', remainingQty: 3 });
      expect((await balanceOf(supplier.id)).charged).toBe('700.00');
      const [damaged] = await discrepanciesOf(receipt);
      expect(damaged?.allowedResolutions).toEqual(['ACCEPT', 'RETURN', 'WRITE_OFF']);
      expect((await resolve(damaged as Discrepancy, 'WRITE_OFF')).status).toBe(200);
      expect(await stock(item.id, 'QUARANTINE')).toBe(0);
      expect(await stock(item.id)).toBe(7);
      expect(await reload(po.id)).toMatchObject({ status: 'RECEIVED', remainingQty: 0 });
      expect((await balanceOf(supplier.id)).charged).toBe('1000.00');
      expect(
        await owner.stockLedger.count({ where: { itemId: item.id, movementType: 'WRITE_OFF' } }),
      ).toBe(1);

      const second = await approvedPo(supplier.id, [
        { itemId: item.id, qtyOrdered: 4, unitCost: '100' },
      ]);
      const again = await receiveOk(second, {
        lines: [{ poLineId: lineOf(second), received: 4, damaged: 4 }],
      });
      const [bad] = await discrepanciesOf(again);
      expect((await resolve(bad as Discrepancy, 'ACCEPT')).status).toBe(200);
      expect(await stock(item.id)).toBe(11);
      expect((await reload(second.id)).status).toBe('RECEIVED');
      const ledger = SupplierLedgerResponseSchema.parse(
        (await adminA.get(`/suppliers/${supplier.id}/ledger`)).body,
      );
      expect(ledger.items.map((e) => e.kind)).toEqual(
        expect.arrayContaining(['RECEIPT', 'ACCEPTED_LATER', 'WRITTEN_OFF']),
      );
      expect(await drift(item.id)).toEqual([]);

      const third = await approvedPo(supplier.id, [
        { itemId: item.id, qtyOrdered: 2, unitCost: '100' },
      ]);
      const last = await receiveOk(third, {
        lines: [{ poLineId: lineOf(third), received: 2, damaged: 2 }],
      });
      const [toReturn] = await discrepanciesOf(last);
      expect((await resolve(toReturn as Discrepancy, 'RETURN')).status).toBe(200);
      expect(await reload(third.id)).toMatchObject({
        status: 'PARTIALLY_RECEIVED',
        remainingQty: 2,
      });
    });

    it('quarantines a wrong item, which can be returned or written off but never accepted', async () => {
      const supplier = await newSupplier();
      const [ordered, wrong] = [await newItem(), await newItem()];
      const po = await approvedPo(supplier.id, [{ itemId: ordered.id, qtyOrdered: 5 }]);
      const receipt = await receiveOk(po, {
        lines: [{ poLineId: lineOf(po), received: 5 }],
        wrongItems: [{ itemId: wrong.id, qty: 2 }],
      });
      expect(await stock(ordered.id)).toBe(5);
      expect(await stock(wrong.id)).toBe(0);
      expect(await stock(wrong.id, 'QUARANTINE')).toBe(2);
      const found = (await discrepanciesOf(receipt)).find((d) => d.type === 'WRONG_ITEM');
      expect(found).toMatchObject({ qty: 2, itemId: wrong.id });
      expect(found?.allowedResolutions).toEqual(['RETURN', 'WRITE_OFF']);
      expect((await resolve(found as Discrepancy, 'ACCEPT')).status).toBe(422);
      expect((await resolve(found as Discrepancy, 'WRITE_OFF')).status).toBe(200);
      expect(await stock(wrong.id, 'QUARANTINE')).toBe(0);
      expect(await drift(wrong.id)).toEqual([]);
    });

    it('refuses what makes no sense, before anything is recorded', async () => {
      const supplier = await newSupplier();
      const [plain, serial] = [await newItem(), await newItem({ isSerialized: true })];
      const po = await approvedPo(supplier.id, [
        { itemId: plain.id, qtyOrdered: 5 },
        { itemId: serial.id, qtyOrdered: 2 },
      ]);
      const [plainLine, serialLine] = [lineFor(po, plain.id), lineFor(po, serial.id)];
      const attempts: [object, number][] = [
        [{ lines: [] }, 400],
        [{ lines: [{ poLineId: plainLine }] }, 400],
        [{ lines: [{ poLineId: plainLine, received: 2, damaged: 3 }] }, 400],
        [{ lines: [{ poLineId: plainLine, received: 0 }] }, 400],
        [
          {
            lines: [
              { poLineId: plainLine, received: 1 },
              { poLineId: plainLine, received: 1 },
            ],
          },
          400,
        ],
        [
          { lines: [{ poLineId: plainLine, received: 1, serials: [{ serialNo: 'ABC-001' }] }] },
          400,
        ],
        [{ lines: [{ poLineId: serialLine, received: 1 }] }, 400],
        [{ lines: [{ poLineId: NIL, received: 1 }] }, 400],
        [
          {
            lines: [
              { poLineId: serialLine, serials: [{ serialNo: 'DUP-001' }, { serialNo: 'dup-001' }] },
            ],
          },
          400,
        ],
        [
          {
            lines: [{ poLineId: plainLine, received: 1 }],
            wrongItems: [{ itemId: plain.id, qty: 2, serials: [{ serialNo: 'ABC-001' }] }],
          },
          400,
        ],
      ];
      for (const [body, status] of attempts) {
        const response = await receive(po, body);
        expect(response.status, JSON.stringify(body)).toBe(status);
      }
      expect(await owner.goodsReceipt.count({ where: { poId: po.id } })).toBe(0);
      expect(await stock(plain.id)).toBe(0);
    });

    it('will not receive against a draft order or in an inactive branch', async () => {
      const supplier = await newSupplier();
      const item = await newItem();
      const draft = await draftPo(supplier.id, [{ itemId: item.id, qtyOrdered: 2 }]);
      const refused = await receive(draft, { lines: [{ poLineId: lineOf(draft), received: 1 }] });
      expect(refused.status).toBe(409);
      expect(refused.body.message).toMatch(/Approve the purchase order/);
      expect(
        (await receive(draft, { lines: [{ poLineId: lineOf(draft), received: 1 }] }, adminB))
          .status,
      ).toBe(404);
      expect(
        (
          await staffA.post(`/purchase-orders/${NIL}/receive`, {
            lines: [{ poLineId: NIL, received: 1 }],
          })
        ).status,
      ).toBe(404);
    });

    it('lets two deliveries arrive at once without ever exceeding the order in Available stock', async () => {
      const supplier = await newSupplier();
      const item = await newItem();
      const po = await approvedPo(supplier.id, [{ itemId: item.id, qtyOrdered: 10 }]);
      const body = { lines: [{ poLineId: lineOf(po), received: 10 }] };
      const results = await Promise.all([receive(po, body), receive(po, body, adminA)]);
      expect(results.map((r) => r.status).every((s) => s < 300)).toBe(true);
      expect(await stock(item.id)).toBe(10);
      expect(await stock(item.id, 'QUARANTINE')).toBe(10);
      expect(await drift(item.id)).toEqual([]);
    });
  });

  describe('serial units and batteries', () => {
    it('creates a serial unit for every piece, with damaged pieces in Quarantine', async () => {
      const supplier = await newSupplier();
      const item = await newItem({ isSerialized: true });
      const po = await approvedPo(supplier.id, [{ itemId: item.id, qtyOrdered: 3 }]);
      const tag = unique('SN');
      const receipt = await receiveOk(po, {
        lines: [
          {
            poLineId: lineOf(po),
            serials: [
              { serialNo: `${tag}-A`, chassisNo: `${tag}-CH1` },
              { serialNo: `${tag}-B`, damaged: true },
              { serialNo: `${tag}-C` },
            ],
          },
        ],
      });
      expect(receipt.lines[0]).toMatchObject({ qtyReceived: 3, qtyAccepted: 2 });
      expect(await stock(item.id)).toBe(2);
      expect(await stock(item.id, 'QUARANTINE')).toBe(1);
      const units = await owner.serialUnit.findMany({
        where: { itemId: item.id },
        orderBy: { serialNo: 'asc' },
      });
      expect(units.map((u) => [u.serialNo, u.state])).toEqual([
        [`${tag}-A`, 'AVAILABLE'],
        [`${tag}-B`, 'QUARANTINE'],
        [`${tag}-C`, 'AVAILABLE'],
      ]);
      expect(units[0]?.chassisNo).toBe(`${tag}-CH1`);
      const [damaged] = await discrepanciesOf(receipt);
      expect(damaged).toMatchObject({ type: 'DAMAGED', qty: 1 });
      expect((await resolve(damaged as Discrepancy, 'ACCEPT')).status).toBe(200);
      expect(
        (await owner.serialUnit.findFirstOrThrow({ where: { serialNo: `${tag}-B` } })).state,
      ).toBe('AVAILABLE');
      expect(await stock(item.id)).toBe(3);
      expect(await drift(item.id)).toEqual([]);
    });

    it('refuses a serial number that already exists anywhere and leaves nothing behind', async () => {
      const supplier = await newSupplier();
      const item = await newItem({ isSerialized: true });
      const tag = unique('DUP');
      const first = await approvedPo(supplier.id, [{ itemId: item.id, qtyOrdered: 1 }]);
      await receiveOk(first, {
        lines: [{ poLineId: lineOf(first), serials: [{ serialNo: `${tag}-1` }] }],
      });
      const second = await approvedPo(supplier.id, [{ itemId: item.id, qtyOrdered: 2 }]);
      const clash = await receive(second, {
        lines: [
          {
            poLineId: lineOf(second),
            serials: [{ serialNo: `${tag}-2` }, { serialNo: `${tag}-1` }],
          },
        ],
      });
      expect(clash.status).toBe(409);
      expect(await owner.serialUnit.count({ where: { serialNo: `${tag}-2` } })).toBe(0);
      expect(await owner.goodsReceipt.count({ where: { poId: second.id } })).toBe(0);
      expect(await stock(item.id)).toBe(1);
    });

    it('sends serial units beyond the order to Quarantine as an excess', async () => {
      const supplier = await newSupplier();
      const item = await newItem({ isSerialized: true });
      const po = await approvedPo(supplier.id, [{ itemId: item.id, qtyOrdered: 1 }]);
      const tag = unique('EX');
      const receipt = await receiveOk(po, {
        lines: [
          { poLineId: lineOf(po), serials: [{ serialNo: `${tag}-1` }, { serialNo: `${tag}-2` }] },
        ],
      });
      expect(await stock(item.id)).toBe(1);
      expect(await stock(item.id, 'QUARANTINE')).toBe(1);
      const [excess] = await discrepanciesOf(receipt);
      expect(excess).toMatchObject({ type: 'EXCESS', qty: 1 });
      expect((await resolve(excess as Discrepancy, 'RETURN')).status).toBe(200);
      expect(
        (await owner.serialUnit.findFirstOrThrow({ where: { serialNo: `${tag}-2` } })).state,
      ).toBe('SCRAPPED');
      expect(await stock(item.id, 'QUARANTINE')).toBe(0);
    });

    it('records battery dates carried with a received serial number', async () => {
      const supplier = await newSupplier();
      const item = await newItem({ isSerialized: true });
      const po = await approvedPo(supplier.id, [{ itemId: item.id, qtyOrdered: 2 }]);
      const tag = unique('BT');
      await receiveOk(po, {
        lines: [
          {
            poLineId: lineOf(po),
            serials: [
              {
                serialNo: `${tag}-1`,
                manufacturedOn: '2026-01-10',
                expiryOn: '2027-01-10',
                warrantyMonths: 12,
              },
              { serialNo: `${tag}-2` },
            ],
          },
        ],
      });
      const unit = await owner.serialUnit.findFirstOrThrow({
        where: { serialNo: `${tag}-1` },
        include: { battery: true },
      });
      expect(unit.battery?.expiryOn?.toISOString().slice(0, 10)).toBe('2027-01-10');
      expect(unit.battery?.warrantyMonths).toBe(12);
      const plain = await owner.serialUnit.findFirstOrThrow({
        where: { serialNo: `${tag}-2` },
        include: { battery: true },
      });
      expect(plain.battery).toBeNull();
      const bad = await receive(po, {
        lines: [
          {
            poLineId: lineOf(po),
            serials: [
              { serialNo: `${tag}-3`, manufacturedOn: '2026-05-01', expiryOn: '2026-04-01' },
            ],
          },
        ],
      });
      expect(bad.status).toBe(400);
    });

    it('takes a wrong serialized item into Quarantine unit by unit', async () => {
      const supplier = await newSupplier();
      const [ordered, wrong] = [await newItem(), await newItem({ isSerialized: true })];
      const po = await approvedPo(supplier.id, [{ itemId: ordered.id, qtyOrdered: 1 }]);
      const tag = unique('WR');
      const receipt = await receiveOk(po, {
        lines: [{ poLineId: lineOf(po), received: 1 }],
        wrongItems: [
          {
            itemId: wrong.id,
            qty: 2,
            serials: [{ serialNo: `${tag}-1` }, { serialNo: `${tag}-2` }],
          },
        ],
      });
      expect(await stock(wrong.id, 'QUARANTINE')).toBe(2);
      const found = (await discrepanciesOf(receipt)).find((d) => d.type === 'WRONG_ITEM');
      expect((await resolve(found as Discrepancy, 'WRITE_OFF')).status).toBe(200);
      expect(
        (await owner.serialUnit.findFirstOrThrow({ where: { serialNo: `${tag}-1` } })).state,
      ).toBe('SCRAPPED');
      expect(await stock(wrong.id, 'QUARANTINE')).toBe(0);
      expect(await drift(wrong.id)).toEqual([]);
    });
  });

  describe('settling discrepancies', () => {
    it('lists them by status and type, and shows who the supplier was', async () => {
      const supplier = await newSupplier();
      const item = await newItem();
      const po = await approvedPo(supplier.id, [{ itemId: item.id, qtyOrdered: 5 }]);
      const receipt = await receiveOk(po, {
        lines: [{ poLineId: lineOf(po), received: 6, damaged: 1, deliveryNoteQty: 7 }],
      });
      const mine = (await discrepanciesOf(receipt)).map((d) => d.type).sort();
      expect(mine).toEqual(['DAMAGED', 'EXCESS', 'SHORT']);
      const open = await staffA.get('/discrepancies?status=OPEN&type=DAMAGED');
      const found = open.body.items.find((d: Discrepancy) => d.itemId === item.id);
      expect(found).toMatchObject({
        type: 'DAMAGED',
        status: 'OPEN',
        supplierName: supplier.name,
        branchCode: codeA,
      });
      expect((await staffA.get('/discrepancies?type=BOGUS')).status).toBe(400);
      expect(
        (await staffA.get('/discrepancies?status=RESOLVED')).body.items.some(
          (d: Discrepancy) => d.itemId === item.id,
        ),
      ).toBe(false);
      const receipts = (await staffA.get(`/goods-receipts?poId=${po.id}`)).body.items;
      expect(receipts[0]).toMatchObject({ lineCount: 1, openDiscrepancies: 3 });
    });

    it('refuses a stale version, a second decision, and lets only one of two parallel decisions win', async () => {
      const supplier = await newSupplier();
      const item = await newItem();
      const po = await approvedPo(supplier.id, [{ itemId: item.id, qtyOrdered: 4 }]);
      const receipt = await receiveOk(po, { lines: [{ poLineId: lineOf(po), received: 6 }] });
      const [excess] = await discrepanciesOf(receipt);
      expect(
        (
          await adminA.post(`/discrepancies/${excess?.id}/resolve`, {
            resolution: 'ACCEPT',
            rowVersion: 99,
          })
        ).status,
      ).toBe(409);
      const racers = await Promise.all([
        resolve(excess as Discrepancy, 'ACCEPT'),
        resolve(excess as Discrepancy, 'RETURN'),
      ]);
      expect(racers.map((r) => r.status).sort()).toEqual([200, 409]);
      const settled = DiscrepancySchema.parse(
        (await adminA.get(`/discrepancies/${excess?.id}`)).body,
      );
      expect(settled.status).toBe('RESOLVED');
      expect((await resolve(settled, 'ACCEPT')).status).toBe(409);
      expect(await audits('DISCREPANCY_RESOLVED', settled.id)).toHaveLength(1);
      expect(await drift(item.id)).toEqual([]);
    });
  });

  describe('returns to a supplier', () => {
    const buy = async (qty = 10, unitCost = '100') => {
      const supplier = await newSupplier();
      const item = await newItem();
      const po = await approvedPo(supplier.id, [{ itemId: item.id, qtyOrdered: qty, unitCost }]);
      await receiveOk(po, { lines: [{ poLineId: lineOf(po), received: qty }] });
      return { supplier, item, po };
    };

    it('sends accepted stock back, takes it out of Available, numbers the return and credits the supplier', async () => {
      const { supplier, item, po } = await buy();
      const response = await adminA.post('/purchase-returns', {
        poId: po.id,
        reason: 'Wrong colour',
        lines: [{ poLineId: lineOf(po), qty: 4 }],
      });
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      const made = PurchaseReturnSchema.parse(response.body);
      expect(made).toMatchObject({
        credit: '400.00',
        reason: 'Wrong colour',
        supplierName: supplier.name,
        discrepancyId: null,
      });
      expect(made.returnNo).toMatch(/PRT\/\d{4}\/\d{5}$/);
      expect(await stock(item.id)).toBe(6);
      expect(
        await owner.stockLedger.count({
          where: { itemId: item.id, movementType: 'PURCHASE_RETURN' },
        }),
      ).toBe(1);
      expect(await balanceOf(supplier.id)).toMatchObject({
        charged: '1000.00',
        credited: '400.00',
        outstanding: '600.00',
      });
      expect(await audits('PURCHASE_RETURN_CREATED', made.id)).toHaveLength(1);
      expect((await staffA.get(`/purchase-returns/${made.id}`)).status).toBe(200);
      expect(
        (await staffA.get(`/purchase-returns?supplierId=${supplier.id}`)).body.items,
      ).toHaveLength(1);
    });

    it('will not return more than was bought and kept, or more than is in stock', async () => {
      const { item, po } = await buy(5);
      const ask = (qty: number) =>
        adminA.post('/purchase-returns', {
          poId: po.id,
          reason: 'Too many',
          lines: [{ poLineId: lineOf(po), qty }],
        });
      const tooMany = await ask(6);
      expect(tooMany.status).toBe(422);
      expect(tooMany.body.message).toMatch(/Only 5 of/);
      expect((await ask(3)).status).toBe(201);
      expect((await ask(3)).status).toBe(422);
      expect((await ask(2)).status).toBe(201);
      expect((await ask(1)).status).toBe(422);
      expect(await stock(item.id)).toBe(0);
    });

    it('refuses a return without quantity, a foreign line, a short reason and an unknown order', async () => {
      const { po } = await buy(5);
      const other = await buy(5);
      const post = (body: object) =>
        adminA.post('/purchase-returns', {
          poId: po.id,
          reason: 'Faulty',
          lines: [{ poLineId: lineOf(po), qty: 1 }],
          ...body,
        });
      expect((await post({ lines: [{ poLineId: lineOf(po) }] })).status).toBe(400);
      expect((await post({ lines: [{ poLineId: lineOf(other.po), qty: 1 }] })).status).toBe(400);
      expect((await post({ reason: 'no' })).status).toBe(400);
      expect((await post({ lines: [] })).status).toBe(400);
      expect((await post({ poId: NIL })).status).toBe(404);
      expect(
        (
          await adminB.post('/purchase-returns', {
            poId: po.id,
            reason: 'Faulty',
            lines: [{ poLineId: lineOf(po), qty: 1 }],
          })
        ).status,
      ).toBe(404);
    });

    it('returns serial units by unit and refuses a unit listed twice or one that is not in stock', async () => {
      const supplier = await newSupplier();
      const item = await newItem({ isSerialized: true });
      const po = await approvedPo(supplier.id, [
        { itemId: item.id, qtyOrdered: 3, unitCost: '500' },
      ]);
      const tag = unique('RT');
      await receiveOk(po, {
        lines: [
          {
            poLineId: lineOf(po),
            serials: [{ serialNo: `${tag}-1` }, { serialNo: `${tag}-2` }, { serialNo: `${tag}-3` }],
          },
        ],
      });
      const units = await owner.serialUnit.findMany({
        where: { itemId: item.id },
        orderBy: { serialNo: 'asc' },
      });
      const ids = units.map((u) => u.id);
      const ask = (serialUnitIds: string[]) =>
        adminA.post('/purchase-returns', {
          poId: po.id,
          reason: 'Faulty units',
          lines: [{ poLineId: lineOf(po), serialUnitIds }],
        });
      expect((await ask([ids[0] as string, ids[0] as string])).status).toBe(400);
      expect((await ask([NIL])).status).toBeGreaterThanOrEqual(400);
      const done = await ask([ids[0] as string, ids[1] as string]);
      expect(done.status, JSON.stringify(done.body)).toBe(201);
      expect(
        PurchaseReturnSchema.parse(done.body)
          .lines.map((l) => l.serialNo)
          .sort(),
      ).toEqual([`${tag}-1`, `${tag}-2`]);
      expect(
        await owner.serialUnit.findMany({
          where: { id: { in: ids.slice(0, 2) } },
          select: { state: true },
        }),
      ).toEqual(
        [{ state: 'SCRAPPED' }, { state: 'SCRAPPED' }].map((s) => expect.objectContaining(s)),
      );
      expect((await ask([ids[0] as string])).status).toBeGreaterThanOrEqual(400);
      expect(await stock(item.id)).toBe(1);
      expect(await drift(item.id)).toEqual([]);
    });

    it('lets only one of two parallel returns of the last units win', async () => {
      const { item, po } = await buy(3);
      const ask = () =>
        adminA.post('/purchase-returns', {
          poId: po.id,
          reason: 'Race',
          lines: [{ poLineId: lineOf(po), qty: 3 }],
        });
      const results = await Promise.all([ask(), ask()]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 422]);
      expect(await stock(item.id)).toBe(0);
      expect(await drift(item.id)).toEqual([]);
    });
  });

  describe('supplier payments and the ledger', () => {
    const owed = async (cost = '100', qty = 10) => {
      const supplier = await newSupplier();
      const item = await newItem();
      const po = await approvedPo(supplier.id, [
        { itemId: item.id, qtyOrdered: qty, unitCost: cost },
      ]);
      await receiveOk(po, { lines: [{ poLineId: lineOf(po), received: qty }] });
      return { supplier, item, po };
    };

    it('records a payment against what is owed and reduces the balance', async () => {
      const { supplier } = await owed();
      const response = await adminA.post(`/suppliers/${supplier.id}/payments`, {
        amount: '400.50',
        mode: 'CASH',
        reference: 'CHQ-123',
        paidOn: '2026-10-01',
      });
      expect(response.status, JSON.stringify(response.body)).toBeLessThan(300);
      expect(response.body).toMatchObject({
        amount: '400.50',
        mode: 'CASH',
        reference: 'CHQ-123',
        paidOn: '2026-10-01',
        outstanding: '599.50',
      });
      expect(await balanceOf(supplier.id)).toMatchObject({
        charged: '1000.00',
        paid: '400.50',
        outstanding: '599.50',
      });
      expect(await audits('SUPPLIER_PAYMENT_RECORDED', supplier.id)).toHaveLength(1);
    });

    it('refuses an overpayment, a future date, an unknown mode and a zero or malformed amount', async () => {
      const { supplier } = await owed('10', 5);
      const pay = (body: object) =>
        adminA.post(`/suppliers/${supplier.id}/payments`, { amount: '10', mode: 'CASH', ...body });
      const over = await pay({ amount: '50.01' });
      expect(over.status).toBe(422);
      expect(over.body.details[0].message).toMatch(/Only 50.00 is outstanding/);
      expect((await pay({ paidOn: '2999-01-01' })).status).toBe(400);
      expect((await pay({ mode: 'BARTER' })).status).toBe(400);
      expect((await pay({ amount: '0' })).status).toBe(400);
      expect((await pay({ amount: '12.345' })).status).toBe(400);
      expect((await pay({ amount: '-5' })).status).toBe(400);
      expect((await pay({ mode: '' })).status).toBe(400);
      expect(
        (await adminA.post(`/suppliers/${NIL}/payments`, { amount: '1', mode: 'CASH' })).status,
      ).toBe(404);
      expect((await pay({ amount: '50' })).status).toBeLessThan(300);
      expect((await pay({ amount: '0.01' })).status).toBe(422);
    });

    it('lets only one of two parallel payments of the full balance win', async () => {
      const { supplier } = await owed('20', 5);
      const results = await Promise.all(
        [1, 2].map(() =>
          adminA.post(`/suppliers/${supplier.id}/payments`, { amount: '100', mode: 'CASH' }),
        ),
      );
      expect(results.map((r) => (r.status < 300 ? 'paid' : String(r.status))).sort()).toEqual([
        '422',
        'paid',
      ]);
      expect((await balanceOf(supplier.id)).outstanding).toBe('0.00');
    });

    it('needs the branch from a Super Admin and refuses an unknown or inactive one', async () => {
      const { supplier } = await owed('10', 2);
      const pay = (body: object) =>
        superAdmin.post(`/suppliers/${supplier.id}/payments`, {
          amount: '5',
          mode: 'CASH',
          ...body,
        });
      expect((await pay({})).status).toBe(400);
      expect((await pay({ branchId: NIL })).status).toBe(404);
      expect((await pay({ branchId: w.branchA })).status).toBeLessThan(300);
    });

    it('keeps a running ledger of receipts, returns and payments, newest first, with a paged balance', async () => {
      const { supplier, po } = await owed('100', 10);
      await adminA.post('/purchase-returns', {
        poId: po.id,
        reason: 'Faulty',
        lines: [{ poLineId: lineOf(po), qty: 2 }],
      });
      await adminA.post(`/suppliers/${supplier.id}/payments`, {
        amount: '300',
        mode: 'UPI',
        reference: 'UPI-9',
      });
      const ledger = SupplierLedgerResponseSchema.parse(
        (await adminA.get(`/suppliers/${supplier.id}/ledger`)).body,
      );
      expect(ledger.items.map((e) => e.kind)).toEqual(['PAYMENT', 'RETURN', 'RECEIPT']);
      expect(ledger.items.map((e) => e.balance)).toEqual(['500.00', '800.00', '1000.00']);
      expect(ledger.items[0]).toMatchObject({
        credit: '300.00',
        debit: '0.00',
        documentNo: 'UPI-9',
      });
      expect(ledger.items[2]).toMatchObject({
        debit: '1000.00',
        credit: '0.00',
        branchCode: codeA,
      });
      expect(ledger.balance).toMatchObject({
        charged: '1000.00',
        credited: '200.00',
        paid: '300.00',
        outstanding: '500.00',
      });
      const page = await adminA.get(`/suppliers/${supplier.id}/ledger?pageSize=1&page=2`);
      expect(page.body.items.map((e: { kind: string }) => e.kind)).toEqual(['RETURN']);
      expect(page.body.total).toBe(3);
      expect((await adminA.get(`/suppliers/${NIL}/ledger`)).status).toBe(404);
    });

    it('serves the payment modes to any signed-in user', async () => {
      const modes = await staffA.get('/reference/payment-modes');
      expect(modes.status).toBe(200);
      expect(modes.body.map((m: { code: string }) => m.code)).toContain('CASH');
    });
  });

  describe('database guards', () => {
    it('never lets the application change or delete a return, and deletes order lines only while draft', async () => {
      const supplier = await newSupplier();
      const item = await newItem();
      const draft = await draftPo(supplier.id, [{ itemId: item.id, qtyOrdered: 2 }]);
      const live = await approvedPo(supplier.id, [{ itemId: item.id, qtyOrdered: 2 }]);
      await expect(owner.poLine.delete({ where: { id: lineOf(live) } })).rejects.toThrow();
      await owner.poLine.delete({ where: { id: lineOf(draft) } });

      await receiveOk(live, { lines: [{ poLineId: lineOf(live), received: 2 }] });
      const made = PurchaseReturnSchema.parse(
        (
          await adminA.post('/purchase-returns', {
            poId: live.id,
            reason: 'Faulty',
            lines: [{ poLineId: lineOf(live), qty: 1 }],
          })
        ).body,
      );
      const client = await connectApp();
      try {
        expect(
          await sqlState(
            client.query('UPDATE purchase_returns SET reason = $1 WHERE id = $2', [
              'Changed',
              made.id,
            ]),
          ),
        ).toBe('42501');
        expect(
          await sqlState(client.query('DELETE FROM purchase_returns WHERE id = $1', [made.id])),
        ).toBe('42501');
        expect(
          await sqlState(
            client.query('UPDATE purchase_return_lines SET qty = 9 WHERE return_id = $1', [
              made.id,
            ]),
          ),
        ).toBe('42501');
      } finally {
        await client.end();
      }
    });

    it('refuses two orders lines for one item, two suppliers with one GSTIN and impossible rows', async () => {
      const supplier = await newSupplier();
      const item = await newItem();
      const po = await approvedPo(supplier.id, [{ itemId: item.id, qtyOrdered: 2 }]);
      await expect(
        owner.poLine.create({
          data: { branchId: w.branchA, poId: po.id, itemId: item.id, qtyOrdered: 1, unitCost: 1 },
        }),
      ).rejects.toThrow();
      const gstin = gstinFor('27', 'QWERT1234F1Z');
      await owner.supplier.create({ data: { name: 'First', gstin } });
      await expect(owner.supplier.create({ data: { name: 'Second', gstin } })).rejects.toThrow();
      await expect(
        owner.purchaseReturnLine.create({
          data: { branchId: w.branchA, returnId: NIL, itemId: item.id, qty: 0, unitCost: 1 },
        }),
      ).rejects.toThrow();
    });
  });
});
