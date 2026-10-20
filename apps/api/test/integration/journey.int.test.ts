import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  BrokerSchema,
  CommissionListResponseSchema,
  CreditNoteSchema,
  DueListResponseSchema,
  ExchangeSchema,
  GoodsReceiptSchema,
  InvoiceSchema,
  LeadSchema,
  PurchaseOrderSchema,
  QuotationSchema,
  SupplierDetailSchema,
  SupplierSchema,
  TransferSchema,
  todayInIndia,
} from '@erp/contracts';
import type { Invoice, PurchaseOrder, Quotation, Transfer } from '@erp/contracts';
import { beforeAll, describe, expect, it } from 'vitest';
import { addUser, createAuthWorld, loggedIn } from '../support/auth-world.js';
import type { AuthWorld, TestClient } from '../support/auth-world.js';
import { createTestApp } from '../support/create-test-app.js';
import { createOwnerPrisma } from '../support/fixtures.js';

/**
 * The Stage 4 exit gate: the core business journey, end to end, through the real API and the real database, one step after
 * another. Each step leans on what the one before it left behind, as the business does, and every step ends by checking
 * that stock still adds up and that the audit trail recorded it.
 */
describe('the core journey: buy, move, sell, collect, correct, deliver, exchange', () => {
  let app: NestExpressApplication;
  let w: AuthWorld;
  let adminA: TestClient;
  let adminA2: TestClient;
  let staffA: TestClient;
  let staffB: TestClient;
  const owner = createOwnerPrisma();
  let counter = 0;
  const unique = (prefix: string): string =>
    `${prefix}${Date.now().toString(36)}${(counter += 1)}`.toUpperCase();
  const today = todayInIndia();

  // What each step hands to the next.
  let supplierId = '';
  let partId = '';
  let vehicleId = '';
  let order: PurchaseOrder;
  let partStockA = 0;
  let customerId = '';
  const vehicleSerials = [unique('JV1-'), unique('JV2-'), unique('JV3-')];

  const available = async (
    itemId: string,
    branchId: string,
    state = 'AVAILABLE',
  ): Promise<number> =>
    (
      await owner.stockBalance.findUnique({
        where: { branchId_itemId_state: { branchId, itemId, state: state as 'AVAILABLE' } },
      })
    )?.quantity ?? 0;
  const noDrift = async (...itemIds: string[]) => {
    for (const itemId of itemIds)
      expect(
        await owner.$queryRaw<
          { branch_id: string }[]
        >`SELECT branch_id FROM stock_balance_drift() WHERE item_id = ${itemId}::uuid`,
        'stock balances must equal the ledger',
      ).toEqual([]);
  };
  const audited = async (action: string, entityId: string) =>
    expect(
      await owner.auditLog.count({ where: { action, entityId } }),
      `${action} is in the audit trail`,
    ).toBeGreaterThanOrEqual(1);
  const unitOf = (serialNo: string) => owner.serialUnit.findFirstOrThrow({ where: { serialNo } });
  const dueOf = async (invoiceId: string) =>
    DueListResponseSchema.parse(
      (await adminA.get(`/dues?scope=all&customerId=${customerId}`)).body,
    ).items.find((d) => d.invoiceId === invoiceId);
  const sell = async (client: TestClient, lines: object[], over: object = {}): Promise<Invoice> => {
    const created = await client.post('/invoices', { customerId, type: 'GST', lines, ...over });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const draft = InvoiceSchema.parse(created.body);
    const issued = await client.post(`/invoices/${draft.id}/issue`, {
      rowVersion: draft.rowVersion,
    });
    expect(issued.status, JSON.stringify(issued.body)).toBe(200);
    return InvoiceSchema.parse(issued.body);
  };
  const pay = (invoice: Invoice, amount: string) =>
    staffA.post('/payments', {
      customerId,
      mode: 'CASH',
      amount,
      paidOn: today,
      idempotencyKey: unique('pay-'),
      allocations: [{ invoiceId: invoice.id, amount }],
    });

  beforeAll(async () => {
    w = await createAuthWorld(owner);
    await owner.branch.update({ where: { id: w.branchA }, data: { gstin: '27AAPFU0939F1ZV' } });
    const category = await owner.itemCategory.findFirstOrThrow({ where: { name: 'Vehicles' } });
    partId = (
      await owner.item.create({
        data: {
          itemCode: unique('JP-'),
          name: 'Journey part',
          categoryId: category.id,
          unitCode: 'PCS',
          hsnCode: '8703',
          taxRate: '18',
        },
      })
    ).id;
    vehicleId = (
      await owner.item.create({
        data: {
          itemCode: unique('JT-'),
          name: 'Journey TOTO',
          categoryId: category.id,
          unitCode: 'PCS',
          isSerialized: true,
          hsnCode: '8703',
          taxRate: '5',
        },
      })
    ).id;
    app = await createTestApp();
    adminA = await loggedIn(app, 'admin_a');
    staffA = await loggedIn(app, 'staff_a');
    staffB = await loggedIn(app, 'staff_b');
    await addUser(owner, { username: 'journey_admin2', role: 'ADMIN', branchIds: [w.branchA] });
    adminA2 = await loggedIn(app, 'journey_admin2');
    return async () => {
      await app.close();
      await owner.$disconnect();
    };
  });

  it('1. branch setup: each person sees only their own branch', async () => {
    const mine = async (client: TestClient) =>
      ((await client.get('/branches')).body.items as { id: string }[]).map((b) => b.id);
    expect(await mine(adminA)).toEqual([w.branchA]);
    expect(await mine(staffB)).toEqual([w.branchB]);
  });

  it('2. purchase to stock: order, receive with a short and a damaged line, resolve both, pay the supplier', async () => {
    const supplier = SupplierSchema.parse(
      (await adminA.post('/suppliers', { name: unique('Supplier ') })).body,
    );
    supplierId = supplier.id;
    const draft = await adminA.post('/purchase-orders', {
      supplierId,
      lines: [
        { itemId: partId, qtyOrdered: 20, unitCost: '500.00' },
        { itemId: vehicleId, qtyOrdered: 3, unitCost: '40000.00' },
      ],
    });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    const placed = PurchaseOrderSchema.parse(draft.body);
    const approved = await adminA.post(`/purchase-orders/${placed.id}/approve`, {
      rowVersion: placed.rowVersion,
    });
    expect(approved.status).toBe(200);
    order = PurchaseOrderSchema.parse(approved.body);
    const lineOf = (itemId: string) => order.lines.find((l) => l.itemId === itemId)?.id ?? '';

    const received = await staffA.post(`/purchase-orders/${order.id}/receive`, {
      deliveryNoteNo: 'DN-1001',
      lines: [
        { poLineId: lineOf(partId), received: 17, damaged: 2, deliveryNoteQty: 20 },
        {
          poLineId: lineOf(vehicleId),
          serials: vehicleSerials.map((serialNo) => ({ serialNo, chassisNo: `CH-${serialNo}` })),
        },
      ],
    });
    expect(received.status, JSON.stringify(received.body)).toBeLessThan(300);
    const receipt = GoodsReceiptSchema.parse(received.body);
    const kinds = receipt.lines.flatMap((l) => l.discrepancies.map((d) => d.type)).sort();
    expect(kinds).toEqual(['DAMAGED', 'SHORT']);
    // 17 arrived, 2 of them damaged and held back: 15 are available, 2 wait in quarantine.
    expect(await available(partId, w.branchA)).toBe(15);
    expect(await available(partId, w.branchA, 'QUARANTINE')).toBe(2);
    expect(await available(vehicleId, w.branchA)).toBe(3);

    for (const found of receipt.lines.flatMap((l) => l.discrepancies)) {
      const detail = (await adminA.get(`/discrepancies/${found.id}`)).body as {
        rowVersion: number;
      };
      const resolution = found.type === 'SHORT' ? 'CLAIM' : 'RETURN';
      const resolved = await adminA.post(`/discrepancies/${found.id}/resolve`, {
        resolution,
        rowVersion: detail.rowVersion,
      });
      expect(resolved.status, JSON.stringify(resolved.body)).toBe(200);
      await audited('DISCREPANCY_RESOLVED', found.id);
    }
    expect(await available(partId, w.branchA, 'QUARANTINE')).toBe(0);
    partStockA = await available(partId, w.branchA);
    expect(partStockA).toBe(15);

    const before = SupplierDetailSchema.parse(
      (await adminA.get(`/suppliers/${supplierId}`)).body,
    ).balance;
    expect(Number(before.outstanding)).toBeGreaterThan(0);
    const paid = await adminA.post(`/suppliers/${supplierId}/payments`, {
      amount: '1000',
      mode: 'CASH',
    });
    expect(paid.status, JSON.stringify(paid.body)).toBeLessThan(300);
    const after = SupplierDetailSchema.parse(
      (await adminA.get(`/suppliers/${supplierId}`)).body,
    ).balance;
    expect(Number(after.outstanding)).toBeCloseTo(Number(before.outstanding) - 1000, 2);
    await audited('PURCHASE_ORDER_APPROVED', order.id);
    await noDrift(partId, vehicleId);
  });

  it('3. transfer: branch B asks, A approves and sends, B receives one short; each branch ends up right', async () => {
    const asked = await staffB.post('/transfers', {
      fromBranchId: w.branchA,
      toBranchId: w.branchB,
      lines: [{ itemId: partId, qty: 5 }],
    });
    expect(asked.status, JSON.stringify(asked.body)).toBe(201);
    let transfer: Transfer = TransferSchema.parse(asked.body);
    const act = async (
      client: TestClient,
      action: string,
      extra: object = {},
    ): Promise<Transfer> => {
      const response = await client.post(`/transfers/${transfer.id}/${action}`, {
        rowVersion: transfer.rowVersion,
        ...extra,
      });
      expect(response.status, `${action}: ${JSON.stringify(response.body)}`).toBe(200);
      return TransferSchema.parse(response.body);
    };
    transfer = await act(adminA, 'approve');
    expect(await available(partId, w.branchA), 'nothing leaves the sender until dispatch').toBe(
      partStockA,
    );
    transfer = await act(staffA, 'dispatch', { items: [{ itemId: partId, qty: 5 }] });
    expect(await available(partId, w.branchA)).toBe(partStockA - 5);
    expect(await available(partId, w.branchB), 'nothing arrives until it is received').toBe(0);
    transfer = await act(staffB, 'receive', {
      lines: transfer.lines.map((l) => ({ lineId: l.id, received: 4, damaged: 0 })),
    });
    partStockA -= 5;
    expect(await available(partId, w.branchB)).toBe(4);
    expect(await available(partId, w.branchA)).toBe(10);
    await audited('TRANSFER_DISPATCHED', transfer.id);
    await noDrift(partId);
  });

  it('4. sale to payment: a GST invoice, a partial payment, then the rest, with the outstanding right at each step', async () => {
    const made = await staffA.post('/customers', {
      name: unique('Customer '),
      phone: `9${Date.now().toString().slice(-9)}`,
    });
    expect(made.status, JSON.stringify(made.body)).toBe(201);
    customerId = (made.body as { id: string }).id;
    const invoice = await sell(staffA, [
      { itemId: partId, qty: 4, unitPrice: '1000.00', discountAmount: '0.00' },
    ]);
    expect(invoice).toMatchObject({ status: 'ISSUED', taxableValue: '4000.00', total: '4720.00' });
    expect(Number(invoice.cgstAmount) + Number(invoice.sgstAmount)).toBeCloseTo(720, 2);
    partStockA -= 4;
    expect(await available(partId, w.branchA)).toBe(partStockA);
    expect(await dueOf(invoice.id)).toMatchObject({ outstanding: '4720.00', status: 'UNPAID' });
    expect((await pay(invoice, '2000.00')).status).toBe(201);
    expect(await dueOf(invoice.id)).toMatchObject({
      paid: '2000.00',
      outstanding: '2720.00',
      status: 'PARTIAL',
    });
    expect((await pay(invoice, '2720.00')).status).toBe(201);
    expect(await dueOf(invoice.id)).toMatchObject({ outstanding: '0.00', status: 'PAID' });
    await audited('INVOICE_ISSUED', invoice.id);
    await noDrift(partId);
  });

  it('5. return and correction: a credit note brings stock back; a cancelled invoice puts everything back and can be reissued', async () => {
    const invoice = await sell(staffA, [
      { itemId: partId, qty: 3, unitPrice: '1000.00', discountAmount: '0.00' },
    ]);
    partStockA -= 3;
    const asked = await staffA.post('/credit-notes', {
      invoiceId: invoice.id,
      reason: 'One was the wrong size',
      lines: [{ invoiceLineId: invoice.lines[0]?.id, qty: 1 }],
    });
    expect(asked.status, JSON.stringify(asked.body)).toBe(201);
    const note = CreditNoteSchema.parse(asked.body);
    const approved = await adminA.post(`/credit-notes/${note.id}/approve`, {
      rowVersion: note.rowVersion,
    });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect(CreditNoteSchema.parse(approved.body)).toMatchObject({
      status: 'APPROVED',
      amount: '1180.00',
    });
    expect(await available(partId, w.branchA, 'RETURNED')).toBe(1);
    expect(await dueOf(invoice.id)).toMatchObject({
      total: '3540.00',
      credited: '1180.00',
      outstanding: '2360.00',
    });
    await audited('CREDIT_NOTE_APPROVED', note.id);

    const other = await sell(staffA, [
      { itemId: partId, qty: 2, unitPrice: '1000.00', discountAmount: '0.00' },
    ]);
    const stockAfterSale = await available(partId, w.branchA);
    // Cancel and reissue is one correction: the wrong invoice is cancelled, its stock comes back, and a new draft is made.
    const reissued = await adminA.post(`/invoices/${other.id}/reissue`, {
      rowVersion: other.rowVersion,
      reason: 'Right customer now',
    });
    expect(reissued.status, JSON.stringify(reissued.body)).toBe(201);
    expect(await available(partId, w.branchA), 'cancelling puts the stock back').toBe(
      stockAfterSale + 2,
    );
    const cancelledNow = InvoiceSchema.parse((await adminA.get(`/invoices/${other.id}`)).body);
    expect(cancelledNow.status).toBe('CANCELLED');
    const draft = InvoiceSchema.parse(reissued.body);
    const again = await adminA.post(`/invoices/${draft.id}/issue`, {
      rowVersion: draft.rowVersion,
    });
    expect(again.status, JSON.stringify(again.body)).toBe(200);
    expect(await available(partId, w.branchA)).toBe(stockAfterSale);
    await audited('INVOICE_CANCELLED', other.id);
    await noDrift(partId);
  });

  it('6. lead to delivery: a lead becomes a customer, a custom TOTO is quoted, built, paid in advance and delivered with its serials, and the broker is paid', async () => {
    const lead = LeadSchema.parse(
      (
        await staffA.post('/leads', {
          name: unique('Lead '),
          phone: `8${Date.now().toString().slice(-9)}`,
          source: 'WALK_IN',
        })
      ).body,
    );
    const converted = await staffA.post(`/leads/${lead.id}/convert`, {
      rowVersion: lead.rowVersion,
    });
    expect(converted.status, JSON.stringify(converted.body)).toBe(200);
    const buyer = (converted.body as { customerId: string }).customerId;
    expect(buyer).toBeTruthy();
    customerId = buyer;

    const broker = BrokerSchema.parse(
      (await adminA.post('/brokers', { name: unique('Broker ') })).body,
    );
    await adminA.post(`/brokers/${broker.id}/rules`, { type: 'PERCENT', value: '2' });

    const created = await staffA.post('/quotations', {
      customerId,
      type: 'GST',
      validUntil: todayInIndia(new Date(Date.now() + 30 * 86_400_000)),
      brokerId: broker.id,
      isCustomBuild: true,
      specification: 'Red body, 60V motor, two batteries',
      lines: [{ itemId: vehicleId, qty: 1, unitPrice: '60000.00', discountAmount: '0.00' }],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    let quote: Quotation = QuotationSchema.parse(created.body);
    const step = async (
      client: TestClient,
      action: string,
      extra: object = {},
    ): Promise<Quotation> => {
      const response = await client.post(`/quotations/${quote.id}/${action}`, {
        rowVersion: quote.rowVersion,
        ...extra,
      });
      expect(response.status, `${action}: ${JSON.stringify(response.body)}`).toBeLessThan(300);
      return QuotationSchema.parse(response.body);
    };
    quote = await step(staffA, 'send');
    quote = await step(staffA, 'accept');
    const unit = await unitOf(vehicleSerials[0] ?? '');
    const assigned = await staffA.post(`/quotations/${quote.id}/lines/${quote.lines[0]?.id}/unit`, {
      serialUnitId: unit.id,
      motorNo: `MOTOR-${unit.serialNo}`,
      rowVersion: quote.rowVersion,
    });
    expect(assigned.status, JSON.stringify(assigned.body)).toBe(200);
    quote = QuotationSchema.parse(assigned.body);
    for (const stage of ['IN_BUILD', 'QUALITY_CHECK', 'READY'])
      quote = await step(staffA, 'build', { stage, note: `Stage ${stage}` });
    expect(quote.buildStage).toBe('READY');
    quote = QuotationSchema.parse(
      (
        await staffA.post(`/quotations/${quote.id}/advance`, {
          mode: 'UPI',
          amount: '30000.00',
          paidOn: today,
          idempotencyKey: unique('adv-'),
        })
      ).body,
    );
    expect(quote).toMatchObject({ advancePaid: '30000.00', balanceDue: expect.any(String) });
    quote = QuotationSchema.parse(
      (
        await staffA.post(`/quotations/${quote.id}/advance`, {
          mode: 'UPI',
          amount: quote.balanceDue,
          paidOn: today,
          idempotencyKey: unique('adv-'),
        })
      ).body,
    );
    expect(quote.balanceDue).toBe('0.00');

    const draft = await staffA.post('/invoices/from-quotation', {
      quotationId: quote.id,
      rowVersion: quote.rowVersion,
    });
    expect(draft.status, JSON.stringify(draft.body)).toBe(201);
    const invoiceDraft = InvoiceSchema.parse(draft.body);
    const delivered = await staffA.post(`/invoices/${invoiceDraft.id}/issue`, {
      rowVersion: invoiceDraft.rowVersion,
    });
    expect(delivered.status, JSON.stringify(delivered.body)).toBe(200);
    expect((await owner.serialUnit.findUniqueOrThrow({ where: { id: unit.id } })).state).toBe(
      'SOLD',
    );
    expect(await dueOf(invoiceDraft.id)).toMatchObject({ outstanding: '0.00', status: 'PAID' });
    const finished = QuotationSchema.parse((await staffA.get(`/quotations/${quote.id}`)).body);
    expect(finished.status).toBe('CONVERTED');

    const commission = CommissionListResponseSchema.parse(
      (await adminA.get(`/commissions?brokerId=${broker.id}`)).body,
    ).items[0];
    expect(commission).toMatchObject({ amount: '1200.00', status: 'PAYABLE' });
    const payout = await adminA.post('/commissions/payout', { commissionIds: [commission?.id] });
    expect(payout.status, JSON.stringify(payout.body)).toBeLessThan(300);
    await audited('QUOTATION_CONVERTED', quote.id);
    await noDrift(vehicleId);
  });

  it("7. exchange: an old TOTO comes back for a new one, with a price difference and a second manager's approval", async () => {
    const oldUnit = await unitOf(vehicleSerials[1] ?? '');
    const newUnit = await unitOf(vehicleSerials[2] ?? '');
    await sell(staffA, [
      {
        itemId: vehicleId,
        qty: 1,
        unitPrice: '50000.00',
        discountAmount: '0.00',
        serialUnitId: oldUnit.id,
      },
    ]);
    const delivery = await sell(staffA, [
      {
        itemId: vehicleId,
        qty: 1,
        unitPrice: '80000.00',
        discountAmount: '0.00',
        serialUnitId: newUnit.id,
      },
    ]);
    const asked = await staffA.post('/exchanges', {
      invoiceId: delivery.id,
      newSerialUnitId: newUnit.id,
      oldSerialUnitId: oldUnit.id,
      kind: 'OLD_FOR_NEW',
      valuationAmount: '40000.00',
      disposition: 'STOCK',
      reason: 'Customer wants the newer model',
    });
    expect(asked.status, JSON.stringify(asked.body)).toBe(201);
    const exchange = ExchangeSchema.parse(asked.body);
    expect(exchange).toMatchObject({
      status: 'PENDING',
      valuationAmount: '40000.00',
      settlement: 'PAYABLE',
    });
    expect(
      (await staffA.post(`/exchanges/${exchange.id}/approve`, { rowVersion: exchange.rowVersion }))
        .status,
      'Staff cannot approve',
    ).toBe(403);
    const approved = await adminA2.post(`/exchanges/${exchange.id}/approve`, {
      rowVersion: exchange.rowVersion,
    });
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    expect((await owner.serialUnit.findUniqueOrThrow({ where: { id: oldUnit.id } })).state).toBe(
      'RETURNED',
    );
    expect((await owner.serialUnit.findUniqueOrThrow({ where: { id: newUnit.id } })).state).toBe(
      'SOLD',
    );
    expect(await dueOf(delivery.id)).toMatchObject({
      total: delivery.total,
      outstanding: String((Number(delivery.total) - 40000).toFixed(2)),
    });
    await audited('EXCHANGE_APPROVED', exchange.id);
    await noDrift(vehicleId);
  });

  it('8. battery expiry: a battery close to expiry shows in the alerts', async () => {
    const category = await owner.itemCategory.findFirstOrThrow({ where: { name: 'Vehicles' } });
    const item = await owner.item.create({
      data: {
        itemCode: unique('JB-'),
        name: 'Journey battery',
        categoryId: category.id,
        unitCode: 'PCS',
        isSerialized: true,
      },
    });
    const before = await staffA.get('/batteries/alerts');
    expect(before.status).toBe(200);
    const serialNo = unique('BAT-');
    const unit = await owner.serialUnit.create({
      data: { branchId: w.branchA, itemId: item.id, serialNo, state: 'AVAILABLE' },
    });
    await owner.battery.create({
      data: {
        serialUnitId: unit.id,
        manufacturedOn: new Date(Date.now() - 300 * 86_400_000),
        expiryOn: new Date(Date.now() + 10 * 86_400_000),
        warrantyMonths: 12,
      },
    });
    const after = await staffA.get('/batteries/alerts');
    expect(after.status, JSON.stringify(after.body)).toBe(200);
    expect(after.body.expiring).toBe(before.body.expiring + 1);
  });

  it("9. at the end, every item's stock still equals its ledger, and branch B never saw branch A's paperwork", async () => {
    await noDrift(partId, vehicleId);
    const orders = (await staffB.get('/purchase-orders')).body.items as { id: string }[];
    expect(orders.map((o) => o.id)).not.toContain(order.id);
    expect((await staffB.get(`/purchase-orders/${order.id}`)).status).toBe(404);
    expect((await staffB.get(`/customers/${customerId}`)).status).toBeLessThan(500);
  });
});
