import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  InvoiceListResponseSchema,
  InvoicePreviewSchema,
  InvoiceSchema,
  addMonths,
  todayInIndia,
} from '@erp/contracts';
import type { Invoice } from '@erp/contracts';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAuthWorld, loggedIn, SUPER_PASSWORD } from '../support/auth-world.js';
import type { AuthWorld, TestClient } from '../support/auth-world.js';
import { createTestApp } from '../support/create-test-app.js';
import { createOwnerPrisma } from '../support/fixtures.js';

const GSTIN_A = '27AAPFU0939F1ZV';
const GSTIN_B = '27AABCT1332L1ZX';

describe('billing and invoices', () => {
  let app: NestExpressApplication;
  let w: AuthWorld;
  let superAdmin: TestClient;
  let adminA: TestClient;
  let staffA: TestClient;
  let adminB: TestClient;
  let staffB: TestClient;
  let categoryId: string;
  let karnataka: string;
  let noState: string;
  const owner = createOwnerPrisma();
  let counter = 0;
  const unique = (prefix: string): string =>
    `${prefix}${(counter += 1).toString().padStart(4, '0')}`;
  const shift = (days: number): string =>
    new Date(Date.parse(`${todayInIndia()}T00:00:00Z`) + days * 86_400_000)
      .toISOString()
      .slice(0, 10);

  const newItem = (opts: { serialized?: boolean; tax?: string | null; active?: boolean } = {}) =>
    owner.item.create({
      data: {
        itemCode: unique('BIL'),
        name: 'Billing test item',
        categoryId,
        unitCode: 'PCS',
        isSerialized: opts.serialized ?? false,
        isActive: opts.active ?? true,
        ...(opts.tax === null ? {} : { hsnCode: '8703', taxRate: opts.tax ?? '18' }),
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
  const unitState = async (id: string) =>
    (await owner.serialUnit.findUniqueOrThrow({ where: { id } })).state;

  const line = (itemId: string, over: object = {}) => ({
    itemId,
    qty: 1,
    unitPrice: '1000.00',
    ...over,
  });
  const payload = (lines: object[], over: object = {}) => ({
    customerId: w.customerId,
    type: 'GST',
    lines,
    ...over,
  });
  const draft = async (
    client: TestClient,
    lines: object[],
    over: object = {},
  ): Promise<Invoice> => {
    const response = await client.post('/invoices', payload(lines, over));
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return InvoiceSchema.parse(response.body);
  };
  const issue = (client: TestClient, invoice: Invoice, extra: object = {}) =>
    client.post(`/invoices/${invoice.id}/issue`, { rowVersion: invoice.rowVersion, ...extra });
  const sell = async (client: TestClient, lines: object[], over: object = {}): Promise<Invoice> => {
    const created = await draft(client, lines, over);
    const response = await issue(client, created);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return InvoiceSchema.parse(response.body);
  };
  const cancel = (client: TestClient, invoice: Invoice, reason = 'Wrong customer') =>
    client.post(`/invoices/${invoice.id}/cancel`, { rowVersion: invoice.rowVersion, reason });
  const nextNumber = (no: string): number => Number(no.slice(no.lastIndexOf('/') + 1));

  beforeAll(async () => {
    w = await createAuthWorld(owner);
    categoryId = (await owner.itemCategory.findFirstOrThrow({ where: { name: 'Vehicles' } })).id;
    await owner.branch.update({ where: { id: w.branchA }, data: { gstin: GSTIN_A } });
    karnataka = (
      await owner.customer.create({ data: { name: 'Kiran', phone: '9000000002', stateCode: '29' } })
    ).id;
    noState = (await owner.customer.create({ data: { name: 'Neha', phone: '9000000003' } })).id;
    app = await createTestApp();
    superAdmin = await loggedIn(app, 'superadmin', SUPER_PASSWORD);
    adminA = await loggedIn(app, 'admin_a');
    staffA = await loggedIn(app, 'staff_a');
    adminB = await loggedIn(app, 'admin_b');
    staffB = await loggedIn(app, 'staff_b');
    return async () => {
      await app.close();
      await owner.$disconnect();
    };
  });

  describe('who may call what', () => {
    it('answers every endpoint with 401 when signed out', async () => {
      const id = w.customerId;
      const origin = 'http://localhost:5173';
      const http = () => request(app.getHttpServer());
      const attempts = [
        http().get('/invoices'),
        http().get(`/invoices/${id}`),
        http().get(`/invoices/${id}/pdf`),
        http().post('/invoices/preview').set('Origin', origin).send({}),
        http().post('/invoices').set('Origin', origin).send({}),
        http().patch(`/invoices/${id}`).set('Origin', origin).send({}),
        http().post(`/invoices/${id}/discard`).set('Origin', origin).send({}),
        http().post(`/invoices/${id}/issue`).set('Origin', origin).send({}),
        http().post(`/invoices/${id}/cancel`).set('Origin', origin).send({}),
        http().post(`/invoices/${id}/reissue`).set('Origin', origin).send({}),
      ];
      for (const response of await Promise.all(attempts)) expect(response.status).toBe(401);
    });

    it('lets Staff raise and issue invoices but not cancel or reissue them', async () => {
      const item = await newItem();
      await seedPlain(item.id, w.branchA, 5);
      const invoice = await sell(staffA, [line(item.id)]);
      expect((await staffA.get(`/invoices/${invoice.id}`)).status).toBe(200);
      expect((await cancel(staffA, invoice)).status).toBe(403);
      const reissue = await staffA.post(`/invoices/${invoice.id}/reissue`, {
        rowVersion: invoice.rowVersion,
        reason: 'Fix it',
      });
      expect(reissue.status).toBe(403);
      expect((await cancel(adminA, invoice)).status).toBe(200);
    });
  });

  describe('drafts and tax', () => {
    it('works out CGST and SGST for a sale inside the state, from the item and not from the request', async () => {
      const item = await newItem({ tax: '18' });
      const response = await staffA.post(
        '/invoices',
        payload([line(item.id, { qty: 2, taxRate: '0', cgstAmount: '1.00', total: '1.00' })], {
          total: '1.00',
        }),
      );
      expect(response.status).toBe(201);
      const invoice = InvoiceSchema.parse(response.body);
      expect(invoice).toMatchObject({
        status: 'DRAFT',
        invoiceNo: null,
        interState: false,
        placeOfSupply: '27',
        subtotal: '2000.00',
        cgstAmount: '180.00',
        sgstAmount: '180.00',
        igstAmount: '0.00',
        total: '2360.00',
      });
      expect(invoice.lines[0]).toMatchObject({
        hsnCode: '8703',
        taxRate: '18.00',
        taxableAmount: '2000.00',
        amount: '2360.00',
      });
      expect(await audits('INVOICE_DRAFT_CREATED', invoice.id)).toHaveLength(1);
    });

    it('charges IGST alone when the customer is in another state', async () => {
      const item = await newItem({ tax: '18' });
      const invoice = await draft(staffA, [line(item.id, { qty: 2 })], { customerId: karnataka });
      expect(invoice).toMatchObject({
        interState: true,
        placeOfSupply: '29',
        igstAmount: '360.00',
        cgstAmount: '0.00',
        sgstAmount: '0.00',
        total: '2360.00',
      });
    });

    it('uses the branch state when the customer has none, and charges no tax on an invoice without GST', async () => {
      const item = await newItem({ tax: '18' });
      const inState = await draft(staffA, [line(item.id)], { customerId: noState });
      expect(inState).toMatchObject({
        placeOfSupply: '27',
        interState: false,
        cgstAmount: '90.00',
      });
      const plain = await draft(staffA, [line(item.id)], {
        type: 'NON_GST',
        customerId: karnataka,
      });
      expect(plain).toMatchObject({ cgstAmount: '0.00', igstAmount: '0.00', total: '1000.00' });
      expect(plain.lines[0]).toMatchObject({ hsnCode: null, taxRate: null });
    });

    it('rounds the total to the rupee and keeps the round-off, taxing the price after the discount', async () => {
      const item = await newItem({ tax: '5' });
      const invoice = await draft(staffA, [
        line(item.id, { unitPrice: '100.45', discountAmount: '5.00' }),
      ]);
      expect(invoice).toMatchObject({
        taxableValue: '95.45',
        cgstAmount: '2.38',
        sgstAmount: '2.39',
        total: '100.00',
        roundOff: '-0.22',
      });
    });

    it('shows a preview that matches the saved draft and stores nothing', async () => {
      const item = await newItem({ tax: '18' });
      const before = await owner.invoice.count();
      const lines = [line(item.id, { qty: 3, unitPrice: '199.99', discountAmount: '10.00' })];
      const response = await staffA.post('/invoices/preview', payload(lines));
      expect(response.status).toBe(200);
      const preview = InvoicePreviewSchema.parse(response.body);
      expect(await owner.invoice.count()).toBe(before);
      const saved = await draft(staffA, lines);
      expect(preview).toMatchObject({
        subtotal: saved.subtotal,
        taxableValue: saved.taxableValue,
        cgstAmount: saved.cgstAmount,
        sgstAmount: saved.sgstAmount,
        total: saved.total,
        roundOff: saved.roundOff,
      });
    });

    it('refuses bad lines with a message for each', async () => {
      const gstFree = await newItem({ tax: null });
      const inactive = await newItem({ active: false });
      const serialItem = await newItem({ serialized: true });
      const plainItem = await newItem();
      const otherItemUnit = await seedUnit(
        (await newItem({ serialized: true })).id,
        w.branchA,
        unique('SN'),
      );
      const foreignUnit = await seedUnit(serialItem.id, w.branchB, unique('SN'));
      const response = await staffA.post(
        '/invoices',
        payload([
          line(gstFree.id),
          line(inactive.id),
          line(serialItem.id),
          line(plainItem.id, { serialUnitId: otherItemUnit.id }),
          line(serialItem.id, { serialUnitId: foreignUnit.id }),
          line('00000000-0000-4000-8000-000000000000'),
        ]),
      );
      expect(response.status).toBe(400);
      const fields = response.body.details.map((d: { field: string }) => d.field);
      expect(fields).toEqual(
        expect.arrayContaining([
          'lines.0.itemId',
          'lines.1.itemId',
          'lines.2.serialUnitId',
          'lines.3.serialUnitId',
          'lines.4.serialUnitId',
          'lines.5.itemId',
        ]),
      );
    });

    it('refuses nonsense numbers, a discount above the price, repeated units and unknown customers', async () => {
      const item = await newItem();
      const unit = await seedUnit(
        (await newItem({ serialized: true })).id,
        w.branchA,
        unique('SN'),
      );
      const bad = async (lines: object[], over: object = {}) =>
        (await staffA.post('/invoices', payload(lines, over))).status;
      expect(await bad([])).toBe(400);
      expect(await bad([line(item.id, { qty: 0 })])).toBe(400);
      expect(await bad([line(item.id, { qty: 1.5 })])).toBe(400);
      expect(await bad([line(item.id, { unitPrice: 'abc' })])).toBe(400);
      expect(await bad([line(item.id, { unitPrice: '-5' })])).toBe(400);
      expect(await bad([line(item.id, { unitPrice: '10.123' })])).toBe(400);
      expect(await bad([line(item.id, { serialUnitId: unit.id, qty: 2 })])).toBe(400);
      expect(await bad([line(item.id, { unitPrice: '100.00', discountAmount: '100.01' })])).toBe(
        400,
      );
      expect(
        await bad([
          line(unit.itemId, { serialUnitId: unit.id }),
          line(unit.itemId, { serialUnitId: unit.id }),
        ]),
      ).toBe(400);
      expect(
        await bad([line(item.id)], { customerId: '00000000-0000-4000-8000-000000000000' }),
      ).toBe(400);
      expect(await bad([line(item.id)], { type: 'CASH' })).toBe(400);
    });

    it('replaces the lines of a draft, refuses a stale edit and refuses editing an issued invoice', async () => {
      const item = await newItem({ tax: '5' });
      await seedPlain(item.id, w.branchA, 10);
      const first = await draft(staffA, [line(item.id, { qty: 1 })]);
      const edited = await staffA.patch(`/invoices/${first.id}`, {
        ...payload([line(item.id, { qty: 4, unitPrice: '250.00' })]),
        rowVersion: first.rowVersion,
      });
      expect(edited.status).toBe(200);
      const updated = InvoiceSchema.parse(edited.body);
      expect(updated.subtotal).toBe('1000.00');
      expect(updated.lines).toHaveLength(1);
      expect(updated.rowVersion).toBeGreaterThan(first.rowVersion);
      const stale = await staffA.patch(`/invoices/${first.id}`, {
        ...payload([line(item.id)]),
        rowVersion: first.rowVersion,
      });
      expect(stale.status).toBe(409);
      const issued = await issue(staffA, updated);
      expect(issued.status).toBe(200);
      const late = await staffA.patch(`/invoices/${first.id}`, {
        ...payload([line(item.id)]),
        rowVersion: issued.body.rowVersion,
      });
      expect(late.status).toBe(409);
    });

    it('discards a draft but never an issued invoice', async () => {
      const item = await newItem();
      await seedPlain(item.id, w.branchA, 3);
      const mine = await draft(staffA, [line(item.id)]);
      expect(
        (await staffA.post(`/invoices/${mine.id}/discard`, { rowVersion: mine.rowVersion })).status,
      ).toBe(204);
      expect((await staffA.get(`/invoices/${mine.id}`)).status).toBe(404);
      expect(await audits('INVOICE_DRAFT_DISCARDED', mine.id)).toHaveLength(1);
      const sold = await sell(staffA, [line(item.id)]);
      const refused = await staffA.post(`/invoices/${sold.id}/discard`, {
        rowVersion: sold.rowVersion,
      });
      expect(refused.status).toBe(422);
    });
  });

  describe('issuing an invoice', () => {
    it('numbers it, takes the stock out, records the sale and snapshots both GSTINs', async () => {
      const item = await newItem({ tax: '18' });
      await seedPlain(item.id, w.branchA, 10);
      const invoice = await sell(staffA, [line(item.id, { qty: 3 })]);
      expect(invoice.invoiceNo).toMatch(/^AAG\/\d{4}\/\d{5}$/);
      expect(invoice).toMatchObject({
        status: 'ISSUED',
        issuedOn: todayInIndia(),
        branchGstin: GSTIN_A,
        customerGstin: null,
        total: '3540.00',
      });
      expect(await quantity(item.id, w.branchA)).toBe(7);
      const sale = await owner.stockLedger.findFirstOrThrow({
        where: { itemId: item.id, movementType: 'SALE' },
      });
      expect(sale).toMatchObject({
        qtyDelta: -3,
        sourceDocType: 'INVOICE',
        sourceDocId: invoice.id,
      });
      expect(await drift(item.id)).toEqual([]);
      expect(await audits('INVOICE_ISSUED', invoice.id)).toHaveLength(1);
      expect(
        await owner.outboxEvent.count({
          where: {
            eventType: 'invoice.issued',
            payload: { path: ['invoiceId'], equals: invoice.id },
          },
        }),
      ).toBe(1);
    });

    it('uses a separate number series for invoices without GST', async () => {
      const item = await newItem();
      await seedPlain(item.id, w.branchA, 3);
      const plain = await sell(staffA, [line(item.id)], { type: 'NON_GST' });
      expect(plain.invoiceNo).toMatch(/^AAN\/\d{4}\//);
      expect(plain.branchGstin).toBeNull();
    });

    it('refuses to issue a GST invoice from a branch that has no GSTIN', async () => {
      const item = await newItem();
      await seedPlain(item.id, w.branchB, 3);
      const created = await draft(staffB, [line(item.id)]);
      const response = await issue(staffB, created);
      expect(response.status).toBe(422);
      expect(response.body.message).toMatch(/no GSTIN/);
      expect(await quantity(item.id, w.branchB)).toBe(3);
      await owner.branch.update({ where: { id: w.branchB }, data: { gstin: GSTIN_B } });
      expect((await issue(staffB, created)).status).toBe(200);
      expect(await quantity(item.id, w.branchB)).toBe(2);
    });

    it('refuses to issue twice and refuses a stale version', async () => {
      const item = await newItem();
      await seedPlain(item.id, w.branchA, 5);
      const created = await draft(staffA, [line(item.id)]);
      const stale = await staffA.post(`/invoices/${created.id}/issue`, {
        rowVersion: created.rowVersion + 5,
      });
      expect(stale.status).toBe(409);
      expect((await issue(staffA, created)).status).toBe(200);
      expect((await issue(staffA, created)).status).toBe(409);
      expect(await quantity(item.id, w.branchA)).toBe(4);
    });

    it('does not use up a number, or any stock, when there is not enough stock', async () => {
      const item = await newItem();
      const other = await newItem();
      await seedPlain(other.id, w.branchA, 10);
      const first = await sell(staffA, [line(other.id)]);
      const failing = await draft(staffA, [line(other.id), line(item.id, { qty: 2 })]);
      const refused = await issue(staffA, failing);
      expect(refused.status).toBe(422);
      expect(refused.body.message).toMatch(/not enough available stock/);
      expect(await quantity(other.id, w.branchA)).toBe(9);
      expect((await staffA.get(`/invoices/${failing.id}`)).body.status).toBe('DRAFT');
      await seedPlain(item.id, w.branchA, 2);
      const second = await issue(staffA, failing);
      expect(second.status).toBe(200);
      expect(nextNumber(second.body.invoiceNo)).toBe(nextNumber(first.invoiceNo ?? '') + 1);
      expect(await drift(other.id)).toEqual([]);
    });

    it('gives consecutive numbers with no gaps when many invoices are issued at once', async () => {
      const item = await newItem();
      await seedPlain(item.id, w.branchA, 20);
      const drafts = await Promise.all(
        Array.from({ length: 8 }, () => draft(staffA, [line(item.id)])),
      );
      const results = await Promise.all(drafts.map((d) => issue(staffA, d)));
      expect(results.every((r) => r.status === 200)).toBe(true);
      const numbers = results.map((r) => nextNumber(r.body.invoiceNo)).sort((a, b) => a - b);
      expect(new Set(numbers).size).toBe(8);
      expect(numbers.at(-1)! - numbers[0]!).toBe(7);
      expect(await quantity(item.id, w.branchA)).toBe(12);
      expect(await drift(item.id)).toEqual([]);
    });

    it('lets only one of two invoices have the last unit of a serial item', async () => {
      const item = await newItem({ serialized: true });
      const unit = await seedUnit(item.id, w.branchA, unique('SN'));
      const a = await draft(staffA, [line(item.id, { serialUnitId: unit.id })]);
      const b = await draft(staffA, [line(item.id, { serialUnitId: unit.id })]);
      const results = await Promise.all([issue(staffA, a), issue(staffA, b)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 422]);
      expect(await unitState(unit.id)).toBe('SOLD');
      expect(await quantity(item.id, w.branchA)).toBe(0);
      expect(await drift(item.id)).toEqual([]);
    });

    it('sells a serial unit, and refuses a unit that is reserved', async () => {
      const item = await newItem({ serialized: true });
      const free = await seedUnit(item.id, w.branchA, unique('SN'));
      const held = await seedUnit(item.id, w.branchA, unique('SN'), 'RESERVED');
      const invoice = await sell(staffA, [line(item.id, { serialUnitId: free.id })]);
      expect(invoice.lines[0]?.serialNo).toBe(free.serialNo);
      expect(await unitState(free.id)).toBe('SOLD');
      const refused = await issue(
        staffA,
        await draft(staffA, [line(item.id, { serialUnitId: held.id })]),
      );
      expect(refused.status).toBe(422);
      expect(refused.body.message).toMatch(/not available to sell/);
      expect(await unitState(held.id)).toBe('RESERVED');
    });
  });

  describe('discounts', () => {
    it('lets Staff give up to 5% of a line and asks a manager for more', async () => {
      const item = await newItem({ tax: '5' });
      await seedPlain(item.id, w.branchA, 10);
      expect(
        (await issue(staffA, await draft(staffA, [line(item.id, { discountAmount: '50.00' })])))
          .status,
      ).toBe(200);
      const big = await draft(staffA, [line(item.id, { discountAmount: '50.01' })]);
      const refused = await issue(staffA, big);
      expect(refused.status).toBe(403);
      expect(refused.body.message).toMatch(/Ask a manager/);
      expect((await staffA.get(`/invoices/${big.id}`)).body.status).toBe('DRAFT');
      const approved = await issue(adminA, big);
      expect(approved.status).toBe(200);
      expect((await audits('INVOICE_ISSUED', big.id))[0]?.newValue).toMatchObject({
        discountApproved: true,
      });
    });
  });

  describe('batteries', () => {
    const newBattery = async (expiryOn: string, months: number | null = 12) => {
      const item = await newItem({ serialized: true });
      const unit = await seedUnit(item.id, w.branchA, unique('BAT'));
      await owner.battery.create({
        data: {
          serialUnitId: unit.id,
          manufacturedOn: new Date(`${shift(-100)}T00:00:00Z`),
          expiryOn: new Date(`${expiryOn}T00:00:00Z`),
          warrantyMonths: months,
        },
      });
      return { item, unit };
    };

    it('starts the warranty on the day of sale', async () => {
      const { item, unit } = await newBattery(shift(200), 12);
      await sell(staffA, [line(item.id, { serialUnitId: unit.id })]);
      const battery = await owner.battery.findUniqueOrThrow({ where: { serialUnitId: unit.id } });
      expect(battery.warrantyEnd?.toISOString().slice(0, 10)).toBe(addMonths(todayInIndia(), 12));
    });

    it('refuses an expired battery without a reason, and from someone who may not override', async () => {
      const { item, unit } = await newBattery(shift(-1));
      const created = await draft(staffA, [line(item.id, { serialUnitId: unit.id })]);
      const bare = await issue(staffA, created);
      expect(bare.status).toBe(422);
      expect(bare.body.message).toMatch(/cannot be sold without an override/);
      const staff = await issue(staffA, created, { overrideReason: 'Customer agreed' });
      expect(staff.status).toBe(403);
      expect(await unitState(unit.id)).toBe('AVAILABLE');
    });

    it('lets a manager sell an expired battery with a reason, and audits the override', async () => {
      const { item, unit } = await newBattery(shift(-1));
      const created = await draft(adminA, [line(item.id, { serialUnitId: unit.id })]);
      const response = await issue(adminA, created, { overrideReason: 'Customer agreed' });
      expect(response.status).toBe(200);
      expect(await unitState(unit.id)).toBe('SOLD');
      expect(
        await owner.auditLog.count({
          where: { action: 'BATTERY_EXPIRY_OVERRIDDEN', entityId: unit.id },
        }),
      ).toBe(1);
    });

    it('sells the batteries fitted to a vehicle with the vehicle, and starts their warranty', async () => {
      const vehicleItem = await newItem({ serialized: true });
      const vehicle = await seedUnit(vehicleItem.id, w.branchA, unique('VEH'));
      const { item: batteryItem, unit: battery } = await newBattery(shift(300), 6);
      await owner.serialUnit.update({ where: { id: battery.id }, data: { state: 'RESERVED' } });
      await owner.stockBalance.update({
        where: {
          branchId_itemId_state: {
            branchId: w.branchA,
            itemId: batteryItem.id,
            state: 'AVAILABLE',
          },
        },
        data: { quantity: 0 },
      });
      await owner.stockBalance.create({
        data: { branchId: w.branchA, itemId: batteryItem.id, state: 'RESERVED', quantity: 1 },
      });
      await owner.stockLedger.create({
        data: {
          branchId: w.branchA,
          itemId: batteryItem.id,
          serialUnitId: battery.id,
          state: 'AVAILABLE',
          qtyDelta: -1,
          movementType: 'STATE_CHANGE',
        },
      });
      await owner.stockLedger.create({
        data: {
          branchId: w.branchA,
          itemId: batteryItem.id,
          serialUnitId: battery.id,
          state: 'RESERVED',
          qtyDelta: 1,
          movementType: 'STATE_CHANGE',
        },
      });
      await owner.battery.update({
        where: { serialUnitId: battery.id },
        data: {
          installedInSerialUnitId: vehicle.id,
          installedOn: new Date(`${shift(-1)}T00:00:00Z`),
        },
      });

      await sell(staffA, [line(vehicleItem.id, { serialUnitId: vehicle.id })]);
      expect(await unitState(vehicle.id)).toBe('SOLD');
      expect(await unitState(battery.id)).toBe('SOLD');
      expect(await quantity(batteryItem.id, w.branchA, 'RESERVED')).toBe(0);
      const details = await owner.battery.findUniqueOrThrow({
        where: { serialUnitId: battery.id },
      });
      expect(details.warrantyEnd?.toISOString().slice(0, 10)).toBe(addMonths(todayInIndia(), 6));
      expect(await drift(batteryItem.id)).toEqual([]);
      expect(await drift(vehicleItem.id)).toEqual([]);
    });
  });

  describe('cancelling and reissuing', () => {
    it('puts the stock back, keeps the number and records who cancelled and why', async () => {
      const item = await newItem({ serialized: true });
      const unit = await seedUnit(item.id, w.branchA, unique('SN'));
      const plain = await newItem();
      await seedPlain(plain.id, w.branchA, 5);
      const invoice = await sell(staffA, [
        line(item.id, { serialUnitId: unit.id }),
        line(plain.id, { qty: 2 }),
      ]);
      expect(await quantity(plain.id, w.branchA)).toBe(3);
      const response = await cancel(adminA, invoice, 'Customer changed their mind');
      expect(response.status).toBe(200);
      const cancelled = InvoiceSchema.parse(response.body);
      expect(cancelled).toMatchObject({
        status: 'CANCELLED',
        invoiceNo: invoice.invoiceNo,
        cancelReason: 'Customer changed their mind',
      });
      expect(cancelled.cancelledByName).toBeTruthy();
      expect(await unitState(unit.id)).toBe('AVAILABLE');
      expect(await quantity(plain.id, w.branchA)).toBe(5);
      expect(await quantity(item.id, w.branchA)).toBe(1);
      expect(await drift(plain.id)).toEqual([]);
      expect(await drift(item.id)).toEqual([]);
      expect(await audits('INVOICE_CANCELLED', invoice.id)).toHaveLength(1);
      const back = await owner.stockLedger.findFirstOrThrow({
        where: { itemId: plain.id, movementType: 'SALE_RETURN' },
      });
      expect(back.qtyDelta).toBe(2);
    });

    it('clears the warranty of a battery that goes back into stock', async () => {
      const item = await newItem({ serialized: true });
      const unit = await seedUnit(item.id, w.branchA, unique('BAT'));
      await owner.battery.create({
        data: {
          serialUnitId: unit.id,
          expiryOn: new Date(`${shift(300)}T00:00:00Z`),
          warrantyMonths: 12,
        },
      });
      const invoice = await sell(staffA, [line(item.id, { serialUnitId: unit.id })]);
      expect(
        (await owner.battery.findUniqueOrThrow({ where: { serialUnitId: unit.id } })).warrantyEnd,
      ).not.toBeNull();
      await cancel(adminA, invoice);
      expect(
        (await owner.battery.findUniqueOrThrow({ where: { serialUnitId: unit.id } })).warrantyEnd,
      ).toBeNull();
    });

    it('needs a reason, an issued invoice and the current version, and works once', async () => {
      const item = await newItem();
      await seedPlain(item.id, w.branchA, 5);
      const invoice = await sell(staffA, [line(item.id)]);
      expect(
        (
          await adminA.post(`/invoices/${invoice.id}/cancel`, {
            rowVersion: invoice.rowVersion,
            reason: 'x',
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await adminA.post(`/invoices/${invoice.id}/cancel`, {
            rowVersion: invoice.rowVersion + 3,
            reason: 'Mistake made',
          })
        ).status,
      ).toBe(409);
      const aDraft = await draft(staffA, [line(item.id)]);
      expect((await cancel(adminA, aDraft)).status).toBe(409);
      expect((await cancel(adminA, invoice)).status).toBe(200);
      expect((await cancel(adminA, invoice)).status).toBe(409);
      expect(await quantity(item.id, w.branchA)).toBe(5);
    });

    it('lets only one of two simultaneous cancellations through', async () => {
      const item = await newItem();
      await seedPlain(item.id, w.branchA, 5);
      const invoice = await sell(staffA, [line(item.id)]);
      const results = await Promise.all([cancel(adminA, invoice), cancel(superAdmin, invoice)]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await quantity(item.id, w.branchA)).toBe(5);
      expect(await drift(item.id)).toEqual([]);
    });

    it('refuses to cancel an invoice that has a payment against it', async () => {
      const item = await newItem();
      await seedPlain(item.id, w.branchA, 5);
      const invoice = await sell(staffA, [line(item.id)]);
      const payment = await owner.payment.create({
        data: {
          branchId: w.branchA,
          receiptNo: unique('RC'),
          customerId: w.customerId,
          mode: 'CASH',
          amount: '500',
          paidOn: new Date(),
        },
      });
      await owner.paymentAllocation.create({
        data: { paymentId: payment.id, invoiceId: invoice.id, branchId: w.branchA, amount: '500' },
      });
      const refused = await cancel(adminA, invoice);
      expect(refused.status).toBe(422);
      expect(refused.body.message).toMatch(/payments/);
      expect(await quantity(item.id, w.branchA)).toBe(4);
    });

    it('refuses to cancel an invoice that has an exchange against it, whichever side of the exchange it is', async () => {
      const item = await newItem({ serialized: true });
      const old = await seedUnit(item.id, w.branchA, unique('SN'));
      const fresh = await seedUnit(item.id, w.branchA, unique('SN'));
      const original = await sell(staffA, [line(item.id, { serialUnitId: old.id })]);
      const delivery = await sell(staffA, [line(item.id, { serialUnitId: fresh.id })]);
      const amount = original.lines[0]?.amount ?? '0';
      await owner.exchange.create({
        data: {
          branchId: w.branchA,
          invoiceId: delivery.id,
          originalInvoiceId: original.id,
          oldSerialUnitId: old.id,
          newSerialUnitId: fresh.id,
          exchangeNo: unique('EXC'),
          kind: 'NEW_FOR_NEW',
          returnedAmount: amount,
          returnedTaxable: original.lines[0]?.taxableAmount ?? '0',
          valuationAmount: amount,
          newAmount: amount,
          differenceAmount: '0',
          disposition: 'STOCK',
          reason: 'Customer wants the other unit',
        },
      });
      for (const invoice of [delivery, original]) {
        const refused = await cancel(adminA, invoice);
        expect(refused.status).toBe(422);
        expect(refused.body.message).toMatch(/exchange/);
      }
      expect(await unitState(old.id)).toBe('SOLD');
    });

    it('puts invoice.cancelled on the outbox once, with the invoice and who cancelled it', async () => {
      const item = await newItem();
      await seedPlain(item.id, w.branchA, 5);
      const invoice = await sell(staffA, [line(item.id)]);
      expect((await cancel(adminA, invoice)).status).toBe(200);
      const events = await owner.outboxEvent.findMany({
        where: {
          eventType: 'invoice.cancelled',
          payload: { path: ['invoiceId'], equals: invoice.id },
        },
      });
      expect(events).toHaveLength(1);
      expect(events[0]?.payload).toMatchObject({
        invoiceNo: invoice.invoiceNo,
        cancelledBy: w.users.adminA,
      });
      const refused = await cancel(adminA, invoice);
      expect(refused.status).toBe(409);
      expect(
        await owner.outboxEvent.count({
          where: {
            eventType: 'invoice.cancelled',
            payload: { path: ['invoiceId'], equals: invoice.id },
          },
        }),
      ).toBe(1);
    });

    it('reissues: cancels the invoice and starts a draft with the same lines, which then gets a new number', async () => {
      const item = await newItem({ tax: '5' });
      await seedPlain(item.id, w.branchA, 5);
      const invoice = await sell(staffA, [
        line(item.id, { qty: 2, unitPrice: '300.00', discountAmount: '10.00' }),
      ]);
      const response = await adminA.post(`/invoices/${invoice.id}/reissue`, {
        rowVersion: invoice.rowVersion,
        reason: 'Wrong price',
      });
      expect(response.status).toBe(201);
      const replacement = InvoiceSchema.parse(response.body);
      expect(replacement).toMatchObject({
        status: 'DRAFT',
        invoiceNo: null,
        replacesInvoiceId: invoice.id,
        replacesInvoiceNo: invoice.invoiceNo,
      });
      expect(replacement.lines[0]).toMatchObject({
        qty: 2,
        unitPrice: '300.00',
        discountAmount: '10.00',
      });
      expect((await staffA.get(`/invoices/${invoice.id}`)).body.status).toBe('CANCELLED');
      expect(await quantity(item.id, w.branchA)).toBe(5);
      const reissued = await issue(staffA, replacement);
      expect(reissued.status).toBe(200);
      expect(reissued.body.invoiceNo).not.toBe(invoice.invoiceNo);
      expect(await quantity(item.id, w.branchA)).toBe(3);
      expect(await drift(item.id)).toEqual([]);
    });
  });

  describe('PDF, lists and branches', () => {
    it('serves the invoice as a PDF download whose file name is safe', async () => {
      const item = await newItem();
      await seedPlain(item.id, w.branchA, 5);
      const invoice = await sell(staffA, [line(item.id)]);
      const response = await staffA
        .get(`/invoices/${invoice.id}/pdf`)
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        });
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toMatch(/application\/pdf/);
      expect(response.headers['content-disposition']).toBe(
        `attachment; filename="${(invoice.invoiceNo ?? '').replace(/\//g, '-')}.pdf"`,
      );
      const body = (response.body as Buffer).toString('latin1');
      expect(body.startsWith('%PDF-')).toBe(true);
      expect(body).toContain('TAX INVOICE');
    });

    it('keeps each branch to its own invoices, and lets a Super Admin see them all', async () => {
      const item = await newItem();
      await seedPlain(item.id, w.branchA, 5);
      const invoice = await sell(staffA, [line(item.id)]);
      expect((await adminB.get(`/invoices/${invoice.id}`)).status).toBe(404);
      expect((await adminB.get(`/invoices/${invoice.id}/pdf`)).status).toBe(404);
      expect(
        (
          await adminB.post(`/invoices/${invoice.id}/cancel`, {
            rowVersion: invoice.rowVersion,
            reason: 'Not mine',
          })
        ).status,
      ).toBe(404);
      const seen = InvoiceListResponseSchema.parse(
        (await staffB.get('/invoices?pageSize=100')).body,
      ).items.map((i) => i.id);
      expect(seen).not.toContain(invoice.id);
      const all = InvoiceListResponseSchema.parse(
        (await superAdmin.get('/invoices?pageSize=100&sortBy=createdAt&sortOrder=desc')).body,
      ).items.map((i) => i.id);
      expect(all).toContain(invoice.id);
    });

    it('filters and pages the list on the server', async () => {
      const item = await newItem();
      await seedPlain(item.id, w.branchA, 9);
      const tagged = await owner.customer.create({
        data: { name: 'Zed Findable', phone: '9111111111', stateCode: '27' },
      });
      const one = await sell(staffA, [line(item.id)], { customerId: tagged.id });
      const two = await sell(staffA, [line(item.id)], { customerId: tagged.id, type: 'NON_GST' });
      const waiting = await draft(staffA, [line(item.id)], { customerId: tagged.id });
      const ids = async (query: string) =>
        InvoiceListResponseSchema.parse((await staffA.get(`/invoices?${query}`)).body).items.map(
          (i) => i.id,
        );
      expect((await ids('search=zed findable')).sort()).toEqual(
        [one.id, two.id, waiting.id].sort(),
      );
      expect(await ids(`search=${encodeURIComponent(one.invoiceNo ?? '')}`)).toEqual([one.id]);
      expect(await ids(`customerId=${tagged.id}&status=DRAFT`)).toEqual([waiting.id]);
      expect(await ids(`customerId=${tagged.id}&type=NON_GST`)).toEqual([two.id]);
      expect(
        (await ids(`customerId=${tagged.id}&from=${todayInIndia()}&to=${todayInIndia()}`)).sort(),
      ).toEqual([one.id, two.id].sort());
      expect(await ids(`customerId=${tagged.id}&from=2999-01-01`)).toEqual([]);
      const page = InvoiceListResponseSchema.parse(
        (
          await staffA.get(
            `/invoices?customerId=${tagged.id}&pageSize=2&page=2&sortBy=createdAt&sortOrder=asc`,
          )
        ).body,
      );
      expect(page).toMatchObject({ total: 3, totalPages: 2, page: 2 });
      expect(page.items).toHaveLength(1);
      expect((await staffA.get('/invoices?sortBy=password')).status).toBe(400);
      expect((await staffA.get('/invoices?status=DELETED')).status).toBe(400);
    });

    it('shows a draft as a draft in its PDF', async () => {
      const item = await newItem();
      const created = await draft(staffA, [line(item.id)]);
      const response = await staffA
        .get(`/invoices/${created.id}/pdf`)
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        });
      expect((response.body as Buffer).toString('latin1')).toContain(
        'DRAFT - this is not a valid invoice',
      );
    });
  });

  describe('what the database refuses on its own', () => {
    it('refuses to change, delete or add lines to an issued invoice, even for the owner', async () => {
      const item = await newItem();
      await seedPlain(item.id, w.branchA, 5);
      const invoice = await sell(staffA, [line(item.id)]);
      await expect(
        owner.invoice.update({ where: { id: invoice.id }, data: { total: '1' } }),
      ).rejects.toThrow();
      await expect(
        owner.invoice.update({ where: { id: invoice.id }, data: { customerId: karnataka } }),
      ).rejects.toThrow();
      await expect(owner.invoice.delete({ where: { id: invoice.id } })).rejects.toThrow();
      await expect(
        owner.invoiceLine.create({
          data: {
            branchId: w.branchA,
            invoiceId: invoice.id,
            lineNo: 9,
            itemId: item.id,
            qty: 1,
            unitPrice: '1',
            taxableAmount: '1',
            amount: '1',
          },
        }),
      ).rejects.toThrow();
      await expect(
        owner.invoiceLine.deleteMany({ where: { invoiceId: invoice.id } }),
      ).rejects.toThrow();
    });

    it('refuses to change a cancelled invoice and to cancel without saying who and why', async () => {
      const item = await newItem();
      await seedPlain(item.id, w.branchA, 5);
      const invoice = await sell(staffA, [line(item.id)]);
      await expect(
        owner.invoice.update({ where: { id: invoice.id }, data: { status: 'CANCELLED' } }),
      ).rejects.toThrow();
      await cancel(adminA, invoice);
      await expect(
        owner.invoice.update({ where: { id: invoice.id }, data: { cancelReason: 'Edited later' } }),
      ).rejects.toThrow();
      await expect(
        owner.invoice.update({ where: { id: invoice.id }, data: { status: 'ISSUED' } }),
      ).rejects.toThrow();
    });

    it('refuses totals that do not add up, and a round-off bigger than 50 paise', async () => {
      const make = (data: object) =>
        owner.invoice.create({
          data: { branchId: w.branchA, customerId: w.customerId, type: 'NON_GST', ...data },
        });
      await expect(make({ subtotal: '100', taxableValue: '100', total: '99' })).rejects.toThrow();
      await expect(
        make({ subtotal: '100', discountTotal: '10', taxableValue: '100', total: '100' }),
      ).rejects.toThrow();
      await expect(
        make({ subtotal: '100', taxableValue: '100', roundOff: '0.6', total: '100.6' }),
      ).rejects.toThrow();
      await expect(
        make({ subtotal: '100', taxableValue: '100', total: '100' }),
      ).resolves.toBeTruthy();
    });

    it('refuses a line whose discount is more than its price or whose taxable amount is wrong', async () => {
      const item = await newItem();
      const parent = await owner.invoice.create({
        data: { branchId: w.branchA, customerId: w.customerId, type: 'NON_GST' },
      });
      const base = {
        branchId: w.branchA,
        invoiceId: parent.id,
        itemId: item.id,
        qty: 2,
        unitPrice: '100',
        amount: '100',
      };
      await expect(
        owner.invoiceLine.create({
          data: { ...base, lineNo: 1, discountAmount: '201', taxableAmount: '0' },
        }),
      ).rejects.toThrow();
      await expect(
        owner.invoiceLine.create({
          data: { ...base, lineNo: 1, discountAmount: '0', taxableAmount: '150' },
        }),
      ).rejects.toThrow();
      await expect(
        owner.invoiceLine.create({
          data: { ...base, lineNo: 1, discountAmount: '50', taxableAmount: '150' },
        }),
      ).resolves.toBeTruthy();
    });
  });
});
