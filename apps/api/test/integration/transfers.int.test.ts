import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  DiscrepancyListResponseSchema,
  TransferListResponseSchema,
  TransferSchema,
} from '@erp/contracts';
import type { Transfer } from '@erp/contracts';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { addUser, createAuthWorld, loggedIn, SUPER_PASSWORD } from '../support/auth-world.js';
import type { AuthWorld, TestClient } from '../support/auth-world.js';
import { createTestApp } from '../support/create-test-app.js';
import { createOwnerPrisma } from '../support/fixtures.js';

describe('inter-branch transfers', () => {
  let app: NestExpressApplication;
  let w: AuthWorld;
  let superAdmin: TestClient;
  let adminA: TestClient;
  let staffA: TestClient;
  let adminB: TestClient;
  let staffB: TestClient;
  let staffC: TestClient;
  let categoryId: string;
  const owner = createOwnerPrisma();
  let counter = 0;
  const unique = (prefix: string): string =>
    `${prefix}${(counter += 1).toString().padStart(4, '0')}`;

  const newItem = (isSerialized = false, isActive = true) =>
    owner.item.create({
      data: {
        itemCode: unique('TRF'),
        name: 'Transfer test item',
        categoryId,
        unitCode: 'PCS',
        isSerialized,
        isActive,
      },
    });
  const seedPlain = async (itemId: string, branchId: string, qty: number) => {
    await owner.stockBalance.upsert({
      where: { branchId_itemId_state: { branchId, itemId, state: 'AVAILABLE' } },
      create: { branchId, itemId, state: 'AVAILABLE', quantity: qty },
      update: { quantity: { increment: qty } },
    });
    await owner.stockLedger.create({
      data: {
        branchId,
        itemId,
        state: 'AVAILABLE',
        qtyDelta: qty,
        movementType: 'OPENING_BALANCE',
      },
    });
  };
  const seedUnit = async (
    itemId: string,
    branchId: string,
    serialNo: string,
    state: 'AVAILABLE' | 'RESERVED' = 'AVAILABLE',
  ) => {
    const unit = await owner.serialUnit.create({ data: { branchId, itemId, serialNo, state } });
    await owner.stockBalance.upsert({
      where: { branchId_itemId_state: { branchId, itemId, state } },
      create: { branchId, itemId, state, quantity: 1 },
      update: { quantity: { increment: 1 } },
    });
    await owner.stockLedger.create({
      data: {
        branchId,
        itemId,
        serialUnitId: unit.id,
        state,
        qtyDelta: 1,
        movementType: 'OPENING_BALANCE',
      },
    });
    return unit;
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
  const audits = (action: string, entityId: string) =>
    owner.auditLog.findMany({ where: { action, entityId } });

  /** Branch B asks branch A for stock. */
  const ask = async (
    lines: { itemId: string; qty: number }[],
    client: TestClient = staffB,
    extra: object = {},
  ): Promise<Transfer> => {
    const response = await client.post('/transfers', {
      fromBranchId: w.branchA,
      toBranchId: w.branchB,
      lines,
      ...extra,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return TransferSchema.parse(response.body);
  };
  const act = (client: TestClient, transfer: Transfer, action: string, extra: object = {}) =>
    client.post(`/transfers/${transfer.id}/${action}`, {
      rowVersion: transfer.rowVersion,
      ...extra,
    });
  const parse = (response: request.Response): Transfer => {
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return TransferSchema.parse(response.body);
  };
  const approved = async (lines: { itemId: string; qty: number }[]): Promise<Transfer> =>
    parse(await act(adminA, await ask(lines), 'approve'));
  const dispatched = async (
    lines: { itemId: string; qty: number }[],
    items?: object[],
  ): Promise<Transfer> => {
    const transfer = await approved(lines);
    return parse(
      await act(staffA, transfer, 'dispatch', {
        items: items ?? lines.map((line) => ({ itemId: line.itemId, qty: line.qty })),
      }),
    );
  };
  const counts = (transfer: Transfer, received: number, damaged = 0) => ({
    lines: transfer.lines.map((line) => ({ lineId: line.id, received, damaged })),
  });

  beforeAll(async () => {
    w = await createAuthWorld(owner);
    categoryId = (await owner.itemCategory.findFirstOrThrow({ where: { name: 'Vehicles' } })).id;
    await addUser(owner, { username: 'staff_c', role: 'STAFF', branchIds: [w.branchC] });
    app = await createTestApp();
    superAdmin = await loggedIn(app, 'superadmin', SUPER_PASSWORD);
    adminA = await loggedIn(app, 'admin_a');
    staffA = await loggedIn(app, 'staff_a');
    adminB = await loggedIn(app, 'admin_b');
    staffB = await loggedIn(app, 'staff_b');
    staffC = await loggedIn(app, 'staff_c');
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
        http().get('/transfers'),
        http().get(`/transfers/${id}`),
        http().post('/transfers').set('Origin', origin).send({}),
        ...['approve', 'reject', 'cancel', 'dispatch', 'receive'].map((action) =>
          http().post(`/transfers/${id}/${action}`).set('Origin', origin).send({}),
        ),
      ];
      for (const response of await Promise.all(attempts)) expect(response.status).toBe(401);
    });

    it('lets Staff request, dispatch and receive but not approve or reject', async () => {
      const item = await newItem();
      const transfer = await ask([{ itemId: item.id, qty: 1 }]);
      expect((await act(staffA, transfer, 'approve')).status).toBe(403);
      expect((await act(staffA, transfer, 'reject', { note: 'No stock' })).status).toBe(403);
      expect((await staffA.get('/transfers')).status).toBe(200);
    });
  });

  describe('asking for stock', () => {
    it('numbers the request from the asking branch, starts it as requested and moves no stock', async () => {
      const item = await newItem();
      await seedPlain(item.id, w.branchA, 10);
      const transfer = await ask([{ itemId: item.id, qty: 4 }], staffB, {
        note: 'Shop is running low',
      });
      expect(transfer).toMatchObject({
        status: 'REQUESTED',
        fromBranchId: w.branchA,
        toBranchId: w.branchB,
      });
      expect(transfer.transferNo).toMatch(/TRF|\//);
      expect(transfer.lines).toMatchObject([
        { qtyRequested: 4, qtySent: 4, qtyReceived: 0, serialNo: null },
      ]);
      expect(transfer.events).toMatchObject([
        { status: 'REQUESTED', note: 'Shop is running low', userName: 'Person staff_b' },
      ]);
      expect(transfer.requestedByName).toBe('Person staff_b');
      expect(await quantity(item.id, w.branchA)).toBe(10);
      expect(await quantity(item.id, w.branchB, 'IN_TRANSIT')).toBe(0);
      expect(await audits('TRANSFER_REQUESTED', transfer.id)).toHaveLength(1);
    });

    it('gives each request its own number', async () => {
      const item = await newItem();
      const [one, two] = await Promise.all([
        ask([{ itemId: item.id, qty: 1 }]),
        ask([{ itemId: item.id, qty: 1 }]),
      ]);
      expect(one.transferNo).not.toBe(two.transferNo);
    });

    it('refuses bad requests with a message for each problem', async () => {
      const item = await newItem();
      const inactive = await newItem(false, false);
      const body = (over: object) => ({
        fromBranchId: w.branchA,
        toBranchId: w.branchB,
        lines: [{ itemId: item.id, qty: 1 }],
        ...over,
      });
      const same = await staffB.post('/transfers', body({ fromBranchId: w.branchB }));
      expect(same.status).toBe(400);
      expect(same.body.details[0].field).toBe('toBranchId');
      expect((await staffB.post('/transfers', body({ lines: [] }))).status).toBe(400);
      expect(
        (await staffB.post('/transfers', body({ lines: [{ itemId: item.id, qty: 0 }] }))).status,
      ).toBe(400);
      const duplicate = await staffB.post(
        '/transfers',
        body({
          lines: [
            { itemId: item.id, qty: 1 },
            { itemId: item.id, qty: 2 },
          ],
        }),
      );
      expect(duplicate.status).toBe(400);
      expect(
        (await staffB.post('/transfers', body({ lines: [{ itemId: inactive.id, qty: 1 }] })))
          .status,
      ).toBe(422);
      expect(
        (
          await staffB.post(
            '/transfers',
            body({ lines: [{ itemId: '00000000-0000-4000-8000-000000000000', qty: 1 }] }),
          )
        ).status,
      ).toBe(404);
      const noBranch = await staffB.post(
        '/transfers',
        body({ fromBranchId: '00000000-0000-4000-8000-000000000000' }),
      );
      expect(noBranch.status).toBe(400);
    });

    it('lets a person ask only for a branch they work in', async () => {
      const item = await newItem();
      const response = await staffA.post('/transfers', {
        fromBranchId: w.branchA,
        toBranchId: w.branchB,
        lines: [{ itemId: item.id, qty: 1 }],
      });
      expect(response.status).toBe(403);
    });

    it('shows a transfer to the two branches in it and to nobody else', async () => {
      const item = await newItem();
      const transfer = await ask([{ itemId: item.id, qty: 1 }]);
      for (const client of [staffA, staffB, adminA, adminB, superAdmin])
        expect((await client.get(`/transfers/${transfer.id}`)).status).toBe(200);
      expect((await staffC.get(`/transfers/${transfer.id}`)).status).toBe(404);
      const listed = TransferListResponseSchema.parse(
        (await staffC.get('/transfers?pageSize=100')).body,
      );
      expect(listed.items.some((row) => row.id === transfer.id)).toBe(false);
    });
  });

  describe('approving and rejecting', () => {
    it('lets only the sending branch approve, and records who did', async () => {
      const item = await newItem();
      const transfer = await ask([{ itemId: item.id, qty: 2 }]);
      const refused = await act(adminB, transfer, 'approve');
      expect(refused.status).toBe(403);
      expect(refused.body.message).toMatch(/branch that holds the stock/);
      expect((await act(staffC, transfer, 'approve')).status).toBe(403);
      const done = parse(await act(adminA, transfer, 'approve'));
      expect(done.status).toBe('APPROVED');
      expect(done.events.map((event) => event.status)).toEqual(['REQUESTED', 'APPROVED']);
      expect(done.events[1]?.userName).toBe('Person admin_a');
      expect(await audits('TRANSFER_APPROVED', transfer.id)).toHaveLength(1);
    });

    it('rejects with a reason, and a rejected transfer cannot be approved or dispatched', async () => {
      const item = await newItem();
      const transfer = await ask([{ itemId: item.id, qty: 2 }]);
      expect((await act(adminA, transfer, 'reject')).status).toBe(400);
      const rejected = parse(
        await act(adminA, transfer, 'reject', { note: 'Needed for a customer' }),
      );
      expect(rejected.status).toBe('REJECTED');
      expect(rejected.events.at(-1)?.note).toBe('Needed for a customer');
      expect((await act(adminA, rejected, 'approve')).status).toBe(409);
      expect(
        (await act(staffA, rejected, 'dispatch', { items: [{ itemId: item.id, qty: 1 }] })).status,
      ).toBe(409);
    });

    it('refuses a stale version and lets only one of two parallel approvals win', async () => {
      const item = await newItem();
      const transfer = await ask([{ itemId: item.id, qty: 2 }]);
      const results = await Promise.all([
        act(adminA, transfer, 'approve'),
        act(superAdmin, transfer, 'approve'),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect((await act(adminA, transfer, 'approve')).status).toBe(409);
    });
  });

  describe('dispatching', () => {
    it('takes stock off the sender only on dispatch, and holds it in transit at the destination', async () => {
      const item = await newItem();
      await seedPlain(item.id, w.branchA, 20);
      const transfer = await approved([{ itemId: item.id, qty: 8 }]);
      expect(await quantity(item.id, w.branchA)).toBe(20);

      const sent = parse(
        await act(staffA, transfer, 'dispatch', { items: [{ itemId: item.id, qty: 8 }] }),
      );
      expect(sent.status).toBe('DISPATCHED');
      expect(sent.events.map((event) => event.status)).toEqual([
        'REQUESTED',
        'APPROVED',
        'DISPATCHED',
      ]);
      expect(await quantity(item.id, w.branchA)).toBe(12);
      expect(await quantity(item.id, w.branchB, 'IN_TRANSIT')).toBe(8);
      expect(await quantity(item.id, w.branchB)).toBe(0);
      expect(await drift(item.id)).toEqual([]);
      const rows = await owner.stockLedger.findMany({
        where: { itemId: item.id, movementType: 'TRANSFER_DISPATCH' },
      });
      expect(rows.map((row) => [row.branchId, row.state, row.qtyDelta]).sort()).toEqual(
        [
          [w.branchA, 'AVAILABLE', -8],
          [w.branchB, 'IN_TRANSIT', 8],
        ].sort(),
      );
      expect(await audits('TRANSFER_DISPATCHED', transfer.id)).toHaveLength(1);
    });

    it('can send less than was asked for, and records both numbers', async () => {
      const item = await newItem();
      await seedPlain(item.id, w.branchA, 20);
      const transfer = await dispatched(
        [{ itemId: item.id, qty: 8 }],
        [{ itemId: item.id, qty: 5 }],
      );
      expect(transfer.lines[0]).toMatchObject({ qtyRequested: 8, qtySent: 5 });
      expect(await quantity(item.id, w.branchA)).toBe(15);
      expect(await quantity(item.id, w.branchB, 'IN_TRANSIT')).toBe(5);
    });

    it('refuses to send more than was asked for, an incomplete dispatch and a mixed-up item', async () => {
      const item = await newItem();
      const other = await newItem();
      await seedPlain(item.id, w.branchA, 20);
      const transfer = await approved([{ itemId: item.id, qty: 3 }]);
      const more = await act(staffA, transfer, 'dispatch', {
        items: [{ itemId: item.id, qty: 4 }],
      });
      expect(more.status).toBe(400);
      const nothing = await act(staffA, transfer, 'dispatch', {
        items: [{ itemId: other.id, qty: 1 }],
      });
      expect(nothing.status).toBe(400);
      const both = await act(staffA, transfer, 'dispatch', {
        items: [{ itemId: item.id, qty: 1, serialNos: ['SN-1'] }],
      });
      expect(both.status).toBe(400);
      expect(await quantity(item.id, w.branchA)).toBe(20);
    });

    it('rolls everything back when the sender does not have the stock', async () => {
      const item = await newItem();
      await seedPlain(item.id, w.branchA, 2);
      const transfer = await approved([{ itemId: item.id, qty: 5 }]);
      const response = await act(staffA, transfer, 'dispatch', {
        items: [{ itemId: item.id, qty: 5 }],
      });
      expect(response.status).toBe(422);
      expect(response.body.message).toMatch(/not enough available stock/);
      expect(await quantity(item.id, w.branchA)).toBe(2);
      expect(await quantity(item.id, w.branchB, 'IN_TRANSIT')).toBe(0);
      const still = TransferSchema.parse((await adminA.get(`/transfers/${transfer.id}`)).body);
      expect(still.status).toBe('APPROVED');
      expect(still.events).toHaveLength(2);
    });

    it('is refused before approval, by the receiving branch and by an outsider', async () => {
      const item = await newItem();
      await seedPlain(item.id, w.branchA, 5);
      const body = { items: [{ itemId: item.id, qty: 1 }] };
      const asked = await ask([{ itemId: item.id, qty: 1 }]);
      expect((await act(staffA, asked, 'dispatch', body)).status).toBe(409);
      const ready = parse(await act(adminA, asked, 'approve'));
      const byReceiver = await act(staffB, ready, 'dispatch', body);
      expect(byReceiver.status).toBe(403);
      expect(byReceiver.body.message).toMatch(/branch that holds the stock/);
      expect((await act(staffC, ready, 'dispatch', body)).status).toBe(404);
      expect(await quantity(item.id, w.branchA)).toBe(5);
    });

    it('lets only one of two parallel dispatches of the same transfer through', async () => {
      const item = await newItem();
      await seedPlain(item.id, w.branchA, 10);
      const transfer = await approved([{ itemId: item.id, qty: 4 }]);
      const body = { items: [{ itemId: item.id, qty: 4 }] };
      const results = await Promise.all([
        act(staffA, transfer, 'dispatch', body),
        act(adminA, transfer, 'dispatch', body),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await quantity(item.id, w.branchA)).toBe(6);
      expect(await quantity(item.id, w.branchB, 'IN_TRANSIT')).toBe(4);
      expect(await drift(item.id)).toEqual([]);
    });

    it('never lets two transfers dispatch the same last units', async () => {
      const item = await newItem();
      await seedPlain(item.id, w.branchA, 5);
      const [one, two] = await Promise.all([
        approved([{ itemId: item.id, qty: 4 }]),
        approved([{ itemId: item.id, qty: 4 }]),
      ]);
      const body = { items: [{ itemId: item.id, qty: 4 }] };
      const results = await Promise.all([
        act(staffA, one, 'dispatch', body),
        act(staffA, two, 'dispatch', body),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 422]);
      expect(await quantity(item.id, w.branchA)).toBe(1);
      expect(await quantity(item.id, w.branchB, 'IN_TRANSIT')).toBe(4);
      expect(await drift(item.id)).toEqual([]);
    });

    it('sends serial units by scanning them, and both branches then see the serial numbers', async () => {
      const item = await newItem(true);
      const [u1, u2] = [
        await seedUnit(item.id, w.branchA, unique('SN')),
        await seedUnit(item.id, w.branchA, unique('SN')),
      ];
      await seedUnit(item.id, w.branchA, unique('SN'));
      const transfer = await approved([{ itemId: item.id, qty: 2 }]);
      const sent = parse(
        await act(staffA, transfer, 'dispatch', {
          items: [{ itemId: item.id, serialNos: [u1.serialNo.toLowerCase(), u2.serialNo] }],
        }),
      );
      expect(sent.lines.map((line) => line.serialNo).sort()).toEqual(
        [u1.serialNo, u2.serialNo].sort(),
      );
      expect(sent.lines.every((line) => line.qtyRequested === 1 && line.qtySent === 1)).toBe(true);
      const seenByReceiver = TransferSchema.parse(
        (await staffB.get(`/transfers/${transfer.id}`)).body,
      );
      expect(seenByReceiver.lines.map((line) => line.serialNo).sort()).toEqual(
        [u1.serialNo, u2.serialNo].sort(),
      );
      const units = await owner.serialUnit.findMany({ where: { id: { in: [u1.id, u2.id] } } });
      expect(
        units.every((unit) => unit.branchId === w.branchB && unit.state === 'IN_TRANSIT'),
      ).toBe(true);
      expect(await quantity(item.id, w.branchA)).toBe(1);
      expect(await quantity(item.id, w.branchB, 'IN_TRANSIT')).toBe(2);
      expect(await drift(item.id)).toEqual([]);
    });

    it('refuses serial units that are not in the sender’s stock, not available, duplicated or the wrong number', async () => {
      const item = await newItem(true);
      const good = await seedUnit(item.id, w.branchA, unique('SN'));
      const held = await seedUnit(item.id, w.branchA, unique('SN'), 'RESERVED');
      const elsewhere = await seedUnit(item.id, w.branchB, unique('SN'));
      const transfer = await approved([{ itemId: item.id, qty: 2 }]);
      const send = (serialNos: string[]) =>
        act(staffA, transfer, 'dispatch', { items: [{ itemId: item.id, serialNos }] });
      expect((await send([good.serialNo])).status).toBe(400);
      const missing = await send([good.serialNo, elsewhere.serialNo]);
      expect(missing.status).toBe(400);
      expect(missing.body.details[0].message).toMatch(/is not in stock at/);
      const reserved = await send([good.serialNo, held.serialNo]);
      expect(reserved.body.details[0].message).toMatch(/reserved, not available/);
      expect((await send([good.serialNo, good.serialNo])).status).toBe(400);
      expect(await quantity(item.id, w.branchA)).toBe(1);
      const still = await owner.serialUnit.findUniqueOrThrow({ where: { id: good.id } });
      expect(still).toMatchObject({ branchId: w.branchA, state: 'AVAILABLE' });
    });
  });

  describe('receiving', () => {
    it('brings stock in only on a verified receipt', async () => {
      const item = await newItem();
      await seedPlain(item.id, w.branchA, 20);
      const sent = await dispatched([{ itemId: item.id, qty: 8 }]);
      expect(await quantity(item.id, w.branchB)).toBe(0);
      const done = parse(await act(staffB, sent, 'receive', counts(sent, 8)));
      expect(done.status).toBe('RECEIVED');
      expect(done.events.map((event) => event.status)).toEqual([
        'REQUESTED',
        'APPROVED',
        'DISPATCHED',
        'RECEIVED',
      ]);
      expect(done.lines[0]).toMatchObject({ qtyReceived: 8, qtyDamaged: 0, discrepancies: [] });
      expect(await quantity(item.id, w.branchB)).toBe(8);
      expect(await quantity(item.id, w.branchB, 'IN_TRANSIT')).toBe(0);
      expect(await quantity(item.id, w.branchA)).toBe(12);
      expect(await drift(item.id)).toEqual([]);
      expect(await audits('TRANSFER_RECEIVED', sent.id)).toHaveLength(1);
    });

    it('cannot be received by the sender, by an outsider, or before dispatch', async () => {
      const item = await newItem();
      await seedPlain(item.id, w.branchA, 20);
      const sent = await dispatched([{ itemId: item.id, qty: 3 }]);
      const bySender = await act(staffA, sent, 'receive', counts(sent, 3));
      expect(bySender.status).toBe(403);
      expect(bySender.body.message).toMatch(/Only the receiving branch/);
      expect((await act(staffC, sent, 'receive', counts(sent, 3))).status).toBe(404);
      const early = await approved([{ itemId: item.id, qty: 1 }]);
      expect((await act(staffB, early, 'receive', counts(early, 1))).status).toBe(409);
      expect(await quantity(item.id, w.branchB)).toBe(0);
      expect(await quantity(item.id, w.branchB, 'IN_TRANSIT')).toBe(3);
    });

    it('lets only one of two parallel receipts through and refuses a second receipt', async () => {
      const item = await newItem();
      await seedPlain(item.id, w.branchA, 20);
      const sent = await dispatched([{ itemId: item.id, qty: 5 }]);
      const results = await Promise.all([
        act(staffB, sent, 'receive', counts(sent, 5)),
        act(adminB, sent, 'receive', counts(sent, 5)),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await quantity(item.id, w.branchB)).toBe(5);
      const again = TransferSchema.parse((await staffB.get(`/transfers/${sent.id}`)).body);
      expect((await act(staffB, again, 'receive', counts(again, 5))).status).toBe(409);
      expect(await drift(item.id)).toEqual([]);
    });

    it('records a short delivery as a discrepancy and leaves the missing goods in transit', async () => {
      const item = await newItem();
      await seedPlain(item.id, w.branchA, 20);
      const sent = await dispatched([{ itemId: item.id, qty: 8 }]);
      const done = parse(await act(staffB, sent, 'receive', counts(sent, 5)));
      expect(done.status).toBe('RECEIVED');
      expect(done.lines[0]).toMatchObject({
        qtyReceived: 5,
        discrepancies: [{ type: 'SHORT', qty: 3, status: 'OPEN' }],
      });
      expect(await quantity(item.id, w.branchB)).toBe(5);
      expect(await quantity(item.id, w.branchB, 'IN_TRANSIT')).toBe(3);
      expect(await drift(item.id)).toEqual([]);
    });

    it('puts damaged goods in quarantine and records the damage', async () => {
      const item = await newItem();
      await seedPlain(item.id, w.branchA, 20);
      const sent = await dispatched([{ itemId: item.id, qty: 8 }]);
      const done = parse(await act(staffB, sent, 'receive', counts(sent, 8, 2)));
      expect(done.lines[0]).toMatchObject({
        qtyReceived: 8,
        qtyDamaged: 2,
        discrepancies: [{ type: 'DAMAGED', qty: 2 }],
      });
      expect(await quantity(item.id, w.branchB)).toBe(6);
      expect(await quantity(item.id, w.branchB, 'QUARANTINE')).toBe(2);
      expect(await quantity(item.id, w.branchB, 'IN_TRANSIT')).toBe(0);
      expect(await drift(item.id)).toEqual([]);
    });

    it('refuses counts that cannot be true, and lines that are missing or not in the transfer', async () => {
      const item = await newItem();
      await seedPlain(item.id, w.branchA, 20);
      const sent = await dispatched([{ itemId: item.id, qty: 4 }]);
      const lineId = sent.lines[0]?.id ?? '';
      const more = await act(staffB, sent, 'receive', { lines: [{ lineId, received: 5 }] });
      expect(more.status).toBe(400);
      expect(more.body.details[0].message).toMatch(/only 4 were sent/);
      expect(
        (await act(staffB, sent, 'receive', { lines: [{ lineId, received: 2, damaged: 3 }] }))
          .status,
      ).toBe(400);
      expect((await act(staffB, sent, 'receive', { lines: [] })).status).toBe(400);
      const stranger = await act(staffB, sent, 'receive', {
        lines: [
          { lineId, received: 4 },
          { lineId: '00000000-0000-4000-8000-000000000000', received: 1 },
        ],
      });
      expect(stranger.status).toBe(400);
      expect(
        (
          await act(staffB, sent, 'receive', {
            lines: [
              { lineId, received: 4 },
              { lineId, received: 4 },
            ],
          })
        ).status,
      ).toBe(400);
      expect(await quantity(item.id, w.branchB, 'IN_TRANSIT')).toBe(4);
    });

    it('receives serial units by scanning, with damaged and missing units recorded', async () => {
      const item = await newItem(true);
      const units = [
        await seedUnit(item.id, w.branchA, unique('SN')),
        await seedUnit(item.id, w.branchA, unique('SN')),
        await seedUnit(item.id, w.branchA, unique('SN')),
      ];
      const transfer = await approved([{ itemId: item.id, qty: 3 }]);
      const sent = parse(
        await act(staffA, transfer, 'dispatch', {
          items: [{ itemId: item.id, serialNos: units.map((u) => u.serialNo) }],
        }),
      );
      const [good, damaged, missing] = units;
      const done = parse(
        await act(staffB, sent, 'receive', {
          serials: [{ serialNo: good?.serialNo }, { serialNo: damaged?.serialNo, damaged: true }],
        }),
      );
      const stateOf = async (id: string | undefined) =>
        (await owner.serialUnit.findUniqueOrThrow({ where: { id: id ?? '' } })).state;
      expect(await stateOf(good?.id)).toBe('AVAILABLE');
      expect(await stateOf(damaged?.id)).toBe('QUARANTINE');
      expect(await stateOf(missing?.id)).toBe('IN_TRANSIT');
      expect(done.lines.flatMap((line) => line.discrepancies.map((d) => d.type)).sort()).toEqual([
        'DAMAGED',
        'SHORT',
      ]);
      expect(await quantity(item.id, w.branchB)).toBe(1);
      expect(await quantity(item.id, w.branchB, 'QUARANTINE')).toBe(1);
      expect(await quantity(item.id, w.branchB, 'IN_TRANSIT')).toBe(1);
      expect(await drift(item.id)).toEqual([]);
    });

    it('refuses a scanned serial number that is not part of the transfer', async () => {
      const item = await newItem(true);
      const unit = await seedUnit(item.id, w.branchA, unique('SN'));
      const stranger = await seedUnit(item.id, w.branchA, unique('SN'));
      const transfer = await approved([{ itemId: item.id, qty: 1 }]);
      const sent = parse(
        await act(staffA, transfer, 'dispatch', {
          items: [{ itemId: item.id, serialNos: [unit.serialNo] }],
        }),
      );
      const response = await act(staffB, sent, 'receive', {
        serials: [{ serialNo: stranger.serialNo }],
      });
      expect(response.status).toBe(400);
      expect(response.body.details[0].message).toBe(
        `${stranger.serialNo} is not part of this transfer`,
      );
      expect(
        (
          await act(staffB, sent, 'receive', {
            serials: [{ serialNo: unit.serialNo }, { serialNo: unit.serialNo }],
          })
        ).status,
      ).toBe(400);
      expect(await owner.serialUnit.findUniqueOrThrow({ where: { id: unit.id } })).toMatchObject({
        state: 'IN_TRANSIT',
      });
    });
  });

  describe('settling what arrived wrong', () => {
    const open = async (client: TestClient, transferId: string) => {
      const found = DiscrepancyListResponseSchema.parse(
        (await client.get('/discrepancies?status=OPEN&pageSize=100')).body,
      );
      return found.items.filter((item) => item.documentNo === transferId);
    };

    it('offers a short transfer only a write-off, and a write-off clears the goods from transit', async () => {
      const item = await newItem();
      await seedPlain(item.id, w.branchA, 20);
      const sent = await dispatched([{ itemId: item.id, qty: 6 }]);
      const done = parse(await act(staffB, sent, 'receive', counts(sent, 4)));
      const [short] = await open(adminB, done.transferNo);
      expect(short).toMatchObject({
        type: 'SHORT',
        qty: 2,
        branchCode: 'BB',
        allowedResolutions: ['WRITE_OFF'],
      });
      expect(
        (await staffA.get('/discrepancies?status=OPEN&pageSize=100')).body.items.some(
          (d: { id: string }) => d.id === short?.id,
        ),
      ).toBe(false);
      const claim = await adminB.post(`/discrepancies/${short?.id}/resolve`, {
        resolution: 'CLAIM',
        rowVersion: short?.rowVersion,
      });
      expect(claim.status).toBe(422);
      const settled = await adminB.post(`/discrepancies/${short?.id}/resolve`, {
        resolution: 'WRITE_OFF',
        rowVersion: short?.rowVersion,
      });
      expect(settled.status, JSON.stringify(settled.body)).toBe(200);
      expect(await quantity(item.id, w.branchB, 'IN_TRANSIT')).toBe(0);
      expect(await quantity(item.id, w.branchB)).toBe(4);
      expect(await drift(item.id)).toEqual([]);
    });

    it('lets damaged goods be accepted into stock or written off, but not returned to a supplier', async () => {
      const item = await newItem();
      await seedPlain(item.id, w.branchA, 30);
      const sent = await dispatched([{ itemId: item.id, qty: 5 }]);
      parse(await act(staffB, sent, 'receive', counts(sent, 5, 1)));
      const rows = DiscrepancyListResponseSchema.parse(
        (await adminB.get('/discrepancies?status=OPEN&type=DAMAGED&pageSize=100')).body,
      ).items.filter((d) => d.itemId === item.id);
      const [one] = rows;
      expect(one?.allowedResolutions).toEqual(['ACCEPT', 'WRITE_OFF']);
      const returned = await adminB.post(`/discrepancies/${one?.id}/resolve`, {
        resolution: 'RETURN',
        rowVersion: one?.rowVersion,
      });
      expect(returned.status).toBe(422);
      expect(
        (
          await adminB.post(`/discrepancies/${one?.id}/resolve`, {
            resolution: 'ACCEPT',
            rowVersion: one?.rowVersion,
          })
        ).status,
      ).toBe(200);
      expect(await quantity(item.id, w.branchB, 'QUARANTINE')).toBe(0);
      expect(await quantity(item.id, w.branchB)).toBe(5);
      expect(await drift(item.id)).toEqual([]);
    });

    it('scraps a serial unit that never arrived once its loss is written off', async () => {
      const item = await newItem(true);
      const unit = await seedUnit(item.id, w.branchA, unique('SN'));
      const transfer = await approved([{ itemId: item.id, qty: 1 }]);
      const sent = parse(
        await act(staffA, transfer, 'dispatch', {
          items: [{ itemId: item.id, serialNos: [unit.serialNo] }],
        }),
      );
      const done = parse(await act(staffB, sent, 'receive', {}));
      const [short] = await open(adminB, done.transferNo);
      expect(short).toMatchObject({ type: 'SHORT', qty: 1 });
      expect(
        (
          await adminB.post(`/discrepancies/${short?.id}/resolve`, {
            resolution: 'WRITE_OFF',
            rowVersion: short?.rowVersion,
          })
        ).status,
      ).toBe(200);
      expect(await owner.serialUnit.findUniqueOrThrow({ where: { id: unit.id } })).toMatchObject({
        state: 'SCRAPPED',
        branchId: w.branchB,
      });
      expect(await quantity(item.id, w.branchB, 'IN_TRANSIT')).toBe(0);
      expect(await drift(item.id)).toEqual([]);
    });
  });

  describe('cancelling', () => {
    it('lets either branch cancel before dispatch, with the reason on the history', async () => {
      const item = await newItem();
      const requested = await ask([{ itemId: item.id, qty: 1 }]);
      const cancelled = parse(await act(staffA, requested, 'cancel', { note: 'Changed our mind' }));
      expect(cancelled.status).toBe('CANCELLED');
      expect(cancelled.events.at(-1)).toMatchObject({
        status: 'CANCELLED',
        note: 'Changed our mind',
      });
      const ready = await approved([{ itemId: item.id, qty: 1 }]);
      expect(parse(await act(staffB, ready, 'cancel')).status).toBe('CANCELLED');
      expect(await audits('TRANSFER_CANCELLED', ready.id)).toHaveLength(1);
    });

    it('refuses to cancel once the goods are on their way, and leaves the stock where it is', async () => {
      const item = await newItem();
      await seedPlain(item.id, w.branchA, 10);
      const sent = await dispatched([{ itemId: item.id, qty: 4 }]);
      for (const client of [staffA, staffB, superAdmin]) {
        const response = await act(client, sent, 'cancel', { note: 'Too late' });
        expect(response.status).toBe(422);
        expect(response.body.message).toMatch(/already on their way/);
      }
      expect(await quantity(item.id, w.branchB, 'IN_TRANSIT')).toBe(4);
      expect(TransferSchema.parse((await staffB.get(`/transfers/${sent.id}`)).body).status).toBe(
        'DISPATCHED',
      );
    });

    it('cannot cancel a finished or already cancelled transfer, or one that is not yours', async () => {
      const item = await newItem();
      await seedPlain(item.id, w.branchA, 10);
      const sent = await dispatched([{ itemId: item.id, qty: 2 }]);
      const received = parse(await act(staffB, sent, 'receive', counts(sent, 2)));
      expect((await act(staffB, received, 'cancel')).status).toBe(409);
      const requested = await ask([{ itemId: item.id, qty: 1 }]);
      expect((await act(staffC, requested, 'cancel')).status).toBe(404);
      const cancelled = parse(await act(staffB, requested, 'cancel'));
      expect((await act(staffB, cancelled, 'cancel')).status).toBe(409);
    });
  });

  describe('lists and history', () => {
    it('filters by status, direction and number, and pages on the server', async () => {
      const item = await newItem();
      const one = await ask([{ itemId: item.id, qty: 1 }]);
      const two = parse(await act(adminA, await ask([{ itemId: item.id, qty: 1 }]), 'approve'));
      const ids = async (client: TestClient, query: string) =>
        TransferListResponseSchema.parse(
          (await client.get(`/transfers?pageSize=100&${query}`)).body,
        ).items.map((row) => row.id);
      expect(await ids(staffB, 'status=APPROVED')).toContain(two.id);
      expect(await ids(staffB, 'status=APPROVED')).not.toContain(one.id);
      expect(await ids(staffB, 'direction=incoming')).toEqual(
        expect.arrayContaining([one.id, two.id]),
      );
      expect(await ids(staffB, 'direction=outgoing')).not.toContain(one.id);
      expect(await ids(staffA, 'direction=outgoing')).toEqual(
        expect.arrayContaining([one.id, two.id]),
      );
      expect(await ids(staffA, `search=${encodeURIComponent(one.transferNo)}`)).toEqual([one.id]);
      const paged = TransferListResponseSchema.parse(
        (await staffB.get('/transfers?pageSize=2&page=1')).body,
      );
      expect(paged.items).toHaveLength(2);
      expect(paged.totalPages).toBeGreaterThan(1);
      expect((await staffB.get('/transfers?status=LOST')).status).toBe(400);
      expect((await staffB.get('/transfers?pageSize=1000')).status).toBe(400);
    });

    it('summarises each transfer with its item and unit counts', async () => {
      const [a, b] = [await newItem(), await newItem()];
      const transfer = await ask([
        { itemId: a.id, qty: 3 },
        { itemId: b.id, qty: 4 },
      ]);
      const row = TransferListResponseSchema.parse(
        (await staffB.get(`/transfers?search=${encodeURIComponent(transfer.transferNo)}`)).body,
      ).items[0];
      expect(row).toMatchObject({
        id: transfer.id,
        itemCount: 2,
        unitCount: 7,
        openDiscrepancies: 0,
      });
    });

    it('answers 404 for an unknown transfer', async () => {
      expect((await staffB.get('/transfers/00000000-0000-4000-8000-000000000000')).status).toBe(
        404,
      );
      expect(
        (
          await adminA.post('/transfers/00000000-0000-4000-8000-000000000000/approve', {
            rowVersion: 1,
          })
        ).status,
      ).toBe(404);
    });
  });

  describe('the database guard', () => {
    it('lets only someone acting for the sending branch move goods into transit', async () => {
      const item = await newItem();
      await seedPlain(item.id, w.branchA, 10);
      const transfer = await approved([{ itemId: item.id, qty: 2 }]);
      const lineId = transfer.lines[0]?.id ?? '';
      await owner.transfer.update({ where: { id: transfer.id }, data: { status: 'DISPATCHED' } });
      const attempt = (branchIds: string) =>
        owner.$transaction(async (tx) => {
          await tx.$executeRaw`SET LOCAL ROLE erp_app`;
          await tx.$executeRaw`SELECT set_config('app.is_super', 'false', true), set_config('app.branch_ids', ${branchIds}, true)`;
          await tx.$executeRaw`SELECT transfer_arrive_in_transit(${lineId}::uuid, ${w.users.staffB}::uuid)`;
        });
      await expect(attempt(w.branchB)).rejects.toThrow(/Only the sending branch may dispatch/);
      await expect(attempt(w.branchC)).rejects.toThrow(/Only the sending branch may dispatch/);
      await attempt(w.branchA);
      await expect(attempt(w.branchA)).rejects.toThrow(/already been dispatched/);
      expect(await quantity(item.id, w.branchB, 'IN_TRANSIT')).toBe(2);
    });

    it('refuses a transfer line that sends more than was asked for or receives more than was sent', async () => {
      const item = await newItem();
      const transfer = await ask([{ itemId: item.id, qty: 2 }]);
      const lineId = transfer.lines[0]?.id ?? '';
      await expect(
        owner.transferLine.update({ where: { id: lineId }, data: { qtySent: 3 } }),
      ).rejects.toThrow();
      await expect(
        owner.transferLine.update({ where: { id: lineId }, data: { qtyReceived: 3 } }),
      ).rejects.toThrow();
      await expect(
        owner.transferLine.update({
          where: { id: lineId },
          data: { qtyReceived: 1, qtyDamaged: 2 },
        }),
      ).rejects.toThrow();
      await expect(
        owner.transferLine.update({ where: { id: lineId }, data: { serialNo: 'SN-ONLY' } }),
      ).rejects.toThrow();
    });
  });
});
