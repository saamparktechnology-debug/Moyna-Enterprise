import type { ReportColumn } from '@erp/contracts';

export type ReportCellValue = string | number | null;

/** Everything an exporter needs to lay out one report. */
export interface ExportableReport {
  title: string;
  /** Lines shown under the title, such as the period and branch. */
  subtitle: string[];
  columns: ReportColumn[];
  rows: Record<string, ReportCellValue>[];
  /** Added up over all rows, keyed by column. */
  totals: Record<string, string>;
  generatedAt: Date;
}

export interface ReportExporter {
  readonly contentType: string;
  readonly extension: string;
  render(report: ExportableReport): Buffer;
}
