import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  REPORT_CODES,
  ReportCatalogSchema,
  ReportResponseSchema,
  todayInIndia,
} from '@erp/contracts';
import type { ReportCode, ReportResponse } from '@erp/contracts';
import { Prisma } from '@prisma/client';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAuthWorld, loggedIn } from '../support/auth-world.js';
import type { AuthWorld, TestClient } from '../support/auth-world.js';
import { createTestApp } from '../support/create-test-app.js';
import { createOwnerPrisma } from '../support/fixtures.js';
import { readZip } from '../support/zip-reader.js';

const FROM = '2026-09-01';
const TO = '2026-09-30';
const PERIOD = `from=${FROM}&to=${TO}`;
const day = 86_400_000;
const money = (value: Prisma.Decimal | number | string): string =>
  new Prisma.Decimal(value).toFixed(2);

describe('reports', () => {
  let app: NestExpressApplication;
  let w: AuthWorld;
  let superAdmin: TestClient;
  let adminA: TestClient;
  let adminB: TestClient;
  let reportsOnly: TestClient;
  let exporter: TestClient;
  const owner = createOwnerPrisma();
  let n = 0;
  const unique = (prefix: string): string => `${prefix}${(n += 1).toString().padStart(4, '0')}`;
  const phone = (): string => `7${(n += 1).toString().padStart(9, '0')}`;
  const ids: Record<string, string> = {};
  const recentFrom = new Date(Date.now() - 30 * day).toISOString().slice(0, 10);
  const recentTo = new Date(Date.now() + day).toISOString().slice(0, 10);
  const RECENT = `from=${recentFrom}&to=${recentTo}`;

  const invoice = async (
    branchId: string,
    issuedOn: string,
    taxable: number,
    options: { type?: 'GST' | 'NON_GST'; dueDate?: string; brokerId?: string; gstin?: string } = {},
  ): Promise<string> => {
    const gst = (options.type ?? 'GST') === 'GST';
    const tax = gst ? taxable * 0.025 : 0;
    return (
      await owner.invoice.create({
        data: {
          branchId,
          customerId: w.customerId,
          type: options.type ?? 'GST',
          invoiceNo: unique('RP/INV/'),
          status: 'ISSUED',
          subtotal: money(taxable),
          taxableValue: money(taxable),
          cgstAmount: money(tax),
          sgstAmount: money(tax),
          total: money(taxable + tax * 2),
          placeOfSupply: '27',
          issuedOn: new Date(issuedOn),
          ...(options.dueDate ? { dueDate: new Date(options.dueDate) } : {}),
          ...(options.brokerId ? { brokerId: options.brokerId } : {}),
          ...(options.gstin ? { customerGstin: options.gstin } : {}),
        },
      })
    ).id;
  };

  const pay = async (
    branchId: string,
    invoiceId: string,
    amount: number,
    paidOn: string,
  ): Promise<string> => {
    const payment = await owner.payment.create({
      data: {
        branchId,
        receiptNo: unique('RP/RCT/'),
        customerId: w.customerId,
        mode: 'CASH',
        amount: money(amount),
        paidOn: new Date(paidOn),
        idempotencyKey: unique('rkey-'),
      },
    });
    await owner.paymentAllocation.create({
      data: { paymentId: payment.id, invoiceId, branchId, amount: money(amount) },
    });
    return payment.id;
  };

  const order = (
    branchId: string,
    date: string,
    status: 'APPROVED' | 'DRAFT',
    itemId: string,
    qty: number,
    cost: number,
  ) =>
    owner.purchaseOrder.create({
      data: {
        branchId,
        poNo: unique('RP/PO/'),
        supplierId: w.supplierId,
        status,
        orderDate: new Date(date),
        poLines: { create: [{ branchId, itemId, qtyOrdered: qty, unitCost: money(cost) }] },
      },
    });

  const run = async (
    client: TestClient,
    code: ReportCode,
    query = PERIOD,
  ): Promise<ReportResponse> => {
    const response = await client.get(`/reports/${code}?${query}`);
    expect(response.status, `${code} ${JSON.stringify(response.body).slice(0, 300)}`).toBe(200);
    return ReportResponseSchema.parse(response.body);
  };
  const col = (report: ReportResponse, key: string): unknown[] =>
    report.rows.map((row) => row[key]);

  beforeAll(async () => {
    app = await createTestApp();
    w = await createAuthWorld(owner);
    superAdmin = await loggedIn(app, 'superadmin', 'super admin passphrase 42');
    adminA = await loggedIn(app, 'admin_a');
    adminB = await loggedIn(app, 'admin_b');

    const mkRole = async (name: string, codes: string[]) => {
      const role = await owner.role.create({ data: { name, tier: 'STAFF', description: name } });
      for (const code of codes)
        await owner.rolePermission.create({
          data: {
            roleId: role.id,
            permissionId: (await owner.permission.findFirstOrThrow({ where: { code } })).id,
          },
        });
      return role.id;
    };
    const hash = (await owner.user.findFirstOrThrow({ where: { username: 'staff_a' } }))
      .passwordHash;
    const mkUser = async (username: string, roleId: string) =>
      owner.user.create({
        data: {
          username,
          email: `${username}@example.com`,
          fullName: `Person ${username}`,
          passwordHash: hash,
          userRoles: { create: { roleId } },
          userBranches: { create: { branchId: w.branchA } },
        },
      });
    await mkUser('rep_only', await mkRole('REPORTS_ONLY', ['reports.view', 'invoices.view']));
    await mkUser(
      'rep_export',
      await mkRole('REPORTS_EXPORT', ['reports.view', 'reports.export', 'invoices.view']),
    );
    reportsOnly = await loggedIn(app, 'rep_only');
    exporter = await loggedIn(app, 'rep_export');

    const categoryId = (await owner.itemCategory.findFirstOrThrow()).id;
    const item = await owner.item.create({
      data: {
        itemCode: unique('RPI'),
        name: 'Report item',
        categoryId,
        unitCode: 'PCS',
        reorderLevel: 0,
      },
    });
    ids.item = item.id;

    // Sales, payments and dues.
    const broker = await owner.broker.create({ data: { name: 'Report broker', phone: phone() } });
    const rule = await owner.commissionRule.create({
      data: { brokerId: broker.id, type: 'PERCENT', value: '2.00', isActive: true },
    });
    ids.a1 = await invoice(w.branchA, '2026-09-05', 100, {
      brokerId: broker.id,
      gstin: '27ABCDE1234F1Z5',
    });
    ids.a2 = await invoice(w.branchA, '2026-09-12', 200, {
      dueDate: '2026-09-20',
      brokerId: broker.id,
    });
    ids.a3 = await invoice(w.branchA, '2026-09-30', 300, { type: 'NON_GST' });
    ids.aug = await invoice(w.branchA, '2026-08-31', 1000, { dueDate: '2026-09-15' });
    ids.b1 = await invoice(w.branchB, '2026-09-10', 400);
    await pay(w.branchA, ids.a1!, 105, '2026-09-06');
    await pay(w.branchA, ids.a2!, 100, '2026-09-13');
    const reversed = await pay(w.branchA, ids.a3!, 50, '2026-09-14');
    await owner.paymentReversal.create({
      data: {
        branchId: w.branchA,
        paymentId: reversed,
        reason: 'Cheque bounced',
        reversedOn: new Date('2026-09-16'),
      },
    });
    await pay(w.branchB, ids.b1!, 420, '2026-09-11');

    // Purchases and stock.
    await order(w.branchA, '2026-09-03', 'APPROVED', item.id, 10, 50);
    await order(w.branchA, '2026-09-20', 'APPROVED', item.id, 4, 60);
    await order(w.branchA, '2026-09-21', 'DRAFT', item.id, 1, 9999);
    await order(w.branchB, '2026-09-04', 'APPROVED', item.id, 2, 55);
    await owner.stockBalance.createMany({
      data: [
        { branchId: w.branchA, itemId: item.id, state: 'AVAILABLE', quantity: 3 },
        { branchId: w.branchA, itemId: item.id, state: 'RESERVED', quantity: 2 },
        { branchId: w.branchA, itemId: item.id, state: 'DAMAGED', quantity: 7 },
        { branchId: w.branchB, itemId: item.id, state: 'IN_TRANSIT', quantity: 6 },
      ],
    });

    // A stock adjustment, a short delivery and an exchange (all dated today).
    await owner.stockAdjustment.create({
      data: {
        branchId: w.branchA,
        itemId: item.id,
        kind: 'OUT',
        state: 'AVAILABLE',
        qty: 1,
        reason: 'Counted one fewer',
        status: 'PENDING',
        requestedBy: w.users.adminA,
      },
    });
    const line = await owner.transferLine.findFirstOrThrow({ where: { transferId: w.transferAB } });
    await owner.discrepancy.create({
      data: { branchId: w.branchA, transferLineId: line.id, type: 'SHORT', qty: 1 },
    });
    const unit = (serialNo: string) =>
      owner.serialUnit.create({
        data: { branchId: w.branchA, itemId: w.itemId, serialNo, state: 'AVAILABLE' },
      });
    const oldUnit = await unit(unique('RPSN'));
    const newUnit = await unit(unique('RPSN'));
    // The lines of an issued invoice are frozen, so build each invoice as a draft, add its line, then issue it.
    const soldWith = async (serialUnitId: string): Promise<string> => {
      const draft = await owner.invoice.create({
        data: {
          branchId: w.branchA,
          customerId: w.customerId,
          type: 'GST',
          status: 'DRAFT',
          subtotal: '100.00',
          taxableValue: '100.00',
          cgstAmount: '2.50',
          sgstAmount: '2.50',
          total: '105.00',
          placeOfSupply: '27',
        },
      });
      await owner.invoiceLine.create({
        data: {
          lineNo: 1,
          invoiceId: draft.id,
          branchId: w.branchA,
          itemId: w.itemId,
          serialUnitId,
          qty: 1,
          amount: '105.00',
          unitPrice: '100.00',
          taxableAmount: '100.00',
        },
      });
      await owner.invoice.update({
        where: { id: draft.id },
        data: { status: 'ISSUED', invoiceNo: unique('RP/INV/'), issuedOn: new Date('2026-08-01') },
      });
      return draft.id;
    };
    const soldOld = await soldWith(oldUnit.id);
    const soldNew = await soldWith(newUnit.id);
    await owner.exchange.create({
      data: {
        branchId: w.branchA,
        invoiceId: soldNew,
        originalInvoiceId: soldOld,
        oldSerialUnitId: oldUnit.id,
        newSerialUnitId: newUnit.id,
        exchangeNo: unique('RP/EXC/'),
        kind: 'OLD_FOR_NEW',
        disposition: 'STOCK',
        reason: 'Customer changed mind',
        status: 'APPROVED',
        decidedBy: w.users.adminA,
        decidedAt: new Date(),
        returnedAmount: '105.00',
        returnedTaxable: '100.00',
        valuationAmount: '90.00',
        newAmount: '120.00',
        differenceAmount: '30.00',
      },
    });

    // Leads from two sources.
    for (const [code, name] of [
      ['REFERRAL', 'Referral'],
      ['WALK_IN', 'Walk-in'],
    ] as const)
      await owner.leadSource.upsert({ where: { code }, update: { name }, create: { code, name } });
    const lead = (branchId: string, stage: 'NEW' | 'WON' | 'LOST', source: string, at: string) =>
      owner.lead.create({
        data: {
          branchId,
          name: unique('Lead '),
          phone: phone(),
          source,
          stage,
          createdAt: new Date(at),
          ...(stage === 'WON' ? { customerId: w.customerId } : {}),
        },
      });
    await lead(w.branchA, 'WON', 'WALK_IN', '2026-09-02T05:00:00Z');
    await lead(w.branchA, 'NEW', 'WALK_IN', '2026-09-03T05:00:00Z');
    await lead(w.branchA, 'LOST', 'WALK_IN', '2026-09-04T05:00:00Z');
    await lead(w.branchA, 'NEW', 'REFERRAL', '2026-09-05T05:00:00Z');
    await lead(w.branchB, 'NEW', 'WALK_IN', '2026-09-06T05:00:00Z');
    await lead(w.branchA, 'NEW', 'WALK_IN', '2026-09-30T20:00:00Z'); // 1 October in India

    // Commission and attendance.
    const payable = await owner.commission.create({
      data: {
        branchId: w.branchA,
        brokerId: broker.id,
        invoiceId: ids.a2!,
        ruleId: rule.id,
        amount: '4.00',
        baseAmount: '200.00',
        status: 'PAYABLE',
        createdAt: new Date('2026-09-13T05:00:00Z'),
      },
    });
    await owner.commission.create({
      data: {
        branchId: w.branchA,
        brokerId: broker.id,
        invoiceId: ids.a1!,
        ruleId: rule.id,
        amount: '2.00',
        baseAmount: '100.00',
        status: 'PAID',
        paidAt: new Date('2026-09-25T06:00:00Z'),
        paidBy: w.users.adminA,
        paidAmount: '2.00',
        createdAt: new Date('2026-09-06T05:00:00Z'),
      },
    });
    const note = await owner.creditNote.create({
      data: {
        branchId: w.branchA,
        creditNoteNo: unique('RP/CN/'),
        invoiceId: ids.a2!,
        reason: 'Return',
        amount: '10.50',
        status: 'APPROVED',
        taxableValue: '10.00',
        cgstAmount: '0.25',
        sgstAmount: '0.25',
        decidedBy: w.users.adminA,
        decidedAt: new Date('2026-09-20T10:00:00Z'),
      },
    });
    await owner.commissionAdjustment.create({
      data: {
        branchId: w.branchA,
        commissionId: payable.id,
        kind: 'CREDIT_NOTE',
        creditNoteId: note.id,
        amount: '1.00',
      },
    });
    const staffUser = await owner.user.create({
      data: {
        username: 'staff_rep',
        email: 'staff_rep@example.com',
        fullName: 'Asha Verma',
        passwordHash: hash,
      },
    });
    const staff = await owner.staff.create({
      data: {
        branchId: w.branchA,
        userId: staffUser.id,
        employeeCode: unique('EMP'),
        designation: 'Cashier',
        joinDate: new Date('2025-01-01'),
        monthlySalary: '20000.00',
      },
    });
    for (const d of ['2026-09-07', '2026-09-08', '2026-09-09'])
      await owner.attendance.create({
        data: {
          branchId: w.branchA,
          staffId: staff.id,
          workDate: new Date(d),
          checkIn: new Date(`${d}T04:00:00Z`),
        },
      });
    // Leave: 10 to 12 September (3 days) and 30 August to 2 September (only 1 and 2 September fall in the period).
    await owner.leaveRequest.createMany({
      data: [
        {
          branchId: w.branchA,
          staffId: staff.id,
          fromDate: new Date('2026-09-10'),
          toDate: new Date('2026-09-12'),
          kind: 'PAID',
          reason: 'x',
          status: 'APPROVED',
          decidedBy: w.users.adminA,
          decidedAt: new Date(),
        },
        {
          branchId: w.branchA,
          staffId: staff.id,
          fromDate: new Date('2026-08-30'),
          toDate: new Date('2026-09-02'),
          kind: 'PAID',
          reason: 'x',
          status: 'APPROVED',
          decidedBy: w.users.adminA,
          decidedAt: new Date(),
        },
        {
          branchId: w.branchA,
          staffId: staff.id,
          fromDate: new Date('2026-09-20'),
          toDate: new Date('2026-09-21'),
          kind: 'PAID',
          reason: 'x',
          status: 'PENDING',
        },
      ],
    });

    // Batteries: expired, expiring soon, and far away, in branch A; one expiring in branch B.
    const today = todayInIndia();
    const shift = (days: number): string =>
      new Date(Date.parse(`${today}T00:00:00Z`) + days * day).toISOString().slice(0, 10);
    const battery = async (branchId: string, expiryOn: string) => {
      const su = await owner.serialUnit.create({
        data: { branchId, itemId: w.itemId, serialNo: unique('RPBT'), state: 'AVAILABLE' },
      });
      await owner.battery.create({ data: { serialUnitId: su.id, expiryOn: new Date(expiryOn) } });
    };
    await battery(w.branchA, shift(-3));
    await battery(w.branchA, shift(10));
    await battery(w.branchA, shift(400));
    await battery(w.branchB, shift(5));
  });

  describe('the catalog', () => {
    it('lists all 16 reports with their columns for a Super Admin', async () => {
      const response = await superAdmin.get('/reports');
      expect(response.status).toBe(200);
      const catalog = ReportCatalogSchema.parse(response.body);
      expect(catalog.map((entry) => entry.code).sort()).toEqual([...REPORT_CODES].sort());
      for (const entry of catalog) {
        expect(entry.columns.length).toBeGreaterThan(2);
        expect(entry.title).toBeTruthy();
      }
      expect(
        catalog
          .filter((entry) => !entry.usesPeriod)
          .map((entry) => entry.code)
          .sort(),
      ).toEqual(['BATTERY_EXPIRY', 'DUES', 'STOCK']);
    });

    it('shows each person only the reports whose own module they may view', async () => {
      const mine = ReportCatalogSchema.parse((await reportsOnly.get('/reports')).body);
      expect(mine.map((entry) => entry.code).sort()).toEqual(
        ['EXCHANGES', 'GST_SALES', 'NON_GST_SALES', 'SALES'].sort(),
      );
    });
  });

  describe('what each report shows', () => {
    it('every report runs for a Super Admin, with the columns the catalog promises', async () => {
      const catalog = ReportCatalogSchema.parse((await superAdmin.get('/reports')).body);
      for (const entry of catalog) {
        const report = await run(superAdmin, entry.code, RECENT);
        expect(report.report.columns).toEqual(entry.columns);
        for (const row of report.rows)
          expect(Object.keys(row).sort()).toEqual(entry.columns.map((c) => c.key).sort());
      }
    });

    it('sales: issued invoices only, with taxable value, tax and total', async () => {
      const sales = await run(adminA, 'SALES');
      expect(sales.total).toBe(3);
      expect(sales.totals).toMatchObject({ taxable: '600.00', tax: '15.00', total: '615.00' });
      expect(col(sales, 'type').sort()).toEqual(['GST', 'GST', 'NON_GST']);
      expect(sales.period).toEqual({ from: FROM, to: TO });
    });

    it('GST and non-GST sales are split, with the GST amounts and the customer GSTIN', async () => {
      const gst = await run(adminA, 'GST_SALES');
      expect(gst.totals).toMatchObject({
        taxable: '300.00',
        cgst: '7.50',
        sgst: '7.50',
        igst: '0.00',
        total: '315.00',
      });
      expect(col(gst, 'gstin')).toContain('27ABCDE1234F1Z5');
      const non = await run(adminA, 'NON_GST_SALES');
      expect(non.totals).toMatchObject({ taxable: '300.00', total: '300.00' });
      expect(non.total).toBe(1);
    });

    it('purchases: approved orders only, quantity times cost', async () => {
      const purchases = await run(adminA, 'PURCHASES');
      expect(purchases.total).toBe(2);
      expect(purchases.totals).toMatchObject({ qty: '14', value: '740.00' });
    });

    it('stock: today, by branch and item, valued at the latest cost', async () => {
      const stock = await run(adminA, 'STOCK');
      const row = stock.rows.find((r) => r['item'] === 'Report item')!;
      expect(row).toMatchObject({
        branch: 'AA',
        available: 3,
        reserved: 2,
        damaged: 7,
        value: '300.00',
      });
      expect(stock.report.usesPeriod).toBe(false);
      expect(stock.period).toBeNull();
    });

    it('transfers: requested in the period, with the quantities on each line', async () => {
      const transfers = await run(superAdmin, 'TRANSFERS', RECENT);
      expect(col(transfers, 'transferNo')).toEqual(
        expect.arrayContaining(['AATRF/2627/00001', 'BBTRF/2627/00001']),
      );
      const one = transfers.rows.find((r) => r['transferNo'] === 'AATRF/2627/00001')!;
      expect(one).toMatchObject({ fromBranch: 'AA', toBranch: 'BB', status: 'REQUESTED' });
    });

    it('adjustments, exchanges and damaged or short stock show what happened today', async () => {
      const adjustments = await run(adminA, 'ADJUSTMENTS', RECENT);
      expect(
        adjustments.rows.some(
          (r) => r['reason'] === 'Counted one fewer' && r['status'] === 'PENDING',
        ),
      ).toBe(true);
      const exchanges = await run(adminA, 'EXCHANGES', RECENT);
      expect(exchanges.rows).toHaveLength(1);
      expect(exchanges.rows[0]).toMatchObject({
        kind: 'OLD_FOR_NEW',
        returned: '105.00',
        valuation: '90.00',
        given: '120.00',
        difference: '30.00',
      });
      const damaged = await run(adminA, 'DAMAGED_SHORT_STOCK', RECENT);
      expect(damaged.rows.find((r) => r['kind'] === 'Damaged stock on hand')).toMatchObject({
        branch: 'AA',
        qty: 7,
      });
      expect(damaged.rows.find((r) => r['kind'] === 'Receiving short')).toMatchObject({
        branch: 'AA',
        qty: 1,
        status: 'Open',
      });
    });

    it('dues: what is owed today, equal to the payments module', async () => {
      const dues = await run(adminA, 'DUES');
      const api = await adminA.get(`/dues?scope=outstanding&branchId=${w.branchA}&pageSize=1`);
      expect(dues.totals['outstanding']).toBe(api.body.totals.outstanding);
      expect(dues.total).toBe(api.body.totals.invoices);
      const aug = dues.rows.find((r) => r['dueDate'] === '2026-09-15')!;
      expect(aug['daysOverdue']).toBeGreaterThan(0);
      expect(aug['outstanding']).toBe('1050.00');
    });

    it('payments: everything received in the period, with reversals marked', async () => {
      const payments = await run(adminA, 'PAYMENTS');
      expect(payments.total).toBe(3);
      expect(col(payments, 'status').sort()).toEqual(['Received', 'Received', 'Reversed']);
      expect(payments.totals['amount']).toBe('255.00');
    });

    it('commissions: what each is worth now and what was paid', async () => {
      const commissions = await run(adminA, 'COMMISSIONS');
      expect(commissions.total).toBe(2);
      expect(commissions.totals).toMatchObject({ amount: '6.00', payable: '3.00', paid: '2.00' });
    });

    it('leads: by source, with conversion, counting by the date in India', async () => {
      const leads = await run(superAdmin, 'LEADS');
      const walkIn = leads.rows.find((r) => r['source'] === 'Walk-in')!;
      expect(walkIn).toMatchObject({ created: 4, won: 1, lost: 1, open: 2, conversion: '25.0%' });
      const referral = leads.rows.find((r) => r['source'] === 'Referral')!;
      expect(referral).toMatchObject({ created: 1, won: 0, conversion: '0.0%' });
    });

    it('attendance: days present and approved leave, counting only the days inside the period', async () => {
      const attendance = await run(adminA, 'ATTENDANCE');
      const row = attendance.rows.find((r) => r['name'] === 'Asha Verma')!;
      expect(row).toMatchObject({ designation: 'Cashier', daysPresent: 3, leaveDays: 5 });
    });

    it('branch performance: one line per branch, the same as the dashboard', async () => {
      const report = await run(superAdmin, 'BRANCH_PERFORMANCE');
      const a = report.rows.find((r) => r['branch'] === 'AA')!;
      expect(a).toMatchObject({
        invoices: 3,
        sales: '615.00',
        purchases: '740.00',
        collected: '205.00',
        leads: 4,
        won: 1,
      });
      const dash = await superAdmin.get(`/dashboards/branch?branchId=${w.branchA}&${PERIOD}`);
      expect(a['sales']).toBe(dash.body.sales.sales);
      expect(a['outstanding']).toBe(dash.body.dues.outstanding);
      expect(a['stockValue']).toBe(dash.body.stock.value);
      expect(a['revenue']).toBe(dash.body.sales.revenue);
    });

    it('battery expiry: expired and the next 90 days, soonest first', async () => {
      const report = await run(adminA, 'BATTERY_EXPIRY');
      expect(report.rows.map((r) => r['status'])).toEqual(['Expired', 'Expiring']);
      expect(report.rows[0]!['daysLeft']).toBe(-3);
      expect(report.rows[1]!['daysLeft']).toBe(10);
    });
  });

  describe('branches and who may see what', () => {
    it("a branch user never sees another branch's rows in any report", async () => {
      for (const code of REPORT_CODES.filter(
        (c) => c !== 'ATTENDANCE' && c !== 'BRANCH_PERFORMANCE',
      )) {
        const rows = (await run(superAdmin, code, RECENT)).rows;
        const forB = await run(adminB, code, RECENT).catch(() => null);
        if (!forB) continue;
        for (const row of forB.rows) {
          for (const key of ['branch', 'fromBranch', 'toBranch'])
            if (key in row && key === 'branch') expect(row[key]).toBe('BB');
        }
        expect(rows.length).toBeGreaterThanOrEqual(forB.rows.length);
      }
    });

    it('branch B sees only its own sales and money', async () => {
      const sales = await run(adminB, 'SALES');
      expect(sales.totals['total']).toBe('420.00');
      const payments = await run(adminB, 'PAYMENTS');
      expect(payments.totals['amount']).toBe('420.00');
    });

    it('a Super Admin can narrow to one branch; a branch user may not name another', async () => {
      const one = await run(superAdmin, 'SALES', `${PERIOD}&branchId=${w.branchB}`);
      expect(one.totals['total']).toBe('420.00');
      expect(one.branchId).toBe(w.branchB);
      const all = await run(superAdmin, 'SALES');
      expect(all.totals['total']).toBe('1035.00');
      const other = await adminA.get(`/reports/SALES?${PERIOD}&branchId=${w.branchB}`);
      expect(other.status).toBe(403);
    });

    it('refuses a report to someone who may not view its module', async () => {
      const response = await reportsOnly.get(`/reports/PAYMENTS?${PERIOD}`);
      expect(response.status).toBe(403);
      expect((await reportsOnly.get(`/reports/PAYMENTS/export?format=pdf&${PERIOD}`)).status).toBe(
        403,
      );
    });

    it('answers 401 without a session and 404 for a report that does not exist', async () => {
      expect((await request(app.getHttpServer()).get('/reports')).status).toBe(401);
      expect((await request(app.getHttpServer()).get(`/reports/SALES?${PERIOD}`)).status).toBe(401);
      expect((await superAdmin.get('/reports/NOPE')).status).toBe(404);
    });
  });

  describe('sorting, paging and filters', () => {
    it('pages the rows but totals every row', async () => {
      const page = await run(adminA, 'SALES', `${PERIOD}&pageSize=1&page=2`);
      expect(page.rows).toHaveLength(1);
      expect(page.total).toBe(3);
      expect(page.totalPages).toBe(3);
      expect(page.totals['total']).toBe('615.00');
    });

    it('sorts by any column, both ways', async () => {
      const asc = await run(adminA, 'SALES', `${PERIOD}&sortBy=total&sortOrder=asc`);
      const desc = await run(adminA, 'SALES', `${PERIOD}&sortBy=total&sortOrder=desc`);
      expect(col(asc, 'total')).toEqual(['105.00', '210.00', '300.00']);
      expect(col(desc, 'total')).toEqual(['300.00', '210.00', '105.00']);
    });

    it('sorts every report by each of its columns without error', async () => {
      for (const code of REPORT_CODES) {
        const catalog = ReportCatalogSchema.parse((await superAdmin.get('/reports')).body);
        const entry = catalog.find((c) => c.code === code)!;
        for (const column of entry.columns) {
          const response = await superAdmin.get(
            `/reports/${code}?${RECENT}&sortBy=${column.key}&sortOrder=desc&pageSize=5`,
          );
          expect(response.status, `${code} ${column.key}`).toBe(200);
        }
      }
    });

    it('ignores the dates for reports that describe today, and says so', async () => {
      const stock = await run(adminA, 'STOCK', 'from=2020-01-01&to=2020-01-31');
      expect(stock.period).toBeNull();
      expect(stock.rows.length).toBeGreaterThan(0);
    });

    it('is empty, not broken, for a quiet period', async () => {
      const sales = await run(adminA, 'SALES', 'from=2020-01-01&to=2020-01-31');
      expect(sales).toMatchObject({
        rows: [],
        total: 0,
        totalPages: 0,
        totals: { taxable: '0.00', tax: '0.00', total: '0.00' },
      });
    });

    it('defaults to this month so far', async () => {
      const sales = await run(adminA, 'SALES', '');
      const today = todayInIndia();
      expect(sales.period).toEqual({ from: `${today.slice(0, 8)}01`, to: today });
    });
  });

  describe('what it refuses', () => {
    const bad = async (client: TestClient, path: string) => {
      const response = await client.get(path);
      expect(response.status, path).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    };
    it('rejects bad dates, unknown fields, a bad sort and a bad page', async () => {
      await bad(superAdmin, '/reports/SALES?from=2026-09-30&to=2026-09-01');
      await bad(superAdmin, '/reports/SALES?from=2025-01-01&to=2026-09-30');
      await bad(superAdmin, '/reports/SALES?from=2026-09-01');
      await bad(superAdmin, '/reports/SALES?extra=1');
      await bad(superAdmin, '/reports/SALES?sortBy=__nope__');
      await bad(superAdmin, '/reports/SALES?pageSize=101');
      await bad(superAdmin, '/reports/SALES?page=0');
      await bad(superAdmin, '/reports/SALES?branchId=not-a-uuid');
    });
    it('rejects a sort field with a quote in it instead of building SQL from it', async () => {
      await bad(
        superAdmin,
        `/reports/SALES?sortBy=${encodeURIComponent('total"; DROP TABLE invoices;--')}`,
      );
      expect(await owner.invoice.count()).toBeGreaterThan(0);
    });
    it('rejects an unknown export format and a missing one', async () => {
      await bad(superAdmin, `/reports/SALES/export?${PERIOD}`);
      await bad(superAdmin, `/reports/SALES/export?format=doc&${PERIOD}`);
    });
  });

  describe('downloads', () => {
    const download = (client: TestClient, code: string, format: string, query = PERIOD) =>
      client
        .get(`/reports/${code}/export?format=${format}&${query}`)
        .buffer(true)
        .parse((res, done) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => done(null, Buffer.concat(chunks)));
        });

    it('needs the export permission, separate from viewing', async () => {
      expect((await reportsOnly.get(`/reports/SALES/export?format=xlsx&${PERIOD}`)).status).toBe(
        403,
      );
      expect((await download(exporter, 'SALES', 'xlsx')).status).toBe(200);
    });

    it('gives an Excel file with the same figures as the screen', async () => {
      const response = await download(adminA, 'SALES', 'xlsx');
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('spreadsheetml.sheet');
      expect(response.headers['content-disposition']).toBe(
        `attachment; filename="sales-${FROM}_${TO}.xlsx"`,
      );
      expect(response.headers['cache-control']).toBe('no-store');
      const sheet = readZip(response.body as Buffer)
        .get('xl/worksheets/sheet1.xml')!
        .toString('utf8');
      for (const text of [
        'Sales',
        `Period: ${FROM} to ${TO}`,
        'Invoice',
        'Customer',
        'Taxable value',
        'Total',
      ])
        expect(sheet).toContain(text);
      expect(sheet).toContain('<v>615</v>');
      expect(sheet).toContain('<v>210</v>');
      expect(sheet.match(/<row /g)!.length).toBe(1 + 3 + 1 + 3 + 1);
    });

    it('gives a PDF with the same figures as the screen', async () => {
      const response = await download(adminA, 'SALES', 'pdf');
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('application/pdf');
      expect(response.headers['content-disposition']).toBe(
        `attachment; filename="sales-${FROM}_${TO}.pdf"`,
      );
      const text = (response.body as Buffer).toString('latin1');
      expect(text.startsWith('%PDF-1.4')).toBe(true);
      expect(text).toContain('615.00');
      expect(text).toContain('3 rows');
    });

    it('exports the whole result, not one page, in the order chosen', async () => {
      const response = await download(
        adminA,
        'SALES',
        'xlsx',
        `${PERIOD}&sortBy=total&sortOrder=desc`,
      );
      const sheet = readZip(response.body as Buffer)
        .get('xl/worksheets/sheet1.xml')!
        .toString('utf8');
      expect(sheet.indexOf('<v>300</v>')).toBeLessThan(sheet.indexOf('<v>210</v>'));
      expect(sheet.indexOf('<v>210</v>')).toBeLessThan(sheet.indexOf('<v>105</v>'));
    });

    it('exports for a branch user only their branch', async () => {
      const response = await download(adminB, 'SALES', 'xlsx');
      const sheet = readZip(response.body as Buffer)
        .get('xl/worksheets/sheet1.xml')!
        .toString('utf8');
      expect(sheet).toContain('<v>420</v>');
      expect(sheet).not.toContain('<v>615</v>');
    });

    it('exports every report in both formats', async () => {
      for (const code of REPORT_CODES)
        for (const format of ['xlsx', 'pdf']) {
          const response = await download(superAdmin, code, format, RECENT);
          expect(response.status, `${code} ${format}`).toBe(200);
          expect((response.body as Buffer).length).toBeGreaterThan(500);
        }
    });

    it('writes an audit row for each download, naming the report and the filters', async () => {
      await owner.$executeRaw`DELETE FROM audit_log WHERE action = 'REPORT_EXPORTED'`.catch(
        () => undefined,
      );
      const before = await owner.auditLog.count({ where: { action: 'REPORT_EXPORTED' } });
      await download(adminA, 'PAYMENTS', 'pdf');
      const rows = await owner.auditLog.findMany({ where: { action: 'REPORT_EXPORTED' } });
      expect(rows.length).toBe(before + 1);
      expect(rows.at(-1)).toMatchObject({ entityType: 'Report', actorId: w.users.adminA });
      expect(rows.at(-1)!.newValue).toMatchObject({ report: 'PAYMENTS', format: 'pdf', rows: 3 });
    });

    it('does not audit a download that was refused', async () => {
      const before = await owner.auditLog.count({ where: { action: 'REPORT_EXPORTED' } });
      await reportsOnly.get(`/reports/SALES/export?format=pdf&${PERIOD}`);
      await adminA.get('/reports/SALES/export?format=pdf&from=2026-09-30&to=2026-09-01');
      expect(await owner.auditLog.count({ where: { action: 'REPORT_EXPORTED' } })).toBe(before);
    });
  });
});
