import { z } from 'zod';
import { DASHBOARD_MAX_RANGE_DAYS } from './dashboards.js';
import { DateOnlySchema, daysBetween } from './battery-dates.js';
import { MAX_PAGE_SIZE, DEFAULT_PAGE_SIZE, SortOrderSchema } from './pagination.js';

export const REPORT_CODES = [
  'SALES',
  'PURCHASES',
  'STOCK',
  'TRANSFERS',
  'ADJUSTMENTS',
  'EXCHANGES',
  'DUES',
  'PAYMENTS',
  'GST_SALES',
  'NON_GST_SALES',
  'COMMISSIONS',
  'LEADS',
  'ATTENDANCE',
  'BRANCH_PERFORMANCE',
  'BATTERY_EXPIRY',
  'DAMAGED_SHORT_STOCK',
] as const;
export const ReportCodeSchema = z.enum(REPORT_CODES);
export type ReportCode = z.infer<typeof ReportCodeSchema>;

export const ReportColumnSchema = z.object({
  key: z.string(),
  label: z.string(),
  /** How to show and total the column. Money and int columns are added up in the totals row. */
  type: z.enum(['text', 'int', 'money', 'date']),
});
export type ReportColumn = z.infer<typeof ReportColumnSchema>;

export const ReportInfoSchema = z.object({
  code: ReportCodeSchema,
  title: z.string(),
  description: z.string(),
  columns: z.array(ReportColumnSchema),
  /** False for reports that describe the situation today (stock, dues, battery expiry) and ignore the dates. */
  usesPeriod: z.boolean(),
});
export type ReportInfo = z.infer<typeof ReportInfoSchema>;
export const ReportCatalogSchema = z.array(ReportInfoSchema);

/** Rows a download may hold. Past this the person must narrow the dates or the branch. */
export const REPORT_EXPORT_MAX_ROWS = 20_000;
export const REPORT_EXPORT_FORMATS = ['xlsx', 'pdf'] as const;
export const ReportExportFormatSchema = z.enum(REPORT_EXPORT_FORMATS);
export type ReportExportFormat = z.infer<typeof ReportExportFormatSchema>;

const filters = {
  from: DateOnlySchema.optional(),
  to: DateOnlySchema.optional(),
  branchId: z.uuid().optional(),
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
      message: 'Give both dates, or neither to use this month so far',
    });
    return;
  }
  if (from === undefined || to === undefined) return;
  if (from > to)
    context.addIssue({ code: 'custom', path: ['to'], message: 'The end date is before the start' });
  else if (daysBetween(from, to) + 1 > DASHBOARD_MAX_RANGE_DAYS)
    context.addIssue({
      code: 'custom',
      path: ['to'],
      message: `Choose at most ${DASHBOARD_MAX_RANGE_DAYS} days`,
    });
}

export const ReportQuerySchema = z
  .object({
    ...filters,
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(DEFAULT_PAGE_SIZE),
    sortBy: z.string().min(1).max(64).optional(),
    sortOrder: SortOrderSchema.default('asc'),
  })
  .strict()
  .superRefine(checkPeriod);
export type ReportQuery = z.input<typeof ReportQuerySchema>;

export const ReportExportQuerySchema = z
  .object({
    ...filters,
    format: ReportExportFormatSchema,
    sortBy: z.string().min(1).max(64).optional(),
    sortOrder: SortOrderSchema.default('asc'),
  })
  .strict()
  .superRefine(checkPeriod);
export type ReportExportQuery = z.input<typeof ReportExportQuerySchema>;

export const ReportCellSchema = z.union([z.string(), z.number(), z.null()]);
export const ReportRowSchema = z.record(z.string(), ReportCellSchema);

export const ReportResponseSchema = z.object({
  report: ReportInfoSchema,
  period: z.object({ from: DateOnlySchema, to: DateOnlySchema }).nullable(),
  branchId: z.uuid().nullable(),
  rows: z.array(ReportRowSchema),
  /** Added up over every row of the result, not just this page. Keys are the money and int columns. */
  totals: z.record(z.string(), z.string()),
  page: z.number().int().min(1),
  pageSize: z.number().int().min(1).max(MAX_PAGE_SIZE),
  total: z.number().int().min(0),
  totalPages: z.number().int().min(0),
});
export type ReportResponse = z.infer<typeof ReportResponseSchema>;
