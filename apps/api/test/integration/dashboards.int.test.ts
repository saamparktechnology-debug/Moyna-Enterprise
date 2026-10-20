import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  BranchDashboardSchema,
  CompanyDashboardSchema,
  DashboardPeriodSchema,
  todayInIndia,
} from '@erp/contracts';
import type { BranchDashboard, CompanyDashboard } from '@erp/contracts';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAuthWorld, loggedIn } from '../support/auth-world.js';
import type { AuthWorld, TestClient } from '../support/auth-world.js';
import { createTestApp } from '../support/create-test-app.js';
import { createOwnerPrisma } from '../support/fixtures.js';

const FROM = '2026-09-01';
const TO = '2026-09-30';
const PERIOD = `from=${FROM}&to=${TO}`;
const money = (value: Prisma.Decimal | number | string | null | undefined): string =>
  new Prisma.Decimal(value ?? 0).toFixed(2);

describe('dashboards', () => {
  let app: NestExpressApplication;
  let w: AuthWorld;
  let superAdmin: TestClient;
  let adminA: TestClient;
  let adminB: TestClient;
  let staffA: TestClient;
  const owner = createOwnerPrisma();
  let counter = 0;
  const unique = (prefix: string): string =>
    `${prefix}${(counter += 1).toString().padStart(4, '0')}`;
  const phone = (): string => `6${(counter += 1).toString().padStart(9, '0')}`;
  let categoryId: string;
  const ids: Record<string, string> = {};

  const invoice = async (
    branchId: string,
    issuedOn: string,
    taxable: number,
    options: { dueDate?: string; status?: 'ISSUED' | 'DRAFT'; brokerId?: string } = {},
  ): Promise<string> => {
    const tax = taxable * 0.025;
    const issued = (options.status ?? 'ISSUED') === 'ISSUED';
    const created = await owner.invoice.create({
      data: {
        branchId,
        customerId: w.customerId,
        type: 'GST',
        invoiceNo: issued ? unique('DB/INV/') : null,
        status: options.status ?? 'ISSUED',
        subtotal: money(taxable),
        taxableValue: money(taxable),
        cgstAmount: money(tax),
        sgstAmount: money(tax),
        total: money(taxable + tax * 2),
        placeOfSupply: '27',
        issuedOn: issued ? new Date(issuedOn) : null,
        dueDate: options.dueDate ? new Date(options.dueDate) : null,
        ...(options.brokerId ? { brokerId: options.brokerId } : {}),
      },
    });
    return created.id;
  };

  const payment = async (
    branchId: string,
    invoiceId: string,
    amount: number,
    paidOn: string,
    mode = 'CASH',
  ): Promise<string> => {
    const created = await owner.payment.create({
      data: {
        branchId,
        receiptNo: unique('DB/RCT/'),
        customerId: w.customerId,
        mode,
        amount: money(amount),
        paidOn: new Date(paidOn),
        idempotencyKey: unique('key-'),
      },
    });
    await owner.paymentAllocation.create({
      data: { paymentId: created.id, invoiceId, branchId, amount: money(amount) },
    });
    return created.id;
  };

  const purchaseOrder = (
    branchId: string,
    orderDate: string,
    status: 'DRAFT' | 'APPROVED' | 'PARTIALLY_RECEIVED' | 'RECEIVED' | 'CANCELLED',
    lines: { itemId: string; qty: number; cost: number }[],
  ) =>
    owner.purchaseOrder.create({
      data: {
        branchId,
        poNo: unique('DB/PO/'),
        supplierId: w.supplierId,
        status,
        orderDate: new Date(orderDate),
        poLines: {
          create: lines.map((line) => ({
            branchId,
            itemId: line.itemId,
            qtyOrdered: line.qty,
            unitCost: money(line.cost),
          })),
        },
      },
    });

  const newItem = async (reorderLevel = 0): Promise<string> =>
    (
      await owner.item.create({
        data: {
          itemCode: unique('DBI'),
          name: 'Dashboard item',
          categoryId,
          unitCode: 'PCS',
          reorderLevel,
        },
      })
    ).id;

  const stock = (
    branchId: string,
    itemId: string,
    state: 'AVAILABLE' | 'RESERVED' | 'IN_TRANSIT' | 'DAMAGED' | 'QUARANTINE',
    quantity: number,
  ) => owner.stockBalance.create({ data: { branchId, itemId, state, quantity } });

  const lead = (branchId: string, stage: 'NEW' | 'CONTACTED' | 'WON' | 'LOST', createdAt: string) =>
    owner.lead.create({
      data: {
        branchId,
        name: unique('Lead '),
        phone: phone(),
        source: 'WALK_IN',
        stage,
        createdAt: new Date(createdAt),
        ...(stage === 'WON' ? { customerId: w.customerId } : {}),
      },
    });

  beforeAll(async () => {
    app = await createTestApp();
    w = await createAuthWorld(owner);
    superAdmin = await loggedIn(app, 'superadmin', 'super admin passphrase 42');
    adminA = await loggedIn(app, 'admin_a');
    adminB = await loggedIn(app, 'admin_b');
    staffA = await loggedIn(app, 'staff_a');
    categoryId = (await owner.itemCategory.findFirstOrThrow()).id;

    const broker = await owner.broker.create({ data: { name: 'Dash broker', phone: phone() } });
    const rule = await owner.commissionRule.create({
      data: { brokerId: broker.id, type: 'PERCENT', value: '2.00', isActive: true },
    });

    // ----- Branch A, September 2026 -----
    ids.invA1 = await invoice(w.branchA, '2026-09-05', 100, { brokerId: broker.id });
    ids.invA2 = await invoice(w.branchA, '2026-09-12', 200, {
      dueDate: '2026-09-20',
      brokerId: broker.id,
    });
    ids.invA3 = await invoice(w.branchA, '2026-09-30', 300, { brokerId: broker.id });
    ids.invAug = await invoice(w.branchA, '2026-08-31', 1000, { dueDate: '2026-09-15' });
    await invoice(w.branchA, '2026-09-10', 800, { status: 'DRAFT' });
    // ----- Branch B -----
    ids.invB1 = await invoice(w.branchB, '2026-09-10', 400);

    await payment(w.branchA, ids.invA1!, 105, '2026-09-06');
    await payment(w.branchA, ids.invA2!, 100, '2026-09-13');
    const reversed = await payment(w.branchA, ids.invA3!, 50, '2026-09-14');
    await owner.paymentReversal.create({
      data: {
        branchId: w.branchA,
        paymentId: reversed,
        reason: 'Cheque bounced',
        reversedOn: new Date('2026-09-16'),
      },
    });
    await payment(w.branchA, ids.invA3!, 20, '2026-09-15', 'EXCHANGE');
    await payment(w.branchB, ids.invB1!, 420, '2026-09-11');

    await owner.creditNote.create({
      data: {
        branchId: w.branchA,
        creditNoteNo: unique('DB/CN/'),
        invoiceId: ids.invA3!,
        reason: 'Return',
        amount: '52.50',
        status: 'APPROVED',
        taxableValue: '50.00',
        cgstAmount: '1.25',
        sgstAmount: '1.25',
        decidedBy: w.users.adminA,
        decidedAt: new Date('2026-09-20T10:00:00Z'),
      },
    });
    await owner.creditNote.create({
      data: {
        branchId: w.branchA,
        invoiceId: ids.invA2!,
        reason: 'Pending one',
        amount: '10.50',
        status: 'PENDING',
        taxableValue: '10.00',
        cgstAmount: '0.25',
        sgstAmount: '0.25',
      },
    });

    // ----- Purchases and stock value -----
    ids.itemCosted = await newItem(5);
    ids.itemUncosted = await newItem();
    await purchaseOrder(w.branchA, '2026-09-03', 'RECEIVED', [
      { itemId: ids.itemCosted, qty: 10, cost: 50 },
    ]);
    await purchaseOrder(w.branchA, '2026-09-20', 'APPROVED', [
      { itemId: ids.itemCosted, qty: 4, cost: 60 },
    ]);
    await purchaseOrder(w.branchA, '2026-09-21', 'DRAFT', [
      { itemId: ids.itemCosted, qty: 1, cost: 9999 },
    ]);
    await purchaseOrder(w.branchA, '2026-09-22', 'CANCELLED', [
      { itemId: ids.itemCosted, qty: 1, cost: 9999 },
    ]);
    await purchaseOrder(w.branchB, '2026-09-04', 'APPROVED', [
      { itemId: ids.itemCosted, qty: 2, cost: 55 },
    ]);
    await stock(w.branchA, ids.itemCosted, 'AVAILABLE', 3);
    await stock(w.branchA, ids.itemCosted, 'RESERVED', 2);
    await stock(w.branchA, ids.itemCosted, 'DAMAGED', 7);
    await stock(w.branchA, ids.itemUncosted, 'AVAILABLE', 4);
    await stock(w.branchB, ids.itemCosted, 'IN_TRANSIT', 6);

    // ----- Leads, follow-ups, commissions -----
    await lead(w.branchA, 'WON', '2026-09-02T05:00:00Z');
    await lead(w.branchA, 'NEW', '2026-09-03T05:00:00Z');
    await lead(w.branchA, 'LOST', '2026-09-04T05:00:00Z');
    await lead(w.branchA, 'NEW', '2026-09-05T05:00:00Z');
    await lead(w.branchA, 'WON', '2026-08-20T05:00:00Z');
    await lead(w.branchB, 'CONTACTED', '2026-09-06T05:00:00Z');
    const open = await lead(w.branchA, 'NEW', '2026-09-07T05:00:00Z');
    // 20:00 UTC on 30 September is 01:30 on 1 October in India, so it belongs to October, not September.
    await lead(w.branchA, 'NEW', '2026-09-30T20:00:00Z');
    // 19:00 UTC on 31 August is 00:30 on 1 September in India, so it belongs to September.
    await lead(w.branchA, 'NEW', '2026-08-31T19:00:00Z');
    const day = 86_400_000;
    await owner.leadFollowup.createMany({
      data: [
        { branchId: w.branchA, leadId: open.id, dueAt: new Date(Date.now() - 3 * day) },
        { branchId: w.branchA, leadId: open.id, dueAt: new Date(Date.now() + 40 * day) },
        {
          branchId: w.branchA,
          leadId: open.id,
          dueAt: new Date(Date.now() - 5 * day),
          completedAt: new Date(),
          completedBy: w.users.adminA,
        },
      ],
    });

    const payable = await owner.commission.create({
      data: {
        branchId: w.branchA,
        brokerId: broker.id,
        invoiceId: ids.invA3!,
        ruleId: rule.id,
        amount: '6.00',
        baseAmount: '300.00',
        status: 'PAYABLE',
      },
    });
    await owner.commission.create({
      data: {
        branchId: w.branchA,
        brokerId: broker.id,
        invoiceId: ids.invA1!,
        ruleId: rule.id,
        amount: '2.00',
        baseAmount: '100.00',
        status: 'PAID',
        paidAt: new Date('2026-09-25T06:00:00Z'),
        paidBy: w.users.adminA,
        paidAmount: '2.00',
      },
    });
    const note = await owner.creditNote.findFirstOrThrow({ where: { status: 'APPROVED' } });
    await owner.commissionAdjustment.create({
      data: {
        branchId: w.branchA,
        commissionId: payable.id,
        kind: 'CREDIT_NOTE',
        creditNoteId: note.id,
        amount: '1.00',
      },
    });

    // ----- Batteries: branch A has one expired, one expiring soon, one far away -----
    const battery = async (branchId: string, expiryOn: string, state = 'AVAILABLE' as const) => {
      const unit = await owner.serialUnit.create({
        data: { branchId, itemId: w.itemId, serialNo: unique('DBSN'), state },
      });
      await owner.battery.create({ data: { serialUnitId: unit.id, expiryOn: new Date(expiryOn) } });
    };
    const today = todayInIndia();
    const shift = (days: number): string =>
      new Date(Date.parse(`${today}T00:00:00Z`) + days * day).toISOString().slice(0, 10);
    await battery(w.branchA, shift(-3));
    await battery(w.branchA, shift(10));
    await battery(w.branchA, shift(400));
    await battery(w.branchA, shift(-1), 'SOLD' as never);
    await battery(w.branchB, shift(5));
  });

  // ---------- figures worked out straight from the source tables ----------

  const direct = async (branchId: string | null) => {
    const only = (column: string) =>
      branchId ? Prisma.sql`AND ${Prisma.raw(column)} = ${branchId}::uuid` : Prisma.empty;
    const one = async <T>(sql: Prisma.Sql): Promise<T> =>
      (await owner.$queryRaw<{ v: T }[]>(sql))[0]!.v;
    const today = todayInIndia();
    return {
      sales: money(
        await one<Prisma.Decimal>(
          Prisma.sql`SELECT coalesce(sum(total),0) AS v FROM invoices WHERE status='ISSUED'
            AND issued_on BETWEEN ${FROM}::date AND ${TO}::date ${only('branch_id')}`,
        ),
      ),
      credit: money(
        await one<Prisma.Decimal>(
          Prisma.sql`SELECT coalesce(sum(taxable_value),0) AS v FROM credit_notes WHERE status='APPROVED'
            AND (decided_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${FROM}::date AND ${TO}::date ${only('branch_id')}`,
        ),
      ),
      taxable: money(
        await one<Prisma.Decimal>(
          Prisma.sql`SELECT coalesce(sum(taxable_value),0) AS v FROM invoices WHERE status='ISSUED'
            AND issued_on BETWEEN ${FROM}::date AND ${TO}::date ${only('branch_id')}`,
        ),
      ),
      collected: money(
        await one<Prisma.Decimal>(
          Prisma.sql`SELECT coalesce(sum(amount),0) AS v FROM payments p WHERE mode <> 'EXCHANGE'
            AND paid_on BETWEEN ${FROM}::date AND ${TO}::date
            AND p.id NOT IN (SELECT payment_id FROM payment_reversals) ${only('branch_id')}`,
        ),
      ),
      purchases: money(
        await one<Prisma.Decimal>(
          Prisma.sql`SELECT coalesce(sum(l.qty_ordered * l.unit_cost),0) AS v
            FROM po_lines l JOIN purchase_orders o ON o.id = l.po_id
            WHERE o.status IN ('APPROVED','PARTIALLY_RECEIVED','RECEIVED')
            AND o.order_date BETWEEN ${FROM}::date AND ${TO}::date ${only('o.branch_id')}`,
        ),
      ),
      outstanding: money(
        await one<Prisma.Decimal>(
          Prisma.sql`SELECT coalesce(sum(greatest(i.total
              - coalesce((SELECT sum(n.amount) FROM credit_notes n WHERE n.invoice_id = i.id AND n.status='APPROVED'),0)
              - coalesce((SELECT sum(a.amount) FROM payment_allocations a WHERE a.invoice_id = i.id
                  AND a.payment_id NOT IN (SELECT payment_id FROM payment_reversals)),0), 0)),0) AS v
            FROM invoices i WHERE i.status='ISSUED' ${only('i.branch_id')}`,
        ),
      ),
      overdue: money(
        await one<Prisma.Decimal>(
          Prisma.sql`SELECT coalesce(sum(greatest(i.total
              - coalesce((SELECT sum(n.amount) FROM credit_notes n WHERE n.invoice_id = i.id AND n.status='APPROVED'),0)
              - coalesce((SELECT sum(a.amount) FROM payment_allocations a WHERE a.invoice_id = i.id
                  AND a.payment_id NOT IN (SELECT payment_id FROM payment_reversals)),0), 0)),0) AS v
            FROM invoices i WHERE i.status='ISSUED' AND i.due_date < ${today}::date ${only('i.branch_id')}`,
        ),
      ),
      stockValue: money(
        await one<Prisma.Decimal>(
          Prisma.sql`SELECT coalesce(sum(s.quantity * coalesce((
              SELECT l.unit_cost FROM po_lines l JOIN purchase_orders o ON o.id = l.po_id
              WHERE l.item_id = s.item_id AND o.status IN ('APPROVED','PARTIALLY_RECEIVED','RECEIVED')
              ORDER BY o.order_date DESC, o.created_at DESC, l.id DESC LIMIT 1), 0)),0) AS v
            FROM stock_balances s WHERE s.state IN ('AVAILABLE','RESERVED','IN_TRANSIT') ${only('s.branch_id')}`,
        ),
      ),
      leadsCreated: await one<number>(
        Prisma.sql`SELECT count(*)::int AS v FROM leads
          WHERE ((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${FROM}::date AND ${TO}::date ${only('branch_id')}`,
      ),
      leadsWon: await one<number>(
        Prisma.sql`SELECT count(*)::int AS v FROM leads WHERE stage='WON'
          AND ((created_at AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${FROM}::date AND ${TO}::date ${only('branch_id')}`,
      ),
      commissionPayable: money(
        await one<Prisma.Decimal>(
          Prisma.sql`SELECT coalesce(sum(c.amount - coalesce((SELECT sum(j.amount) FROM commission_adjustments j
            WHERE j.commission_id = c.id),0)),0) AS v FROM commissions c WHERE c.status='PAYABLE' ${only('c.branch_id')}`,
        ),
      ),
      commissionPaid: money(
        await one<Prisma.Decimal>(
          Prisma.sql`SELECT coalesce(sum(paid_amount),0) AS v FROM commissions WHERE status='PAID'
            AND (paid_at AT TIME ZONE 'Asia/Kolkata')::date BETWEEN ${FROM}::date AND ${TO}::date ${only('branch_id')}`,
        ),
      ),
    };
  };

  const company = async (client: TestClient, query = PERIOD): Promise<CompanyDashboard> => {
    const response = await client.get(`/dashboards/company?${query}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return CompanyDashboardSchema.parse(response.body);
  };
  const branch = async (
    client: TestClient,
    branchId: string | null,
    query = PERIOD,
  ): Promise<BranchDashboard> => {
    const id = branchId ? `branchId=${branchId}&` : '';
    const response = await client.get(`/dashboards/branch?${id}${query}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return BranchDashboardSchema.parse(response.body);
  };

  describe('the branch dashboard', () => {
    it('shows a branch the figures it can be checked against by hand', async () => {
      const a = await branch(adminA, w.branchA);
      expect(DashboardPeriodSchema.parse(a.period)).toEqual({ from: FROM, to: TO });
      expect(a.branch).toMatchObject({ id: w.branchA, code: 'AA' });
      expect(a.sales).toEqual({
        invoices: 3,
        sales: '630.00',
        creditNotes: '52.50',
        revenue: '550.00',
        collected: '205.00',
      });
      expect(a.purchases).toEqual({ orders: 2, value: '740.00' });
      // 3 available + 2 reserved of the costed item at its latest cost (60); 4 + 5 units of two never-bought items; damaged stock left out.
      expect(a.stock).toMatchObject({ units: 14, value: '300.00', itemsWithoutCost: 2 });
      expect(a.leads).toEqual({ created: 6, won: 1, conversionRate: 16.7 });
    });

    it('agrees with the source tables for every branch and period', async () => {
      for (const [client, id] of [
        [adminA, w.branchA],
        [adminB, w.branchB],
      ] as const) {
        const figures = await branch(client, id);
        const expected = await direct(id);
        expect(figures.sales.sales).toBe(expected.sales);
        expect(figures.sales.revenue).toBe(
          money(Number(expected.taxable) - Number(expected.credit)),
        );
        expect(figures.sales.collected).toBe(expected.collected);
        expect(figures.purchases.value).toBe(expected.purchases);
        expect(figures.dues.outstanding).toBe(expected.outstanding);
        expect(figures.dues.overdue).toBe(expected.overdue);
        expect(figures.stock.value).toBe(expected.stockValue);
        expect(figures.leads.created).toBe(expected.leadsCreated);
        expect(figures.leads.won).toBe(expected.leadsWon);
      }
    });

    it('leaves out drafts, cancelled and pending documents, reversed payments and trade-ins', async () => {
      const a = await branch(adminA, w.branchA);
      expect(a.sales.invoices).toBe(3);
      expect(a.sales.collected).toBe('205.00');
      expect(a.purchases.orders).toBe(2);
    });

    it('matches the payments module on what is owed', async () => {
      const a = await branch(adminA, w.branchA);
      const dues = await adminA.get(`/dues?scope=outstanding&branchId=${w.branchA}&pageSize=1`);
      expect(dues.status).toBe(200);
      expect(a.dues.outstanding).toBe(dues.body.totals.outstanding);
      expect(a.dues.overdue).toBe(dues.body.totals.overdue);
      expect(a.dues.invoices).toBe(dues.body.totals.invoices);
    });

    it('matches the stock module on low stock and the batteries module on expiry', async () => {
      const a = await branch(adminA, w.branchA, `${PERIOD}&withinDays=30`);
      const low = await adminA.get(`/stock/low-stock?branchId=${w.branchA}&pageSize=1`);
      expect(a.stock.lowStockItems).toBe(low.body.total);
      expect(a.stock.lowStockItems).toBeGreaterThan(0);
      const alerts = await adminA.get(`/batteries/alerts?branchId=${w.branchA}&withinDays=30`);
      expect(a.alerts).toEqual({
        batteriesExpired: alerts.body.expired,
        batteriesExpiring: alerts.body.expiring,
      });
      expect(a.alerts.batteriesExpired).toBeGreaterThanOrEqual(1);
      expect(a.alerts.batteriesExpiring).toBeGreaterThanOrEqual(1);
    });

    it('counts transfers on their way into and out of the branch, and follow-ups by when they fall due', async () => {
      const a = await branch(adminA, w.branchA);
      expect(a.transfers).toEqual({ incoming: 0, outgoing: 1 });
      const b = await branch(adminB, w.branchB);
      expect(b.transfers).toEqual({ incoming: 1, outgoing: 1 });
      expect(a.followups).toEqual({ overdue: 1, today: 0, upcoming: 1 });
      expect(b.followups).toEqual({ overdue: 0, today: 0, upcoming: 0 });
    });

    it('has one trend point per day that adds up to the figures', async () => {
      const a = await branch(adminA, w.branchA);
      expect(a.trend).toHaveLength(30);
      expect(a.trend[0]?.day).toBe(FROM);
      expect(a.trend[29]?.day).toBe(TO);
      const total = (pick: 'sales' | 'purchases' | 'collected') =>
        money(a.trend.reduce((sum, point) => sum + Number(point[pick]), 0));
      expect(total('sales')).toBe(a.sales.sales);
      expect(total('purchases')).toBe(a.purchases.value);
      expect(total('collected')).toBe(a.sales.collected);
      expect(a.trend.find((point) => point.day === '2026-09-12')?.sales).toBe('210.00');
    });

    it('is empty, not broken, for a period with no activity', async () => {
      const a = await branch(adminA, w.branchA, 'from=2020-01-01&to=2020-01-31');
      expect(a.sales).toEqual({
        invoices: 0,
        sales: '0.00',
        creditNotes: '0.00',
        revenue: '0.00',
        collected: '0.00',
      });
      expect(a.leads.conversionRate).toBeNull();
      expect(a.trend).toHaveLength(31);
    });

    it('defaults to this month so far', async () => {
      const a = await branch(adminA, w.branchA, '');
      const today = todayInIndia();
      expect(a.period).toEqual({ from: `${today.slice(0, 8)}01`, to: today });
    });

    it('lets a staff member see their own branch without naming it', async () => {
      const a = await branch(staffA, null);
      expect(a.branch.id).toBe(w.branchA);
    });
  });

  describe('the company dashboard', () => {
    it('adds the branches up, and every branch line matches its own branch dashboard', async () => {
      const all = await company(superAdmin);
      const a = all.branches.find((row) => row.branchId === w.branchA)!;
      const b = all.branches.find((row) => row.branchId === w.branchB)!;
      const sumOf = (pick: (row: (typeof all.branches)[number]) => string): string =>
        money(all.branches.reduce((total, row) => total + Number(pick(row)), 0));
      expect(all.sales.sales).toBe(sumOf((row) => row.sales.sales));
      expect(all.sales.revenue).toBe(sumOf((row) => row.sales.revenue));
      expect(all.purchases.value).toBe(sumOf((row) => row.purchases.value));
      expect(all.dues.outstanding).toBe(sumOf((row) => row.dues.outstanding));
      expect(all.stock.value).toBe(sumOf((row) => row.stock.value));
      expect(all.branchCount).toBe(all.branches.filter((row) => row.isActive).length);

      const lineA = await branch(superAdmin, w.branchA);
      expect(a.sales).toEqual(lineA.sales);
      expect(a.purchases).toEqual(lineA.purchases);
      expect(a.dues).toEqual(lineA.dues);
      expect(a.stock.value).toBe(lineA.stock.value);
      expect(a.leads).toEqual(lineA.leads);
      const lineB = await branch(superAdmin, w.branchB);
      expect(b.sales).toEqual(lineB.sales);
      expect(b.stock.value).toBe(lineB.stock.value);
    });

    it('agrees with the source tables for the whole company', async () => {
      const all = await company(superAdmin);
      const expected = await direct(null);
      expect(all.sales.sales).toBe(expected.sales);
      expect(all.sales.revenue).toBe(money(Number(expected.taxable) - Number(expected.credit)));
      expect(all.sales.collected).toBe(expected.collected);
      expect(all.purchases.value).toBe(expected.purchases);
      expect(all.dues.outstanding).toBe(expected.outstanding);
      expect(all.dues.overdue).toBe(expected.overdue);
      expect(all.stock.value).toBe(expected.stockValue);
      expect(all.leads.created).toBe(expected.leadsCreated);
      expect(all.leads.won).toBe(expected.leadsWon);
      expect(all.commissions).toEqual({
        payable: expected.commissionPayable,
        paid: expected.commissionPaid,
      });
    });

    it('shows commission after credit notes took their share back, and what was paid in the period', async () => {
      const all = await company(superAdmin);
      expect(all.commissions).toEqual({ payable: '5.00', paid: '2.00' });
    });

    it('has a trend that adds up to the company figures', async () => {
      const all = await company(superAdmin);
      const total = money(all.trend.reduce((sum, point) => sum + Number(point.sales), 0));
      expect(total).toBe(all.sales.sales);
      expect(all.trend).toHaveLength(30);
    });

    it('counts items in stock that were never bought once across the company', async () => {
      const all = await company(superAdmin);
      expect(all.stock.itemsWithoutCost).toBeGreaterThanOrEqual(1);
    });

    it('counts leads created in the period and how many of them are won', async () => {
      const all = await company(superAdmin);
      expect(all.leads.created).toBe(7);
      expect(all.leads.won).toBe(1);
      expect(all.leads.conversionRate).toBe(14.3);
    });
  });

  describe('who may look', () => {
    it('answers 401 without a session', async () => {
      for (const path of ['/dashboards/company', '/dashboards/branch']) {
        const response = await request(app.getHttpServer()).get(path);
        expect(response.status).toBe(401);
      }
    });

    it('refuses the company dashboard to anyone without that permission', async () => {
      for (const client of [adminA, staffA]) {
        const response = await client.get(`/dashboards/company?${PERIOD}`);
        expect(response.status).toBe(403);
        expect(response.body.code).toBe('FORBIDDEN');
      }
    });

    it('refuses the branch dashboard to a role without the permission', async () => {
      const role = await owner.role.create({
        data: { name: unique('NO_DASH_'), tier: 'STAFF', description: 'no dashboards' },
      });
      await owner.rolePermission.create({
        data: {
          roleId: role.id,
          permissionId: (await owner.permission.findFirstOrThrow({ where: { code: 'items.view' } }))
            .id,
        },
      });
      await owner.user.create({
        data: {
          username: 'no_dash',
          email: 'no_dash@example.com',
          fullName: 'No Dash',
          passwordHash: (await owner.user.findFirstOrThrow({ where: { username: 'staff_a' } }))
            .passwordHash,
          userRoles: { create: { roleId: role.id } },
          userBranches: { create: { branchId: w.branchA } },
        },
      });
      const client = await loggedIn(app, 'no_dash');
      const response = await client.get(`/dashboards/branch?branchId=${w.branchA}&${PERIOD}`);
      expect(response.status).toBe(403);
    });

    it('keeps a branch user to their own branch, whether they name another or not', async () => {
      const other = await adminA.get(`/dashboards/branch?branchId=${w.branchB}&${PERIOD}`);
      expect(other.status).toBe(403);
      expect(other.body.code).toBe('FORBIDDEN');
      const reverse = await adminB.get(`/dashboards/branch?branchId=${w.branchA}&${PERIOD}`);
      expect(reverse.status).toBe(403);
      const own = await branch(adminB, null);
      expect(own.branch.id).toBe(w.branchB);
    });

    it("never lets a branch's figures include another branch's rows", async () => {
      const a = await branch(adminA, w.branchA);
      const b = await branch(adminB, w.branchB);
      expect(a.sales.sales).toBe('630.00');
      expect(b.sales.sales).toBe('420.00');
      expect(b.sales.collected).toBe('420.00');
      expect(b.purchases.value).toBe('110.00');
      expect(b.stock).toMatchObject({ units: 13, value: '360.00' });
    });

    it('shows a company dashboard limited to the branch a user works in when they pick one', async () => {
      const response = await superAdmin
        .get(`/dashboards/company?${PERIOD}`)
        .set('X-Branch-Id', w.branchB);
      expect(response.status).toBe(200);
      const body = CompanyDashboardSchema.parse(response.body);
      expect(body.branches.map((row) => row.branchId)).toEqual([w.branchB]);
      expect(body.sales.sales).toBe('420.00');
    });

    it('asks a Super Admin who works across all branches to choose one', async () => {
      const response = await superAdmin.get(`/dashboards/branch?${PERIOD}`);
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.details[0].field).toBe('branchId');
    });

    it('lets a Super Admin open any branch, and says so when the branch does not exist', async () => {
      const b = await branch(superAdmin, w.branchB);
      expect(b.branch.id).toBe(w.branchB);
      const missing = await superAdmin.get(
        `/dashboards/branch?branchId=00000000-0000-4000-8000-000000000000&${PERIOD}`,
      );
      expect(missing.status).toBe(404);
    });
  });

  describe('what it refuses', () => {
    const bad = async (client: TestClient, path: string) => {
      const response = await client.get(path);
      expect(response.status, path).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      return response.body;
    };

    it('rejects a period that is back to front, too long, half given or not a date', async () => {
      await bad(superAdmin, '/dashboards/company?from=2026-09-30&to=2026-09-01');
      await bad(superAdmin, '/dashboards/company?from=2025-01-01&to=2026-09-30');
      await bad(superAdmin, '/dashboards/company?from=2026-09-01');
      await bad(superAdmin, '/dashboards/company?to=2026-09-30');
      await bad(superAdmin, '/dashboards/company?from=2026-02-31&to=2026-03-01');
      await bad(adminA, `/dashboards/branch?branchId=${w.branchA}&from=yesterday&to=today`);
    });

    it('accepts exactly 366 days and refuses 367', async () => {
      const ok = await superAdmin.get('/dashboards/company?from=2025-09-30&to=2026-09-30');
      expect(ok.status).toBe(200);
      await bad(superAdmin, '/dashboards/company?from=2025-09-29&to=2026-09-30');
    });

    it('rejects unknown parameters, a bad branch id and a bad expiry window', async () => {
      await bad(superAdmin, `/dashboards/company?${PERIOD}&unknown=1`);
      await bad(adminA, `/dashboards/branch?branchId=not-a-uuid&${PERIOD}`);
      await bad(superAdmin, `/dashboards/company?${PERIOD}&withinDays=0`);
      await bad(superAdmin, `/dashboards/company?${PERIOD}&withinDays=366`);
    });

    it('is not fooled by a hostile branch id', async () => {
      await bad(
        adminA,
        `/dashboards/branch?branchId=${encodeURIComponent("x'; DROP TABLE invoices;--")}&${PERIOD}`,
      );
      expect(await owner.invoice.count()).toBeGreaterThan(0);
    });
  });

  describe('the database views', () => {
    it('are read-only for the application', async () => {
      await expect(
        owner.$executeRawUnsafe(
          `SET ROLE erp_app; INSERT INTO v_daily_sales (branch_id) VALUES (NULL)`,
        ),
      ).rejects.toThrow();
    });

    it('show an application user nothing outside their branches, even when asked directly', async () => {
      const rows = await owner.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL ROLE erp_app');
        await tx.$executeRaw`SELECT set_config('app.branch_ids', ${w.branchA}, true), set_config('app.is_super', 'false', true)`;
        return tx.$queryRawUnsafe<{ branch_id: string }[]>(
          `SELECT DISTINCT branch_id FROM v_daily_sales
           UNION SELECT DISTINCT branch_id FROM v_invoice_balances
           UNION SELECT DISTINCT branch_id FROM v_stock_value_by_branch
           UNION SELECT DISTINCT branch_id FROM v_low_stock
           UNION SELECT DISTINCT branch_id FROM v_daily_leads
           UNION SELECT DISTINCT branch_id FROM v_battery_expiry_stock`,
        );
      });
      expect(rows.map((row) => row.branch_id)).toEqual([w.branchA]);
    });

    it('value stock at the same cost in every branch', async () => {
      const rows = await owner.$transaction(async (tx) => {
        await tx.$executeRawUnsafe('SET LOCAL ROLE erp_app');
        await tx.$executeRaw`SELECT set_config('app.branch_ids', ${w.branchB}, true), set_config('app.is_super', 'false', true)`;
        return tx.$queryRawUnsafe<{ unit_cost: Prisma.Decimal }[]>(
          `SELECT unit_cost FROM v_stock_value_by_branch WHERE item_id = '${ids.itemCosted}'`,
        );
      });
      // Branch B bought the item at 55, but the latest cost anywhere is branch A's 60 on 2026-09-20.
      expect(rows.map((row) => money(row.unit_cost))).toEqual(['60.00']);
    });
  });
});
