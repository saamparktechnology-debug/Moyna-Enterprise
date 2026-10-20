import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  AdjustmentListResponseSchema,
  LowStockListResponseSchema,
  MovementListResponseSchema,
  SerialUnitListResponseSchema,
  StockAdjustmentSchema,
  StockBalanceListResponseSchema,
} from '@erp/contracts';
import type { StockAdjustment } from '@erp/contracts';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { BranchContextService } from '../../src/common/branch-context/branch-context.service.js';
import { TransactionService } from '../../src/common/prisma/transaction.service.js';
import { StockPostingService } from '../../src/features/stock/stock-posting.service.js';
import { createTestApp } from '../support/create-test-app.js';
import { createOwnerPrisma } from '../support/fixtures.js';
import { createAuthWorld, loggedIn, ORIGIN, SUPER_PASSWORD } from '../support/auth-world.js';
import type { AuthWorld, TestClient } from '../support/auth-world.js';

describe('stock ledger, balances and adjustments', () => {
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

  const newItem = async (
    over: { isSerialized?: boolean; reorderLevel?: number; isActive?: boolean } = {},
  ) =>
    owner.item.create({
      data: {
        itemCode: unique('STK'),
        name: 'Stock test item',
        categoryId,
        unitCode: 'PCS',
        ...over,
      },
    });
  const ask = async (client: TestClient, body: object, status = 201): Promise<StockAdjustment> => {
    const response = await client.post('/stock/adjustments', body);
    expect(response.status, JSON.stringify(response.body)).toBe(status);
    return StockAdjustmentSchema.parse(response.body);
  };
  const decide = (
    client: TestClient,
    adjustment: StockAdjustment,
    action: 'approve' | 'reject' | 'cancel',
    extra: object = {},
  ) =>
    client.post(`/stock/adjustments/${adjustment.id}/${action}`, {
      rowVersion: adjustment.rowVersion,
      ...extra,
    });
  /** Puts stock in the way the business does: Staff asks, a Super Admin (who has no size limit) approves. */
  const stockIn = async (
    itemId: string,
    qty: number,
    branch: 'A' | 'B' = 'A',
    state = 'AVAILABLE',
  ) => {
    const adjustment = await ask(branch === 'A' ? staffA : staffB, {
      itemId,
      kind: 'IN',
      qty,
      state,
      reason: 'Opening stock',
    });
    const response = await decide(superAdmin, adjustment, 'approve');
    expect(response.status, JSON.stringify(response.body)).toBe(200);
  };
  const quantity = async (itemId: string, branchId: string, state = 'AVAILABLE'): Promise<number> =>
    (
      await owner.stockBalance.findUnique({
        where: { branchId_itemId_state: { branchId, itemId, state: state as 'AVAILABLE' } },
      })
    )?.quantity ?? 0;
  const drift = (itemId: string) =>
    owner.$queryRaw<
      { branch_id: string }[]
    >`SELECT branch_id FROM stock_balance_drift() WHERE item_id = ${itemId}::uuid`;
  const ledger = (itemId: string) =>
    owner.stockLedger.findMany({ where: { itemId }, orderBy: { createdAt: 'asc' } });
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
      const http = () => request(app.getHttpServer());
      const post = (path: string) => http().post(path).set('Origin', ORIGIN).send({});
      const attempts = [
        http().get('/stock/balances'),
        http().get('/stock/low-stock'),
        http().get('/stock/movements'),
        http().get('/stock/serial-units'),
        http().get('/stock/adjustments'),
        http().get(`/stock/adjustments/${id}`),
        post('/stock/adjustments'),
        post(`/stock/adjustments/${id}/approve`),
        post(`/stock/adjustments/${id}/reject`),
        post(`/stock/adjustments/${id}/cancel`),
      ];
      for (const response of await Promise.all(attempts)) expect(response.status).toBe(401);
    });

    it('lets Staff view stock and ask for adjustments but not decide them', async () => {
      const item = await newItem();
      const pending = await ask(staffA, {
        itemId: item.id,
        kind: 'IN',
        qty: 3,
        reason: 'Counted extra',
      });
      expect((await staffA.get('/stock/balances')).status).toBe(200);
      expect((await staffA.get('/stock/adjustments')).status).toBe(200);
      expect((await decide(staffA, pending, 'approve')).status).toBe(403);
      expect((await decide(staffA, pending, 'reject', { note: 'No' })).status).toBe(403);
      expect((await decide(staffA, pending, 'cancel')).status).toBe(200);
    });

    it('keeps a branch out of another branch’s requests', async () => {
      const item = await newItem();
      const pending = await ask(adminA, {
        itemId: item.id,
        kind: 'IN',
        qty: 2,
        reason: 'Branch A stock',
      });
      expect(
        (await adminB.post(`/stock/adjustments/${pending.id}/approve`, { rowVersion: 1 })).status,
      ).toBe(404);
      expect((await adminB.get(`/stock/adjustments/${pending.id}`)).status).toBe(404);
      const listed = AdjustmentListResponseSchema.parse(
        (await adminB.get(`/stock/adjustments?itemId=${item.id}`)).body,
      );
      expect(listed.items).toEqual([]);
      const forged = await adminB.post('/stock/adjustments', {
        branchId: w.branchA,
        itemId: item.id,
        kind: 'IN',
        qty: 1,
        reason: 'Sneaky',
      });
      expect(forged.status).toBe(403);
    });
  });

  describe('asking for an adjustment', () => {
    it('records a pending request and an approval row without moving any stock', async () => {
      const item = await newItem();
      const pending = await ask(staffA, {
        itemId: item.id,
        kind: 'IN',
        qty: 4,
        reason: 'Found in store room',
      });
      expect(pending).toMatchObject({
        status: 'PENDING',
        kind: 'IN',
        qty: 4,
        state: 'AVAILABLE',
        branchId: w.branchA,
      });
      expect(pending.requestedByName).toBe('Person staff_a');
      expect(await quantity(item.id, w.branchA)).toBe(0);
      expect(await ledger(item.id)).toHaveLength(0);
      const approval = await owner.approval.findFirstOrThrow({ where: { entityId: pending.id } });
      expect(approval).toMatchObject({
        entityType: 'STOCK_ADJUSTMENT',
        status: 'PENDING',
        requestedBy: w.users.staffA,
      });
      expect(await audits('STOCK_ADJUSTMENT_REQUESTED', pending.id)).toHaveLength(1);
    });

    it('needs a branch from a Super Admin and takes it from a single-branch user', async () => {
      const item = await newItem();
      const missing = await superAdmin.post('/stock/adjustments', {
        itemId: item.id,
        kind: 'IN',
        qty: 1,
        reason: 'Opening',
      });
      expect(missing.status).toBe(400);
      expect(missing.body.details[0].field).toBe('branchId');
      const given = await ask(superAdmin, {
        branchId: w.branchB,
        itemId: item.id,
        kind: 'IN',
        qty: 1,
        reason: 'Opening',
      });
      expect(given.branchId).toBe(w.branchB);
    });

    it('refuses bad input field by field', async () => {
      const item = await newItem();
      const post = (over: object) =>
        staffA.post('/stock/adjustments', {
          itemId: item.id,
          kind: 'IN',
          qty: 1,
          reason: 'Because',
          ...over,
        });
      const fields = async (over: object) =>
        ((await post(over)).body.details ?? []).map((d: { field: string }) => d.field);
      expect(await fields({ reason: 'x' })).toContain('reason');
      expect(await fields({ qty: 0 })).toContain('qty');
      expect(await fields({ qty: 1.5 })).toContain('qty');
      expect(await fields({ kind: 'OUT', toState: 'DAMAGED' })).toContain('toState');
      expect(await fields({ kind: 'STATE_CHANGE' })).toContain('toState');
      expect(await fields({ kind: 'STATE_CHANGE', toState: 'AVAILABLE' })).toContain('toState');
      expect(await fields({ serialNo: 'SN-0001', kind: 'OUT' })).toContain('serialNo');
      expect(await fields({ itemId: 'nope' })).toContain('itemId');
    });

    it('refuses an unknown item, an inactive item, a serial number on a plain item and an inactive branch', async () => {
      const gone = await newItem({ isActive: false });
      const plain = await newItem();
      expect(
        (
          await staffA.post('/stock/adjustments', {
            itemId: '00000000-0000-4000-8000-000000000000',
            kind: 'IN',
            qty: 1,
            reason: 'Ghost item',
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await staffA.post('/stock/adjustments', {
            itemId: gone.id,
            kind: 'IN',
            qty: 1,
            reason: 'Retired item',
          })
        ).status,
      ).toBe(422);
      const serial = await staffA.post('/stock/adjustments', {
        itemId: plain.id,
        kind: 'IN',
        qty: 1,
        serialNo: 'SN-9999',
        reason: 'Wrong item',
      });
      expect(serial.status).toBe(400);
      expect(serial.body.details[0].field).toBe('serialNo');
      const closed = await owner.branch.create({
        data: { code: unique('Z').slice(0, 4), name: 'Closed', stateCode: '27', isActive: false },
      });
      const inactive = await superAdmin.post('/stock/adjustments', {
        branchId: closed.id,
        itemId: plain.id,
        kind: 'IN',
        qty: 1,
        reason: 'Closed branch',
      });
      expect(inactive.status).toBe(422);
    });

    it('refuses taking out more than the stock on hand', async () => {
      const item = await newItem();
      await stockIn(item.id, 3);
      const response = await staffA.post('/stock/adjustments', {
        itemId: item.id,
        kind: 'OUT',
        qty: 4,
        reason: 'Too many',
      });
      expect(response.status).toBe(422);
      expect(response.body.details[0].message).toMatch(/3 on hand/);
      const damaged = await staffA.post('/stock/adjustments', {
        itemId: item.id,
        kind: 'WRITE_OFF',
        qty: 1,
        state: 'DAMAGED',
        reason: 'None damaged',
      });
      expect(damaged.status).toBe(422);
    });
  });

  describe('approving', () => {
    it('adds stock to the balance and the ledger together, and records who approved', async () => {
      const item = await newItem();
      const pending = await ask(staffA, {
        itemId: item.id,
        kind: 'IN',
        qty: 6,
        reason: 'Opening stock',
      });
      const response = await decide(adminA, pending, 'approve', { note: 'Counted and checked' });
      expect(response.status).toBe(200);
      expect(StockAdjustmentSchema.parse(response.body)).toMatchObject({
        status: 'APPROVED',
        approvedByName: 'Person admin_a',
        decisionNote: 'Counted and checked',
      });
      expect(await quantity(item.id, w.branchA)).toBe(6);
      const [entry] = await ledger(item.id);
      expect(entry).toMatchObject({
        qtyDelta: 6,
        movementType: 'ADJUSTMENT_IN',
        state: 'AVAILABLE',
        sourceDocId: pending.id,
        sourceDocType: 'STOCK_ADJUSTMENT',
        createdBy: w.users.adminA,
      });
      expect(await drift(item.id)).toEqual([]);
      expect(
        await owner.approval.findFirstOrThrow({ where: { entityId: pending.id } }),
      ).toMatchObject({ status: 'APPROVED', approvedBy: w.users.adminA });
      expect(await audits('STOCK_ADJUSTMENT_APPROVED', pending.id)).toHaveLength(1);
      const events = await owner.outboxEvent.findMany({
        where: { eventType: 'stock.adjustment.approved' },
      });
      expect(
        events.some((e) => (e.payload as { adjustmentId: string }).adjustmentId === pending.id),
      ).toBe(true);
    });

    it('does not let anyone but a Super Admin approve their own request', async () => {
      const item = await newItem();
      const own = await ask(adminA, {
        itemId: item.id,
        kind: 'IN',
        qty: 2,
        reason: 'My own count',
      });
      const refused = await decide(adminA, own, 'approve');
      expect(refused.status).toBe(403);
      expect(refused.body.message).toMatch(/cannot approve your own/);
      expect(await quantity(item.id, w.branchA)).toBe(0);
      expect((await decide(staffA, own, 'cancel')).status).toBe(403);
      expect((await decide(adminA, own, 'cancel')).status).toBe(200);

      const owners = await ask(superAdmin, {
        branchId: w.branchA,
        itemId: item.id,
        kind: 'IN',
        qty: 3,
        reason: 'Owner counted it',
      });
      expect((await decide(superAdmin, owners, 'approve')).status).toBe(200);
      expect(await quantity(item.id, w.branchA)).toBe(3);
    });

    it('lets a branch Admin approve up to the limit and leaves bigger ones to a Super Admin', async () => {
      const item = await newItem();
      const atLimit = await ask(staffA, {
        itemId: item.id,
        kind: 'IN',
        qty: 10,
        reason: 'Delivery',
      });
      expect((await decide(adminA, atLimit, 'approve')).status).toBe(200);
      const over = await ask(staffA, {
        itemId: item.id,
        kind: 'IN',
        qty: 11,
        reason: 'Big delivery',
      });
      const refused = await decide(adminA, over, 'approve');
      expect(refused.status).toBe(422);
      expect(refused.body.details[0].field).toBe('qty');
      expect(await quantity(item.id, w.branchA)).toBe(10);
      const stillWaiting = await owner.stockAdjustment.findUniqueOrThrow({
        where: { id: over.id },
      });
      expect(stillWaiting.status).toBe('PENDING');
      expect((await decide(superAdmin, over, 'approve')).status).toBe(200);
      expect(await quantity(item.id, w.branchA)).toBe(21);
      expect(await drift(item.id)).toEqual([]);
    });

    it('applies the limit to taking stock out and moving it between states too', async () => {
      const item = await newItem();
      await stockIn(item.id, 30);
      const out = await ask(staffA, {
        itemId: item.id,
        kind: 'OUT',
        qty: 12,
        reason: 'Count correction',
      });
      expect((await decide(adminA, out, 'approve')).status).toBe(422);
      const move = await ask(staffA, {
        itemId: item.id,
        kind: 'STATE_CHANGE',
        state: 'AVAILABLE',
        toState: 'DAMAGED',
        qty: 11,
        reason: 'Flood damage',
      });
      expect((await decide(adminA, move, 'approve')).status).toBe(422);
      expect(await quantity(item.id, w.branchA)).toBe(30);
      expect((await decide(superAdmin, out, 'approve')).status).toBe(200);
      expect((await decide(superAdmin, move, 'approve')).status).toBe(200);
      expect(await quantity(item.id, w.branchA)).toBe(7);
      expect(await quantity(item.id, w.branchA, 'DAMAGED')).toBe(11);
      expect(await drift(item.id)).toEqual([]);
    });

    it('removes stock for OUT and WRITE_OFF with the right movement types', async () => {
      const item = await newItem();
      await stockIn(item.id, 10);
      await decide(
        adminA,
        await ask(staffA, { itemId: item.id, kind: 'OUT', qty: 3, reason: 'Lost on shelf' }),
        'approve',
      );
      await decide(
        adminA,
        await ask(staffA, { itemId: item.id, kind: 'WRITE_OFF', qty: 2, reason: 'Water damage' }),
        'approve',
      );
      expect(await quantity(item.id, w.branchA)).toBe(5);
      expect((await ledger(item.id)).map((e) => [e.movementType, e.qtyDelta])).toEqual([
        ['ADJUSTMENT_IN', 10],
        ['ADJUSTMENT_OUT', -3],
        ['WRITE_OFF', -2],
      ]);
      expect(await drift(item.id)).toEqual([]);
    });

    it('moves stock between states with a pair of ledger rows', async () => {
      const item = await newItem();
      await stockIn(item.id, 5);
      const change = await ask(staffA, {
        itemId: item.id,
        kind: 'STATE_CHANGE',
        state: 'AVAILABLE',
        toState: 'DAMAGED',
        qty: 2,
        reason: 'Dropped in transit',
      });
      expect((await decide(adminA, change, 'approve')).status).toBe(200);
      expect(await quantity(item.id, w.branchA, 'AVAILABLE')).toBe(3);
      expect(await quantity(item.id, w.branchA, 'DAMAGED')).toBe(2);
      const moves = (await ledger(item.id)).filter((e) => e.movementType === 'STATE_CHANGE');
      expect(moves.map((e) => [e.state, e.qtyDelta]).sort()).toEqual([
        ['AVAILABLE', -2],
        ['DAMAGED', 2],
      ]);
      expect(await drift(item.id)).toEqual([]);
    });

    it('blocks negative stock when the stock was used up after the request was made', async () => {
      const item = await newItem();
      await stockIn(item.id, 5);
      const first = await ask(staffA, {
        itemId: item.id,
        kind: 'OUT',
        qty: 4,
        reason: 'First removal',
      });
      const second = await ask(staffA, {
        itemId: item.id,
        kind: 'OUT',
        qty: 4,
        reason: 'Second removal',
      });
      expect((await decide(adminA, first, 'approve')).status).toBe(200);
      const refused = await decide(adminA, second, 'approve');
      expect(refused.status).toBe(422);
      expect(refused.body.message).toMatch(/not enough available stock/);
      expect((await adminA.get(`/stock/adjustments/${second.id}`)).body.status).toBe('PENDING');
      expect(await quantity(item.id, w.branchA)).toBe(1);
      expect(await drift(item.id)).toEqual([]);
    });

    it('lets exactly the available stock be issued when many approvals race for it', async () => {
      const item = await newItem();
      await stockIn(item.id, 5);
      const requests = await Promise.all(
        Array.from({ length: 9 }, (_, i) =>
          ask(staffA, { itemId: item.id, kind: 'OUT', qty: 1, reason: `Issue number ${i + 1}` }),
        ),
      );
      const results = await Promise.all(
        requests.map((adjustment) => decide(adminA, adjustment, 'approve')),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(5);
      expect(results.filter((r) => r.status === 422)).toHaveLength(4);
      expect(await quantity(item.id, w.branchA)).toBe(0);
      expect((await ledger(item.id)).reduce((sum, e) => sum + e.qtyDelta, 0)).toBe(0);
      expect(await drift(item.id)).toEqual([]);
    });

    it('applies a request only once when it is approved twice at the same time', async () => {
      const item = await newItem();
      const pending = await ask(staffA, {
        itemId: item.id,
        kind: 'IN',
        qty: 3,
        reason: 'Double click',
      });
      const results = await Promise.all([
        decide(adminA, pending, 'approve'),
        decide(adminA, pending, 'approve'),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await quantity(item.id, w.branchA)).toBe(3);
      expect(await ledger(item.id)).toHaveLength(1);
    });

    it('rejects a stale version and a request that is no longer pending', async () => {
      const item = await newItem();
      const pending = await ask(staffA, {
        itemId: item.id,
        kind: 'IN',
        qty: 1,
        reason: 'Version check',
      });
      const stale = await adminA.post(`/stock/adjustments/${pending.id}/approve`, {
        rowVersion: pending.rowVersion + 5,
      });
      expect(stale.status).toBe(409);
      await decide(adminA, pending, 'approve');
      const again = await decide(adminA, pending, 'approve');
      expect(again.status).toBe(409);
      expect(again.body.code).toBe('INVALID_STATE');
    });
  });

  describe('rejecting and cancelling', () => {
    it('needs a reason to reject, moves no stock and cannot be approved afterwards', async () => {
      const item = await newItem();
      const pending = await ask(staffA, {
        itemId: item.id,
        kind: 'IN',
        qty: 2,
        reason: 'Needs checking',
      });
      expect((await decide(adminA, pending, 'reject')).status).toBe(400);
      const rejected = await decide(adminA, pending, 'reject', { note: 'Count is wrong' });
      expect(StockAdjustmentSchema.parse(rejected.body)).toMatchObject({
        status: 'REJECTED',
        decisionNote: 'Count is wrong',
      });
      expect(await quantity(item.id, w.branchA)).toBe(0);
      expect(await ledger(item.id)).toHaveLength(0);
      expect((await decide(adminA, pending, 'approve')).status).toBe(409);
      expect(
        await owner.approval.findFirstOrThrow({ where: { entityId: pending.id } }),
      ).toMatchObject({ status: 'REJECTED' });
    });

    it('lets only the requester cancel, and a cancelled request cannot be approved', async () => {
      const item = await newItem();
      const pending = await ask(staffA, {
        itemId: item.id,
        kind: 'IN',
        qty: 2,
        reason: 'Changed my mind',
      });
      expect((await decide(adminA, pending, 'cancel')).status).toBe(403);
      const cancelled = await decide(staffA, pending, 'cancel');
      expect(cancelled.body.status).toBe('CANCELLED');
      expect((await decide(adminA, pending, 'approve')).status).toBe(409);
      expect(
        await owner.approval.findFirstOrThrow({ where: { entityId: pending.id } }),
      ).toMatchObject({ status: 'CANCELLED', approvedBy: null });
    });
  });

  describe('serial units', () => {
    const serialIn = async (itemId: string, serialNo: string, extra: object = {}) =>
      ask(staffA, { itemId, kind: 'IN', serialNo, reason: 'Received unit', ...extra });
    const unitOf = (serialNo: string) =>
      owner.serialUnit.findUniqueOrThrow({ where: { serialNo } });

    it('creates the serial unit and a ledger row of one when an incoming request is approved', async () => {
      const item = await newItem({ isSerialized: true });
      const serialNo = unique('sn-').toUpperCase();
      const pending = await serialIn(item.id, serialNo.toLowerCase(), {
        chassisNo: `CH-${serialNo}`,
      });
      expect(pending.serialNo).toBe(serialNo);
      expect(await owner.serialUnit.count({ where: { serialNo } })).toBe(0);
      expect((await decide(adminA, pending, 'approve')).status).toBe(200);
      const unit = await unitOf(serialNo);
      expect(unit).toMatchObject({
        branchId: w.branchA,
        itemId: item.id,
        state: 'AVAILABLE',
        chassisNo: `CH-${serialNo}`,
      });
      expect((await ledger(item.id))[0]).toMatchObject({ serialUnitId: unit.id, qtyDelta: 1 });
      expect(await quantity(item.id, w.branchA)).toBe(1);
      expect(await drift(item.id)).toEqual([]);
    });

    it('insists on a serial number, one piece, and no duplicates among units or waiting requests', async () => {
      const item = await newItem({ isSerialized: true });
      const bare = await staffA.post('/stock/adjustments', {
        itemId: item.id,
        kind: 'IN',
        reason: 'No serial',
      });
      expect(bare.status).toBe(400);
      expect(bare.body.details[0].field).toBe('serialNo');
      const many = await staffA.post('/stock/adjustments', {
        itemId: item.id,
        kind: 'IN',
        serialNo: 'SN-MANY-1',
        qty: 2,
        reason: 'Two units',
      });
      expect(many.status).toBe(400);

      const serialNo = unique('DUP-');
      const first = await serialIn(item.id, serialNo, { chassisNo: `CH-${serialNo}` });
      expect(
        (
          await staffA.post('/stock/adjustments', {
            itemId: item.id,
            kind: 'IN',
            serialNo,
            reason: 'Again',
          })
        ).status,
      ).toBe(409);
      await decide(adminA, first, 'approve');
      const dup = await staffB.post('/stock/adjustments', {
        itemId: item.id,
        kind: 'IN',
        serialNo,
        reason: 'Another branch',
      });
      expect(dup.status).toBe(409);
      expect(dup.body.details[0].field).toBe('serialNo');
      const chassis = await staffA.post('/stock/adjustments', {
        itemId: item.id,
        kind: 'IN',
        serialNo: unique('NEW-'),
        chassisNo: `CH-${serialNo}`,
        reason: 'Same chassis',
      });
      expect(chassis.status).toBe(409);
    });

    it('stops two requests in the same moment from creating the same serial number', async () => {
      const item = await newItem({ isSerialized: true });
      const serialNo = unique('RACE-');
      const first = await serialIn(item.id, serialNo);
      await owner.stockAdjustment.update({
        where: { id: first.id },
        data: { status: 'CANCELLED', decidedAt: new Date() },
      });
      const second = await serialIn(item.id, serialNo);
      await owner.stockAdjustment.update({
        where: { id: first.id },
        data: { status: 'PENDING', decidedAt: null },
      });
      const results = await Promise.all([
        decide(adminA, first, 'approve'),
        decide(adminA, second, 'approve'),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await owner.serialUnit.count({ where: { serialNo } })).toBe(1);
    });

    it('scraps a unit that is written off and refuses a second request for it', async () => {
      const item = await newItem({ isSerialized: true });
      const serialNo = unique('WO-');
      await decide(adminA, await serialIn(item.id, serialNo), 'approve');
      const unit = await unitOf(serialNo);
      const off = await ask(staffA, {
        itemId: item.id,
        kind: 'WRITE_OFF',
        serialUnitId: unit.id,
        reason: 'Burnt in fire',
      });
      const second = await staffA.post('/stock/adjustments', {
        itemId: item.id,
        kind: 'OUT',
        serialUnitId: unit.id,
        reason: 'Duplicate request',
      });
      expect(second.status).toBe(409);
      expect((await decide(adminA, off, 'approve')).status).toBe(200);
      expect((await unitOf(serialNo)).state).toBe('SCRAPPED');
      expect(await quantity(item.id, w.branchA)).toBe(0);
      const gone = await staffA.post('/stock/adjustments', {
        itemId: item.id,
        kind: 'OUT',
        serialUnitId: unit.id,
        reason: 'Already scrapped',
      });
      expect(gone.status).toBe(422);
      expect(await drift(item.id)).toEqual([]);
    });

    it('changes the state of one unit and moves one piece between balances', async () => {
      const item = await newItem({ isSerialized: true });
      const serialNo = unique('ST-');
      await decide(adminA, await serialIn(item.id, serialNo), 'approve');
      const unit = await unitOf(serialNo);
      const change = await ask(staffA, {
        itemId: item.id,
        kind: 'STATE_CHANGE',
        serialUnitId: unit.id,
        toState: 'QUARANTINE',
        reason: 'Check battery',
      });
      expect((await decide(adminA, change, 'approve')).status).toBe(200);
      expect((await unitOf(serialNo)).state).toBe('QUARANTINE');
      expect(await quantity(item.id, w.branchA, 'AVAILABLE')).toBe(0);
      expect(await quantity(item.id, w.branchA, 'QUARANTINE')).toBe(1);
      expect(await drift(item.id)).toEqual([]);
    });

    it('needs the unit, in this branch and in the stated state', async () => {
      const item = await newItem({ isSerialized: true });
      const serialNo = unique('BR-');
      await decide(adminA, await serialIn(item.id, serialNo), 'approve');
      const unit = await unitOf(serialNo);
      const missing = await staffA.post('/stock/adjustments', {
        itemId: item.id,
        kind: 'OUT',
        reason: 'No unit chosen',
      });
      expect(missing.body.details[0].field).toBe('serialUnitId');
      const elsewhere = await staffB.post('/stock/adjustments', {
        itemId: item.id,
        kind: 'OUT',
        serialUnitId: unit.id,
        reason: 'Wrong branch',
      });
      expect(elsewhere.status).toBe(400);
      const wrongState = await staffA.post('/stock/adjustments', {
        itemId: item.id,
        kind: 'OUT',
        state: 'DAMAGED',
        serialUnitId: unit.id,
        reason: 'Wrong state',
      });
      expect(wrongState.status).toBe(422);
    });
  });

  describe('posting service', () => {
    const run = <T>(
      work: (
        posting: StockPostingService,
        tx: Parameters<Parameters<TransactionService['run']>[0]>[0],
      ) => Promise<T>,
    ): Promise<T> =>
      app
        .get(BranchContextService)
        .runAsSystem(() =>
          app.get(TransactionService).run((tx) => work(app.get(StockPostingService), tx)),
        );

    it('refuses to take stock out of an empty balance and leaves nothing behind', async () => {
      const item = await newItem();
      await expect(
        run((posting, tx) =>
          posting.post(tx, {
            branchId: w.branchA,
            itemId: item.id,
            state: 'AVAILABLE',
            qtyDelta: -1,
            movementType: 'SALE',
          }),
        ),
      ).rejects.toThrow(/not enough available stock/);
      expect(await ledger(item.id)).toHaveLength(0);
    });

    it('rolls the balance back with the ledger when the surrounding work fails', async () => {
      const item = await newItem();
      await expect(
        run(async (posting, tx) => {
          await posting.post(tx, {
            branchId: w.branchA,
            itemId: item.id,
            state: 'AVAILABLE',
            qtyDelta: 4,
            movementType: 'OPENING_BALANCE',
          });
          throw new Error('later step failed');
        }),
      ).rejects.toThrow('later step failed');
      expect(await quantity(item.id, w.branchA)).toBe(0);
      expect(await ledger(item.id)).toHaveLength(0);
    });

    it('moves serialized items only by serial unit, and plain items only without one', async () => {
      const serial = await newItem({ isSerialized: true });
      const plain = await newItem();
      await expect(
        run((posting, tx) =>
          posting.post(tx, {
            branchId: w.branchA,
            itemId: serial.id,
            state: 'AVAILABLE',
            qtyDelta: 1,
            movementType: 'OPENING_BALANCE',
          }),
        ),
      ).rejects.toThrow(/serial/);
      await expect(
        run((posting, tx) =>
          posting.post(tx, {
            branchId: w.branchA,
            itemId: plain.id,
            state: 'AVAILABLE',
            qtyDelta: 1,
            movementType: 'OPENING_BALANCE',
            serialUnitId: w.serialA,
          }),
        ),
      ).rejects.toThrow(/not tracked/);
      await expect(
        run((posting, tx) =>
          posting.post(tx, {
            branchId: w.branchA,
            itemId: plain.id,
            state: 'AVAILABLE',
            qtyDelta: 0,
            movementType: 'OPENING_BALANCE',
          }),
        ),
      ).rejects.toThrow(RangeError);
    });
  });

  describe('balances, low stock and history', () => {
    it('shows stock by state with a total, and only for the branches the user may see', async () => {
      const item = await newItem({ reorderLevel: 2 });
      await stockIn(item.id, 5);
      await stockIn(item.id, 4, 'B');
      await decide(
        adminA,
        await ask(staffA, {
          itemId: item.id,
          kind: 'STATE_CHANGE',
          toState: 'DAMAGED',
          qty: 1,
          reason: 'Cracked casing',
        }),
        'approve',
      );
      const ofA = StockBalanceListResponseSchema.parse(
        (await staffA.get(`/stock/balances?search=${item.itemCode}`)).body,
      );
      expect(ofA.items).toHaveLength(1);
      expect(ofA.items[0]).toMatchObject({
        branchId: w.branchA,
        available: 4,
        damaged: 1,
        total: 5,
        reorderLevel: 2,
        isLow: false,
      });
      const ofB = StockBalanceListResponseSchema.parse(
        (await staffB.get(`/stock/balances?search=${item.itemCode}`)).body,
      );
      expect(ofB.items.map((r) => [r.branchId, r.available])).toEqual([[w.branchB, 4]]);
      const all = StockBalanceListResponseSchema.parse(
        (await superAdmin.get(`/stock/balances?search=${item.itemCode}`)).body,
      );
      expect(all.items.map((r) => r.branchId).sort()).toEqual([w.branchA, w.branchB].sort());
    });

    it('filters by branch and low stock, pages and sorts, and refuses an unknown sort field', async () => {
      const tag = unique('BAL');
      const low = await owner.item.create({
        data: {
          itemCode: `${tag}-L`,
          name: 'Low one',
          categoryId,
          unitCode: 'PCS',
          reorderLevel: 5,
        },
      });
      const fine = await owner.item.create({
        data: {
          itemCode: `${tag}-F`,
          name: 'Fine one',
          categoryId,
          unitCode: 'PCS',
          reorderLevel: 1,
        },
      });
      await stockIn(low.id, 5);
      await stockIn(fine.id, 9);
      const find = async (query: string) =>
        StockBalanceListResponseSchema.parse(
          (await superAdmin.get(`/stock/balances?search=${tag}&${query}`)).body,
        );
      expect((await find('lowOnly=true')).items.map((r) => r.itemId)).toEqual([low.id]);
      expect((await find(`branchId=${w.branchB}`)).items).toEqual([]);
      const sorted = await find('sortBy=available&sortOrder=desc');
      expect(sorted.items.map((r) => r.itemId)).toEqual([fine.id, low.id]);
      const page = await find('pageSize=1&page=2&sortBy=itemCode&sortOrder=asc');
      expect(page).toMatchObject({ total: 2, totalPages: 2 });
      expect(page.items.map((r) => r.itemId)).toEqual([low.id]);
      expect((await superAdmin.get('/stock/balances?sortBy=quantity')).status).toBe(400);
      expect((await superAdmin.get('/stock/balances?pageSize=1000')).status).toBe(400);
    });

    it('treats % in a search as a plain character', async () => {
      expect(
        StockBalanceListResponseSchema.parse(
          (await superAdmin.get('/stock/balances?search=%25')).body,
        ).items,
      ).toEqual([]);
    });

    it('lists low stock, including items that have no stock row at all, worst shortage first', async () => {
      const tag = unique('LOW');
      const empty = await owner.item.create({
        data: {
          itemCode: `${tag}-E`,
          name: 'Never stocked',
          categoryId,
          unitCode: 'PCS',
          reorderLevel: 4,
        },
      });
      const some = await owner.item.create({
        data: {
          itemCode: `${tag}-S`,
          name: 'Some left',
          categoryId,
          unitCode: 'PCS',
          reorderLevel: 4,
        },
      });
      const off = await owner.item.create({
        data: {
          itemCode: `${tag}-X`,
          name: 'Retired',
          categoryId,
          unitCode: 'PCS',
          reorderLevel: 4,
        },
      });
      const none = await owner.item.create({
        data: {
          itemCode: `${tag}-N`,
          name: 'No alert wanted',
          categoryId,
          unitCode: 'PCS',
          reorderLevel: 0,
        },
      });
      await stockIn(some.id, 3);
      await owner.item.update({ where: { id: off.id }, data: { isActive: false } });
      const rows = LowStockListResponseSchema.parse(
        (await staffA.get(`/stock/low-stock?pageSize=100&branchId=${w.branchA}`)).body,
      ).items.filter((r) => r.itemCode.startsWith(tag));
      expect(rows.map((r) => [r.itemCode, r.available, r.shortBy])).toEqual([
        [`${tag}-E`, 0, 4],
        [`${tag}-S`, 3, 1],
      ]);
      expect(rows.some((r) => r.itemId === none.id || r.itemId === off.id)).toBe(false);
      const ofB = LowStockListResponseSchema.parse(
        (await staffB.get('/stock/low-stock?pageSize=100')).body,
      );
      expect(ofB.items.every((r) => r.branchId === w.branchB)).toBe(true);
      expect(empty.id).toBeDefined();
    });

    it('does not report an inactive branch', async () => {
      const closed = await owner.branch.create({
        data: { code: unique('Q').slice(0, 4), name: 'Closed', stateCode: '27', isActive: false },
      });
      const item = await newItem({ reorderLevel: 3 });
      const rows = LowStockListResponseSchema.parse(
        (await superAdmin.get('/stock/low-stock?pageSize=100')).body,
      ).items;
      expect(rows.some((r) => r.branchId === closed.id && r.itemId === item.id)).toBe(false);
    });

    it('keeps the movement history newest first, with who and what, and filters it', async () => {
      const item = await newItem();
      await stockIn(item.id, 5);
      await decide(
        adminA,
        await ask(staffA, { itemId: item.id, kind: 'OUT', qty: 2, reason: 'Used in repair' }),
        'approve',
      );
      const all = MovementListResponseSchema.parse(
        (await staffA.get(`/stock/movements?itemId=${item.id}`)).body,
      );
      expect(all.items.map((m) => [m.movementType, m.qtyDelta])).toEqual([
        ['ADJUSTMENT_OUT', -2],
        ['ADJUSTMENT_IN', 5],
      ]);
      expect(all.items[0]).toMatchObject({
        itemCode: item.itemCode,
        branchCode: 'AA',
        createdByName: 'Person admin_a',
        sourceDocType: 'STOCK_ADJUSTMENT',
      });
      const outs = MovementListResponseSchema.parse(
        (await staffA.get(`/stock/movements?itemId=${item.id}&movementType=ADJUSTMENT_OUT`)).body,
      );
      expect(outs.items).toHaveLength(1);
      expect(
        MovementListResponseSchema.parse(
          (await staffB.get(`/stock/movements?itemId=${item.id}`)).body,
        ).items,
      ).toEqual([]);
      const future = new Date(Date.now() + 86_400_000).toISOString();
      expect(
        MovementListResponseSchema.parse(
          (
            await staffA.get(
              `/stock/movements?itemId=${item.id}&from=${encodeURIComponent(future)}`,
            )
          ).body,
        ).items,
      ).toEqual([]);
      expect(
        (await staffA.get(`/stock/movements?from=${encodeURIComponent(future)}&to=2020-01-01`))
          .status,
      ).toBe(400);
      expect((await staffA.get('/stock/movements?movementType=NOPE')).status).toBe(400);
    });

    it('follows one serial number through the history and lists serial units with filters', async () => {
      const item = await newItem({ isSerialized: true });
      const serialNo = unique('HIS-');
      await decide(
        adminA,
        await ask(staffA, { itemId: item.id, kind: 'IN', serialNo, reason: 'Received unit' }),
        'approve',
      );
      const found = MovementListResponseSchema.parse(
        (await staffA.get(`/stock/movements?serialNo=${serialNo.toLowerCase()}`)).body,
      );
      expect(found.items.map((m) => m.serialNo)).toEqual([serialNo]);
      const units = SerialUnitListResponseSchema.parse(
        (
          await staffA.get(
            `/stock/serial-units?itemId=${item.id}&state=AVAILABLE&search=${serialNo.slice(0, 5)}`,
          )
        ).body,
      );
      expect(units.items.map((u) => u.serialNo)).toEqual([serialNo]);
      expect(
        SerialUnitListResponseSchema.parse(
          (await staffB.get(`/stock/serial-units?itemId=${item.id}`)).body,
        ).items,
      ).toEqual([]);
      expect((await staffA.get('/stock/serial-units?state=LOST')).status).toBe(400);
    });

    it('lists adjustments by status, kind and item, newest first', async () => {
      const item = await newItem();
      const first = await ask(staffA, {
        itemId: item.id,
        kind: 'IN',
        qty: 1,
        reason: 'List test one',
      });
      const second = await ask(staffA, {
        itemId: item.id,
        kind: 'IN',
        qty: 2,
        reason: 'List test two',
      });
      await decide(adminA, first, 'approve');
      const list = async (query: string) =>
        AdjustmentListResponseSchema.parse(
          (await staffA.get(`/stock/adjustments?itemId=${item.id}&${query}`)).body,
        ).items.map((a) => a.id);
      expect(await list('')).toEqual([second.id]);
      expect(await list('status=APPROVED')).toEqual([first.id]);
      expect(await list('status=all')).toEqual([second.id, first.id]);
      expect(await list('status=all&kind=OUT')).toEqual([]);
      expect((await staffA.get('/stock/adjustments?status=DONE')).status).toBe(400);
    });
  });

  describe('database guards', () => {
    it('reports any balance that differs from its ledger and hides that check from the application role', async () => {
      const item = await newItem();
      await stockIn(item.id, 3);
      expect(await drift(item.id)).toEqual([]);
      await owner.$executeRaw`UPDATE stock_balances SET quantity = quantity + 1 WHERE item_id = ${item.id}::uuid`;
      expect(await drift(item.id)).toHaveLength(1);
      await owner.$executeRaw`UPDATE stock_balances SET quantity = quantity - 1 WHERE item_id = ${item.id}::uuid`;
      const privileges = await owner.$queryRaw<
        { allowed: boolean }[]
      >`SELECT has_function_privilege('erp_app', 'stock_balance_drift()', 'EXECUTE') AS allowed`;
      expect(privileges[0]?.allowed).toBe(false);
    });

    it('rejects adjustment rows that break the rules, even for the owner', async () => {
      const item = await newItem();
      const bad = (data: object) =>
        owner.stockAdjustment.create({
          data: {
            branchId: w.branchA,
            itemId: item.id,
            kind: 'IN',
            state: 'AVAILABLE',
            qty: 1,
            reason: 'Valid reason',
            requestedBy: w.users.adminA,
            ...data,
          },
        });
      await expect(bad({ qty: 0 })).rejects.toThrow();
      await expect(bad({ reason: ' a ' })).rejects.toThrow();
      await expect(bad({ kind: 'STATE_CHANGE' })).rejects.toThrow();
      await expect(bad({ kind: 'OUT', toState: 'DAMAGED' })).rejects.toThrow();
      await expect(bad({ kind: 'STATE_CHANGE', toState: 'AVAILABLE' })).rejects.toThrow();
      await expect(bad({ kind: 'OUT', serialNo: 'SN-1234' })).rejects.toThrow();
      await expect(bad({ serialNo: 'SN-1234', qty: 2 })).rejects.toThrow();
      await expect(bad({ chassisNo: 'CH-1' })).rejects.toThrow();
      await expect(bad({ status: 'APPROVED' })).rejects.toThrow();
      await expect(bad({ status: 'REJECTED', decidedAt: new Date() })).rejects.toThrow();
      await expect(bad({})).resolves.toBeDefined();
    });
  });
});
