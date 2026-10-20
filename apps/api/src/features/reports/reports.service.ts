import { Inject, Injectable } from '@nestjs/common';
import {
  REPORT_EXPORT_MAX_ROWS,
  ReportExportQuerySchema,
  ReportQuerySchema,
  todayInIndia,
} from '@erp/contracts';
import type { ReportColumn, ReportExportFormat, ReportInfo, ReportResponse } from '@erp/contracts';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service.js';
import {
  BranchAccessError,
  ForbiddenError,
  NotFoundError,
  ValidationFailedError,
} from '../../common/errors/domain-errors.js';
import { formatMoney } from '../../common/money/money.js';
import { buildPage, toSkipTake } from '../../common/pagination/pagination.js';
import { TransactionService } from '../../common/prisma/transaction.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { resolvePeriod } from '../dashboards/dashboard-period.js';
import type { ExportableReport, ReportCellValue, ReportExporter } from './export-types.js';
import { pdfExporter } from './pdf-exporter.js';
import { REPORT_BY_CODE, REPORTS } from './report-definitions.js';
import type { ReportDefinition } from './report-definitions.js';
import { xlsxExporter } from './xlsx-exporter.js';

type Row = Record<string, unknown>;

const EXPORTERS: Record<ReportExportFormat, ReportExporter> = {
  xlsx: xlsxExporter,
  pdf: pdfExporter,
};

const info = (definition: ReportDefinition): ReportInfo => ({
  code: definition.code,
  title: definition.title,
  description: definition.description,
  columns: definition.columns,
  usesPeriod: definition.usesPeriod,
});

function cellValue(value: unknown, column: ReportColumn): ReportCellValue {
  if (value === null || value === undefined) return null;
  if (column.type === 'money') return formatMoney(value as Prisma.Decimal | string | number);
  if (column.type === 'int') return Number(value);
  return String(value);
}

@Injectable()
export class ReportsService {
  constructor(
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private allowed(auth: AuthContext, definition: ReportDefinition): boolean {
    return auth.isSuperAdmin || auth.permissions.includes(definition.needs);
  }

  /** The reports this person may open: those whose own module they may also view. */
  catalog(auth: AuthContext): ReportInfo[] {
    return REPORTS.filter((definition) => this.allowed(auth, definition)).map(info);
  }

  private definition(auth: AuthContext, code: string): ReportDefinition {
    const definition = REPORT_BY_CODE.get(code);
    if (!definition) throw new NotFoundError('Report', code);
    if (!this.allowed(auth, definition)) throw new ForbiddenError();
    return definition;
  }

  private checkBranch(auth: AuthContext, branchId: string | undefined): string | null {
    if (!branchId) return null;
    if (!auth.isSuperAdmin && !auth.branchIds.includes(branchId)) throw new BranchAccessError();
    return branchId;
  }

  /** The ORDER BY for a sort the person chose, limited to the report's own columns. */
  private ordering(
    definition: ReportDefinition,
    sortBy: string | undefined,
    sortOrder: 'asc' | 'desc',
  ): Prisma.Sql {
    const key = sortBy ?? definition.defaultSort.key;
    const order = sortBy ? sortOrder : definition.defaultSort.order;
    if (!definition.columns.some((column) => column.key === key))
      throw new ValidationFailedError('Unsupported sort field', [
        {
          field: 'sortBy',
          message: `Sort by one of: ${definition.columns.map((column) => column.key).join(', ')}`,
        },
      ]);
    const direction = order === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`;
    const count = definition.columns.length;
    const tiebreak = Array.from({ length: count }, (_, i) => Prisma.raw(String(i + 1)));
    return Prisma.sql`ORDER BY ${Prisma.raw(`"${key}"`)} ${direction} NULLS LAST, ${Prisma.join(tiebreak)}`;
  }

  private totalsSql(definition: ReportDefinition): Prisma.Sql {
    const sums = definition.columns
      .filter((column) => column.type === 'money' || column.type === 'int')
      .map(
        (column) =>
          Prisma.sql`coalesce(sum(${Prisma.raw(`"${column.key}"`)}), 0) AS ${Prisma.raw(`"${column.key}"`)}`,
      );
    return sums.length > 0
      ? Prisma.sql`SELECT count(*)::int AS "__n", ${Prisma.join(sums)}`
      : Prisma.sql`SELECT count(*)::int AS "__n"`;
  }

  async run(auth: AuthContext, code: string, rawQuery: unknown): Promise<ReportResponse> {
    const definition = this.definition(auth, code);
    const query = ReportQuerySchema.parse(rawQuery);
    const branchId = this.checkBranch(auth, query.branchId);
    const period = definition.usesPeriod ? resolvePeriod(query) : null;
    const ctx = {
      from: period?.from ?? '1970-01-01',
      to: period?.to ?? '2999-12-31',
      branchId,
      today: todayInIndia(),
    };
    const base = definition.base(ctx);
    const order = this.ordering(definition, query.sortBy, query.sortOrder);
    const { skip, take } = toSkipTake(query);

    return this.transactions.run(async (tx) => {
      const [rows, totalsRow] = await Promise.all([
        tx.$queryRaw<Row[]>(
          Prisma.sql`SELECT * FROM (${base}) r ${order} LIMIT ${take} OFFSET ${skip}`,
        ),
        tx.$queryRaw<Row[]>(Prisma.sql`${this.totalsSql(definition)} FROM (${base}) r`),
      ]);
      const totals = totalsRow[0] ?? {};
      const total = Number(totals['__n'] ?? 0);
      const sums: Record<string, string> = {};
      for (const column of definition.columns)
        if (column.type === 'money' || column.type === 'int')
          sums[column.key] =
            column.type === 'money'
              ? formatMoney((totals[column.key] as Prisma.Decimal | undefined) ?? 0)
              : String(Number(totals[column.key] ?? 0));
      return {
        report: info(definition),
        period,
        branchId,
        rows: rows.map((row) =>
          Object.fromEntries(
            definition.columns.map((column) => [column.key, cellValue(row[column.key], column)]),
          ),
        ),
        totals: sums,
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: buildPage([], total, query).totalPages,
      };
    });
  }

  /** The whole result as a file. Recorded in the audit log, because a download takes data out of the system. */
  async export(
    auth: AuthContext,
    code: string,
    rawQuery: unknown,
  ): Promise<{ body: Buffer; fileName: string; contentType: string }> {
    const definition = this.definition(auth, code);
    const query = ReportExportQuerySchema.parse(rawQuery);
    const branchId = this.checkBranch(auth, query.branchId);
    const period = definition.usesPeriod ? resolvePeriod(query) : null;
    const today = todayInIndia();
    const ctx = {
      from: period?.from ?? '1970-01-01',
      to: period?.to ?? '2999-12-31',
      branchId,
      today,
    };
    const base = definition.base(ctx);
    const order = this.ordering(definition, query.sortBy, query.sortOrder);
    const exporter = EXPORTERS[query.format];

    const report = await this.transactions.run(async (tx) => {
      const [{ n } = { n: 0 }] = await tx.$queryRaw<{ n: number }[]>(
        Prisma.sql`SELECT count(*)::int AS n FROM (${base}) r`,
      );
      if (n > REPORT_EXPORT_MAX_ROWS)
        throw new ValidationFailedError('Too many rows to download', [
          {
            field: 'from',
            message: `This report has ${n} rows; a download holds at most ${REPORT_EXPORT_MAX_ROWS}. Choose fewer days or one branch.`,
          },
        ]);
      const rows = await tx.$queryRaw<Row[]>(Prisma.sql`SELECT * FROM (${base}) r ${order}`);
      const totalsRow = await tx.$queryRaw<Row[]>(
        Prisma.sql`${this.totalsSql(definition)} FROM (${base}) r`,
      );
      const totals: Record<string, string> = {};
      for (const column of definition.columns)
        if (column.type === 'money' || column.type === 'int')
          totals[column.key] =
            column.type === 'money'
              ? formatMoney((totalsRow[0]?.[column.key] as Prisma.Decimal | undefined) ?? 0)
              : String(Number(totalsRow[0]?.[column.key] ?? 0));
      await this.audit.record(tx, {
        action: 'REPORT_EXPORTED',
        entityType: 'Report',
        branchId,
        newValue: { report: definition.code, format: query.format, period, branchId, rows: n },
      });
      return {
        title: definition.title,
        subtitle: [
          period ? `Period: ${period.from} to ${period.to}` : `As at ${today}`,
          branchId ? 'One branch' : 'All branches you can see',
          `${n} rows`,
        ],
        columns: definition.columns,
        rows: rows.map((row) =>
          Object.fromEntries(
            definition.columns.map((column) => [column.key, cellValue(row[column.key], column)]),
          ),
        ),
        totals,
        generatedAt: new Date(),
      } satisfies ExportableReport;
    });

    const stamp = period ? `${period.from}_${period.to}` : today;
    return {
      body: exporter.render(report),
      fileName: `${definition.code.toLowerCase().replaceAll('_', '-')}-${stamp}.${exporter.extension}`,
      contentType: exporter.contentType,
    };
  }
}
