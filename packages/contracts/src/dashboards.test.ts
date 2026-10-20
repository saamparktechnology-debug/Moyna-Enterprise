import { describe, expect, it } from 'vitest';
import { BranchDashboardQuerySchema, CompanyDashboardQuerySchema } from './dashboards.js';

const issues = (result: { success: boolean; error?: { issues: { message: string }[] } }) =>
  result.error?.issues.map((i) => i.message) ?? [];

describe('dashboard queries', () => {
  it('accept no dates, and default the expiry window to 30 days', () => {
    const parsed = CompanyDashboardQuerySchema.parse({});
    expect(parsed.withinDays).toBe(30);
  });
  it('accept a period of exactly 366 days and refuse 367', () => {
    expect(
      CompanyDashboardQuerySchema.safeParse({ from: '2025-09-30', to: '2026-09-30' }).success,
    ).toBe(true);
    expect(
      issues(CompanyDashboardQuerySchema.safeParse({ from: '2025-09-29', to: '2026-09-30' })),
    ).toEqual(['Choose at most 366 days']);
  });
  it('refuse a back-to-front or half-given period', () => {
    expect(
      issues(CompanyDashboardQuerySchema.safeParse({ from: '2026-02-02', to: '2026-02-01' })),
    ).toEqual(['The end date is before the start']);
    expect(issues(CompanyDashboardQuerySchema.safeParse({ from: '2026-02-02' }))).toEqual([
      'Give both dates, or neither to see this month so far',
    ]);
  });
  it('refuse unknown fields and a branch that is not an id', () => {
    expect(CompanyDashboardQuerySchema.safeParse({ extra: 1 }).success).toBe(false);
    expect(BranchDashboardQuerySchema.safeParse({ branchId: 'x' }).success).toBe(false);
  });
});
