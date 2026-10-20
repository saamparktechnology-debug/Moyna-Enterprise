import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  BrokerLedgerSchema,
  BrokerListResponseSchema,
  BrokerSchema,
  CommissionListResponseSchema,
  InvoiceSchema,
  PayoutResponseSchema,
} from '@erp/contracts';
import type { Broker, Invoice } from '@erp/contracts';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAuthWorld, loggedIn, SUPER_PASSWORD } from '../support/auth-world.js';
import type { AuthWorld, TestClient } from '../support/auth-world.js';
import { createTestApp } from '../support/create-test-app.js';
import { createOwnerPrisma } from '../support/fixtures.js';

describe('brokers and commission', () => {
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
  const phone = (): string => `8${(counter += 1).toString().padStart(9, '0')}`;
  const customerPhone = (): string => `7${(counter += 1).toString().padStart(9, '0')}`;

  const newCustomer = async (): Promise<string> =>
    (await owner.customer.create({ data: { name: unique('Buyer '), phone: customerPhone() } })).id;

  const newBroker = async (
    rule: { type: string; value: string } | null = { type: 'PERCENT', value: '2.00' },
  ): Promise<Broker> => {
    const created = await adminA.post('/brokers', { name: unique('Broker '), phone: phone() });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    let broker = BrokerSchema.parse(created.body);
    if (rule) {
      const ruled = await adminA.post(`/brokers/${broker.id}/rules`, rule);
      expect(ruled.status, JSON.stringify(ruled.body)).toBe(201);
      broker = BrokerSchema.parse(ruled.body);
    }
    return broker;
  };

  const stockedItem = async (branchId: string) => {
    const item = await owner.item.create({
      data: {
        itemCode: unique('BRK'),
        name: 'Broker test item',
        categoryId,
        unitCode: 'PCS',
        isSerialized: false,
      },
    });
    await owner.stockBalance.create({
      data: { branchId, itemId: item.id, state: 'AVAILABLE', quantity: 500 },
    });
    await owner.stockLedger.create({
      data: {
        branchId,
        itemId: item.id,
        state: 'AVAILABLE',
        qtyDelta: 500,
        movementType: 'OPENING_BALANCE',
      },
    });
    return item;
  };

  const draftBody = async (
    customerId: string,
    price: string,
    qty: number,
    brokerId: string | null,
    branchId = w.branchA,
  ) => ({
    customerId,
    type: 'NON_GST',
    brokerId,
    lines: [{ itemId: (await stockedItem(branchId)).id, qty, unitPrice: price }],
  });

  const draft = async (
    customerId: string,
    price: string,
    qty: number,
    brokerId: string | null,
    client: TestClient = staffA,
  ): Promise<Invoice> => {
    const response = await client.post(
      '/invoices',
      await draftBody(customerId, price, qty, brokerId, client === staffB ? w.branchB : w.branchA),
    );
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return InvoiceSchema.parse(response.body);
  };
  const issue = (invoice: Invoice, client: TestClient = staffA) =>
    client.post(`/invoices/${invoice.id}/issue`, { rowVersion: invoice.rowVersion });
  const issued = async (
    price: string,
    qty: number,
    brokerId: string | null,
    client: TestClient = staffA,
  ): Promise<Invoice> => {
    const response = await issue(
      await draft(await newCustomer(), price, qty, brokerId, client),
      client,
    );
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return InvoiceSchema.parse(response.body);
  };

  const commissionOf = async (invoiceId: string, client: TestClient = adminA) => {
    const page = CommissionListResponseSchema.parse(
      (await client.get('/commissions?pageSize=100')).body,
    );
    return page.items.find((item) => item.invoiceId === invoiceId);
  };
  const creditNote = async (invoice: Invoice, qty: number, approve = true) => {
    const created = await staffA.post('/credit-notes', {
      invoiceId: invoice.id,
      reason: 'Customer returned goods',
      lines: [{ invoiceLineId: invoice.lines[0]?.id, qty }],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    if (!approve) return created.body;
    const approved = await adminA.post(`/credit-notes/${created.body.id}/approve`, {
      rowVersion: created.body.rowVersion,
    });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    return approved.body;
  };
  const payout = (client: TestClient, ids: string[], reference?: string) =>
    client.post('/commissions/payout', { commissionIds: ids, ...(reference ? { reference } : {}) });
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
      const origin = 'http://localhost:5173';
      const http = () => request(app.getHttpServer());
      const id = w.customerId;
      const attempts = [
        http().get('/brokers'),
        http().get(`/brokers/${id}`),
        http().get(`/brokers/${id}/ledger`),
        http().get('/commissions'),
        http().post('/brokers').set('Origin', origin).send({}),
        http().patch(`/brokers/${id}`).set('Origin', origin).send({}),
        http().post(`/brokers/${id}/rules`).set('Origin', origin).send({}),
        http().post('/commissions/payout').set('Origin', origin).send({}),
      ];
      for (const response of await Promise.all(attempts)) expect(response.status).toBe(401);
    });

    it('lets Staff read brokers and commissions but only a manager change a broker or pay out', async () => {
      const broker = await newBroker();
      expect((await staffA.get('/brokers')).status).toBe(200);
      expect((await staffA.get(`/brokers/${broker.id}`)).status).toBe(200);
      expect((await staffA.get('/commissions')).status).toBe(200);
      expect((await staffA.post('/brokers', { name: 'Nobody Nobody' })).status).toBe(403);
      expect(
        (
          await staffA.patch(`/brokers/${broker.id}`, {
            name: 'Renamed Broker',
            rowVersion: broker.rowVersion,
          })
        ).status,
      ).toBe(403);
      expect(
        (await staffA.post(`/brokers/${broker.id}/rules`, { type: 'FIXED', value: '10' })).status,
      ).toBe(403);
      expect((await payout(staffA, [w.customerId])).status).toBe(403);
    });
  });

  describe('the broker master', () => {
    it('creates a broker and records it in the audit trail', async () => {
      const created = await adminA.post('/brokers', { name: 'Ravi Broker', phone: phone() });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      const broker = BrokerSchema.parse(created.body);
      expect(broker).toMatchObject({
        name: 'Ravi Broker',
        isActive: true,
        activeRule: null,
        payable: '0.00',
        toRecover: '0.00',
        rules: [],
      });
      expect((await audits('BROKER_CREATED', broker.id)).length).toBe(1);
    });

    it('refuses a bad phone, a short name and a phone another broker has', async () => {
      const number = phone();
      await adminA.post('/brokers', { name: 'First Broker', phone: number });
      const clash = await adminA.post('/brokers', { name: 'Second Broker', phone: number });
      expect(clash.status).toBe(409);
      expect(clash.body.details[0].field).toBe('phone');
      expect((await adminA.post('/brokers', { name: 'X' })).status).toBe(400);
      expect((await adminA.post('/brokers', { name: 'Ok Broker', phone: '12345' })).status).toBe(
        400,
      );
      expect((await adminA.post('/brokers', { name: 'No Phone One' })).status).toBe(201);
      expect((await adminA.post('/brokers', { name: 'No Phone Two' })).status).toBe(201);
    });

    it('edits a broker, refuses a stale edit, and switches a broker off and on', async () => {
      const broker = await newBroker(null);
      const edited = await adminA.patch(`/brokers/${broker.id}`, {
        name: 'Renamed Broker',
        rowVersion: broker.rowVersion,
      });
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      const after = BrokerSchema.parse(edited.body);
      expect(after.name).toBe('Renamed Broker');
      expect(
        (
          await adminA.patch(`/brokers/${broker.id}`, {
            name: 'Stale Name',
            rowVersion: broker.rowVersion,
          })
        ).status,
      ).toBe(409);
      const off = BrokerSchema.parse(
        (
          await adminA.patch(`/brokers/${broker.id}`, {
            isActive: false,
            rowVersion: after.rowVersion,
          })
        ).body,
      );
      expect(off.isActive).toBe(false);
      expect((await audits('BROKER_DEACTIVATED', broker.id)).length).toBe(1);
      const on = await adminA.patch(`/brokers/${broker.id}`, {
        isActive: true,
        rowVersion: off.rowVersion,
      });
      expect(BrokerSchema.parse(on.body).isActive).toBe(true);
    });

    it('lists brokers with their rule in force, and filters by name, phone and status', async () => {
      const tag = unique('Findable');
      const a = BrokerSchema.parse(
        (await adminA.post('/brokers', { name: `${tag} One`, phone: phone() })).body,
      );
      const b = BrokerSchema.parse(
        (await adminA.post('/brokers', { name: `${tag} Two`, phone: phone() })).body,
      );
      await adminA.post(`/brokers/${a.id}/rules`, { type: 'PERCENT', value: '3' });
      await adminA.patch(`/brokers/${b.id}`, { isActive: false, rowVersion: b.rowVersion });
      const page = BrokerListResponseSchema.parse(
        (await staffA.get(`/brokers?search=${tag}&sortBy=name&sortOrder=asc`)).body,
      );
      expect(page.items.map((i) => i.id)).toEqual([a.id, b.id]);
      expect(page.items[0]?.activeRule).toEqual({ type: 'PERCENT', value: '3.00' });
      expect(page.items[1]?.activeRule).toBeNull();
      const ids = async (qs: string) =>
        BrokerListResponseSchema.parse(
          (await staffA.get(`/brokers?search=${tag}&${qs}`)).body,
        ).items.map((i) => i.id);
      expect(await ids('status=active')).toEqual([a.id]);
      expect(await ids('status=inactive')).toEqual([b.id]);
      expect(
        (await staffA.get(`/brokers?search=${a.phone}`)).body.items.map(
          (i: { id: string }) => i.id,
        ),
      ).toEqual([a.id]);
      expect((await staffA.get('/brokers?sortBy=phone')).status).toBe(400);
    });
  });

  describe('commission rules', () => {
    it('puts a new rule in force and keeps the old one as it was', async () => {
      const broker = await newBroker({ type: 'PERCENT', value: '2' });
      const first = broker.rules[0];
      const changed = BrokerSchema.parse(
        (await adminA.post(`/brokers/${broker.id}/rules`, { type: 'FIXED', value: '1500' })).body,
      );
      expect(changed.activeRule).toEqual({ type: 'FIXED', value: '1500.00' });
      expect(changed.rules).toHaveLength(2);
      expect(changed.rules.filter((r) => r.isActive)).toHaveLength(1);
      const old = changed.rules.find((r) => r.id === first?.id);
      expect(old).toMatchObject({ type: 'PERCENT', value: '2.00', isActive: false });
      expect((await audits('COMMISSION_RULE_ADDED', broker.id)).length).toBe(2);
    });

    it('refuses a percentage over 100, a zero or negative value, and a rule for a switched-off broker', async () => {
      const broker = await newBroker(null);
      for (const body of [
        { type: 'PERCENT', value: '100.01' },
        { type: 'PERCENT', value: '0' },
        { type: 'FIXED', value: '-5' },
        { type: 'FIXED', value: '0.00' },
        { type: 'MIXED', value: '5' },
      ])
        expect(
          (await adminA.post(`/brokers/${broker.id}/rules`, body)).status,
          JSON.stringify(body),
        ).toBe(400);
      await adminA.patch(`/brokers/${broker.id}`, {
        isActive: false,
        rowVersion: broker.rowVersion,
      });
      expect(
        (await adminA.post(`/brokers/${broker.id}/rules`, { type: 'FIXED', value: '5' })).status,
      ).toBe(422);
      expect(
        (
          await adminA.post('/brokers/0b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59/rules', {
            type: 'FIXED',
            value: '5',
          })
        ).status,
      ).toBe(404);
    });

    it('keeps one rule in force when two are added at once', async () => {
      const broker = await newBroker(null);
      const results = await Promise.all([
        adminA.post(`/brokers/${broker.id}/rules`, { type: 'PERCENT', value: '1' }),
        adminA.post(`/brokers/${broker.id}/rules`, { type: 'PERCENT', value: '2' }),
        superAdmin.post(`/brokers/${broker.id}/rules`, { type: 'PERCENT', value: '3' }),
      ]);
      for (const r of results) expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(
        await owner.commissionRule.count({ where: { brokerId: broker.id, isActive: true } }),
      ).toBe(1);
      expect(await owner.commissionRule.count({ where: { brokerId: broker.id } })).toBe(3);
    });

    it('is protected by the database: a rule cannot be edited or brought back, and only one is live', async () => {
      const broker = await newBroker({ type: 'PERCENT', value: '2' });
      const live = broker.rules[0]?.id ?? '';
      await expect(
        owner.$executeRaw`UPDATE commission_rules SET value = 50 WHERE id = ${live}::uuid`,
      ).rejects.toThrow(/cannot be changed/);
      await expect(
        owner.$executeRaw`UPDATE commission_rules SET type = 'FIXED' WHERE id = ${live}::uuid`,
      ).rejects.toThrow(/cannot be changed/);
      await expect(
        owner.commissionRule.create({
          data: { brokerId: broker.id, type: 'FIXED', value: '10', isActive: true },
        }),
      ).rejects.toThrow();
      const changed = BrokerSchema.parse(
        (await adminA.post(`/brokers/${broker.id}/rules`, { type: 'FIXED', value: '10' })).body,
      );
      const retired = changed.rules.find((r) => !r.isActive)?.id ?? '';
      await expect(
        owner.$executeRaw`UPDATE commission_rules SET is_active = true WHERE id = ${retired}::uuid`,
      ).rejects.toThrow();
    });
  });

  describe('putting a broker on an invoice', () => {
    it('shows the broker on the draft and the issued invoice, and lets the draft change or drop them', async () => {
      const broker = await newBroker();
      const customerId = await newCustomer();
      const first = await draft(customerId, '100.00', 1, broker.id);
      expect(first).toMatchObject({ brokerId: broker.id, brokerName: broker.name });
      const dropped = await staffA.patch(`/invoices/${first.id}`, {
        ...(await draftBody(customerId, '100.00', 1, null)),
        rowVersion: first.rowVersion,
      });
      expect(dropped.status, JSON.stringify(dropped.body)).toBe(200);
      expect(InvoiceSchema.parse(dropped.body)).toMatchObject({ brokerId: null, brokerName: null });
      const again = await staffA.patch(`/invoices/${first.id}`, {
        ...(await draftBody(customerId, '100.00', 1, broker.id)),
        rowVersion: dropped.body.rowVersion,
      });
      expect(InvoiceSchema.parse(again.body).brokerId).toBe(broker.id);
      const done = InvoiceSchema.parse((await issue(InvoiceSchema.parse(again.body))).body);
      expect(done).toMatchObject({ status: 'ISSUED', brokerName: broker.name });
    });

    it('refuses an unknown broker, a switched-off broker and a broker with no rule', async () => {
      const customerId = await newCustomer();
      const unknown = await staffA.post(
        '/invoices',
        await draftBody(customerId, '10', 1, '0b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59'),
      );
      expect(unknown.status).toBe(400);
      expect(unknown.body.details[0].field).toBe('brokerId');
      const bare = await newBroker(null);
      const noRule = await staffA.post('/invoices', await draftBody(customerId, '10', 1, bare.id));
      expect(noRule.status).toBe(400);
      expect(noRule.body.details[0].message).toContain('no commission rule');
      const off = await newBroker();
      await adminA.patch(`/brokers/${off.id}`, { isActive: false, rowVersion: off.rowVersion });
      const inactive = await staffA.post('/invoices', await draftBody(customerId, '10', 1, off.id));
      expect(inactive.status).toBe(400);
      expect(inactive.body.details[0].message).toContain('no longer active');
    });

    it('freezes the broker once the invoice is issued, even for the database', async () => {
      const broker = await newBroker();
      const other = await newBroker();
      const invoice = await issued('100.00', 1, broker.id);
      await expect(
        owner.$executeRaw`UPDATE invoices SET broker_id = ${other.id}::uuid WHERE id = ${invoice.id}::uuid`,
      ).rejects.toThrow(/cannot be changed/);
    });
  });

  describe('working out the commission', () => {
    it('takes a percentage of the taxable value when the invoice is issued', async () => {
      const broker = await newBroker({ type: 'PERCENT', value: '2.50' });
      const invoice = await issued('10000.00', 1, broker.id);
      const commission = await commissionOf(invoice.id);
      expect(commission).toMatchObject({
        status: 'PAYABLE',
        brokerId: broker.id,
        invoiceNo: invoice.invoiceNo,
        ruleType: 'PERCENT',
        ruleValue: '2.50',
        baseAmount: '10000.00',
        amount: '250.00',
        adjusted: '0.00',
        effective: '250.00',
        paidAt: null,
        toRecover: '0.00',
      });
      expect((await audits('COMMISSION_ACCRUED', commission?.id ?? '')).length).toBe(1);
      expect(
        await owner.outboxEvent.count({
          where: {
            eventType: 'commission.accrued',
            payload: { path: ['invoiceId'], equals: invoice.id },
          },
        }),
      ).toBe(1);
    });

    it('rounds a percentage to the paisa, halves up', async () => {
      const broker = await newBroker({ type: 'PERCENT', value: '12.5' });
      expect((await commissionOf((await issued('0.30', 1, broker.id)).id))?.amount).toBe('0.04');
      const small = await newBroker({ type: 'PERCENT', value: '0.5' });
      expect((await commissionOf((await issued('333.33', 3, small.id)).id))?.amount).toBe('5.00');
    });

    it('pays a fixed rule as it is, but never more than the taxable value', async () => {
      const broker = await newBroker({ type: 'FIXED', value: '500.00' });
      expect((await commissionOf((await issued('10000.00', 1, broker.id)).id))?.amount).toBe(
        '500.00',
      );
      expect((await commissionOf((await issued('300.00', 1, broker.id)).id))?.amount).toBe(
        '300.00',
      );
    });

    it('works out nothing for an invoice with no broker', async () => {
      const invoice = await issued('1000.00', 1, null);
      expect(await commissionOf(invoice.id)).toBeUndefined();
      expect(await owner.commission.count({ where: { invoiceId: invoice.id } })).toBe(0);
    });

    it('leaves old commissions alone when the rule changes, and uses the rule in force at issue', async () => {
      const broker = await newBroker({ type: 'PERCENT', value: '2' });
      const before = await issued('10000.00', 1, broker.id);
      const waiting = await draft(await newCustomer(), '10000.00', 1, broker.id);
      await adminA.post(`/brokers/${broker.id}/rules`, { type: 'PERCENT', value: '5' });
      const after = await issued('10000.00', 1, broker.id);
      const late = InvoiceSchema.parse((await issue(waiting)).body);
      expect(await commissionOf(before.id)).toMatchObject({ ruleValue: '2.00', amount: '200.00' });
      expect(await commissionOf(after.id)).toMatchObject({ ruleValue: '5.00', amount: '500.00' });
      expect(await commissionOf(late.id)).toMatchObject({ ruleValue: '5.00', amount: '500.00' });
    });

    it('refuses to issue, and changes nothing, when the broker was switched off after the draft', async () => {
      const broker = await newBroker();
      const waiting = await draft(await newCustomer(), '1000.00', 1, broker.id);
      await adminA.patch(`/brokers/${broker.id}`, {
        isActive: false,
        rowVersion: broker.rowVersion,
      });
      const refused = await issue(waiting);
      expect(refused.status).toBe(400);
      expect(refused.body.details[0].field).toBe('brokerId');
      const after = InvoiceSchema.parse((await staffA.get(`/invoices/${waiting.id}`)).body);
      expect(after).toMatchObject({ status: 'DRAFT', invoiceNo: null });
      expect(await owner.commission.count({ where: { invoiceId: waiting.id } })).toBe(0);
    });

    it('carries the broker onto a re-issued draft, or drops them when they can no longer be used', async () => {
      const broker = await newBroker();
      const invoice = await issued('1000.00', 1, broker.id);
      const again = await adminA.post(`/invoices/${invoice.id}/reissue`, {
        rowVersion: invoice.rowVersion,
        reason: 'Wrong address',
      });
      expect(again.status, JSON.stringify(again.body)).toBe(201);
      expect(InvoiceSchema.parse(again.body).brokerId).toBe(broker.id);
      const gone = await newBroker();
      const second = await issued('1000.00', 1, gone.id);
      await adminA.patch(`/brokers/${gone.id}`, { isActive: false, rowVersion: gone.rowVersion });
      const dropped = await adminA.post(`/invoices/${second.id}/reissue`, {
        rowVersion: second.rowVersion,
        reason: 'Wrong address',
      });
      expect(dropped.status, JSON.stringify(dropped.body)).toBe(201);
      expect(InvoiceSchema.parse(dropped.body).brokerId).toBeNull();
    });
  });

  describe('credit notes and cancellations', () => {
    it('takes back the credited share, note by note, and reverses a commission whose invoice is fully credited', async () => {
      const broker = await newBroker({ type: 'PERCENT', value: '10' });
      const invoice = await issued('2000.00', 5, broker.id);
      const start = await commissionOf(invoice.id);
      expect(start).toMatchObject({ baseAmount: '10000.00', amount: '1000.00' });

      // A request that is still waiting changes nothing.
      const waiting = await creditNote(invoice, 1, false);
      expect(await commissionOf(invoice.id)).toMatchObject({
        adjusted: '0.00',
        effective: '1000.00',
      });

      await creditNote(invoice, 1);
      expect(await commissionOf(invoice.id)).toMatchObject({
        status: 'PAYABLE',
        adjusted: '200.00',
        effective: '800.00',
      });

      await creditNote(invoice, 3);
      expect(await commissionOf(invoice.id)).toMatchObject({
        status: 'PAYABLE',
        adjusted: '800.00',
        effective: '200.00',
      });

      const approved = await adminA.post(`/credit-notes/${waiting.id}/approve`, {
        rowVersion: waiting.rowVersion,
      });
      expect(approved.status, JSON.stringify(approved.body)).toBe(200);
      const done = await commissionOf(invoice.id);
      expect(done).toMatchObject({
        status: 'REVERSED',
        adjusted: '1000.00',
        effective: '0.00',
        amount: '1000.00',
      });
      expect(await owner.commissionAdjustment.count({ where: { commissionId: start?.id } })).toBe(
        3,
      );
      expect((await audits('COMMISSION_REDUCED', start?.id ?? '')).length).toBe(3);
    });

    it('adds up to the exact commission when the shares do not divide evenly', async () => {
      const broker = await newBroker({ type: 'FIXED', value: '100.00' });
      const invoice = await issued('1.00', 3, broker.id);
      for (let note = 0; note < 3; note += 1) await creditNote(invoice, 1);
      expect(await commissionOf(invoice.id)).toMatchObject({
        status: 'REVERSED',
        adjusted: '3.00',
        effective: '0.00',
        amount: '3.00',
      });
    });

    it('takes the whole commission back when an invoice is cancelled', async () => {
      const broker = await newBroker({ type: 'PERCENT', value: '5' });
      const invoice = await issued('1000.00', 1, broker.id);
      const cancelled = await adminA.post(`/invoices/${invoice.id}/cancel`, {
        rowVersion: invoice.rowVersion,
        reason: 'Entered wrongly',
      });
      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
      const commission = await commissionOf(invoice.id);
      expect(commission).toMatchObject({
        status: 'REVERSED',
        amount: '50.00',
        adjusted: '50.00',
        effective: '0.00',
      });
      const adjustment = await owner.commissionAdjustment.findFirstOrThrow({
        where: { commissionId: commission?.id },
      });
      expect(adjustment).toMatchObject({ kind: 'INVOICE_CANCELLED', creditNoteId: null });
    });

    it('records money to get back when a credit note arrives after the commission was paid', async () => {
      const broker = await newBroker({ type: 'PERCENT', value: '10' });
      const invoice = await issued('2500.00', 4, broker.id);
      const commission = await commissionOf(invoice.id);
      expect((await payout(adminA, [commission?.id ?? ''], 'CHQ 1')).status).toBe(200);
      await creditNote(invoice, 2);
      expect(await commissionOf(invoice.id)).toMatchObject({
        status: 'PAID',
        paidAmount: '1000.00',
        adjusted: '500.00',
        effective: '500.00',
        toRecover: '500.00',
      });
      const summary = BrokerSchema.parse((await adminA.get(`/brokers/${broker.id}`)).body);
      expect(summary).toMatchObject({ payable: '0.00', toRecover: '500.00' });
      const ledger = BrokerLedgerSchema.parse(
        (await adminA.get(`/brokers/${broker.id}/ledger`)).body,
      );
      expect(ledger.balance).toBe('-500.00');
    });

    it('is protected by the database: adjustments are never changed and never take more than the commission', async () => {
      const broker = await newBroker({ type: 'PERCENT', value: '10' });
      const invoice = await issued('1000.00', 2, broker.id);
      const commission = await commissionOf(invoice.id);
      await creditNote(invoice, 1);
      const adjustment = await owner.commissionAdjustment.findFirstOrThrow({
        where: { commissionId: commission?.id },
      });
      await expect(
        owner.$executeRaw`UPDATE commission_adjustments SET amount = 1 WHERE id = ${adjustment.id}::uuid`,
      ).rejects.toThrow(/cannot be changed/);
      await expect(
        owner.$executeRaw`DELETE FROM commission_adjustments WHERE id = ${adjustment.id}::uuid`,
      ).rejects.toThrow(/cannot be changed/);
      await expect(
        owner.commissionAdjustment.create({
          data: {
            branchId: w.branchA,
            commissionId: commission?.id ?? '',
            kind: 'INVOICE_CANCELLED',
            amount: '100.01',
          },
        }),
      ).rejects.toThrow(/more than the commission/);
      await expect(
        owner.commissionAdjustment.create({
          data: {
            branchId: w.branchB,
            commissionId: commission?.id ?? '',
            kind: 'INVOICE_CANCELLED',
            amount: '1.00',
          },
        }),
      ).rejects.toThrow(/branch of its commission/);
    });
  });

  describe('paying commission out', () => {
    it('pays several commissions to one broker, each at what it is worth now', async () => {
      const broker = await newBroker({ type: 'PERCENT', value: '10' });
      const one = await issued('1000.00', 1, broker.id);
      const two = await issued('2000.00', 2, broker.id);
      await creditNote(two, 1);
      const ids = [(await commissionOf(one.id))?.id ?? '', (await commissionOf(two.id))?.id ?? ''];
      const response = await payout(adminA, ids, 'UTR 998877');
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const result = PayoutResponseSchema.parse(response.body);
      expect(result).toMatchObject({ brokerId: broker.id, total: '300.00' });
      expect(
        result.commissions.map((c) => [c.status, c.paidAmount, c.payoutReference]).sort(),
      ).toEqual([
        ['PAID', '100.00', 'UTR 998877'],
        ['PAID', '200.00', 'UTR 998877'],
      ]);
      expect(await commissionOf(one.id)).toMatchObject({ status: 'PAID', paidAmount: '100.00' });
      expect((await audits('COMMISSION_PAID', ids[0] ?? '')).length).toBe(1);
      expect(
        await owner.outboxEvent.count({
          where: {
            eventType: 'commission.paid',
            payload: { path: ['commissionId'], equals: ids[1] },
          },
        }),
      ).toBe(1);
    });

    it('refuses to pay twice, a reversed commission, two brokers at once, an unknown id and an empty request', async () => {
      const broker = await newBroker({ type: 'PERCENT', value: '10' });
      const other = await newBroker({ type: 'PERCENT', value: '10' });
      const a = await issued('1000.00', 1, broker.id);
      const b = await issued('1000.00', 1, other.id);
      const idA = (await commissionOf(a.id))?.id ?? '';
      const idB = (await commissionOf(b.id))?.id ?? '';
      const mixed = await payout(adminA, [idA, idB]);
      expect(mixed.status).toBe(400);
      expect(JSON.stringify(mixed.body.details)).toContain('one broker at a time');
      expect((await payout(adminA, [idA])).status).toBe(200);
      const again = await payout(adminA, [idA]);
      expect(again.status).toBe(400);
      expect(JSON.stringify(again.body.details)).toContain('already paid');
      const cancelledInvoice = await issued('1000.00', 1, broker.id);
      await adminA.post(`/invoices/${cancelledInvoice.id}/cancel`, {
        rowVersion: cancelledInvoice.rowVersion,
        reason: 'Wrong',
      });
      const reversed = await payout(adminA, [(await commissionOf(cancelledInvoice.id))?.id ?? '']);
      expect(reversed.status).toBe(400);
      expect(JSON.stringify(reversed.body.details)).toContain('reversed');
      expect((await payout(adminA, ['0b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59'])).status).toBe(404);
      expect((await payout(adminA, [])).status).toBe(400);
      expect((await commissionOf(b.id))?.status).toBe('PAYABLE');
    });

    it('pays a commission once when two payouts race for it', async () => {
      const broker = await newBroker({ type: 'PERCENT', value: '10' });
      const invoice = await issued('1000.00', 1, broker.id);
      const id = (await commissionOf(invoice.id))?.id ?? '';
      const results = await Promise.all([
        payout(adminA, [id]),
        payout(superAdmin, [id]),
        payout(adminA, [id]),
      ]);
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 400)).toHaveLength(2);
      expect(await owner.commission.count({ where: { id, status: 'PAID' } })).toBe(1);
    });

    it('settles a credit note and a payout that arrive together without paying too much', async () => {
      const broker = await newBroker({ type: 'PERCENT', value: '10' });
      const invoice = await issued('1000.00', 2, broker.id);
      const id = (await commissionOf(invoice.id))?.id ?? '';
      const created = await staffA.post('/credit-notes', {
        invoiceId: invoice.id,
        reason: 'Returned',
        lines: [{ invoiceLineId: invoice.lines[0]?.id, qty: 1 }],
      });
      const [paid, approved] = await Promise.all([
        payout(adminA, [id]),
        adminA.post(`/credit-notes/${created.body.id}/approve`, {
          rowVersion: created.body.rowVersion,
        }),
      ]);
      expect(paid.status).toBe(200);
      expect(approved.status).toBe(200);
      const after = await commissionOf(invoice.id);
      expect(after?.status).toBe('PAID');
      expect(Number(after?.paidAmount) - Number(after?.effective)).toBe(Number(after?.toRecover));
      expect(Number(after?.paidAmount) + 0).toBeGreaterThanOrEqual(Number(after?.effective));
    });

    it('is protected by the database: the terms of a commission never change and a paid one never moves', async () => {
      const broker = await newBroker({ type: 'PERCENT', value: '10' });
      const invoice = await issued('1000.00', 1, broker.id);
      const commission = await commissionOf(invoice.id);
      const id = commission?.id ?? '';
      await expect(
        owner.$executeRaw`UPDATE commissions SET amount = 1 WHERE id = ${id}::uuid`,
      ).rejects.toThrow(/terms of a commission/);
      await expect(
        owner.$executeRaw`UPDATE commissions SET rule_id = rule_id, broker_id = ${(await newBroker()).id}::uuid WHERE id = ${id}::uuid`,
      ).rejects.toThrow(/terms of a commission/);
      await payout(adminA, [id]);
      await expect(
        owner.$executeRaw`UPDATE commissions SET status = 'PAYABLE' WHERE id = ${id}::uuid`,
      ).rejects.toThrow(/paid commission/);
      await expect(
        owner.$executeRaw`UPDATE commissions SET paid_amount = 1 WHERE id = ${id}::uuid`,
      ).rejects.toThrow(/paid commission/);
    });

    it("allows only one commission per invoice, for the invoice's own broker and branch", async () => {
      const broker = await newBroker({ type: 'PERCENT', value: '10' });
      const stranger = await newBroker({ type: 'PERCENT', value: '10' });
      const invoice = await issued('1000.00', 1, broker.id);
      const commission = await owner.commission.findFirstOrThrow({
        where: { invoiceId: invoice.id },
      });
      const make = (over: Record<string, unknown>) =>
        owner.commission.create({
          data: {
            branchId: w.branchA,
            brokerId: broker.id,
            invoiceId: invoice.id,
            ruleId: commission.ruleId,
            amount: '1',
            baseAmount: '1',
            ...over,
          } as never,
        });
      await expect(make({})).rejects.toThrow();
      const second = await issued('1000.00', 1, broker.id);
      await owner.commission.deleteMany({ where: { invoiceId: second.id } }).catch(() => undefined);
      const draftOnly = await draft(await newCustomer(), '10', 1, broker.id);
      await expect(make({ invoiceId: draftOnly.id })).rejects.toThrow(/issued invoice/);
      await expect(make({ invoiceId: second.id, brokerId: stranger.id })).rejects.toThrow();
      await expect(make({ invoiceId: second.id, branchId: w.branchB })).rejects.toThrow();
    });
  });

  describe('the broker ledger', () => {
    it('lists commissions, deductions and payouts with a running balance', async () => {
      const broker = await newBroker({ type: 'PERCENT', value: '10' });
      const invoice = await issued('2500.00', 4, broker.id);
      const id = (await commissionOf(invoice.id))?.id ?? '';
      await creditNote(invoice, 1);
      await payout(adminA, [id], 'CHQ 77');
      const response = await staffA.get(`/brokers/${broker.id}/ledger?sortOrder=asc`);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const ledger = BrokerLedgerSchema.parse(response.body);
      expect(ledger.items.map((e) => e.type)).toEqual(['COMMISSION', 'CREDIT_NOTE', 'PAYOUT']);
      expect(ledger.items.map((e) => e.balance)).toEqual(['1000.00', '750.00', '0.00']);
      expect(ledger.items[0]).toMatchObject({
        increase: '1000.00',
        decrease: '0.00',
        documentNo: invoice.invoiceNo,
      });
      expect(ledger.items[2]?.description).toContain('CHQ 77');
      expect(ledger.balance).toBe('0.00');
      const today = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
      const filtered = BrokerLedgerSchema.parse(
        (await staffA.get(`/brokers/${broker.id}/ledger?from=${today}&pageSize=1&sortOrder=asc`))
          .body,
      );
      expect(filtered).toMatchObject({ total: 3, totalPages: 3, balance: '0.00' });
      expect(
        (await staffA.get('/brokers/0b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59/ledger')).status,
      ).toBe(404);
    });

    it('counts a reversed commission as nothing owed', async () => {
      const broker = await newBroker({ type: 'PERCENT', value: '10' });
      const invoice = await issued('1000.00', 1, broker.id);
      await adminA.post(`/invoices/${invoice.id}/cancel`, {
        rowVersion: invoice.rowVersion,
        reason: 'Wrong',
      });
      const ledger = BrokerLedgerSchema.parse(
        (await adminA.get(`/brokers/${broker.id}/ledger?sortOrder=asc`)).body,
      );
      expect(ledger.items.map((e) => e.type)).toEqual(['COMMISSION', 'INVOICE_CANCELLED']);
      expect(ledger.balance).toBe('0.00');
      expect(BrokerSchema.parse((await adminA.get(`/brokers/${broker.id}`)).body).payable).toBe(
        '0.00',
      );
    });
  });

  describe('finding commissions', () => {
    it('filters by status, broker and search, and pages the result', async () => {
      const broker = await newBroker({ type: 'PERCENT', value: '10' });
      const a = await issued('1000.00', 1, broker.id);
      const b = await issued('2000.00', 1, broker.id);
      await payout(adminA, [(await commissionOf(a.id))?.id ?? '']);
      const ids = async (qs: string) =>
        CommissionListResponseSchema.parse(
          (await adminA.get(`/commissions?brokerId=${broker.id}&${qs}`)).body,
        ).items.map((i) => i.invoiceId);
      expect(await ids('status=PAID')).toEqual([a.id]);
      expect(await ids('status=PAYABLE')).toEqual([b.id]);
      expect((await ids('')).length).toBe(2);
      expect(await ids(`search=${b.invoiceNo}`)).toEqual([b.id]);
      expect(await ids('search=zzzznothing')).toEqual([]);
      const paged = CommissionListResponseSchema.parse(
        (
          await adminA.get(
            `/commissions?brokerId=${broker.id}&pageSize=1&page=2&sortBy=amount&sortOrder=asc`,
          )
        ).body,
      );
      expect(paged).toMatchObject({ page: 2, total: 2, totalPages: 2 });
      expect(paged.items[0]?.invoiceId).toBe(b.id);
      expect((await adminA.get('/commissions?sortBy=baseAmount')).status).toBe(400);
      expect((await adminA.get('/commissions?status=OWED')).status).toBe(400);
    });
  });

  describe('branch isolation', () => {
    it("hides a branch's commissions from another branch, but shares the broker list", async () => {
      const broker = await newBroker({ type: 'PERCENT', value: '10' });
      const invoice = await issued('1000.00', 1, broker.id);
      const commission = await commissionOf(invoice.id);
      expect(await commissionOf(invoice.id, staffB)).toBeUndefined();
      expect(await commissionOf(invoice.id, superAdmin)).toBeDefined();
      expect((await payout(adminB, [commission?.id ?? ''])).status).toBe(404);
      expect((await commissionOf(invoice.id))?.status).toBe('PAYABLE');
      expect((await staffB.get(`/brokers/${broker.id}`)).status).toBe(200);
      const seenByB = BrokerSchema.parse((await staffB.get(`/brokers/${broker.id}`)).body);
      expect(seenByB.payable).toBe('0.00');
      const ledgerB = BrokerLedgerSchema.parse(
        (await staffB.get(`/brokers/${broker.id}/ledger`)).body,
      );
      expect(ledgerB.items).toHaveLength(0);
      expect(BrokerSchema.parse((await adminA.get(`/brokers/${broker.id}`)).body).payable).toBe(
        '100.00',
      );
    });

    it('works out commission in the branch of the invoice, for every branch', async () => {
      const broker = await newBroker({ type: 'PERCENT', value: '10' });
      const inB = await issued('1000.00', 1, broker.id, staffB);
      const commission = await commissionOf(inB.id, superAdmin);
      expect(commission).toMatchObject({ branchId: w.branchB, amount: '100.00' });
      expect(await commissionOf(inB.id, staffA)).toBeUndefined();
      expect((await payout(adminB, [commission?.id ?? ''])).status).toBe(200);
    });
  });
});
