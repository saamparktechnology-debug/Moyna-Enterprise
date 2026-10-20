import { Prisma } from '@prisma/client';

/** Where a figure is read from. Every dashboard figure comes from one of these views, never from page-level sums. */
export const DASHBOARD_VIEWS = [
  'v_daily_sales',
  'v_daily_credit_notes',
  'v_daily_purchases',
  'v_daily_collections',
  'v_stock_value_by_branch',
  'v_invoice_balances',
  'v_daily_leads',
  'v_open_followups',
  'v_commission_worth',
  'v_pending_transfers',
  'v_low_stock',
  'v_battery_expiry_stock',
] as const;

export interface PeriodParams {
  from: string;
  to: string;
}

export const between = (column: Prisma.Sql, period: PeriodParams): Prisma.Sql =>
  Prisma.sql`${column} BETWEEN ${period.from}::date AND ${period.to}::date`;

/** One row per day of the period with sales, purchases and money received, for the branch or for everything the caller can see. */
export function trendSql(period: PeriodParams, branchId: string | null): Prisma.Sql {
  const branch = branchId ? Prisma.sql`AND branch_id = ${branchId}::uuid` : Prisma.empty;
  return Prisma.sql`
    SELECT to_char(g.d, 'YYYY-MM-DD') AS day,
           coalesce(s.total, 0) AS sales,
           coalesce(p.value, 0) AS purchases,
           coalesce(c.received, 0) AS collected
    FROM generate_series(${period.from}::date, ${period.to}::date, interval '1 day') AS g(d)
    LEFT JOIN (SELECT day, sum(total) AS total FROM v_daily_sales
               WHERE ${between(Prisma.sql`day`, period)} ${branch} GROUP BY day) s ON s.day = g.d::date
    LEFT JOIN (SELECT day, sum(value) AS value FROM v_daily_purchases
               WHERE ${between(Prisma.sql`day`, period)} ${branch} GROUP BY day) p ON p.day = g.d::date
    LEFT JOIN (SELECT day, sum(received) AS received FROM v_daily_collections
               WHERE ${between(Prisma.sql`day`, period)} ${branch} GROUP BY day) c ON c.day = g.d::date
    ORDER BY g.d`;
}

export interface TrendRow {
  day: string;
  sales: Prisma.Decimal;
  purchases: Prisma.Decimal;
  collected: Prisma.Decimal;
}
