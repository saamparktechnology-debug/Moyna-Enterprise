import { ReportCatalogSchema, ReportResponseSchema } from '@erp/contracts';
import type { ReportCode, ReportExportFormat, ReportInfo, ReportResponse } from '@erp/contracts';
import { api } from '@/lib/api';

export interface ReportParams {
  from: string;
  to: string;
  branchId: string;
  page: number;
  pageSize: number;
  sortBy: string;
  sortOrder: 'asc' | 'desc';
}

function filters(
  params: Pick<ReportParams, 'from' | 'to' | 'branchId'>,
  usesPeriod: boolean,
): URLSearchParams {
  const query = new URLSearchParams();
  if (usesPeriod) {
    query.set('from', params.from);
    query.set('to', params.to);
  }
  if (params.branchId) query.set('branchId', params.branchId);
  return query;
}

export const listReports = (): Promise<ReportInfo[]> => api.get('/reports', ReportCatalogSchema);

export function getReport(
  code: ReportCode,
  params: ReportParams,
  usesPeriod: boolean,
): Promise<ReportResponse> {
  const query = filters(params, usesPeriod);
  query.set('page', String(params.page));
  query.set('pageSize', String(params.pageSize));
  if (params.sortBy) {
    query.set('sortBy', params.sortBy);
    query.set('sortOrder', params.sortOrder);
  }
  return api.get(`/reports/${code}?${query.toString()}`, ReportResponseSchema);
}

/** The address of the file download. A plain link, so the browser saves the file with the session cookie. */
export function exportUrl(
  code: ReportCode,
  format: ReportExportFormat,
  params: ReportParams,
  usesPeriod: boolean,
): string {
  const query = filters(params, usesPeriod);
  query.set('format', format);
  if (params.sortBy) {
    query.set('sortBy', params.sortBy);
    query.set('sortOrder', params.sortOrder);
  }
  return `/api/reports/${code}/export?${query.toString()}`;
}
