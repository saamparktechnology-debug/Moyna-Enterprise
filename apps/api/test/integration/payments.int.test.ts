import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  CustomerDueListResponseSchema,
  CustomerLedgerSchema,
  DueListResponseSchema,
  InvoiceSchema,
  PaymentListResponseSchema,
  PaymentSchema,
} from '@erp/contracts';
import type { Invoice, Payment } from '@erp/contracts';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAuthWorld, loggedIn, SUPER_PASSWORD } from '../support/auth-world.js';
import type { AuthWorld, TestClient } from '../support/auth-world.js';
import { createTestApp } from '../support/create-test-app.js';
import { createOwnerPrisma } from '../support/fixtures.js';

describe('payments and dues', () => {
  let app: NestExpressApplication;
  let w: AuthWorld;
  let superAdmin: TestClient;
  let adminA: TestClient;
  let staffA: TestClient;
  let staffB: TestClient;
  let categoryId: string;
  const owner = createOwnerPrisma();
  let counter = 0;
  const unique = (prefix: string): string =>
    `${prefix}${(counter += 1).toString().padStart(4, '0')}`;

  const newCustomer = async (): Promise<string> =>
    (
      await owner.customer.create({
        data: { name: unique('Payer '), phone: `90${(counter += 1).toString().padStart(8, '0')}` },
      })
    ).id;

  const stockedItem = async (branchId: string) => {
    const item = await owner.item.create({
      data: {
        itemCode: unique('PAY'),
        name: 'Payment test item',
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

  /** Issues a non-GST invoice whose total is exactly `price` times `qty`. */
  const issueInvoice = async (
    customerId: string,
    price: string,
    opts: { qty?: number; client?: TestClient; branchId?: string; dueDate?: string } = {},
  ): Promise<Invoice> => {
    const client = opts.client ?? staffA;
    const item = await stockedItem(opts.branchId ?? w.branchA);
    const created = await client.post('/invoices', {
      customerId,
      type: 'NON_GST',
      dueDate: opts.dueDate ?? null,
      lines: [{ itemId: item.id, qty: opts.qty ?? 1, unitPrice: price }],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const draft = InvoiceSchema.parse(created.body);
    const issued = await client.post(`/invoices/${draft.id}/issue`, {
      rowVersion: draft.rowVersion,
    });
    expect(issued.status, JSON.stringify(issued.body)).toBe(200);
    return InvoiceSchema.parse(issued.body);
  };

  let keyCounter = 0;
  const key = (): string => `test-key-${Date.now()}-${(keyCounter += 1)}`;
  const today = (): string => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);

  const pay = (
    client: TestClient,
    customerId: string,
    amount: string,
    extra: Record<string, unknown> = {},
  ) =>
    client.post('/payments', {
      customerId,
      mode: 'CASH',
      amount,
      paidOn: today(),
      idempotencyKey: key(),
      ...extra,
    });
  const paid = async (
    client: TestClient,
    customerId: string,
    amount: string,
    extra: Record<string, unknown> = {},
  ): Promise<Payment> => {
    const response = await pay(client, customerId, amount, extra);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return PaymentSchema.parse(response.body);
  };
  const dueOf = async (invoiceId: string, client: TestClient = staffA) => {
    const response = await client.get('/dues?scope=all&pageSize=100');
    expect(response.status).toBe(200);
    const page = DueListResponseSchema.parse(response.body);
    return page.items.find((item) => item.invoiceId === invoiceId);
  };
  const dueFor = async (customerId: string, invoiceId: string) => {
    const response = await staffA.get(`/dues?scope=all&customerId=${customerId}`);
    return DueListResponseSchema.parse(response.body).items.find((i) => i.invoiceId === invoiceId);
  };
  const creditNoteOf = async (invoice: Invoice, qty: number) => {
    const created = await staffA.post('/credit-notes', {
      invoiceId: invoice.id,
      reason: 'Customer returned goods',
      lines: [{ invoiceLineId: invoice.lines[0]?.id, qty }],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const approved = await adminA.post(`/credit-notes/${created.body.id}/approve`, {
      rowVersion: created.body.rowVersion,
    });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
  };
  const audits = (action: string, entityId: string) =>
    owner.auditLog.findMany({ where: { action, entityId } });

  beforeAll(async () => {
    w = await createAuthWorld(owner);
    categoryId = (await owner.itemCategory.findFirstOrThrow({ where: { name: 'Vehicles' } })).id;
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
        http().get('/payments'),
        http().get(`/payments/${id}`),
        http().get('/dues'),
        http().get('/dues/customers'),
        http().get(`/dues/customers/${id}/ledger`),
        http().post('/payments').set('Origin', origin).send({}),
        http().post(`/payments/${id}/reverse`).set('Origin', origin).send({}),
        http().post(`/payments/${id}/allocations`).set('Origin', origin).send({}),
      ];
      for (const response of await Promise.all(attempts)) expect(response.status).toBe(401);
    });

    it('lets Staff record and read payments but only a manager reverse one', async () => {
      const customerId = await newCustomer();
      const payment = await paid(staffA, customerId, '100.00');
      expect((await staffA.get(`/payments/${payment.id}`)).status).toBe(200);
      const denied = await staffA.post(`/payments/${payment.id}/reverse`, {
        reason: 'Wrong entry',
      });
      expect(denied.status).toBe(403);
      const done = await adminA.post(`/payments/${payment.id}/reverse`, { reason: 'Wrong entry' });
      expect(done.status, JSON.stringify(done.body)).toBe(200);
      expect(PaymentSchema.parse(done.body).status).toBe('REVERSED');
    });
  });

  describe('partial, full and split payments', () => {
    it('settles an invoice in two payments and shows the balance at each step', async () => {
      const customerId = await newCustomer();
      const invoice = await issueInvoice(customerId, '1000.00');
      expect(await dueFor(customerId, invoice.id)).toMatchObject({
        total: '1000.00',
        paid: '0.00',
        outstanding: '1000.00',
        status: 'UNPAID',
      });

      const first = await paid(staffA, customerId, '400.00', {
        allocations: [{ invoiceId: invoice.id, amount: '400.00' }],
      });
      expect(first).toMatchObject({ status: 'ACTIVE', allocated: '400.00', unallocated: '0.00' });
      expect(first.allocations).toEqual([
        { invoiceId: invoice.id, invoiceNo: invoice.invoiceNo, amount: '400.00' },
      ]);
      expect(await dueFor(customerId, invoice.id)).toMatchObject({
        paid: '400.00',
        outstanding: '600.00',
        status: 'PARTIAL',
      });

      const second = await paid(staffA, customerId, '600.00', {
        allocations: [{ invoiceId: invoice.id, amount: '600.00' }],
      });
      expect(await dueFor(customerId, invoice.id)).toMatchObject({
        paid: '1000.00',
        outstanding: '0.00',
        status: 'PAID',
      });
      const number = (no: string) => Number(no.slice(no.lastIndexOf('/') + 1));
      expect(number(second.receiptNo)).toBe(number(first.receiptNo) + 1);
      expect(first.receiptNo).toMatch(/RCT\/\d{4}\/\d{5}$/);
      expect((await audits('PAYMENT_RECORDED', first.id)).length).toBe(1);
      const event = await owner.outboxEvent.findFirst({
        where: {
          eventType: 'payment.recorded',
          payload: { path: ['paymentId'], equals: first.id },
        },
      });
      expect(event).not.toBeNull();
    });

    it('splits one payment across several invoices', async () => {
      const customerId = await newCustomer();
      const a = await issueInvoice(customerId, '300.00');
      const b = await issueInvoice(customerId, '700.00');
      const payment = await paid(staffA, customerId, '1000.00', {
        allocations: [
          { invoiceId: a.id, amount: '300.00' },
          { invoiceId: b.id, amount: '700.00' },
        ],
      });
      expect(payment.allocations).toHaveLength(2);
      expect((await dueFor(customerId, a.id))?.status).toBe('PAID');
      expect((await dueFor(customerId, b.id))?.status).toBe('PAID');
    });

    it('allocates automatically, oldest due date first, and keeps the rest as credit', async () => {
      const customerId = await newCustomer();
      const later = await issueInvoice(customerId, '500.00', { dueDate: '2099-12-31' });
      const sooner = await issueInvoice(customerId, '500.00', { dueDate: '2099-06-30' });
      const payment = await paid(staffA, customerId, '700.00', { allocateAutomatically: true });
      const byInvoice = Object.fromEntries(payment.allocations.map((a) => [a.invoiceId, a.amount]));
      expect(byInvoice[sooner.id]).toBe('500.00');
      expect(byInvoice[later.id]).toBe('200.00');
      expect(payment.unallocated).toBe('0.00');

      const extra = await paid(staffA, customerId, '1000.00', { allocateAutomatically: true });
      expect(extra.allocated).toBe('300.00');
      expect(extra.unallocated).toBe('700.00');
    });
  });

  describe('overpayment and credit', () => {
    it('keeps an advance as credit and applies it to a later invoice', async () => {
      const customerId = await newCustomer();
      const advance = await paid(staffA, customerId, '800.00');
      expect(advance).toMatchObject({ allocated: '0.00', unallocated: '800.00' });

      const owing = await staffA.get(`/dues/customers`);
      const row = CustomerDueListResponseSchema.parse(owing.body).items.find(
        (item) => item.customerId === customerId,
      );
      expect(row).toMatchObject({ outstanding: '0.00', credit: '800.00' });

      const invoice = await issueInvoice(customerId, '500.00');
      const withCredit = await staffA.get(`/payments?customerId=${customerId}&withCredit=true`);
      expect(PaymentListResponseSchema.parse(withCredit.body).items.map((p) => p.id)).toEqual([
        advance.id,
      ]);
      const applied = await staffA.post(`/payments/${advance.id}/allocations`, {
        allocations: [{ invoiceId: invoice.id, amount: '500.00' }],
      });
      expect(applied.status, JSON.stringify(applied.body)).toBe(200);
      expect(PaymentSchema.parse(applied.body)).toMatchObject({
        allocated: '500.00',
        unallocated: '300.00',
      });
      expect((await dueFor(customerId, invoice.id))?.status).toBe('PAID');

      const again = await staffA.post(`/payments/${advance.id}/allocations`, {
        allocations: [{ invoiceId: invoice.id, amount: '10.00' }],
      });
      expect(again.status).toBe(400);
    });

    it('refuses to apply more than the invoice owes or more than the payment holds', async () => {
      const customerId = await newCustomer();
      const invoice = await issueInvoice(customerId, '1000.00');
      const tooMuch = await pay(staffA, customerId, '1500.00', {
        allocations: [{ invoiceId: invoice.id, amount: '1000.01' }],
      });
      expect(tooMuch.status).toBe(400);
      expect(JSON.stringify(tooMuch.body.details)).toContain('allocations.0.amount');

      const payment = await paid(staffA, customerId, '100.00');
      const beyond = await staffA.post(`/payments/${payment.id}/allocations`, {
        allocations: [{ invoiceId: invoice.id, amount: '100.01' }],
      });
      expect(beyond.status).toBe(400);
      const nothing = await staffA.post(`/payments/${payment.id}/allocations`, {
        allocateAutomatically: true,
      });
      expect(nothing.status).toBe(200);
      const empty = await staffA.post(`/payments/${payment.id}/allocations`, {
        allocateAutomatically: true,
      });
      expect(empty.status).toBe(422);
    });
  });

  describe('validation', () => {
    it('refuses a future date, an unknown mode, a zero amount and a missing retry key', async () => {
      const customerId = await newCustomer();
      expect((await pay(staffA, customerId, '10.00', { paidOn: '2999-01-01' })).status).toBe(400);
      expect((await pay(staffA, customerId, '10.00', { mode: 'BARTER' })).status).toBe(400);
      expect((await pay(staffA, customerId, '0.00')).status).toBe(400);
      expect((await pay(staffA, customerId, '10.00', { idempotencyKey: undefined })).status).toBe(
        400,
      );
    });

    it('refuses invoices of another customer, a draft and an unknown invoice', async () => {
      const customerId = await newCustomer();
      const other = await newCustomer();
      const theirs = await issueInvoice(other, '100.00');
      const wrong = await pay(staffA, customerId, '100.00', {
        allocations: [{ invoiceId: theirs.id, amount: '100.00' }],
      });
      expect(wrong.status).toBe(400);
      expect(JSON.stringify(wrong.body.details)).toContain('another customer');

      const item = await stockedItem(w.branchA);
      const draft = await staffA.post('/invoices', {
        customerId,
        type: 'NON_GST',
        lines: [{ itemId: item.id, qty: 1, unitPrice: '50.00' }],
      });
      const onDraft = await pay(staffA, customerId, '50.00', {
        allocations: [{ invoiceId: draft.body.id, amount: '50.00' }],
      });
      expect(onDraft.status).toBe(400);
      const unknown = await pay(staffA, customerId, '50.00', {
        allocations: [{ invoiceId: '0b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59', amount: '50.00' }],
      });
      expect(unknown.status).toBe(400);
    });

    it('refuses a reference that is already on a live payment of the same mode, until that payment is reversed', async () => {
      const customerId = await newCustomer();
      const reference = unique('UTR');
      const first = await paid(staffA, customerId, '25.00', { mode: 'UPI', reference });
      const repeat = await pay(staffA, customerId, '25.00', {
        mode: 'UPI',
        reference: reference.toLowerCase(),
      });
      expect(repeat.status).toBe(409);
      expect((await pay(staffA, customerId, '25.00', { mode: 'CARD', reference })).status).toBe(
        201,
      );
      await adminA.post(`/payments/${first.id}/reverse`, { reason: 'Entered twice' });
      expect((await pay(staffA, customerId, '25.00', { mode: 'UPI', reference })).status).toBe(201);
    });
  });

  describe('duplicate and concurrent requests', () => {
    it('answers a retry with the payment already recorded and takes the money once', async () => {
      const customerId = await newCustomer();
      const body = {
        customerId,
        mode: 'CASH',
        amount: '250.00',
        paidOn: today(),
        idempotencyKey: key(),
      };
      const first = await staffA.post('/payments', body);
      const second = await staffA.post('/payments', body);
      expect(first.status).toBe(201);
      expect(second.status).toBe(201);
      expect(second.body.id).toBe(first.body.id);
      expect(await owner.payment.count({ where: { customerId } })).toBe(1);

      const different = await staffA.post('/payments', { ...body, amount: '251.00' });
      expect(different.status).toBe(409);
    });

    it('records one payment when the same request arrives many times at once', async () => {
      const customerId = await newCustomer();
      const body = {
        customerId,
        mode: 'CASH',
        amount: '75.00',
        paidOn: today(),
        idempotencyKey: key(),
      };
      const responses = await Promise.all(
        Array.from({ length: 6 }, () => staffA.post('/payments', body)),
      );
      for (const response of responses)
        expect(response.status, JSON.stringify(response.body)).toBe(201);
      expect(new Set(responses.map((r) => r.body.id)).size).toBe(1);
      expect(await owner.payment.count({ where: { customerId } })).toBe(1);
    });

    it('lets only one of two payments that race for the same invoice take it', async () => {
      const customerId = await newCustomer();
      const invoice = await issueInvoice(customerId, '1000.00');
      const attempt = () =>
        pay(staffA, customerId, '1000.00', {
          allocations: [{ invoiceId: invoice.id, amount: '1000.00' }],
        });
      const results = await Promise.all([attempt(), attempt(), attempt()]);
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 400)).toHaveLength(2);
      expect(await dueFor(customerId, invoice.id)).toMatchObject({
        paid: '1000.00',
        outstanding: '0.00',
      });
      const allocated = await owner.paymentAllocation.aggregate({
        where: { invoiceId: invoice.id },
        _sum: { amount: true },
      });
      expect(allocated._sum.amount?.toFixed(2)).toBe('1000.00');
    });
  });

  describe('reversal', () => {
    it('returns the money to the invoice, keeps the history and blocks a second reversal', async () => {
      const customerId = await newCustomer();
      const invoice = await issueInvoice(customerId, '600.00');
      const payment = await paid(staffA, customerId, '600.00', {
        allocations: [{ invoiceId: invoice.id, amount: '600.00' }],
      });
      expect((await dueFor(customerId, invoice.id))?.status).toBe('PAID');

      const blocked = await adminA.post(`/invoices/${invoice.id}/cancel`, {
        rowVersion: invoice.rowVersion,
        reason: 'Customer changed mind',
      });
      expect(blocked.status).toBe(422);

      const reversed = await adminA.post(`/payments/${payment.id}/reverse`, {
        reason: 'Cheque bounced',
      });
      expect(reversed.status, JSON.stringify(reversed.body)).toBe(200);
      const body = PaymentSchema.parse(reversed.body);
      expect(body).toMatchObject({ status: 'REVERSED', unallocated: '0.00' });
      expect(body.reversal).toMatchObject({ reason: 'Cheque bounced', reversedOn: today() });
      expect(await dueFor(customerId, invoice.id)).toMatchObject({
        paid: '0.00',
        outstanding: '600.00',
        status: 'UNPAID',
      });
      expect(await owner.payment.count({ where: { id: payment.id } })).toBe(1);
      expect((await audits('PAYMENT_REVERSED', payment.id)).length).toBe(1);

      expect(
        (await adminA.post(`/payments/${payment.id}/reverse`, { reason: 'Again' })).status,
      ).toBe(409);
      expect(
        (await staffA.post(`/payments/${payment.id}/allocations`, { allocateAutomatically: true }))
          .status,
      ).toBe(409);
      expect((await adminA.post(`/payments/${payment.id}/reverse`, { reason: 'x' })).status).toBe(
        400,
      );

      const cancelled = await adminA.post(`/invoices/${invoice.id}/cancel`, {
        rowVersion: invoice.rowVersion,
        reason: 'Customer changed mind',
      });
      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
    });

    it('lets two reversals race and reverses once', async () => {
      const customerId = await newCustomer();
      const payment = await paid(staffA, customerId, '90.00');
      const results = await Promise.all([
        adminA.post(`/payments/${payment.id}/reverse`, { reason: 'Racing one' }),
        adminA.post(`/payments/${payment.id}/reverse`, { reason: 'Racing two' }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
      expect(await owner.paymentReversal.count({ where: { paymentId: payment.id } })).toBe(1);
    });
  });

  describe('credit notes', () => {
    it('lowers what is owed once a credit note is approved', async () => {
      const customerId = await newCustomer();
      const invoice = await issueInvoice(customerId, '500.00', { qty: 4 });
      await paid(staffA, customerId, '500.00', {
        allocations: [{ invoiceId: invoice.id, amount: '500.00' }],
      });
      await creditNoteOf(invoice, 1);
      expect(await dueFor(customerId, invoice.id)).toMatchObject({
        total: '2000.00',
        credited: '500.00',
        paid: '500.00',
        outstanding: '1000.00',
        surplus: '0.00',
      });
    });

    it('shows a surplus when a credit note exceeds what is still owed', async () => {
      const customerId = await newCustomer();
      const invoice = await issueInvoice(customerId, '500.00', { qty: 2 });
      await paid(staffA, customerId, '1000.00', {
        allocations: [{ invoiceId: invoice.id, amount: '1000.00' }],
      });
      await creditNoteOf(invoice, 1);
      expect(await dueFor(customerId, invoice.id)).toMatchObject({
        outstanding: '0.00',
        surplus: '500.00',
        status: 'PAID',
      });
      const listed = await staffA.get('/dues/customers');
      const row = CustomerDueListResponseSchema.parse(listed.body).items.find(
        (item) => item.customerId === customerId,
      );
      expect(row?.credit).toBe('500.00');
    });

    it('refuses to take more than the invoice is now worth after a credit note', async () => {
      const customerId = await newCustomer();
      const invoice = await issueInvoice(customerId, '500.00', { qty: 2 });
      await creditNoteOf(invoice, 1);
      const over = await pay(staffA, customerId, '1000.00', {
        allocations: [{ invoiceId: invoice.id, amount: '1000.00' }],
      });
      expect(over.status).toBe(400);
      expect(
        (
          await pay(staffA, customerId, '500.00', {
            allocations: [{ invoiceId: invoice.id, amount: '500.00' }],
          })
        ).status,
      ).toBe(201);
    });
  });

  describe('dues, overdue and the customer ledger', () => {
    it('finds overdue invoices and totals them across pages', async () => {
      const customerId = await newCustomer();
      const old = await issueInvoice(customerId, '400.00', { dueDate: '2099-01-01' });
      await issueInvoice(customerId, '100.00');
      await owner.$transaction(async (tx) => {
        await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
        await tx.$executeRaw`UPDATE invoices SET due_date = ${today()}::date - 10 WHERE id = ${old.id}::uuid`;
      });
      const response = await staffA.get(`/dues?scope=overdue&customerId=${customerId}&pageSize=1`);
      const page = DueListResponseSchema.parse(response.body);
      expect(page.items).toHaveLength(1);
      expect(page.items[0]).toMatchObject({
        invoiceId: old.id,
        overdue: true,
        overdueDays: 10,
        outstanding: '400.00',
      });
      expect(page.totals).toMatchObject({ invoices: 2, outstanding: '500.00', overdue: '400.00' });

      await paid(staffA, customerId, '400.00', {
        allocations: [{ invoiceId: old.id, amount: '400.00' }],
      });
      const after = DueListResponseSchema.parse(
        (await staffA.get(`/dues?scope=overdue&customerId=${customerId}`)).body,
      );
      expect(after.items).toHaveLength(0);
    });

    it('rejects a sort field it does not know', async () => {
      expect((await staffA.get('/dues?sortBy=password')).status).toBe(400);
      expect((await staffA.get('/dues/customers?sortBy=password')).status).toBe(400);
    });

    it('keeps a running balance that ends at what the customer owes', async () => {
      const customerId = await newCustomer();
      const invoice = await issueInvoice(customerId, '1000.00', { qty: 2 });
      const first = await paid(staffA, customerId, '500.00', {
        allocations: [{ invoiceId: invoice.id, amount: '500.00' }],
      });
      await creditNoteOf(invoice, 1);
      await adminA.post(`/payments/${first.id}/reverse`, { reason: 'Cheque bounced' });

      const response = await staffA.get(`/dues/customers/${customerId}/ledger?sortOrder=asc`);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const ledger = CustomerLedgerSchema.parse(response.body);
      expect(ledger.items.map((e) => e.type)).toEqual([
        'INVOICE',
        'CREDIT_NOTE',
        'PAYMENT',
        'PAYMENT_REVERSAL',
      ]);
      expect(ledger.items.map((e) => e.balance)).toEqual([
        '2000.00',
        '1000.00',
        '500.00',
        '1000.00',
      ]);
      expect(ledger.balance).toBe('1000.00');
      expect((await dueFor(customerId, invoice.id))?.outstanding).toBe('1000.00');

      const filtered = CustomerLedgerSchema.parse(
        (
          await staffA.get(
            `/dues/customers/${customerId}/ledger?sortOrder=asc&from=${today()}&pageSize=1`,
          )
        ).body,
      );
      expect(filtered.total).toBe(4);
      expect(filtered.totalPages).toBe(4);
      expect(
        (await staffA.get('/dues/customers/0b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59/ledger')).status,
      ).toBe(404);
    });

    it('shows a cancelled invoice and its cancellation, ending at zero', async () => {
      const customerId = await newCustomer();
      const invoice = await issueInvoice(customerId, '300.00');
      await adminA.post(`/invoices/${invoice.id}/cancel`, {
        rowVersion: invoice.rowVersion,
        reason: 'Entered wrongly',
      });
      const ledger = CustomerLedgerSchema.parse(
        (await staffA.get(`/dues/customers/${customerId}/ledger?sortOrder=asc`)).body,
      );
      expect(ledger.items.map((e) => e.type)).toEqual(['INVOICE', 'INVOICE_CANCELLED']);
      expect(ledger.balance).toBe('0.00');
    });
  });

  describe('branch isolation', () => {
    it("hides one branch's payments, dues and ledger from another and refuses cross-branch use", async () => {
      const customerId = await newCustomer();
      const invoice = await issueInvoice(customerId, '200.00');
      const payment = await paid(staffA, customerId, '200.00', {
        allocations: [{ invoiceId: invoice.id, amount: '200.00' }],
      });

      expect((await staffB.get(`/payments/${payment.id}`)).status).toBe(404);
      const listed = PaymentListResponseSchema.parse(
        (await staffB.get(`/payments?customerId=${customerId}`)).body,
      );
      expect(listed.items).toHaveLength(0);
      expect(await dueOf(invoice.id, staffB)).toBeUndefined();
      const ledger = CustomerLedgerSchema.parse(
        (await staffB.get(`/dues/customers/${customerId}/ledger`)).body,
      );
      expect(ledger.items).toHaveLength(0);
      expect((await adminA.get(`/payments/${payment.id}`)).status).toBe(200);

      const reverse = await staffB.post(`/payments/${payment.id}/reverse`, { reason: 'Not mine' });
      expect(reverse.status).toBe(403);
      const adminB = await loggedIn(app, 'admin_b');
      expect(
        (await adminB.post(`/payments/${payment.id}/reverse`, { reason: 'Not mine' })).status,
      ).toBe(404);

      const intoA = await pay(staffB, customerId, '10.00', { branchId: w.branchA });
      expect(intoA.status).toBe(403);
      const onA = await pay(staffB, customerId, '10.00', {
        allocations: [{ invoiceId: invoice.id, amount: '10.00' }],
      });
      expect(onA.status).toBe(400);
    });

    it('lets a Super Admin choose the branch but not mix branches in one payment', async () => {
      const customerId = await newCustomer();
      const invoiceA = await issueInvoice(customerId, '100.00');
      const noBranch = await pay(superAdmin, customerId, '100.00');
      expect(noBranch.status).toBe(400);
      const mixed = await pay(superAdmin, customerId, '100.00', {
        branchId: w.branchB,
        allocations: [{ invoiceId: invoiceA.id, amount: '100.00' }],
      });
      expect(mixed.status).toBe(400);
      const fine = await pay(superAdmin, customerId, '100.00', {
        branchId: w.branchA,
        allocations: [{ invoiceId: invoiceA.id, amount: '100.00' }],
      });
      expect(fine.status, JSON.stringify(fine.body)).toBe(201);
    });
  });

  describe('the database itself', () => {
    it('refuses to change or delete a payment, an allocation or a reversal', async () => {
      const customerId = await newCustomer();
      const invoice = await issueInvoice(customerId, '100.00');
      const payment = await paid(staffA, customerId, '100.00', {
        allocations: [{ invoiceId: invoice.id, amount: '100.00' }],
      });
      await adminA.post(`/payments/${payment.id}/reverse`, { reason: 'Test reversal' });
      const attempts = [
        owner.$executeRaw`UPDATE payments SET amount = 1 WHERE id = ${payment.id}::uuid`,
        owner.$executeRaw`DELETE FROM payments WHERE id = ${payment.id}::uuid`,
        owner.$executeRaw`UPDATE payment_allocations SET amount = 1 WHERE payment_id = ${payment.id}::uuid`,
        owner.$executeRaw`DELETE FROM payment_allocations WHERE payment_id = ${payment.id}::uuid`,
        owner.$executeRaw`UPDATE payment_reversals SET reason = 'changed' WHERE payment_id = ${payment.id}::uuid`,
        owner.$executeRaw`DELETE FROM payment_reversals WHERE payment_id = ${payment.id}::uuid`,
      ];
      for (const attempt of attempts) await expect(attempt).rejects.toThrow(/ledger/);
    });

    it('refuses over-allocation however the rows are inserted', async () => {
      const customerId = await newCustomer();
      const invoice = await issueInvoice(customerId, '100.00');
      const other = await newCustomer();
      const payment = await owner.payment.create({
        data: {
          branchId: w.branchA,
          receiptNo: unique('DB/'),
          customerId,
          mode: 'CASH',
          amount: '150.00',
          paidOn: new Date(),
        },
      });
      const foreign = await owner.payment.create({
        data: {
          branchId: w.branchA,
          receiptNo: unique('DB/'),
          customerId: other,
          mode: 'CASH',
          amount: '50.00',
          paidOn: new Date(),
        },
      });
      const insert = (paymentId: string, branchId: string, amount: string) =>
        owner.paymentAllocation.create({
          data: { paymentId, invoiceId: invoice.id, branchId, amount },
        });
      await expect(insert(payment.id, w.branchA, '100.01')).rejects.toThrow(/more is being paid/i);
      await expect(insert(foreign.id, w.branchA, '10.00')).rejects.toThrow(/same customer/i);
      await expect(insert(payment.id, w.branchB, '10.00')).rejects.toThrow(/same branch/i);
      await insert(payment.id, w.branchA, '100.00');
      await expect(
        owner.paymentAllocation.create({
          data: {
            paymentId: payment.id,
            invoiceId: invoice.id,
            branchId: w.branchA,
            amount: '0.01',
          },
        }),
      ).rejects.toThrow();
      const second = await issueInvoice(customerId, '100.00');
      await expect(
        owner.paymentAllocation.create({
          data: {
            paymentId: payment.id,
            invoiceId: second.id,
            branchId: w.branchA,
            amount: '50.01',
          },
        }),
      ).rejects.toThrow(/more of the payment/i);
    });
  });
});
