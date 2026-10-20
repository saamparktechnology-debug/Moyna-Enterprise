import { Inject, Injectable } from '@nestjs/common';
import {
  BranchDashboardQuerySchema,
  CompanyDashboardQuerySchema,
  todayInIndia,
} from '@erp/contracts';
import type {
  BranchDashboard,
  BranchPerformance,
  CompanyDashboard,
  DashboardTrendPoint,
} from '@erp/contracts';
import { Prisma } from '@prisma/client';
import { BranchContextService } from '../../common/branch-context/branch-context.service.js';
import {
  BranchAccessError,
  NotFoundError,
  ValidationFailedError,
} from '../../common/errors/domain-errors.js';
import { formatMoney, sumMoney } from '../../common/money/money.js';
import { TransactionService } from '../../common/prisma/transaction.service.js';
import { conversionRate, resolvePeriod, tomorrowStartInIndia } from './dashboard-period.js';
import { between, trendSql } from './dashboards.sql.js';
import type { PeriodParams, TrendRow } from './dashboards.sql.js';

type Num = Prisma.Decimal | null;

interface PerformanceRow {
  branch_id: string;
  code: string;
  name: string;
  is_active: boolean;
  invoices: number;
  sales: Num;
  revenue: Num;
  credit_notes: Num;
  purchase_orders: number;
  purchases: Num;
  collected: Num;
  stock_units: number;
  stock_value: Num;
  due_invoices: number;
  outstanding: Num;
  overdue: Num;
  overdue_invoices: number;
  leads_created: number;
  leads_won: number;
  commission_payable: Num;
  commission_paid: Num;
  low_stock: number;
  batteries_expired: number;
  batteries_expiring: number;
}

interface BranchRow {
  invoices: number;
  sales: Num;
  revenue: Num;
  credit_notes: Num;
  collected: Num;
  purchase_orders: number;
  purchases: Num;
  stock_units: number;
  stock_value: Num;
  items_without_cost: number;
  low_stock: number;
  incoming: number;
  outgoing: number;
  due_invoices: number;
  outstanding: Num;
  overdue: Num;
  overdue_invoices: number;
  followups_overdue: number;
  followups_today: number;
  followups_upcoming: number;
  leads_created: number;
  leads_won: number;
  batteries_expired: number;
  batteries_expiring: number;
}

const money = (value: Num): string => formatMoney(value ?? 0);

const toTrend = (rows: TrendRow[]): DashboardTrendPoint[] =>
  rows.map((row) => ({
    day: row.day,
    sales: money(row.sales),
    purchases: money(row.purchases),
    collected: money(row.collected),
  }));

@Injectable()
export class DashboardsService {
  constructor(
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(BranchContextService) private readonly contexts: BranchContextService,
  ) {}

  /**
   * Everything the caller can see, branch by branch and added up. The totals are the sum of the branch rows, so a
   * branch line and the company line can never disagree. Row-level security limits the rows to the caller's branches.
   */
  async company(rawQuery: unknown): Promise<CompanyDashboard> {
    const query = CompanyDashboardQuerySchema.parse(rawQuery);
    const period = resolvePeriod(query);
    const today = todayInIndia();

    return this.transactions.run(async (tx) => {
      const [rows, trend, missing] = await Promise.all([
        tx.$queryRaw<PerformanceRow[]>(performanceSql(period, today, query.withinDays)),
        tx.$queryRaw<TrendRow[]>(trendSql(period, null)),
        tx.$queryRaw<{ n: number }[]>`
          SELECT count(DISTINCT item_id)::int AS n FROM v_stock_value_by_branch WHERE cost_missing`,
      ]);

      const branches: BranchPerformance[] = rows
        .filter((row) => row.is_active || hasActivity(row))
        .map((row) => ({
          branchId: row.branch_id,
          branchCode: row.code,
          branchName: row.name,
          isActive: row.is_active,
          sales: {
            invoices: row.invoices,
            sales: money(row.sales),
            creditNotes: money(row.credit_notes),
            revenue: money(row.revenue),
            collected: money(row.collected),
          },
          purchases: { orders: row.purchase_orders, value: money(row.purchases) },
          stock: {
            units: row.stock_units,
            value: money(row.stock_value),
            itemsWithoutCost: 0,
          },
          dues: {
            invoices: row.due_invoices,
            outstanding: money(row.outstanding),
            overdue: money(row.overdue),
            overdueInvoices: row.overdue_invoices,
          },
          leads: {
            created: row.leads_created,
            won: row.leads_won,
            conversionRate: conversionRate(row.leads_created, row.leads_won),
          },
          commissionPayable: money(row.commission_payable),
          commissionPaid: money(row.commission_paid),
          lowStockItems: row.low_stock,
          batteriesExpired: row.batteries_expired,
          batteriesExpiring: row.batteries_expiring,
        }));

      const sum = (pick: (row: BranchPerformance) => string): string =>
        formatMoney(sumMoney(branches.map(pick)));
      const count = (pick: (row: BranchPerformance) => number): number =>
        branches.reduce((total, row) => total + pick(row), 0);
      const created = count((row) => row.leads.created);
      const won = count((row) => row.leads.won);

      return {
        period,
        withinDays: query.withinDays,
        branchCount: branches.filter((row) => row.isActive).length,
        sales: {
          invoices: count((row) => row.sales.invoices),
          sales: sum((row) => row.sales.sales),
          creditNotes: sum((row) => row.sales.creditNotes),
          revenue: sum((row) => row.sales.revenue),
          collected: sum((row) => row.sales.collected),
        },
        purchases: {
          orders: count((row) => row.purchases.orders),
          value: sum((row) => row.purchases.value),
        },
        stock: {
          units: count((row) => row.stock.units),
          value: sum((row) => row.stock.value),
          itemsWithoutCost: missing[0]?.n ?? 0,
        },
        dues: {
          invoices: count((row) => row.dues.invoices),
          outstanding: sum((row) => row.dues.outstanding),
          overdue: sum((row) => row.dues.overdue),
          overdueInvoices: count((row) => row.dues.overdueInvoices),
        },
        leads: { created, won, conversionRate: conversionRate(created, won) },
        commissions: {
          payable: sum((row) => row.commissionPayable),
          paid: sum((row) => row.commissionPaid),
        },
        alerts: {
          lowStockItems: count((row) => row.lowStockItems),
          batteriesExpired: count((row) => row.batteriesExpired),
          batteriesExpiring: count((row) => row.batteriesExpiring),
        },
        branches,
        trend: toTrend(trend),
      };
    });
  }

  /** One branch. The branch must be one the caller works in; a Super Admin working across all branches may pick any. */
  async branch(rawQuery: unknown): Promise<BranchDashboard> {
    const query = BranchDashboardQuerySchema.parse(rawQuery);
    const period = resolvePeriod(query);
    const today = todayInIndia();
    const now = new Date();
    const tomorrow = tomorrowStartInIndia(now);
    const branchId = this.chooseBranch(query.branchId);

    return this.transactions.run(async (tx) => {
      const branch = await tx.branch.findUnique({
        where: { id: branchId },
        select: { id: true, code: true, name: true },
      });
      if (!branch) throw new NotFoundError('Branch', branchId);

      const [rows, trend] = await Promise.all([
        tx.$queryRaw<BranchRow[]>(
          branchSql(branchId, period, today, query.withinDays, now, tomorrow),
        ),
        tx.$queryRaw<TrendRow[]>(trendSql(period, branchId)),
      ]);
      const row = rows[0];
      if (!row) throw new NotFoundError('Branch', branchId);

      return {
        period,
        withinDays: query.withinDays,
        branch,
        sales: {
          invoices: row.invoices,
          sales: money(row.sales),
          creditNotes: money(row.credit_notes),
          revenue: money(row.revenue),
          collected: money(row.collected),
        },
        purchases: { orders: row.purchase_orders, value: money(row.purchases) },
        stock: {
          units: row.stock_units,
          value: money(row.stock_value),
          itemsWithoutCost: row.items_without_cost,
          lowStockItems: row.low_stock,
        },
        transfers: { incoming: row.incoming, outgoing: row.outgoing },
        dues: {
          invoices: row.due_invoices,
          outstanding: money(row.outstanding),
          overdue: money(row.overdue),
          overdueInvoices: row.overdue_invoices,
        },
        followups: {
          overdue: row.followups_overdue,
          today: row.followups_today,
          upcoming: row.followups_upcoming,
        },
        leads: {
          created: row.leads_created,
          won: row.leads_won,
          conversionRate: conversionRate(row.leads_created, row.leads_won),
        },
        alerts: {
          batteriesExpired: row.batteries_expired,
          batteriesExpiring: row.batteries_expiring,
        },
        trend: toTrend(trend),
      };
    });
  }

  private chooseBranch(requested: string | undefined): string {
    const context = this.contexts.require();
    if (requested) {
      if (!context.isSuperAdmin && !context.branchIds.includes(requested))
        throw new BranchAccessError();
      return requested;
    }
    const [only] = context.branchIds;
    if (!context.isSuperAdmin && context.branchIds.length === 1 && only) return only;
    throw new ValidationFailedError('Choose a branch', [
      { field: 'branchId', message: 'Choose the branch to show' },
    ]);
  }
}

function hasActivity(row: PerformanceRow): boolean {
  const figures = [
    row.sales,
    row.credit_notes,
    row.purchases,
    row.collected,
    row.stock_value,
    row.outstanding,
    row.commission_payable,
    row.commission_paid,
  ];
  const counts = [
    row.invoices,
    row.purchase_orders,
    row.stock_units,
    row.leads_created,
    row.low_stock,
    row.batteries_expired,
    row.batteries_expiring,
  ];
  return figures.some((value) => value !== null && !value.isZero()) || counts.some((n) => n > 0);
}

function performanceSql(period: PeriodParams, today: string, withinDays: number): Prisma.Sql {
  return Prisma.sql`
    WITH s AS (
      SELECT branch_id, sum(invoices)::int AS invoices, sum(total) AS sales, sum(taxable_value) AS taxable
      FROM v_daily_sales WHERE ${between(Prisma.sql`day`, period)} GROUP BY branch_id),
    n AS (
      SELECT branch_id, sum(total) AS total, sum(taxable_value) AS taxable
      FROM v_daily_credit_notes WHERE ${between(Prisma.sql`day`, period)} GROUP BY branch_id),
    p AS (
      SELECT branch_id, sum(orders)::int AS orders, sum(value) AS value
      FROM v_daily_purchases WHERE ${between(Prisma.sql`day`, period)} GROUP BY branch_id),
    c AS (
      SELECT branch_id, sum(received) AS received
      FROM v_daily_collections WHERE ${between(Prisma.sql`day`, period)} GROUP BY branch_id),
    st AS (
      SELECT branch_id, sum(units)::int AS units, sum(value) AS value
      FROM v_stock_value_by_branch GROUP BY branch_id),
    d AS (
      SELECT branch_id,
             (count(*) FILTER (WHERE outstanding > 0))::int AS invoices,
             sum(outstanding) AS outstanding,
             sum(outstanding) FILTER (WHERE due_date < ${today}::date) AS overdue,
             (count(*) FILTER (WHERE outstanding > 0 AND due_date < ${today}::date))::int AS overdue_invoices
      FROM v_invoice_balances GROUP BY branch_id),
    l AS (
      SELECT branch_id, sum(created)::int AS created, sum(won)::int AS won
      FROM v_daily_leads WHERE ${between(Prisma.sql`day`, period)} GROUP BY branch_id),
    cm AS (
      SELECT branch_id, sum(payable_amount) AS payable,
             sum(paid_amount) FILTER (WHERE ${between(Prisma.sql`paid_day`, period)}) AS paid
      FROM v_commission_worth GROUP BY branch_id),
    ls AS (SELECT branch_id, count(*)::int AS n FROM v_low_stock GROUP BY branch_id),
    bx AS (
      SELECT branch_id,
             (count(*) FILTER (WHERE expiry_on < ${today}::date))::int AS expired,
             (count(*) FILTER (WHERE expiry_on >= ${today}::date
                                 AND expiry_on <= ${today}::date + ${withinDays}::int))::int AS expiring
      FROM v_battery_expiry_stock GROUP BY branch_id)
    SELECT b.id AS branch_id, b.code, b.name, b.is_active,
           coalesce(s.invoices, 0) AS invoices, coalesce(s.sales, 0) AS sales,
           coalesce(s.taxable, 0) - coalesce(n.taxable, 0) AS revenue, coalesce(n.total, 0) AS credit_notes,
           coalesce(p.orders, 0) AS purchase_orders, coalesce(p.value, 0) AS purchases,
           coalesce(c.received, 0) AS collected,
           coalesce(st.units, 0) AS stock_units, coalesce(st.value, 0) AS stock_value,
           coalesce(d.invoices, 0) AS due_invoices, coalesce(d.outstanding, 0) AS outstanding,
           coalesce(d.overdue, 0) AS overdue, coalesce(d.overdue_invoices, 0) AS overdue_invoices,
           coalesce(l.created, 0) AS leads_created, coalesce(l.won, 0) AS leads_won,
           coalesce(cm.payable, 0) AS commission_payable, coalesce(cm.paid, 0) AS commission_paid,
           coalesce(ls.n, 0) AS low_stock,
           coalesce(bx.expired, 0) AS batteries_expired, coalesce(bx.expiring, 0) AS batteries_expiring
    FROM branches b
    LEFT JOIN s ON s.branch_id = b.id LEFT JOIN n ON n.branch_id = b.id
    LEFT JOIN p ON p.branch_id = b.id LEFT JOIN c ON c.branch_id = b.id
    LEFT JOIN st ON st.branch_id = b.id LEFT JOIN d ON d.branch_id = b.id
    LEFT JOIN l ON l.branch_id = b.id LEFT JOIN cm ON cm.branch_id = b.id
    LEFT JOIN ls ON ls.branch_id = b.id LEFT JOIN bx ON bx.branch_id = b.id
    WHERE app_branch_allowed(b.id)
    ORDER BY b.code`;
}

function branchSql(
  branchId: string,
  period: PeriodParams,
  today: string,
  withinDays: number,
  now: Date,
  tomorrow: Date,
): Prisma.Sql {
  const id = Prisma.sql`${branchId}::uuid`;
  return Prisma.sql`
    SELECT
      (SELECT coalesce(sum(invoices), 0)::int FROM v_daily_sales
        WHERE branch_id = ${id} AND ${between(Prisma.sql`day`, period)}) AS invoices,
      (SELECT coalesce(sum(total), 0) FROM v_daily_sales
        WHERE branch_id = ${id} AND ${between(Prisma.sql`day`, period)}) AS sales,
      (SELECT coalesce(sum(taxable_value), 0) FROM v_daily_sales
        WHERE branch_id = ${id} AND ${between(Prisma.sql`day`, period)})
      - (SELECT coalesce(sum(taxable_value), 0) FROM v_daily_credit_notes
        WHERE branch_id = ${id} AND ${between(Prisma.sql`day`, period)}) AS revenue,
      (SELECT coalesce(sum(total), 0) FROM v_daily_credit_notes
        WHERE branch_id = ${id} AND ${between(Prisma.sql`day`, period)}) AS credit_notes,
      (SELECT coalesce(sum(received), 0) FROM v_daily_collections
        WHERE branch_id = ${id} AND ${between(Prisma.sql`day`, period)}) AS collected,
      (SELECT coalesce(sum(orders), 0)::int FROM v_daily_purchases
        WHERE branch_id = ${id} AND ${between(Prisma.sql`day`, period)}) AS purchase_orders,
      (SELECT coalesce(sum(value), 0) FROM v_daily_purchases
        WHERE branch_id = ${id} AND ${between(Prisma.sql`day`, period)}) AS purchases,
      (SELECT coalesce(sum(units), 0)::int FROM v_stock_value_by_branch WHERE branch_id = ${id}) AS stock_units,
      (SELECT coalesce(sum(value), 0) FROM v_stock_value_by_branch WHERE branch_id = ${id}) AS stock_value,
      (SELECT count(*)::int FROM v_stock_value_by_branch WHERE branch_id = ${id} AND cost_missing) AS items_without_cost,
      (SELECT count(*)::int FROM v_low_stock WHERE branch_id = ${id}) AS low_stock,
      (SELECT count(*)::int FROM v_pending_transfers WHERE to_branch_id = ${id}) AS incoming,
      (SELECT count(*)::int FROM v_pending_transfers WHERE from_branch_id = ${id}) AS outgoing,
      (SELECT count(*)::int FROM v_invoice_balances WHERE branch_id = ${id} AND outstanding > 0) AS due_invoices,
      (SELECT coalesce(sum(outstanding), 0) FROM v_invoice_balances WHERE branch_id = ${id}) AS outstanding,
      (SELECT coalesce(sum(outstanding), 0) FROM v_invoice_balances
        WHERE branch_id = ${id} AND due_date < ${today}::date) AS overdue,
      (SELECT count(*)::int FROM v_invoice_balances
        WHERE branch_id = ${id} AND outstanding > 0 AND due_date < ${today}::date) AS overdue_invoices,
      (SELECT count(*)::int FROM v_open_followups WHERE branch_id = ${id} AND due_at < ${now}) AS followups_overdue,
      (SELECT count(*)::int FROM v_open_followups
        WHERE branch_id = ${id} AND due_at >= ${now} AND due_at < ${tomorrow}) AS followups_today,
      (SELECT count(*)::int FROM v_open_followups WHERE branch_id = ${id} AND due_at >= ${tomorrow}) AS followups_upcoming,
      (SELECT coalesce(sum(created), 0)::int FROM v_daily_leads
        WHERE branch_id = ${id} AND ${between(Prisma.sql`day`, period)}) AS leads_created,
      (SELECT coalesce(sum(won), 0)::int FROM v_daily_leads
        WHERE branch_id = ${id} AND ${between(Prisma.sql`day`, period)}) AS leads_won,
      (SELECT count(*)::int FROM v_battery_expiry_stock
        WHERE branch_id = ${id} AND expiry_on < ${today}::date) AS batteries_expired,
      (SELECT count(*)::int FROM v_battery_expiry_stock
        WHERE branch_id = ${id} AND expiry_on >= ${today}::date
          AND expiry_on <= ${today}::date + ${withinDays}::int) AS batteries_expiring`;
}
