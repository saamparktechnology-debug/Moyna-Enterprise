import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  CustomerCreditSchema,
  CustomerDueListResponseSchema,
  CustomerLedgerSchema,
  PaymentSchema,
  QuotationSchema,
  RefundListResponseSchema,
  RefundSchema,
  todayInIndia,
} from '@erp/contracts';
import type { Refund } from '@erp/contracts';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAuthWorld, loggedIn } from '../support/auth-world.js';
import type { AuthWorld, TestClient } from '../support/auth-world.js';
import { createTestApp } from '../support/create-test-app.js';
import { createOwnerPrisma } from '../support/fixtures.js';

describe("refunding a customer's credit", () => {
  let app: NestExpressApplication;
  let w: AuthWorld;
  let adminA: TestClient;
  let adminB: TestClient;
  let staffA: TestClient;
  const owner = createOwnerPrisma();
  let counter = 0;
  const unique = (prefix: string): string =>
    `${prefix}${Date.now().toString(36)}${(counter += 1)}`.toUpperCase();
  const today = todayInIndia();
  let categoryId = '';

  const newCustomer = async (): Promise<string> =>
    (
      await owner.customer.create({
        data: {
          name: unique('Holder '),
          phone: `9${Date.now().toString().slice(-8)}${counter % 10}`,
        },
      })
    ).id;
  /** Money paid in with nothing to apply it to: credit held for the customer. */
  const payIn = async (customerId: string, amount: string, client: TestClient = staffA) => {
    const response = await client.post('/payments', {
      customerId,
      mode: 'CASH',
      amount,
      paidOn: today,
      idempotencyKey: unique('pay-'),
      allocateAutomatically: false,
      allocations: [],
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return PaymentSchema.parse(response.body);
  };
  const creditOf = async (customerId: string, client: TestClient = adminA) =>
    CustomerCreditSchema.parse(
      (await client.get(`/refunds/credit?customerId=${customerId}&branchId=${w.branchA}`)).body,
    );
  const refund = (
    customerId: string,
    amount: string,
    over: Record<string, unknown> = {},
    client: TestClient = adminA,
  ) =>
    client.post('/refunds', {
      customerId,
      branchId: w.branchA,
      amount,
      mode: 'CASH',
      paidOn: today,
      reason: 'Customer asked for their money back',
      idempotencyKey: unique('rf-'),
      ...over,
    });
  const refunded = async (
    customerId: string,
    amount: string,
    over: Record<string, unknown> = {},
  ): Promise<Refund> => {
    const response = await refund(customerId, amount, over);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return RefundSchema.parse(response.body);
  };

  beforeAll(async () => {
    w = await createAuthWorld(owner);
    categoryId = (await owner.itemCategory.findFirstOrThrow({ where: { name: 'Vehicles' } })).id;
    app = await createTestApp();
    adminA = await loggedIn(app, 'admin_a');
    adminB = await loggedIn(app, 'admin_b');
    staffA = await loggedIn(app, 'staff_a');
    return async () => {
      await app.close();
      await owner.$disconnect();
    };
  });

  it('answers every endpoint with 401 when signed out, and lets only a manager pay a refund', async () => {
    const origin = 'http://localhost:5173';
    for (const response of await Promise.all([
      request(app.getHttpServer()).get('/refunds'),
      request(app.getHttpServer()).get('/refunds/credit'),
      request(app.getHttpServer()).post('/refunds').set('Origin', origin).send({}),
    ]))
      expect(response.status).toBe(401);
    const customerId = await newCustomer();
    await payIn(customerId, '1000.00');
    expect((await refund(customerId, '100.00', {}, staffA)).status).toBe(403);
    expect(
      (await staffA.get(`/refunds/credit?customerId=${customerId}&branchId=${w.branchA}`)).status,
    ).toBe(200);
    expect((await staffA.get('/refunds')).status).toBe(200);
    expect((await refund(customerId, '100.00')).status).toBe(201);
  });

  it('shows what a customer holds: payments with nothing applied to them', async () => {
    const customerId = await newCustomer();
    expect(await creditOf(customerId)).toMatchObject({ credit: '0.00', refundable: '0.00' });
    await payIn(customerId, '3000.00');
    await payIn(customerId, '500.50');
    expect(await creditOf(customerId)).toEqual({
      customerId,
      branchId: w.branchA,
      credit: '3500.50',
      heldForOrders: '0.00',
      refunded: '0.00',
      refundable: '3500.50',
    });
  });

  it('pays a refund: numbered, recorded, audited, and the credit goes down in the dues list and the ledger', async () => {
    const customerId = await newCustomer();
    await payIn(customerId, '3000.00');
    const made = await refunded(customerId, '1200.00', { mode: 'UPI', reference: 'UTR-8841' });
    expect(made).toMatchObject({
      amount: '1200.00',
      mode: 'UPI',
      reference: 'UTR-8841',
      customerId,
      reason: 'Customer asked for their money back',
      createdByName: 'Person admin_a',
    });
    expect(made.refundNo).toMatch(/RFD\/\d{4}\/\d{5}$/);
    expect(await creditOf(customerId)).toMatchObject({
      credit: '1800.00',
      refunded: '1200.00',
      refundable: '1800.00',
    });
    const dues = CustomerDueListResponseSchema.parse(
      (await adminA.get(`/dues/customers?search=${made.customerName.slice(0, 12)}`)).body,
    );
    expect(dues.items.find((d) => d.customerId === customerId)?.credit).toBe('1800.00');
    const ledger = CustomerLedgerSchema.parse(
      (await adminA.get(`/dues/customers/${customerId}/ledger`)).body,
    );
    // Newest first, each with the balance after it: the refund brings the balance back up towards zero.
    expect(ledger.items.map((e) => [e.type, e.debit, e.credit, e.balance])).toEqual([
      ['REFUND', '1200.00', '0.00', '-1800.00'],
      ['PAYMENT', '0.00', '3000.00', '-3000.00'],
    ]);
    expect(ledger.balance).toBe('-1800.00');
    expect(
      await owner.auditLog.count({ where: { action: 'CUSTOMER_REFUND_PAID', entityId: made.id } }),
    ).toBe(1);
    expect(
      await owner.outboxEvent.count({
        where: {
          eventType: 'customer.refund_paid',
          payload: { path: ['refundId'], equals: made.id },
        },
      }),
    ).toBe(1);
    const listed = RefundListResponseSchema.parse(
      (await staffA.get(`/refunds?customerId=${customerId}`)).body,
    );
    expect(listed.items.map((r) => r.id)).toEqual([made.id]);
  });

  it('never pays back more than is held, and shows what is left', async () => {
    const customerId = await newCustomer();
    await payIn(customerId, '1000.00');
    const over = await refund(customerId, '1000.01');
    expect(over.status).toBe(400);
    expect(over.body.details[0]).toMatchObject({ field: 'amount' });
    expect(over.body.details[0].message).toContain('1000.00');
    await refunded(customerId, '600.00');
    expect((await refund(customerId, '400.01')).status).toBe(400);
    await refunded(customerId, '400.00');
    expect(await creditOf(customerId)).toMatchObject({
      credit: '0.00',
      refundable: '0.00',
      refunded: '1000.00',
    });
    expect((await refund(customerId, '0.01')).status).toBe(400);
  });

  it('takes two refunds arriving together one after the other, so credit is never overspent', async () => {
    const customerId = await newCustomer();
    await payIn(customerId, '3000.00');
    const results = await Promise.all([
      refund(customerId, '2000.00'),
      refund(customerId, '2000.00'),
    ]);
    expect(results.map((r) => r.status).sort()).toEqual([201, 400]);
    expect(await creditOf(customerId)).toMatchObject({ credit: '1000.00', refunded: '2000.00' });
    expect(await owner.customerRefund.count({ where: { customerId } })).toBe(1);
  });

  it('answers a retry with the refund already paid, and refuses a different refund under the same key', async () => {
    const customerId = await newCustomer();
    await payIn(customerId, '2000.00');
    const key = unique('retry-');
    const first = await refund(customerId, '500.00', { idempotencyKey: key });
    const again = await refund(customerId, '500.00', { idempotencyKey: key });
    expect([first.status, again.status]).toEqual([201, 201]);
    expect(again.body.id).toBe(first.body.id);
    expect(await owner.customerRefund.count({ where: { customerId } })).toBe(1);
    expect(await creditOf(customerId)).toMatchObject({ refunded: '500.00' });
    const different = await refund(customerId, '600.00', { idempotencyKey: key });
    expect(different.status).toBe(409);
  });

  it('keeps back money held for an accepted order, and releases nothing else', async () => {
    const customerId = await newCustomer();
    const item = await owner.item.create({
      data: { itemCode: unique('RFI-'), name: 'Refund test item', categoryId, unitCode: 'PCS' },
    });
    const created = await staffA.post('/quotations', {
      customerId,
      type: 'NON_GST',
      validUntil: todayInIndia(new Date(Date.now() + 20 * 86_400_000)),
      lines: [{ itemId: item.id, qty: 2, unitPrice: '1000.00', discountAmount: '0.00' }],
    });
    let quote = QuotationSchema.parse(created.body);
    for (const action of ['send', 'accept'])
      quote = QuotationSchema.parse(
        (await staffA.post(`/quotations/${quote.id}/${action}`, { rowVersion: quote.rowVersion }))
          .body,
      );
    const advance = await staffA.post(`/quotations/${quote.id}/advance`, {
      mode: 'CASH',
      amount: '700.00',
      paidOn: today,
      idempotencyKey: unique('adv-'),
    });
    expect(advance.status, JSON.stringify(advance.body)).toBe(201);
    expect(await creditOf(customerId)).toMatchObject({
      credit: '700.00',
      heldForOrders: '700.00',
      refundable: '0.00',
    });
    const blocked = await refund(customerId, '1.00');
    expect(blocked.status).toBe(400);
    expect(blocked.body.details[0].message).toContain('held for an accepted order');
    await payIn(customerId, '300.00');
    expect(await creditOf(customerId)).toMatchObject({
      credit: '1000.00',
      heldForOrders: '700.00',
      refundable: '300.00',
    });
    expect((await refund(customerId, '300.01')).status).toBe(400);
    expect((await refund(customerId, '300.00')).status).toBe(201);
    expect(await creditOf(customerId)).toMatchObject({
      credit: '700.00',
      heldForOrders: '700.00',
      refundable: '0.00',
    });
  });

  it('does not count a payment that was reversed', async () => {
    const customerId = await newCustomer();
    const kept = await payIn(customerId, '800.00');
    const gone = await payIn(customerId, '500.00');
    expect(
      (await adminA.post(`/payments/${gone.id}/reverse`, { reason: 'Cheque bounced' })).status,
    ).toBe(200);
    expect(await creditOf(customerId)).toMatchObject({ credit: '800.00', refundable: '800.00' });
    expect((await refund(customerId, '800.01')).status).toBe(400);
    expect(kept.amount).toBe('800.00');
  });

  it('refuses the mode used for exchanges, an unknown mode, a future date and a missing reason', async () => {
    const customerId = await newCustomer();
    await payIn(customerId, '500.00');
    expect((await refund(customerId, '10.00', { mode: 'EXCHANGE' })).status).toBe(400);
    expect((await refund(customerId, '10.00', { mode: 'BARTER' })).status).toBe(400);
    expect(
      (
        await refund(customerId, '10.00', {
          paidOn: todayInIndia(new Date(Date.now() + 3 * 86_400_000)),
        })
      ).status,
    ).toBe(400);
    expect((await refund(customerId, '10.00', { reason: 'no' })).status).toBe(400);
    expect((await refund(customerId, '10.00', { idempotencyKey: 'short' })).status).toBe(400);
    expect(await owner.customerRefund.count({ where: { customerId } })).toBe(0);
  });

  it('is kept to the branch: another branch cannot refund, and sees no credit', async () => {
    const customerId = await newCustomer();
    await payIn(customerId, '900.00');
    expect((await refund(customerId, '100.00', { branchId: w.branchA }, adminB)).status).toBe(403);
    const mine = CustomerCreditSchema.parse(
      (await adminB.get(`/refunds/credit?customerId=${customerId}`)).body,
    );
    expect(mine).toMatchObject({ branchId: w.branchB, credit: '0.00', refundable: '0.00' });
    expect((await refund(customerId, '100.00', { branchId: undefined }, adminB)).status).toBe(400);
    const made = await refunded(customerId, '100.00');
    expect(
      RefundListResponseSchema.parse((await adminB.get(`/refunds?customerId=${customerId}`)).body)
        .items,
    ).toEqual([]);
    expect(made.branchId).toBe(w.branchA);
  });

  it('is protected by the database: a refund is never changed or deleted, and is for more than nothing', async () => {
    const customerId = await newCustomer();
    await payIn(customerId, '900.00');
    const made = await refunded(customerId, '100.00');
    await expect(
      owner.$executeRaw`UPDATE customer_refunds SET amount = 1 WHERE id = ${made.id}::uuid`,
    ).rejects.toThrow(/cannot be changed or deleted/);
    await expect(
      owner.$executeRaw`DELETE FROM customer_refunds WHERE id = ${made.id}::uuid`,
    ).rejects.toThrow(/cannot be changed or deleted/);
    const base = {
      branchId: w.branchA,
      customerId,
      mode: 'CASH',
      paidOn: new Date(),
      reason: 'Direct',
      createdBy: null,
    };
    await expect(
      owner.customerRefund.create({
        data: { ...base, refundNo: unique('X/'), amount: '0', idempotencyKey: unique('k-') },
      }),
    ).rejects.toThrow();
    await expect(
      owner.customerRefund.create({
        data: {
          ...base,
          mode: 'EXCHANGE',
          refundNo: unique('X/'),
          amount: '5',
          idempotencyKey: unique('k-'),
        },
      }),
    ).rejects.toThrow();
  });
});
