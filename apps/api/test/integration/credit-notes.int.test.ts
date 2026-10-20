import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  CreditNoteListResponseSchema,
  CreditNoteSchema,
  InvoiceSchema,
  ReturnableResponseSchema,
} from '@erp/contracts';
import type { CreditNote, Invoice } from '@erp/contracts';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAuthWorld, loggedIn, SUPER_PASSWORD } from '../support/auth-world.js';
import type { AuthWorld, TestClient } from '../support/auth-world.js';
import { createTestApp } from '../support/create-test-app.js';
import { createOwnerPrisma } from '../support/fixtures.js';

const GSTIN_A = '27AAPFU0939F1ZV';

describe('credit notes', () => {
  let app: NestExpressApplication;
  let w: AuthWorld;
  let superAdmin: TestClient;
  let adminA: TestClient;
  let staffA: TestClient;
  let staffB: TestClient;
  let categoryId: string;
  let karnataka: string;
  const owner = createOwnerPrisma();
  let counter = 0;
  const unique = (prefix: string): string =>
    `${prefix}${(counter += 1).toString().padStart(4, '0')}`;

  const newItem = (opts: { serialized?: boolean; tax?: string } = {}) =>
    owner.item.create({
      data: {
        itemCode: unique('CRN'),
        name: 'Credit note test item',
        categoryId,
        unitCode: 'PCS',
        isSerialized: opts.serialized ?? false,
        hsnCode: '8703',
        taxRate: opts.tax ?? '18',
      },
    });
  const seedPlain = async (itemId: string, qty: number) => {
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
  const seedUnit = async (itemId: string, serialNo: string) => {
    const unit = await owner.serialUnit.create({
      data: { branchId: w.branchA, itemId, serialNo, state: 'AVAILABLE' },
    });
    await owner.stockBalance.upsert({
      where: { branchId_itemId_state: { branchId: w.branchA, itemId, state: 'AVAILABLE' } },
      create: { branchId: w.branchA, itemId, state: 'AVAILABLE', quantity: 1 },
      update: { quantity: { increment: 1 } },
    });
    await owner.stockLedger.create({
      data: {
        branchId: w.branchA,
        itemId,
        serialUnitId: unit.id,
        state: 'AVAILABLE',
        qtyDelta: 1,
        movementType: 'OPENING_BALANCE',
      },
    });
    return unit;
  };
  const quantity = async (itemId: string, state: 'AVAILABLE' | 'RETURNED'): Promise<number> =>
    (
      await owner.stockBalance.findUnique({
        where: { branchId_itemId_state: { branchId: w.branchA, itemId, state } },
      })
    )?.quantity ?? 0;
  const drift = (itemId: string) =>
    owner.$queryRaw<
      { branch_id: string }[]
    >`SELECT branch_id FROM stock_balance_drift() WHERE item_id = ${itemId}::uuid`;
  const unitState = async (id: string) =>
    (await owner.serialUnit.findUniqueOrThrow({ where: { id } })).state;
  const audits = (action: string, entityId: string) =>
    owner.auditLog.findMany({ where: { action, entityId } });

  const sell = async (
    lines: object[],
    over: object = {},
    client: TestClient = staffA,
  ): Promise<Invoice> => {
    const created = await client.post('/invoices', {
      customerId: w.customerId,
      type: 'GST',
      lines,
      ...over,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const invoice = InvoiceSchema.parse(created.body);
    const issued = await client.post(`/invoices/${invoice.id}/issue`, {
      rowVersion: invoice.rowVersion,
    });
    expect(issued.status, JSON.stringify(issued.body)).toBe(200);
    return InvoiceSchema.parse(issued.body);
  };
  const row = (itemId: string, qty: number, unitPrice = '1000.00', extra: object = {}) => ({
    itemId,
    qty,
    unitPrice,
    ...extra,
  });
  const ask = (
    client: TestClient,
    invoice: Invoice,
    lines: { qty: number; index?: number }[],
    reason = 'Customer returned them',
  ) =>
    client.post('/credit-notes', {
      invoiceId: invoice.id,
      reason,
      lines: lines.map((l) => ({ invoiceLineId: invoice.lines[l.index ?? 0]?.id, qty: l.qty })),
    });
  const request1 = async (invoice: Invoice, qty: number, index = 0): Promise<CreditNote> => {
    const response = await ask(staffA, invoice, [{ qty, index }]);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return CreditNoteSchema.parse(response.body);
  };
  const approve = (client: TestClient, note: CreditNote) =>
    client.post(`/credit-notes/${note.id}/approve`, { rowVersion: note.rowVersion });
  const reject = (client: TestClient, note: CreditNote, reason = 'Not accepted') =>
    client.post(`/credit-notes/${note.id}/reject`, { rowVersion: note.rowVersion, reason });
  const numberOf = (no: string | null): number =>
    Number(no?.slice((no?.lastIndexOf('/') ?? 0) + 1));

  beforeAll(async () => {
    w = await createAuthWorld(owner);
    categoryId = (await owner.itemCategory.findFirstOrThrow({ where: { name: 'Vehicles' } })).id;
    await owner.branch.update({ where: { id: w.branchA }, data: { gstin: GSTIN_A } });
    karnataka = (
      await owner.customer.create({ data: { name: 'Kiran', phone: '9000000002', stateCode: '29' } })
    ).id;
    app = await createTestApp();
    superAdmin = await loggedIn(app, 'superadmin', SUPER_PASSWORD);
    adminA = await loggedIn(app, 'admin_a');
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
      const id = w.customerId;
      const attempts = [
        http().get('/credit-notes'),
        http().get(`/credit-notes/${id}`),
        http().get(`/invoices/${id}/returnable`),
        http().post('/credit-notes').set('Origin', origin).send({}),
        http().post(`/credit-notes/${id}/approve`).set('Origin', origin).send({}),
        http().post(`/credit-notes/${id}/reject`).set('Origin', origin).send({}),
      ];
      for (const response of await Promise.all(attempts)) expect(response.status).toBe(401);
    });

    it('lets Staff ask for a credit note and read it, but not approve it', async () => {
      const item = await newItem();
      await seedPlain(item.id, 5);
      const invoice = await sell([row(item.id, 3)]);
      const note = await request1(invoice, 1);
      expect((await staffA.get(`/credit-notes/${note.id}`)).status).toBe(200);
      expect((await approve(staffA, note)).status).toBe(403);
    });
  });

  describe('asking for a credit note', () => {
    it('credits the price, discount and tax of the returned goods, inside the state and across the border', async () => {
      const item = await newItem({ tax: '18' });
      await seedPlain(item.id, 10);
      const inside = await sell([row(item.id, 2, '1000.00', { discountAmount: '100.00' })]);
      const full = await request1(inside, 2);
      expect(full).toMatchObject({
        status: 'PENDING',
        creditNoteNo: null,
        taxableValue: '1900.00',
        cgstAmount: '171.00',
        sgstAmount: '171.00',
        igstAmount: '0.00',
        amount: '2242.00',
        invoiceNo: inside.invoiceNo,
      });
      const across = await sell([row(item.id, 2, '1000.00', { discountAmount: '100.00' })], {
        customerId: karnataka,
      });
      const igst = await request1(across, 2);
      expect(igst).toMatchObject({
        cgstAmount: '0.00',
        sgstAmount: '0.00',
        igstAmount: '342.00',
        amount: '2242.00',
      });
      expect((await audits('CREDIT_NOTE_REQUESTED', full.id)).length).toBe(1);
    });

    it('takes the exact remainder on the last units so many small credits add back to the whole line', async () => {
      const item = await newItem({ tax: '18' });
      await seedPlain(item.id, 10);
      const invoice = await sell([row(item.id, 3, '333.33')]);
      const line = invoice.lines[0]!;
      const first = await request1(invoice, 1);
      const second = await request1(invoice, 1);
      const third = await request1(invoice, 1);
      const sum = (key: 'taxableValue' | 'cgstAmount' | 'sgstAmount' | 'amount') =>
        [first, second, third].reduce((total, note) => total + Number(note[key]), 0).toFixed(2);
      expect(sum('taxableValue')).toBe(line.taxableAmount);
      expect(sum('cgstAmount')).toBe(line.cgstAmount);
      expect(sum('sgstAmount')).toBe(line.sgstAmount);
      expect(sum('amount')).toBe(line.amount);
    });

    it('refuses crediting more than was sold, counting requests that are still waiting', async () => {
      const item = await newItem();
      await seedPlain(item.id, 10);
      const invoice = await sell([row(item.id, 3)]);
      const waiting = await request1(invoice, 2);
      const over = await ask(staffA, invoice, [{ qty: 2 }]);
      expect(over.status).toBe(400);
      expect(over.body.details[0]).toEqual({
        field: 'lines.0.qty',
        message: 'Only 1 can still be credited',
      });
      expect((await reject(adminA, waiting)).status).toBe(200);
      expect((await ask(staffA, invoice, [{ qty: 3 }])).status).toBe(201);
      const nothingLeft = await ask(staffA, invoice, [{ qty: 1 }]);
      expect(nothingLeft.body.details[0].message).toBe(
        'Everything on this line has already been credited',
      );
    });

    it('lets only one of two simultaneous requests for the same goods through', async () => {
      const item = await newItem();
      await seedPlain(item.id, 10);
      const invoice = await sell([row(item.id, 5)]);
      const results = await Promise.all([
        ask(staffA, invoice, [{ qty: 3 }]),
        ask(staffA, invoice, [{ qty: 3 }]),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
    });

    it('refuses a draft, a cancelled invoice, a repeated line, a line from another invoice and free goods', async () => {
      const item = await newItem();
      await seedPlain(item.id, 10);
      const draft = InvoiceSchema.parse(
        (
          await staffA.post('/invoices', {
            customerId: w.customerId,
            type: 'GST',
            lines: [row(item.id, 1)],
          })
        ).body,
      );
      expect(
        (
          await staffA.post('/credit-notes', {
            invoiceId: draft.id,
            reason: 'Returned',
            lines: [{ invoiceLineId: draft.lines[0]?.id, qty: 1 }],
          })
        ).status,
      ).toBe(422);

      const cancelled = await sell([row(item.id, 1)]);
      await adminA.post(`/invoices/${cancelled.id}/cancel`, {
        rowVersion: cancelled.rowVersion,
        reason: 'Mistake',
      });
      expect((await ask(staffA, cancelled, [{ qty: 1 }])).status).toBe(422);

      const invoice = await sell([row(item.id, 2)]);
      const other = await sell([row(item.id, 1)]);
      const twice = await staffA.post('/credit-notes', {
        invoiceId: invoice.id,
        reason: 'Returned',
        lines: [
          { invoiceLineId: invoice.lines[0]?.id, qty: 1 },
          { invoiceLineId: invoice.lines[0]?.id, qty: 1 },
        ],
      });
      expect(twice.status).toBe(400);
      const foreign = await staffA.post('/credit-notes', {
        invoiceId: invoice.id,
        reason: 'Returned',
        lines: [{ invoiceLineId: other.lines[0]?.id, qty: 1 }],
      });
      expect(foreign.status).toBe(400);
      expect(foreign.body.details[0].field).toBe('lines.0.invoiceLineId');

      const free = await sell(
        [row(item.id, 1, '500.00', { discountAmount: '500.00' })],
        {},
        adminA,
      );
      const nothing = await ask(adminA, free, [{ qty: 1 }]);
      expect(nothing.status).toBe(422);
    });

    it('needs a reason and at least one line', async () => {
      const item = await newItem();
      await seedPlain(item.id, 5);
      const invoice = await sell([row(item.id, 1)]);
      expect((await ask(staffA, invoice, [{ qty: 1 }], 'no')).status).toBe(400);
      expect(
        (
          await staffA.post('/credit-notes', {
            invoiceId: invoice.id,
            reason: 'Returned',
            lines: [],
          })
        ).status,
      ).toBe(400);
    });

    it('credits no tax on an invoice without GST', async () => {
      const item = await newItem();
      await seedPlain(item.id, 5);
      const invoice = await sell([row(item.id, 2)], { type: 'NON_GST' });
      const note = await request1(invoice, 1);
      expect(note).toMatchObject({ cgstAmount: '0.00', igstAmount: '0.00', amount: '1000.00' });
    });
  });

  describe('approving', () => {
    it('numbers it, puts returned goods in the Returned state and keeps the books balanced', async () => {
      const item = await newItem();
      await seedPlain(item.id, 5);
      const invoice = await sell([row(item.id, 3)]);
      const note = await request1(invoice, 2);
      const approved = CreditNoteSchema.parse((await approve(adminA, note)).body);
      expect(approved.status).toBe('APPROVED');
      expect(approved.creditNoteNo).toMatch(/\/\d{5}$/);
      expect(approved.decidedByName).toBeTruthy();
      expect(await quantity(item.id, 'RETURNED')).toBe(2);
      expect(await quantity(item.id, 'AVAILABLE')).toBe(2);
      const entry = await owner.stockLedger.findFirstOrThrow({
        where: { itemId: item.id, movementType: 'SALE_RETURN' },
      });
      expect(entry).toMatchObject({
        qtyDelta: 2,
        state: 'RETURNED',
        sourceDocType: 'CREDIT_NOTE',
        sourceDocId: note.id,
      });
      expect(await drift(item.id)).toEqual([]);
      expect((await audits('CREDIT_NOTE_APPROVED', note.id)).length).toBe(1);
      expect(
        await owner.outboxEvent.count({
          where: {
            eventType: 'credit_note.approved',
            payload: { path: ['creditNoteId'], equals: note.id },
          },
        }),
      ).toBe(1);
    });

    it('returns a serial unit to the Returned state and takes back its battery warranty', async () => {
      const item = await newItem({ serialized: true });
      const unit = await seedUnit(item.id, unique('SN'));
      await owner.battery.create({ data: { serialUnitId: unit.id, warrantyMonths: 12 } });
      const invoice = await sell([row(item.id, 1, '5000.00', { serialUnitId: unit.id })]);
      expect(
        (await owner.battery.findUniqueOrThrow({ where: { serialUnitId: unit.id } })).warrantyEnd,
      ).not.toBeNull();
      const note = await request1(invoice, 1);
      expect((await approve(adminA, note)).status).toBe(200);
      expect(await unitState(unit.id)).toBe('RETURNED');
      expect(
        (await owner.battery.findUniqueOrThrow({ where: { serialUnitId: unit.id } })).warrantyEnd,
      ).toBeNull();
      expect(await drift(item.id)).toEqual([]);
      const again = await ask(staffA, invoice, [{ qty: 1 }]);
      expect(again.status).toBe(400);
    });

    it('does not let a person approve their own request, except a Super Admin', async () => {
      const item = await newItem();
      await seedPlain(item.id, 5);
      const invoice = await sell([row(item.id, 2)]);
      const own = CreditNoteSchema.parse((await ask(adminA, invoice, [{ qty: 1 }])).body);
      const refused = await approve(adminA, own);
      expect(refused.status).toBe(403);
      expect(refused.body.message).toMatch(/cannot approve a credit note you asked for/);
      const owners = CreditNoteSchema.parse((await ask(superAdmin, invoice, [{ qty: 1 }])).body);
      expect((await approve(superAdmin, owners)).status).toBe(200);
    });

    it('works once, refuses a stale version and a decided note', async () => {
      const item = await newItem();
      await seedPlain(item.id, 5);
      const invoice = await sell([row(item.id, 2)]);
      const note = await request1(invoice, 1);
      expect(
        (await adminA.post(`/credit-notes/${note.id}/approve`, { rowVersion: note.rowVersion + 5 }))
          .status,
      ).toBe(409);
      expect((await approve(adminA, note)).status).toBe(200);
      const again = await adminA.post(`/credit-notes/${note.id}/approve`, {
        rowVersion: note.rowVersion + 1,
      });
      expect(again.status).toBe(409);
      expect(await quantity(item.id, 'RETURNED')).toBe(1);
    });

    it('lets only one of two simultaneous approvals through', async () => {
      const item = await newItem();
      await seedPlain(item.id, 5);
      const invoice = await sell([row(item.id, 2)]);
      const note = await request1(invoice, 1);
      const results = await Promise.all([approve(adminA, note), approve(superAdmin, note)]);
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(await quantity(item.id, 'RETURNED')).toBe(1);
    });

    it('numbers consecutively with no gap, even when an approval fails half way', async () => {
      const item = await newItem({ serialized: true });
      const good = await seedUnit(item.id, unique('SN'));
      const broken = await seedUnit(item.id, unique('SN'));
      const invoice = await sell([
        row(item.id, 1, '100.00', { serialUnitId: good.id }),
        row(item.id, 1, '100.00', { serialUnitId: broken.id }),
      ]);
      const first = await request1(invoice, 1, 0);
      const failing = await request1(invoice, 1, 1);
      const a = CreditNoteSchema.parse((await approve(adminA, first)).body);
      await owner.serialUnit.update({ where: { id: broken.id }, data: { state: 'AVAILABLE' } });
      const refused = await approve(adminA, failing);
      expect(refused.status).toBeGreaterThanOrEqual(400);
      expect((await owner.creditNote.findUniqueOrThrow({ where: { id: failing.id } })).status).toBe(
        'PENDING',
      );
      await owner.serialUnit.update({ where: { id: broken.id }, data: { state: 'SOLD' } });
      const b = CreditNoteSchema.parse((await approve(adminA, failing)).body);
      expect(numberOf(b.creditNoteNo)).toBe(numberOf(a.creditNoteNo) + 1);
    });
  });

  describe('rejecting', () => {
    it('lets an approver reject with a reason, and changes no stock', async () => {
      const item = await newItem();
      await seedPlain(item.id, 5);
      const invoice = await sell([row(item.id, 2)]);
      const note = await request1(invoice, 1);
      expect(
        (
          await adminA.post(`/credit-notes/${note.id}/reject`, {
            rowVersion: note.rowVersion,
            reason: 'x',
          })
        ).status,
      ).toBe(400);
      const rejected = CreditNoteSchema.parse((await reject(adminA, note, 'Goods were used')).body);
      expect(rejected).toMatchObject({
        status: 'REJECTED',
        creditNoteNo: null,
        decisionNote: 'Goods were used',
      });
      expect(await quantity(item.id, 'RETURNED')).toBe(0);
      expect(await quantity(item.id, 'AVAILABLE')).toBe(3);
      expect(
        (await adminA.post(`/credit-notes/${note.id}/approve`, { rowVersion: rejected.rowVersion }))
          .status,
      ).toBe(409);
    });

    it('lets a person withdraw their own request but not someone else’s', async () => {
      const item = await newItem();
      await seedPlain(item.id, 5);
      const invoice = await sell([row(item.id, 2)]);
      const mine = await request1(invoice, 1);
      const theirs = CreditNoteSchema.parse((await ask(adminA, invoice, [{ qty: 1 }])).body);
      expect((await reject(staffA, theirs)).status).toBe(403);
      expect((await reject(staffA, mine, 'Asked by mistake')).status).toBe(200);
    });
  });

  describe('the invoice and the lists', () => {
    it('cannot be cancelled while a credit note is waiting or approved, but can after it was rejected', async () => {
      const item = await newItem();
      await seedPlain(item.id, 5);
      const invoice = await sell([row(item.id, 2)]);
      const note = await request1(invoice, 1);
      const blocked = await adminA.post(`/invoices/${invoice.id}/cancel`, {
        rowVersion: invoice.rowVersion,
        reason: 'Mistake',
      });
      expect(blocked.status).toBe(422);
      expect(blocked.body.message).toMatch(/credit notes/);
      await reject(adminA, note);
      expect(
        (
          await adminA.post(`/invoices/${invoice.id}/cancel`, {
            rowVersion: invoice.rowVersion,
            reason: 'Mistake',
          })
        ).status,
      ).toBe(200);
    });

    it('says what can still be credited on each line', async () => {
      const item = await newItem();
      await seedPlain(item.id, 5);
      const invoice = await sell([row(item.id, 4)]);
      await request1(invoice, 3);
      const lines = ReturnableResponseSchema.parse(
        (await staffA.get(`/invoices/${invoice.id}/returnable`)).body,
      );
      expect(lines[0]).toMatchObject({ soldQty: 4, creditedQty: 3, returnableQty: 1 });
    });

    it('lists and filters on the server, and keeps each branch to its own', async () => {
      const item = await newItem();
      await seedPlain(item.id, 5);
      const invoice = await sell([row(item.id, 3)]);
      const waiting = await request1(invoice, 1);
      const decided = await request1(invoice, 1);
      await approve(adminA, decided);
      const list = (query: string) =>
        staffA
          .get(`/credit-notes?${query}`)
          .then((r) => CreditNoteListResponseSchema.parse(r.body));
      expect((await list(`invoiceId=${invoice.id}`)).items.map((n) => n.id).sort()).toEqual(
        [waiting.id, decided.id].sort(),
      );
      expect((await list(`invoiceId=${invoice.id}&status=PENDING`)).items.map((n) => n.id)).toEqual(
        [waiting.id],
      );
      expect(
        (await list(`search=${encodeURIComponent(invoice.invoiceNo ?? '')}&pageSize=1`)).totalPages,
      ).toBe(2);
      expect((await staffA.get('/credit-notes?sortBy=password')).status).toBe(400);
      expect((await staffA.get('/credit-notes?status=DELETED')).status).toBe(400);
      expect((await staffB.get(`/credit-notes/${waiting.id}`)).status).toBe(404);
      expect((await staffB.get(`/credit-notes?invoiceId=${invoice.id}`)).body.items).toEqual([]);
    });
  });

  describe('database guards', () => {
    it('never lets a decided credit note or any line change, and refuses crediting more than was sold', async () => {
      const item = await newItem();
      await seedPlain(item.id, 5);
      const invoice = await sell([row(item.id, 2)]);
      const note = await request1(invoice, 1);
      await approve(adminA, note);
      await expect(
        owner.creditNote.update({ where: { id: note.id }, data: { reason: 'Changed' } }),
      ).rejects.toThrow();
      await expect(
        owner.creditNote.update({ where: { id: note.id }, data: { status: 'PENDING' } }),
      ).rejects.toThrow();
      const lineId = (
        await owner.creditNoteLine.findFirstOrThrow({ where: { creditNoteId: note.id } })
      ).id;
      await expect(
        owner.creditNoteLine.update({ where: { id: lineId }, data: { qty: 2 } }),
      ).rejects.toThrow();
      await expect(owner.creditNoteLine.delete({ where: { id: lineId } })).rejects.toThrow();

      const second = await request1(invoice, 1);
      await expect(
        owner.creditNoteLine.create({
          data: {
            branchId: w.branchA,
            creditNoteId: second.id,
            invoiceLineId: String(invoice.lines[0]?.id),
            itemId: item.id,
            lineNo: 2,
            qty: 1,
            taxableAmount: '1',
            amount: '1',
          },
        }),
      ).rejects.toThrow();
    });

    it('refuses a number on a request that is not approved and an approval with no number', async () => {
      const item = await newItem();
      await seedPlain(item.id, 5);
      const invoice = await sell([row(item.id, 2)]);
      const note = await request1(invoice, 1);
      await expect(
        owner.creditNote.update({ where: { id: note.id }, data: { creditNoteNo: 'X/1' } }),
      ).rejects.toThrow();
      await expect(
        owner.creditNote.update({
          where: { id: note.id },
          data: { status: 'APPROVED', decidedBy: w.users.adminA, decidedAt: new Date() },
        }),
      ).rejects.toThrow();
    });

    describe('a vehicle with batteries fitted', () => {
      const vehicleWithBattery = async () => {
        const vehicleItem = await newItem({ serialized: true });
        const batteryItem = await newItem({ serialized: true });
        const vehicle = await seedUnit(vehicleItem.id, unique('VEH'));
        const battery = await owner.serialUnit.create({
          data: {
            branchId: w.branchA,
            itemId: batteryItem.id,
            serialNo: unique('BAT'),
            state: 'RESERVED',
          },
        });
        await owner.stockBalance.create({
          data: { branchId: w.branchA, itemId: batteryItem.id, state: 'RESERVED', quantity: 1 },
        });
        await owner.stockLedger.create({
          data: {
            branchId: w.branchA,
            itemId: batteryItem.id,
            serialUnitId: battery.id,
            state: 'RESERVED',
            qtyDelta: 1,
            movementType: 'OPENING_BALANCE',
          },
        });
        await owner.battery.create({
          data: {
            serialUnitId: battery.id,
            manufacturedOn: new Date(Date.now() - 30 * 86_400_000),
            expiryOn: new Date(Date.now() + 365 * 86_400_000),
            warrantyMonths: 12,
            installedInSerialUnitId: vehicle.id,
            installedOn: new Date(),
          },
        });
        return { vehicleItem, batteryItem, vehicle, battery };
      };

      it('takes the batteries back with the vehicle: returned goods, warranty cleared, still fitted, traced to the credit note', async () => {
        const { vehicleItem, batteryItem, vehicle, battery } = await vehicleWithBattery();
        const invoice = await sell([
          row(vehicleItem.id, 1, '90000.00', { serialUnitId: vehicle.id }),
        ]);
        expect(await unitState(battery.id)).toBe('SOLD');
        const sold = await owner.battery.findUniqueOrThrow({ where: { serialUnitId: battery.id } });
        expect(sold.warrantyEnd).not.toBeNull();
        const note = await request1(invoice, 1);
        expect((await approve(adminA, note)).status).toBe(200);
        expect(await unitState(vehicle.id)).toBe('RETURNED');
        expect(await unitState(battery.id)).toBe('RETURNED');
        const returned = await owner.battery.findUniqueOrThrow({
          where: { serialUnitId: battery.id },
        });
        expect(returned).toMatchObject({ warrantyEnd: null, installedInSerialUnitId: vehicle.id });
        const trail = await owner.stockLedger.findMany({
          where: { serialUnitId: battery.id },
          orderBy: { createdAt: 'asc' },
        });
        expect(trail.map((r) => [r.movementType, r.state, r.qtyDelta])).toEqual([
          ['OPENING_BALANCE', 'RESERVED', 1],
          ['SALE', 'RESERVED', -1],
          ['SALE_RETURN', 'RETURNED', 1],
        ]);
        expect(trail[2]).toMatchObject({ sourceDocType: 'CREDIT_NOTE', sourceDocId: note.id });
        expect(await quantity(batteryItem.id, 'RETURNED')).toBe(1);
        expect(await drift(batteryItem.id)).toEqual([]);
        expect(await drift(vehicleItem.id)).toEqual([]);
        const log = await audits('CREDIT_NOTE_APPROVED', note.id);
        expect(log[0]?.newValue).toMatchObject({ batteriesReturned: 1 });
      });

      it('leaves a battery that was not sold with the vehicle alone, and a rejected note changes nothing', async () => {
        const { vehicleItem, vehicle, battery } = await vehicleWithBattery();
        const invoice = await sell([
          row(vehicleItem.id, 1, '90000.00', { serialUnitId: vehicle.id }),
        ]);
        const rejected = await request1(invoice, 1);
        expect((await reject(adminA, rejected)).status).toBe(200);
        expect(await unitState(battery.id)).toBe('SOLD');
        await owner.$executeRaw`UPDATE serial_units SET state = 'DAMAGED' WHERE id = ${battery.id}::uuid`;
        const note = await request1(invoice, 1);
        expect((await approve(adminA, note)).status).toBe(200);
        expect(await unitState(vehicle.id)).toBe('RETURNED');
        expect(await unitState(battery.id)).toBe('DAMAGED');
        const log = await audits('CREDIT_NOTE_APPROVED', note.id);
        expect(log[0]?.newValue).toMatchObject({ batteriesReturned: 0 });
      });
    });

    describe('the credit note PDF', () => {
      const fetchPdf = (client: TestClient, id: string) =>
        client
          .get(`/credit-notes/${id}/pdf`)
          .buffer(true)
          .parse((res, done) => {
            const chunks: Buffer[] = [];
            res.on('data', (chunk: Buffer) => chunks.push(chunk));
            res.on('end', () => done(null, Buffer.concat(chunks)));
          });

      it('is refused when signed out', async () => {
        const response = await request(app.getHttpServer()).get(
          `/credit-notes/${w.customerId}/pdf`,
        );
        expect(response.status).toBe(401);
      });

      it('gives an approved credit note as a PDF download, numbered, with the invoice it follows', async () => {
        const item = await newItem();
        await seedPlain(item.id, 10);
        const invoice = await sell([row(item.id, 3)]);
        const note = await request1(invoice, 2);
        const approvedNote = CreditNoteSchema.parse((await approve(adminA, note)).body);
        const response = await fetchPdf(staffA, note.id);
        expect(response.status).toBe(200);
        expect(response.headers['content-type']).toContain('application/pdf');
        expect(response.headers['content-disposition']).toContain(
          `${(approvedNote.creditNoteNo ?? '').replace(/[^A-Za-z0-9._-]/g, '-')}.pdf`,
        );
        expect(response.headers['cache-control']).toBe('no-store');
        const text = (response.body as Buffer).toString('latin1');
        expect(text.startsWith('%PDF-1.4')).toBe(true);
        expect(text).toContain(`Credit note no: ${approvedNote.creditNoteNo}`);
        expect(text).toContain(`Against invoice: ${invoice.invoiceNo}`);
        expect(text).toContain('GSTIN: 27AAPFU0939F1ZV');
        expect(text).toContain('Rupees');
        expect(text).not.toContain('PENDING');
      });

      it('says a waiting credit note is not valid', async () => {
        const item = await newItem();
        await seedPlain(item.id, 10);
        const invoice = await sell([row(item.id, 1)]);
        const note = await request1(invoice, 1);
        const response = await fetchPdf(staffA, note.id);
        expect(response.status).toBe(200);
        const text = (response.body as Buffer).toString('latin1');
        expect(text).toContain('PENDING - this credit note is not valid until it is approved');
        expect(text).toContain('not yet numbered');
      });

      it('is not given to another branch, and an unknown note is a 404', async () => {
        const item = await newItem();
        await seedPlain(item.id, 10);
        const invoice = await sell([row(item.id, 1)]);
        const note = await request1(invoice, 1);
        expect((await fetchPdf(staffB, note.id)).status).toBe(404);
        expect((await fetchPdf(staffA, '0b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59')).status).toBe(404);
        expect((await staffA.get('/credit-notes/not-a-uuid/pdf')).status).toBe(400);
      });
    });
  });
});
