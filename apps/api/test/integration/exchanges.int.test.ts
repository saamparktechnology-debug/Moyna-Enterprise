import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  BrokerSchema,
  CommissionListResponseSchema,
  DueListResponseSchema,
  ExchangeListResponseSchema,
  ExchangeOptionsSchema,
  ExchangeSchema,
  InvoiceSchema,
  PaymentListResponseSchema,
} from '@erp/contracts';
import type { Exchange, Invoice } from '@erp/contracts';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { addUser, createAuthWorld, loggedIn, SUPER_PASSWORD } from '../support/auth-world.js';
import type { AuthWorld, TestClient } from '../support/auth-world.js';
import { createTestApp } from '../support/create-test-app.js';
import { createOwnerPrisma } from '../support/fixtures.js';

describe('exchanges', () => {
  let app: NestExpressApplication;
  let w: AuthWorld;
  let superAdmin: TestClient;
  let adminA: TestClient;
  let adminA2: TestClient;
  let adminB: TestClient;
  let staffA: TestClient;
  let staffB: TestClient;
  let viewer: TestClient;
  let categoryId: string;
  const owner = createOwnerPrisma();
  let counter = 0;
  const unique = (prefix: string): string =>
    `${prefix}${(counter += 1).toString().padStart(4, '0')}`;
  let keyCounter = 0;
  const key = (): string => `exchange-test-${Date.now()}-${(keyCounter += 1)}`;
  const today = (): string => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

  const newCustomer = async (): Promise<string> =>
    (
      await owner.customer.create({
        data: { name: unique('Owner '), phone: `6${(counter += 1).toString().padStart(9, '0')}` },
      })
    ).id;
  const newItem = (serialized = true) =>
    owner.item.create({
      data: {
        itemCode: unique('EXC'),
        name: 'Exchange test item',
        categoryId,
        unitCode: 'PCS',
        isSerialized: serialized,
      },
    });
  const stockUnit = async (
    itemId: string,
    state: 'AVAILABLE' | 'RESERVED' = 'AVAILABLE',
    branchId = w.branchA,
  ) => {
    const unit = await owner.serialUnit.create({
      data: { branchId, itemId, serialNo: unique('SN'), state },
    });
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
  const plainStock = async (itemId: string, qty = 50) => {
    await owner.stockBalance.create({
      data: { branchId: w.branchA, itemId, state: 'AVAILABLE', quantity: qty },
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
  /** A vehicle with a battery fitted, as it is before it is sold. */
  const vehicleWithBattery = async (item: { id: string }) => {
    const vehicle = await stockUnit(item.id);
    const batteryItem = await newItem();
    const battery = await stockUnit(batteryItem.id, 'RESERVED');
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
    return { vehicle, battery };
  };

  const sell = async (
    customerId: string,
    lines: { itemId: string; qty?: number; unitPrice: string; serialUnitId?: string }[],
    over: Record<string, unknown> = {},
    client: TestClient = staffA,
  ): Promise<Invoice> => {
    const created = await client.post('/invoices', {
      customerId,
      type: 'NON_GST',
      lines: lines.map((l) => ({ qty: 1, discountAmount: '0.00', ...l })),
      ...over,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const draft = InvoiceSchema.parse(created.body);
    const issued = await client.post(`/invoices/${draft.id}/issue`, {
      rowVersion: draft.rowVersion,
    });
    expect(issued.status, JSON.stringify(issued.body)).toBe(200);
    return InvoiceSchema.parse(issued.body);
  };

  /** A customer who bought a vehicle (the old unit) and is now buying another (the new unit) on a delivery invoice. */
  const scene = async (
    opts: {
      oldPrice?: string;
      newPrice?: string;
      withBattery?: boolean;
      brokerId?: string | null;
      sparePrice?: string;
    } = {},
  ) => {
    const customerId = await newCustomer();
    const model = await newItem();
    const oldPair = opts.withBattery
      ? await vehicleWithBattery(model)
      : { vehicle: await stockUnit(model.id), battery: null };
    const newUnit = await stockUnit(model.id);
    const lines: { itemId: string; unitPrice: string; serialUnitId?: string }[] = [
      {
        itemId: model.id,
        unitPrice: opts.oldPrice ?? '60000.00',
        serialUnitId: oldPair.vehicle.id,
      },
    ];
    if (opts.sparePrice) {
      const part = await newItem(false);
      await plainStock(part.id);
      lines.push({ itemId: part.id, unitPrice: opts.sparePrice });
    }
    const original = await sell(customerId, lines, { brokerId: opts.brokerId ?? null });
    const delivery = await sell(customerId, [
      { itemId: model.id, unitPrice: opts.newPrice ?? '100000.00', serialUnitId: newUnit.id },
    ]);
    return {
      customerId,
      model,
      oldUnit: oldPair.vehicle,
      battery: oldPair.battery,
      newUnit,
      original,
      delivery,
    };
  };
  type Scene = Awaited<ReturnType<typeof scene>>;

  const ask = (client: TestClient, s: Scene, over: Record<string, unknown> = {}) =>
    client.post('/exchanges', {
      invoiceId: s.delivery.id,
      newSerialUnitId: s.newUnit.id,
      oldSerialUnitId: s.oldUnit.id,
      kind: 'OLD_FOR_NEW',
      valuationAmount: '40000.00',
      disposition: 'STOCK',
      reason: 'Customer wants the larger model',
      ...over,
    });
  const asked = async (
    s: Scene,
    over: Record<string, unknown> = {},
    client: TestClient = staffA,
  ): Promise<Exchange> => {
    const response = await ask(client, s, over);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return ExchangeSchema.parse(response.body);
  };
  const approve = (client: TestClient, e: Exchange, note?: string) =>
    client.post(`/exchanges/${e.id}/approve`, {
      rowVersion: e.rowVersion,
      ...(note ? { note } : {}),
    });
  const approved = async (client: TestClient, e: Exchange): Promise<Exchange> => {
    const response = await approve(client, e);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return ExchangeSchema.parse(response.body);
  };
  const unit = (id: string) => owner.serialUnit.findUniqueOrThrow({ where: { id } });
  const dueOf = async (invoiceId: string, customerId: string) =>
    DueListResponseSchema.parse(
      (await adminA.get(`/dues?scope=all&customerId=${customerId}`)).body,
    ).items.find((d) => d.invoiceId === invoiceId);
  const audits = (action: string, entityId: string) =>
    owner.auditLog.findMany({ where: { action, entityId } });
  const drift = (itemId: string) =>
    owner.$queryRaw<
      { branch_id: string }[]
    >`SELECT branch_id FROM stock_balance_drift() WHERE item_id = ${itemId}::uuid`;
  const balance = async (itemId: string, state: string) =>
    (
      await owner.stockBalance.findUnique({
        where: {
          branchId_itemId_state: { branchId: w.branchA, itemId, state: state as 'RETURNED' },
        },
      })
    )?.quantity ?? 0;

  beforeAll(async () => {
    w = await createAuthWorld(owner);
    categoryId = (await owner.itemCategory.findFirstOrThrow({ where: { name: 'Vehicles' } })).id;
    app = await createTestApp();
    superAdmin = await loggedIn(app, 'superadmin', SUPER_PASSWORD);
    adminA = await loggedIn(app, 'admin_a');
    adminB = await loggedIn(app, 'admin_b');
    staffA = await loggedIn(app, 'staff_a');
    staffB = await loggedIn(app, 'staff_b');
    await addUser(owner, { username: 'admin_a2', role: 'ADMIN', branchIds: [w.branchA] });
    adminA2 = await loggedIn(app, 'admin_a2');
    expect(
      (
        await superAdmin.post('/roles', {
          name: 'Exchange Viewer',
          tier: 'STAFF',
          permissionCodes: ['invoices.view'],
        })
      ).status,
    ).toBe(201);
    await addUser(owner, {
      username: 'exchange_viewer',
      role: 'Exchange Viewer',
      branchIds: [w.branchA],
    });
    viewer = await loggedIn(app, 'exchange_viewer');
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
        http().get('/exchanges'),
        http().get(`/exchanges/${id}`),
        http().get(`/exchanges/options?invoiceId=${id}`),
        http().post('/exchanges').set('Origin', origin).send({}),
        ...['approve', 'reject', 'cancel'].map((a) =>
          http().post(`/exchanges/${id}/${a}`).set('Origin', origin).send({}),
        ),
      ];
      for (const response of await Promise.all(attempts)) expect(response.status).toBe(401);
    });

    it('lets a viewer read, Staff ask, and only a manager approve or reject', async () => {
      const s = await scene();
      expect((await viewer.get('/exchanges')).status).toBe(200);
      expect((await viewer.get(`/exchanges/options?invoiceId=${s.delivery.id}`)).status).toBe(403);
      expect((await ask(viewer, s)).status).toBe(403);
      const e = await asked(s);
      expect((await viewer.get(`/exchanges/${e.id}`)).status).toBe(200);
      expect((await approve(staffA, e)).status).toBe(403);
      expect(
        (await staffA.post(`/exchanges/${e.id}/reject`, { rowVersion: e.rowVersion, note: 'No' }))
          .status,
      ).toBe(403);
      expect((await approve(adminA, e)).status).toBe(200);
    });
  });

  describe('choosing the vehicles', () => {
    it('lists the vehicle on the delivery invoice and the vehicles sold earlier to the same customer, with their batteries', async () => {
      const s = await scene({ withBattery: true });
      const other = await scene();
      const response = await staffA.get(`/exchanges/options?invoiceId=${s.delivery.id}`);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const options = ExchangeOptionsSchema.parse(response.body);
      expect(options.newUnits.map((u) => u.unitId)).toEqual([s.newUnit.id]);
      expect(options.oldUnits.map((u) => u.unitId)).toEqual([s.oldUnit.id]);
      expect(options.oldUnits[0]).toMatchObject({
        originalInvoiceNo: s.original.invoiceNo,
        lineAmount: '60000.00',
        batteries: [{ id: s.battery?.id }],
      });
      expect(options.oldUnits.map((u) => u.unitId)).not.toContain(other.oldUnit.id);
    });

    it('leaves out vehicles already in an exchange or covered by a credit note, and refuses a delivery invoice that is not issued', async () => {
      const s = await scene();
      await asked(s);
      const after = ExchangeOptionsSchema.parse(
        (await staffA.get(`/exchanges/options?invoiceId=${s.delivery.id}`)).body,
      );
      expect(after.oldUnits).toHaveLength(0);
      expect(after.newUnits).toHaveLength(0);
      const model = await newItem();
      const draft = await staffA.post('/invoices', {
        customerId: s.customerId,
        type: 'NON_GST',
        lines: [
          {
            itemId: model.id,
            qty: 1,
            unitPrice: '1.00',
            discountAmount: '0.00',
            serialUnitId: (await stockUnit(model.id)).id,
          },
        ],
      });
      expect((await staffA.get(`/exchanges/options?invoiceId=${draft.body.id}`)).status).toBe(422);
    });
  });

  describe('asking for an exchange', () => {
    it('works out the difference an old-for-new exchange leaves the customer to pay', async () => {
      const s = await scene();
      const e = await asked(s);
      expect(e).toMatchObject({
        status: 'PENDING',
        kind: 'OLD_FOR_NEW',
        disposition: 'STOCK',
        valuationAmount: '40000.00',
        returnedAmount: '60000.00',
        newAmount: '100000.00',
        differenceAmount: '60000.00',
        settlement: 'PAYABLE',
        customerId: s.customerId,
        invoiceNo: s.delivery.invoiceNo,
        originalInvoiceNo: s.original.invoiceNo,
        oldSerialNo: s.oldUnit.serialNo,
        newSerialNo: s.newUnit.serialNo,
        createdByName: 'Person staff_a',
        tradeInPayment: null,
      });
      expect(e.exchangeNo).toMatch(/EXC\/\d{4}\/\d{5}$/);
      expect((await audits('EXCHANGE_REQUESTED', e.id)).length).toBe(1);
      expect((await unit(s.oldUnit.id)).state).toBe('SOLD');
    });

    it('takes a new-for-new exchange back at exactly the price paid', async () => {
      const s = await scene({ newPrice: '95000.00' });
      const e = await asked(s, { kind: 'NEW_FOR_NEW', valuationAmount: undefined });
      expect(e).toMatchObject({
        kind: 'NEW_FOR_NEW',
        valuationAmount: '60000.00',
        differenceAmount: '35000.00',
        settlement: 'PAYABLE',
      });
      const cheaper = await scene({ oldPrice: '90000.00', newPrice: '80000.00' });
      const credit = await asked(cheaper, { kind: 'NEW_FOR_NEW', valuationAmount: undefined });
      expect(credit).toMatchObject({ differenceAmount: '-10000.00', settlement: 'REFUNDABLE' });
      const even = await scene({ oldPrice: '70000.00', newPrice: '70000.00' });
      expect(
        (await asked(even, { kind: 'NEW_FOR_NEW', valuationAmount: undefined })).settlement,
      ).toBe('EVEN');
    });

    it('refuses a valuation above what was paid, a valuation on a new-for-new exchange and a missing one', async () => {
      const s = await scene();
      const over = await ask(staffA, s, { valuationAmount: '60000.01' });
      expect(over.status).toBe(400);
      expect(over.body.details[0].field).toBe('valuationAmount');
      expect((await ask(staffA, s, { kind: 'NEW_FOR_NEW' })).status).toBe(400);
      expect((await ask(staffA, s, { valuationAmount: undefined })).status).toBe(400);
      expect((await ask(staffA, s, { valuationAmount: '60000.00' })).status).toBe(201);
    });

    it("refuses vehicles that do not fit: not on the invoice, not sold, another customer's, the same one twice", async () => {
      const s = await scene();
      const stranger = await scene();
      const spare = await stockUnit(s.model.id);
      const field = async (over: Record<string, unknown>) => {
        const r = await ask(staffA, s, over);
        expect(r.status, JSON.stringify(over)).toBe(400);
        return r.body.details.map((d: { field: string }) => d.field);
      };
      expect(await field({ newSerialUnitId: spare.id })).toContain('newSerialUnitId');
      expect(await field({ oldSerialUnitId: spare.id })).toContain('oldSerialUnitId');
      expect(await field({ oldSerialUnitId: stranger.oldUnit.id })).toContain('oldSerialUnitId');
      expect(await field({ oldSerialUnitId: s.newUnit.id })).toContain('oldSerialUnitId');
      expect(
        (await ask(staffA, s, { oldSerialUnitId: s.newUnit.id, newSerialUnitId: s.newUnit.id }))
          .status,
      ).toBe(400);
      expect(
        (await ask(staffA, s, { invoiceId: '0b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59' })).status,
      ).toBe(404);
    });

    it('refuses a vehicle given free, since it has no value to take back', async () => {
      const customerId = await newCustomer();
      const model = await newItem();
      const gift = await stockUnit(model.id);
      await sell(customerId, [{ itemId: model.id, unitPrice: '0.00', serialUnitId: gift.id }]);
      const next = await stockUnit(model.id);
      const delivery = await sell(customerId, [
        { itemId: model.id, unitPrice: '50000.00', serialUnitId: next.id },
      ]);
      const r = await staffA.post('/exchanges', {
        invoiceId: delivery.id,
        newSerialUnitId: next.id,
        oldSerialUnitId: gift.id,
        kind: 'OLD_FOR_NEW',
        valuationAmount: '1.00',
        disposition: 'STOCK',
        reason: 'Trying',
      });
      expect(r.status).toBe(400);
    });

    it('lets a vehicle be in one open exchange at a time, in either role, and records one request when two arrive together', async () => {
      const s = await scene();
      const first = await asked(s);
      const again = await ask(staffA, s);
      expect(again.status).toBe(409);
      expect(JSON.stringify(again.body.details)).toContain(first.exchangeNo);
      const t = await scene();
      const results = await Promise.all([ask(staffA, t), ask(adminA, t)]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await owner.exchange.count({ where: { oldSerialUnitId: t.oldUnit.id } })).toBe(1);
      const rejected = await asked(await scene());
      await adminA.post(`/exchanges/${rejected.id}/reject`, {
        rowVersion: rejected.rowVersion,
        note: 'Valuation too high',
      });
      expect(await owner.exchange.count({ where: { status: 'REJECTED' } })).toBeGreaterThan(0);
    });

    it('frees the vehicles again when a request is rejected or withdrawn', async () => {
      const s = await scene();
      const e = await asked(s);
      const rejected = ExchangeSchema.parse(
        (
          await adminA.post(`/exchanges/${e.id}/reject`, {
            rowVersion: e.rowVersion,
            note: 'Valuation too high',
          })
        ).body,
      );
      expect(rejected).toMatchObject({
        status: 'REJECTED',
        decisionNote: 'Valuation too high',
        decidedByName: 'Person admin_a',
      });
      const second = await asked(s, { valuationAmount: '30000.00' });
      const withdrawn = await staffA.post(`/exchanges/${second.id}/cancel`, {
        rowVersion: second.rowVersion,
      });
      expect(ExchangeSchema.parse(withdrawn.body).status).toBe('CANCELLED');
      expect((await ask(staffA, s)).status).toBe(201);
    });

    it('refuses a vehicle a credit note covers, and stops a credit note on a vehicle that is being exchanged', async () => {
      const s = await scene();
      const line = s.original.lines[0];
      const note = await staffA.post('/credit-notes', {
        invoiceId: s.original.id,
        reason: 'Defective',
        lines: [{ invoiceLineId: line?.id, qty: 1 }],
      });
      expect(note.status, JSON.stringify(note.body)).toBe(201);
      const covered = await ask(staffA, s);
      expect(covered.status).toBe(422);
      expect(JSON.stringify(covered.body.details)).toContain('credit note');
      const t = await scene();
      const e = await asked(t);
      const blocked = await staffA.post('/credit-notes', {
        invoiceId: t.original.id,
        reason: 'Defective',
        lines: [{ invoiceLineId: t.original.lines[0]?.id, qty: 1 }],
      });
      expect(blocked.status).toBe(400);
      expect(JSON.stringify(blocked.body.details)).toContain(e.exchangeNo);
      const returnable = (await staffA.get(`/invoices/${t.original.id}/returnable`)).body as {
        returnableQty: number;
      }[];
      expect(returnable[0]?.returnableQty).toBe(0);
    });

    it('stops either invoice being cancelled while the exchange stands', async () => {
      const s = await scene();
      await asked(s);
      for (const invoice of [s.delivery, s.original]) {
        const refused = await adminA.post(`/invoices/${invoice.id}/cancel`, {
          rowVersion: invoice.rowVersion,
          reason: 'Wrong',
        });
        expect(refused.status).toBe(422);
        expect(refused.body.message).toMatch(/exchange/);
      }
    });
  });

  describe('approving an exchange', () => {
    it('takes the old vehicle and its batteries back into stock as returned goods, serial by serial', async () => {
      const s = await scene({ withBattery: true });
      const e = await asked(s);
      const done = await approved(adminA, e);
      expect(done).toMatchObject({ status: 'APPROVED', decidedByName: 'Person admin_a' });
      expect(done.decidedAt).not.toBeNull();
      expect(await unit(s.oldUnit.id)).toMatchObject({ state: 'RETURNED' });
      expect((await unit(s.battery?.id ?? '')).state).toBe('RETURNED');
      expect(
        (await owner.battery.findUniqueOrThrow({ where: { serialUnitId: s.battery?.id ?? '' } }))
          .installedInSerialUnitId,
      ).toBe(s.oldUnit.id);
      expect(
        (await owner.battery.findUniqueOrThrow({ where: { serialUnitId: s.battery?.id ?? '' } }))
          .warrantyEnd,
      ).toBeNull();
      expect((await unit(s.newUnit.id)).state).toBe('SOLD');
      const trail = await owner.stockLedger.findMany({
        where: { serialUnitId: s.oldUnit.id },
        orderBy: { createdAt: 'asc' },
      });
      expect(trail.map((r) => [r.movementType, r.state, r.qtyDelta])).toEqual([
        ['OPENING_BALANCE', 'AVAILABLE', 1],
        ['SALE', 'AVAILABLE', -1],
        ['EXCHANGE_IN', 'RETURNED', 1],
      ]);
      expect(trail[2]).toMatchObject({ sourceDocType: 'EXCHANGE', sourceDocId: e.id });
      expect(await balance(s.model.id, 'RETURNED')).toBeGreaterThanOrEqual(1);
      expect(await drift(s.model.id)).toEqual([]);
      expect((await audits('EXCHANGE_APPROVED', e.id)).length).toBe(1);
      expect(
        await owner.outboxEvent.count({
          where: {
            eventType: 'exchange.approved',
            payload: { path: ['exchangeId'], equals: e.id },
          },
        }),
      ).toBe(1);
    });

    it('scrapes the old vehicle when told to: in and written off, so the ledger shows both', async () => {
      const s = await scene({ withBattery: true });
      const e = await asked(s, { disposition: 'SCRAP' });
      await approved(adminA, e);
      expect((await unit(s.oldUnit.id)).state).toBe('SCRAPPED');
      const trail = await owner.stockLedger.findMany({
        where: { serialUnitId: s.oldUnit.id, sourceDocType: 'EXCHANGE' },
        orderBy: { createdAt: 'asc' },
      });
      expect(trail.map((r) => [r.movementType, r.state, r.qtyDelta])).toEqual([
        ['EXCHANGE_IN', 'DAMAGED', 1],
        ['WRITE_OFF', 'DAMAGED', -1],
      ]);
      expect((await unit(s.battery?.id ?? '')).state).toBe('RETURNED');
      const battery = await owner.battery.findUniqueOrThrow({
        where: { serialUnitId: s.battery?.id ?? '' },
      });
      expect(battery).toMatchObject({
        installedInSerialUnitId: null,
        installedOn: null,
        warrantyEnd: null,
      });
      expect(await drift(s.model.id)).toEqual([]);
    });

    it('pays the valuation in as a trade-in and applies it to the delivery invoice, leaving the difference to pay', async () => {
      const s = await scene();
      const e = await approved(adminA, await asked(s));
      expect(e.tradeInPayment).toMatchObject({ amount: '40000.00', appliedToInvoice: '40000.00' });
      expect(e.tradeInPayment?.receiptNo).toMatch(/RCT\/\d{4}\/\d{5}$/);
      expect(await dueOf(s.delivery.id, s.customerId)).toMatchObject({
        total: '100000.00',
        paid: '40000.00',
        outstanding: '60000.00',
        status: 'PARTIAL',
      });
      const payments = PaymentListResponseSchema.parse(
        (await adminA.get(`/payments?customerId=${s.customerId}`)).body,
      );
      const tradeIn = payments.items.find((p) => p.id === e.tradeInPayment?.id);
      expect(tradeIn).toMatchObject({
        mode: 'EXCHANGE',
        amount: '40000.00',
        reference: e.exchangeNo,
        allocated: '40000.00',
        unallocated: '0.00',
      });
    });

    it('holds what is more than the invoice owes as credit for the customer, which is the refundable difference', async () => {
      const s = await scene({ oldPrice: '90000.00', newPrice: '80000.00' });
      const e = await approved(
        adminA,
        await asked(s, { kind: 'NEW_FOR_NEW', valuationAmount: undefined }),
      );
      expect(e).toMatchObject({ differenceAmount: '-10000.00', settlement: 'REFUNDABLE' });
      expect(e.tradeInPayment).toMatchObject({ amount: '90000.00', appliedToInvoice: '80000.00' });
      expect(await dueOf(s.delivery.id, s.customerId)).toMatchObject({
        paid: '80000.00',
        outstanding: '0.00',
        status: 'PAID',
      });
      const payments = PaymentListResponseSchema.parse(
        (await adminA.get(`/payments?customerId=${s.customerId}&withCredit=true`)).body,
      );
      expect(payments.items[0]).toMatchObject({ mode: 'EXCHANGE', unallocated: '10000.00' });
    });

    it('holds the whole valuation as credit when the delivery invoice was already paid for', async () => {
      const s = await scene();
      const paid = await staffA.post('/payments', {
        customerId: s.customerId,
        mode: 'CASH',
        amount: '100000.00',
        paidOn: today(),
        idempotencyKey: key(),
        allocations: [{ invoiceId: s.delivery.id, amount: '100000.00' }],
      });
      expect(paid.status, JSON.stringify(paid.body)).toBe(201);
      const e = await approved(adminA, await asked(s));
      expect(e.tradeInPayment).toMatchObject({ amount: '40000.00', appliedToInvoice: '0.00' });
      const credit = PaymentListResponseSchema.parse(
        (await adminA.get(`/payments?customerId=${s.customerId}&withCredit=true`)).body,
      );
      expect(credit.items.map((p) => p.unallocated)).toEqual(['40000.00']);
    });

    it("lowers the commission on the old sale by the vehicle's share, alongside credit notes", async () => {
      const broker = BrokerSchema.parse(
        (await adminA.post('/brokers', { name: unique('Broker ') })).body,
      );
      await adminA.post(`/brokers/${broker.id}/rules`, { type: 'PERCENT', value: '10' });
      const s = await scene({ brokerId: broker.id, oldPrice: '60000.00', sparePrice: '40000.00' });
      const commissionOf = async (invoiceId: string) =>
        CommissionListResponseSchema.parse(
          (await adminA.get('/commissions?pageSize=100')).body,
        ).items.find((c) => c.invoiceId === invoiceId);
      expect(await commissionOf(s.original.id)).toMatchObject({
        amount: '10000.00',
        adjusted: '0.00',
      });
      const e = await approved(adminA, await asked(s));
      expect(await commissionOf(s.original.id)).toMatchObject({
        status: 'PAYABLE',
        adjusted: '6000.00',
        effective: '4000.00',
      });
      const adjustment = await owner.commissionAdjustment.findFirstOrThrow({
        where: { exchangeId: e.id },
      });
      expect(adjustment).toMatchObject({ kind: 'EXCHANGE', creditNoteId: null });
      const part = s.original.lines[1];
      const note = await staffA.post('/credit-notes', {
        invoiceId: s.original.id,
        reason: 'Returned',
        lines: [{ invoiceLineId: part?.id, qty: 1 }],
      });
      await adminA.post(`/credit-notes/${note.body.id}/approve`, {
        rowVersion: note.body.rowVersion,
      });
      expect(await commissionOf(s.original.id)).toMatchObject({
        status: 'REVERSED',
        adjusted: '10000.00',
        effective: '0.00',
      });
      expect(
        (await audits('COMMISSION_REDUCED', (await commissionOf(s.original.id))?.id ?? '')).length,
      ).toBe(2);
    });

    it('does not change the commission of the delivery invoice, and shows a paid commission lowered as money to get back', async () => {
      const broker = BrokerSchema.parse(
        (await adminA.post('/brokers', { name: unique('Broker ') })).body,
      );
      await adminA.post(`/brokers/${broker.id}/rules`, { type: 'PERCENT', value: '10' });
      const customerId = await newCustomer();
      const model = await newItem();
      const oldUnit = await stockUnit(model.id);
      const newUnit = await stockUnit(model.id);
      const original = await sell(
        customerId,
        [{ itemId: model.id, unitPrice: '50000.00', serialUnitId: oldUnit.id }],
        { brokerId: broker.id },
      );
      const delivery = await sell(
        customerId,
        [{ itemId: model.id, unitPrice: '80000.00', serialUnitId: newUnit.id }],
        { brokerId: broker.id },
      );
      const list = async () =>
        CommissionListResponseSchema.parse(
          (await adminA.get(`/commissions?brokerId=${broker.id}&pageSize=100`)).body,
        ).items;
      const originalCommission = (await list()).find((c) => c.invoiceId === original.id);
      await adminA.post('/commissions/payout', { commissionIds: [originalCommission?.id] });
      const s = { customerId, model, oldUnit, newUnit, original, delivery, battery: null } as Scene;
      await approved(adminA, await asked(s, { kind: 'NEW_FOR_NEW', valuationAmount: undefined }));
      const after = await list();
      expect(after.find((c) => c.invoiceId === original.id)).toMatchObject({
        status: 'PAID',
        paidAmount: '5000.00',
        adjusted: '5000.00',
        toRecover: '5000.00',
      });
      expect(after.find((c) => c.invoiceId === delivery.id)).toMatchObject({
        amount: '8000.00',
        adjusted: '0.00',
      });
    });

    it('serves the person asking no approval of their own, except a Super Admin, and lets another manager approve', async () => {
      const s = await scene();
      const mine = await asked(s, {}, adminA);
      const refused = await approve(adminA, mine);
      expect(refused.status).toBe(403);
      expect(refused.body.message).toMatch(/asked for/);
      expect((await unit(s.oldUnit.id)).state).toBe('SOLD');
      expect((await approve(adminA2, mine)).status).toBe(200);
      const t = await scene();
      const own = await asked(t, {}, superAdmin);
      expect((await approve(superAdmin, own)).status).toBe(200);
    });

    it('refuses to approve twice or after a rejection, and refuses a stale approval', async () => {
      const s = await scene();
      const e = await asked(s);
      const stale = await approve(adminA, { ...e, rowVersion: e.rowVersion + 3 });
      expect(stale.status).toBe(409);
      const done = await approved(adminA, e);
      expect((await approve(adminA, done)).status).toBe(409);
      const t = await scene();
      const r = await asked(t);
      await adminA.post(`/exchanges/${r.id}/reject`, {
        rowVersion: r.rowVersion,
        note: 'Not needed',
      });
      expect((await approve(adminA, r)).status).toBe(409);
      const u = await scene();
      const w2 = await asked(u);
      expect(
        (await adminA.post(`/exchanges/${w2.id}/reject`, { rowVersion: w2.rowVersion })).status,
      ).toBe(400);
    });

    it('lets two approvals arrive together and approves once, taking the vehicle back once', async () => {
      const s = await scene({ withBattery: true });
      const e = await asked(s);
      const results = await Promise.all([
        approve(adminA, e),
        approve(adminA2, e),
        approve(superAdmin, e),
      ]);
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(await owner.payment.count({ where: { reference: e.exchangeNo } })).toBe(1);
      expect(
        await owner.stockLedger.count({
          where: { serialUnitId: s.oldUnit.id, movementType: 'EXCHANGE_IN' },
        }),
      ).toBe(1);
      expect(await drift(s.model.id)).toEqual([]);
    });

    it('changes nothing when it cannot be done, such as the old vehicle no longer being sold', async () => {
      const s = await scene();
      const e = await asked(s);
      await owner.$executeRaw`UPDATE serial_units SET state = 'DAMAGED' WHERE id = ${s.oldUnit.id}::uuid`;
      const refused = await approve(adminA, e);
      expect(refused.status).toBe(422);
      expect(ExchangeSchema.parse((await adminA.get(`/exchanges/${e.id}`)).body).status).toBe(
        'PENDING',
      );
      expect(await owner.payment.count({ where: { reference: e.exchangeNo } })).toBe(0);
    });

    it('keeps the payment mode for exchanges to exchanges', async () => {
      const s = await scene();
      const direct = await staffA.post('/payments', {
        customerId: s.customerId,
        mode: 'EXCHANGE',
        amount: '10.00',
        paidOn: today(),
        idempotencyKey: key(),
      });
      expect(direct.status).toBe(400);
      expect(direct.body.details[0].field).toBe('mode');
      const q = await staffA.post('/payments', {
        customerId: s.customerId,
        mode: 'CASH',
        amount: '10.00',
        paidOn: today(),
        idempotencyKey: key(),
      });
      expect(q.status).toBe(201);
    });
  });

  describe('the database guards', () => {
    it('refuses to change the terms of an exchange, or a decided one at all', async () => {
      const s = await scene();
      const e = await asked(s);
      await expect(
        owner.$executeRaw`UPDATE exchanges SET valuation_amount = 1 WHERE id = ${e.id}::uuid`,
      ).rejects.toThrow(/terms of an exchange/);
      await expect(
        owner.$executeRaw`UPDATE exchanges SET disposition = 'SCRAP' WHERE id = ${e.id}::uuid`,
      ).rejects.toThrow(/terms of an exchange/);
      await approved(adminA, e);
      await expect(
        owner.$executeRaw`UPDATE exchanges SET status = 'REJECTED' WHERE id = ${e.id}::uuid`,
      ).rejects.toThrow(/decided exchange/);
      await expect(
        owner.$executeRaw`UPDATE exchanges SET decision_note = 'changed' WHERE id = ${e.id}::uuid`,
      ).rejects.toThrow(/decided exchange/);
    });

    it('refuses an exchange whose figures do not add up, or whose invoices do not fit', async () => {
      const s = await scene();
      const other = await scene();
      const base = {
        branchId: w.branchA,
        invoiceId: s.delivery.id,
        originalInvoiceId: s.original.id,
        oldSerialUnitId: s.oldUnit.id,
        newSerialUnitId: s.newUnit.id,
        exchangeNo: unique('EXC'),
        kind: 'OLD_FOR_NEW',
        returnedAmount: '60000.00',
        returnedTaxable: '60000.00',
        valuationAmount: '40000.00',
        newAmount: '100000.00',
        differenceAmount: '60000.00',
        disposition: 'STOCK',
        reason: 'Test',
      };
      const make = (over: Record<string, unknown>) =>
        owner.exchange.create({ data: { ...base, ...over, exchangeNo: unique('EXC') } as never });
      await expect(make({ differenceAmount: '1.00' })).rejects.toThrow(
        /chk_exchanges_difference|difference/,
      );
      await expect(
        make({ valuationAmount: '60000.01', differenceAmount: '39999.99' }),
      ).rejects.toThrow();
      await expect(make({ kind: 'NEW_FOR_NEW' })).rejects.toThrow();
      await expect(make({ originalInvoiceId: s.delivery.id })).rejects.toThrow();
      await expect(make({ originalInvoiceId: other.original.id })).rejects.toThrow(
        /same customer|not on the invoice/,
      );
      await expect(make({ newSerialUnitId: other.newUnit.id })).rejects.toThrow(/delivery invoice/);
      await expect(make({ oldSerialUnitId: other.oldUnit.id })).rejects.toThrow(
        /invoice it was sold on/,
      );
      await expect(make({ branchId: w.branchB })).rejects.toThrow(/branch/);
    });

    it('refuses a credit note line for a vehicle in an open exchange, directly in the database', async () => {
      const s = await scene();
      await asked(s);
      const note = await owner.creditNote.create({
        data: {
          branchId: w.branchA,
          invoiceId: s.original.id,
          reason: 'Direct',
          amount: '1.00',
          taxableValue: '1.00',
          status: 'PENDING',
        },
      });
      await expect(
        owner.creditNoteLine.create({
          data: {
            branchId: w.branchA,
            creditNoteId: note.id,
            invoiceLineId: s.original.lines[0]?.id ?? '',
            itemId: s.model.id,
            serialUnitId: s.oldUnit.id,
            lineNo: 1,
            qty: 1,
            taxableAmount: '1.00',
            amount: '1.00',
          },
        }),
      ).rejects.toThrow(/part of an exchange/);
    });

    it('keeps one open exchange per vehicle and never lets an adjustment take more than the commission', async () => {
      const s = await scene();
      const e = await asked(s);
      await expect(
        owner.exchange.create({
          data: {
            branchId: w.branchA,
            invoiceId: s.delivery.id,
            originalInvoiceId: s.original.id,
            oldSerialUnitId: s.oldUnit.id,
            newSerialUnitId: s.newUnit.id,
            exchangeNo: unique('EXC'),
            kind: 'OLD_FOR_NEW',
            returnedAmount: '60000.00',
            returnedTaxable: '60000.00',
            valuationAmount: '40000.00',
            newAmount: '100000.00',
            differenceAmount: '60000.00',
            disposition: 'STOCK',
            reason: 'Again',
          },
        }),
      ).rejects.toThrow(/duplicate|unique/i);
      expect(e.status).toBe('PENDING');
    });
  });

  describe('finding exchanges', () => {
    it('filters by status, kind and search, and pages the result', async () => {
      const s = await scene();
      const a = await asked(s);
      const t = await scene({ newPrice: '95000.00' });
      const b = await asked(t, { kind: 'NEW_FOR_NEW', valuationAmount: undefined });
      await approved(adminA, b);
      const ids = async (qs: string) =>
        ExchangeListResponseSchema.parse((await adminA.get(`/exchanges?${qs}`)).body).items.map(
          (i) => i.id,
        );
      expect(await ids(`search=${a.exchangeNo}`)).toEqual([a.id]);
      expect(await ids(`search=${s.oldUnit.serialNo}`)).toEqual([a.id]);
      expect(await ids(`search=${t.newUnit.serialNo}`)).toEqual([b.id]);
      expect(await ids(`customerId=${s.customerId}`)).toEqual([a.id]);
      expect(await ids(`customerId=${t.customerId}&status=APPROVED`)).toEqual([b.id]);
      expect(await ids(`customerId=${t.customerId}&status=PENDING`)).toEqual([]);
      expect(await ids(`customerId=${t.customerId}&kind=NEW_FOR_NEW`)).toEqual([b.id]);
      expect(await ids(`customerId=${t.customerId}&kind=OLD_FOR_NEW`)).toEqual([]);
      const page = ExchangeListResponseSchema.parse(
        (await adminA.get('/exchanges?pageSize=1&page=2&sortBy=differenceAmount&sortOrder=asc'))
          .body,
      );
      expect(page.page).toBe(2);
      expect((await adminA.get('/exchanges?sortBy=reason')).status).toBe(400);
      expect((await adminA.get('/exchanges?status=DONE')).status).toBe(400);
    });
  });

  describe('branch isolation', () => {
    it("hides one branch's exchanges from another and refuses every change", async () => {
      const s = await scene();
      const e = await asked(s);
      expect((await staffB.get(`/exchanges/${e.id}`)).status).toBe(404);
      expect((await staffB.get(`/exchanges/options?invoiceId=${s.delivery.id}`)).status).toBe(404);
      expect(
        ExchangeListResponseSchema.parse(
          (await staffB.get(`/exchanges?search=${e.exchangeNo}`)).body,
        ).items,
      ).toHaveLength(0);
      expect((await approve(adminB, e)).status).toBe(404);
      expect(
        (
          await adminB.post(`/exchanges/${e.id}/reject`, {
            rowVersion: e.rowVersion,
            note: 'Not mine',
          })
        ).status,
      ).toBe(404);
      expect(
        (await staffB.post(`/exchanges/${e.id}/cancel`, { rowVersion: e.rowVersion })).status,
      ).toBe(404);
      expect((await ask(staffB, s)).status).toBe(404);
      expect((await adminA.get(`/exchanges/${e.id}`)).status).toBe(200);
      expect((await unit(s.oldUnit.id)).state).toBe('SOLD');
    });

    it('lets only the person who asked withdraw a request', async () => {
      const s = await scene();
      const e = await asked(s);
      expect(
        (await adminA.post(`/exchanges/${e.id}/cancel`, { rowVersion: e.rowVersion })).status,
      ).toBe(403);
      expect(
        (await staffA.post(`/exchanges/${e.id}/cancel`, { rowVersion: e.rowVersion })).status,
      ).toBe(200);
      expect(
        (await staffA.post(`/exchanges/${e.id}/cancel`, { rowVersion: e.rowVersion + 1 })).status,
      ).toBe(409);
    });
  });
});
