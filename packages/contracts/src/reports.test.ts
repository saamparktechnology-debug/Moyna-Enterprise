import { describe, expect, it } from 'vitest';
import {
  REPORT_CODES,
  REPORT_EXPORT_MAX_ROWS,
  ReportExportQuerySchema,
  ReportQuerySchema,
} from './reports.js';

describe('report query', () => {
  it('defaults to the first page of 25, ascending, with no dates', () => {
    expect(ReportQuerySchema.parse({})).toMatchObject({ page: 1, pageSize: 25, sortOrder: 'asc' });
  });
  it('refuses half a period, a back-to-front period and one over 366 days', () => {
    expect(ReportQuerySchema.safeParse({ from: '2026-09-01' }).success).toBe(false);
    expect(ReportQuerySchema.safeParse({ from: '2026-09-30', to: '2026-09-01' }).success).toBe(
      false,
    );
    expect(ReportQuerySchema.safeParse({ from: '2025-09-29', to: '2026-09-30' }).success).toBe(
      false,
    );
    expect(ReportQuerySchema.safeParse({ from: '2025-09-30', to: '2026-09-30' }).success).toBe(
      true,
    );
  });
  it('refuses unknown fields, a page over 100 rows and a bad branch', () => {
    expect(ReportQuerySchema.safeParse({ extra: 1 }).success).toBe(false);
    expect(ReportQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
    expect(ReportQuerySchema.safeParse({ branchId: 'x' }).success).toBe(false);
  });
});

describe('report export query', () => {
  it('needs a known format', () => {
    expect(ReportExportQuerySchema.safeParse({}).success).toBe(false);
    expect(ReportExportQuerySchema.safeParse({ format: 'doc' }).success).toBe(false);
    expect(ReportExportQuerySchema.parse({ format: 'pdf' }).format).toBe('pdf');
    expect(ReportExportQuerySchema.parse({ format: 'xlsx' }).format).toBe('xlsx');
  });
  it('takes no paging fields', () => {
    expect(ReportExportQuerySchema.safeParse({ format: 'pdf', page: 2 }).success).toBe(false);
  });
});

describe('report catalog constants', () => {
  it('names all sixteen reports once, and caps a download', () => {
    expect(REPORT_CODES).toHaveLength(16);
    expect(new Set(REPORT_CODES).size).toBe(16);
    expect(REPORT_EXPORT_MAX_ROWS).toBe(20_000);
  });
});
