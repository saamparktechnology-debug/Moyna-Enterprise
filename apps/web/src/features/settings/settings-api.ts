import {
  AuditFacetsSchema,
  AuditLogResponseSchema,
  DocumentSeriesListResponseSchema,
  DocumentSeriesSchema,
  GstRateAdminListResponseSchema,
  GstRateAdminSchema,
  SettingListResponseSchema,
  SettingSchema,
  UserActivitySchema,
} from '@erp/contracts';
import type {
  AuditFacets,
  AuditLogResponse,
  DocumentSeries,
  DocumentSeriesListResponse,
  GstRateAdmin,
  Setting,
  UserActivity,
} from '@erp/contracts';
import { z } from 'zod';
import { api } from '@/lib/api';

const AuditUserListSchema = z.object({
  items: z.array(z.object({ id: z.uuid(), fullName: z.string() })),
});
export const listAuditUsers = (): Promise<z.infer<typeof AuditUserListSchema>> =>
  api.get('/users?pageSize=100&status=all', AuditUserListSchema);

export const listSettings = (): Promise<Setting[]> =>
  api.get('/settings', SettingListResponseSchema);
export const saveSetting = (
  key: string,
  value: string | number,
  rowVersion: number | null,
): Promise<Setting> =>
  api.put(
    `/settings/${key}`,
    { value, ...(rowVersion === null ? {} : { rowVersion }) },
    SettingSchema,
  );
export const resetSetting = (key: string, rowVersion: number): Promise<Setting> =>
  api.post(`/settings/${key}/reset`, { rowVersion }, SettingSchema);

export interface SeriesParams {
  page: number;
  branchId: string;
  docType: string;
  financialYear: string;
}
export function listSeries(params: SeriesParams): Promise<DocumentSeriesListResponse> {
  const query = new URLSearchParams({ page: String(params.page), pageSize: '20' });
  if (params.branchId) query.set('branchId', params.branchId);
  if (params.docType) query.set('docType', params.docType);
  if (params.financialYear) query.set('financialYear', params.financialYear);
  return api.get(`/settings/document-series?${query.toString()}`, DocumentSeriesListResponseSchema);
}
export const advanceSeries = (
  id: string,
  body: { nextNumber: number; reason: string; rowVersion: number },
): Promise<DocumentSeries> =>
  api.post(`/settings/document-series/${id}/advance`, body, DocumentSeriesSchema);

export const listRates = (): Promise<GstRateAdmin[]> =>
  api.get('/settings/gst-rates', GstRateAdminListResponseSchema);
export const createRate = (body: { rate: string; label: string }): Promise<GstRateAdmin> =>
  api.post('/settings/gst-rates', body, GstRateAdminSchema);
export const updateRate = (
  id: string,
  body: { label?: string; isActive?: boolean; rowVersion: number },
): Promise<GstRateAdmin> => api.patch(`/settings/gst-rates/${id}`, body, GstRateAdminSchema);

export interface AuditParams {
  page: number;
  actorId: string;
  action: string;
  entityType: string;
  from: string;
  to: string;
  q: string;
}
export function listAudit(params: AuditParams): Promise<AuditLogResponse> {
  const query = new URLSearchParams({ page: String(params.page), pageSize: '25' });
  for (const key of ['actorId', 'action', 'entityType', 'from', 'to', 'q'] as const)
    if (params[key]) query.set(key, params[key]);
  return api.get(`/audit-log?${query.toString()}`, AuditLogResponseSchema);
}
export const getAuditFacets = (): Promise<AuditFacets> =>
  api.get('/audit-log/facets', AuditFacetsSchema);
export const getUserActivity = (id: string): Promise<UserActivity> =>
  api.get(`/audit-log/users/${id}`, UserActivitySchema);
