import { z } from 'zod';
import { DateOnlySchema, DEFAULT_EXPIRY_WINDOW_DAYS, daysBetween } from './battery-dates.js';

/** The longest period a dashboard answers for, in days (both ends counted). */
export const DASHBOARD_MAX_RANGE_DAYS = 366;

/** A rupee amount with exactly two decimals, as the database worked it out. */
export const MoneyStringSchema = z.string().regex(/^-?\d+\.\d{2}$/, 'Expected an amount');

const PeriodQueryShape = {
  from: DateOnlySchema.optional(),
  to: DateOnlySchema.optional(),
};

function checkPeriod(
  value: { from?: string | undefined; to?: string | undefined },
  context: z.RefinementCtx,
): void {
  const { from, to } = value;
  if ((from === undefined) !== (to === undefined)) {
    context.addIssue({
      code: 'custom',
      path: [from === undefined ? 'from' : 'to'],
      message: 'Give both dates, or neither to see this month so far',
    });
    return;
  }
  if (from === undefined || to === undefined) return;
  if (from > to) {
    context.addIssue({ code: 'custom', path: ['to'], message: 'The end date is before the start' });
  } else if (daysBetween(from, to) + 1 > DASHBOARD_MAX_RANGE_DAYS) {
    context.addIssue({
      code: 'custom',
      path: ['to'],
      message: `Choose at most ${DASHBOARD_MAX_RANGE_DAYS} days`,
    });
  }
}

const withinDaysSchema = z.coerce
  .number()
  .int()
  .min(1)
  .max(365)
  .default(DEFAULT_EXPIRY_WINDOW_DAYS);

export const CompanyDashboardQuerySchema = z
  .object({ ...PeriodQueryShape, withinDays: withinDaysSchema })
  .strict()
  .superRefine(checkPeriod);
export type CompanyDashboardQuery = z.input<typeof CompanyDashboardQuerySchema>;

export const BranchDashboardQuerySchema = z
  .object({ ...PeriodQueryShape, branchId: z.uuid().optional(), withinDays: withinDaysSchema })
  .strict()
  .superRefine(checkPeriod);
export type BranchDashboardQuery = z.input<typeof BranchDashboardQuerySchema>;

export const DashboardPeriodSchema = z.object({ from: DateOnlySchema, to: DateOnlySchema });
export type DashboardPeriod = z.infer<typeof DashboardPeriodSchema>;

/** One day of the period: invoiced sales, purchase orders placed and money received. */
export const DashboardTrendPointSchema = z.object({
  day: DateOnlySchema,
  sales: MoneyStringSchema,
  purchases: MoneyStringSchema,
  collected: MoneyStringSchema,
});
export type DashboardTrendPoint = z.infer<typeof DashboardTrendPointSchema>;

const SalesFiguresSchema = z.object({
  /** Issued invoices in the period. */
  invoices: z.number().int(),
  /** Invoice totals including GST. */
  sales: MoneyStringSchema,
  /** Approved credit notes in the period, including GST. */
  creditNotes: MoneyStringSchema,
  /** Taxable value of issued invoices less the taxable value of approved credit notes (before GST). */
  revenue: MoneyStringSchema,
  /** Money received from customers in the period (reversed payments and trade-ins left out). */
  collected: MoneyStringSchema,
});

const PurchaseFiguresSchema = z.object({
  /** Purchase orders placed in the period that were approved (or received). */
  orders: z.number().int(),
  value: MoneyStringSchema,
});

const StockFiguresSchema = z.object({
  /** Units available, reserved or in transit now. */
  units: z.number().int(),
  /** Those units at the latest purchase cost of each item. */
  value: MoneyStringSchema,
  /** Items in stock that have never been bought on an approved order, so they add nothing to the value. */
  itemsWithoutCost: z.number().int(),
});

const DueFiguresSchema = z.object({
  invoices: z.number().int(),
  outstanding: MoneyStringSchema,
  overdue: MoneyStringSchema,
  overdueInvoices: z.number().int(),
});

const LeadFiguresSchema = z.object({
  /** Leads created in the period. */
  created: z.number().int(),
  /** Of those, the leads that are won now. */
  won: z.number().int(),
  /** won / created as a percentage with one decimal, or null when no leads were created. */
  conversionRate: z.number().min(0).max(100).nullable(),
});

export const BranchPerformanceSchema = z.object({
  branchId: z.uuid(),
  branchCode: z.string(),
  branchName: z.string(),
  isActive: z.boolean(),
  sales: SalesFiguresSchema,
  purchases: PurchaseFiguresSchema,
  stock: StockFiguresSchema,
  dues: DueFiguresSchema,
  leads: LeadFiguresSchema,
  commissionPayable: MoneyStringSchema,
  commissionPaid: MoneyStringSchema,
  lowStockItems: z.number().int(),
  batteriesExpired: z.number().int(),
  batteriesExpiring: z.number().int(),
});
export type BranchPerformance = z.infer<typeof BranchPerformanceSchema>;

export const CompanyDashboardSchema = z.object({
  period: DashboardPeriodSchema,
  withinDays: z.number().int(),
  /** Active branches the caller can see. */
  branchCount: z.number().int(),
  sales: SalesFiguresSchema,
  purchases: PurchaseFiguresSchema,
  stock: StockFiguresSchema,
  dues: DueFiguresSchema,
  leads: LeadFiguresSchema,
  commissions: z.object({
    /** What is owed to brokers now, after credit notes took their share back. */
    payable: MoneyStringSchema,
    /** Commission paid out in the period. */
    paid: MoneyStringSchema,
  }),
  alerts: z.object({
    lowStockItems: z.number().int(),
    batteriesExpired: z.number().int(),
    batteriesExpiring: z.number().int(),
  }),
  branches: z.array(BranchPerformanceSchema),
  trend: z.array(DashboardTrendPointSchema),
});
export type CompanyDashboard = z.infer<typeof CompanyDashboardSchema>;

export const BranchDashboardSchema = z.object({
  period: DashboardPeriodSchema,
  withinDays: z.number().int(),
  branch: z.object({ id: z.uuid(), code: z.string(), name: z.string() }),
  sales: SalesFiguresSchema,
  purchases: PurchaseFiguresSchema,
  stock: StockFiguresSchema.extend({ lowStockItems: z.number().int() }),
  transfers: z.object({
    /** Transfers to this branch that are requested, approved or on their way. */
    incoming: z.number().int(),
    /** Transfers from this branch that are requested, approved or on their way. */
    outgoing: z.number().int(),
  }),
  dues: DueFiguresSchema,
  followups: z.object({
    overdue: z.number().int(),
    today: z.number().int(),
    upcoming: z.number().int(),
  }),
  leads: LeadFiguresSchema,
  alerts: z.object({
    batteriesExpired: z.number().int(),
    batteriesExpiring: z.number().int(),
  }),
  trend: z.array(DashboardTrendPointSchema),
});
export type BranchDashboard = z.infer<typeof BranchDashboardSchema>;
