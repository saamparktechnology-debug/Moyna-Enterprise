import {
  BatteryAlertsSchema,
  BatteryListResponseSchema,
  BatterySchema,
  SaleCheckResponseSchema,
} from '@erp/contracts';
import type {
  Battery,
  BatteryAlerts,
  BatteryListResponse,
  InstallBatteryRequest,
  SetBatteryDetailsRequest,
} from '@erp/contracts';
import { api } from '@/lib/api';

export interface BatteryListParams {
  page: number;
  pageSize: number;
  search: string;
  expiry: 'any' | 'expired' | 'expiring' | 'ok' | 'none';
  warranty: 'any' | 'active' | 'ended' | 'none';
  installed: 'any' | 'yes' | 'no';
  withinDays: number;
  /** One of `BATTERY_SORT_FIELDS`. The list is by expiry date unless the person picks a column. */
  sortBy?: string | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
}

export function listBatteries(params: BatteryListParams): Promise<BatteryListResponse> {
  const query = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
    expiry: params.expiry,
    warranty: params.warranty,
    installed: params.installed,
    withinDays: String(params.withinDays),
  });
  if (params.search) query.set('search', params.search);
  if (params.sortBy) {
    query.set('sortBy', params.sortBy);
    query.set('sortOrder', params.sortOrder ?? 'asc');
  }
  return api.get(`/batteries?${query.toString()}`, BatteryListResponseSchema);
}

export function getAlerts(withinDays: number): Promise<BatteryAlerts> {
  return api.get(`/batteries/alerts?withinDays=${withinDays}`, BatteryAlertsSchema);
}

export function getBattery(serialUnitId: string): Promise<Battery> {
  return api.get(`/batteries/${serialUnitId}`, BatterySchema);
}

export function setDetails(
  serialUnitId: string,
  values: SetBatteryDetailsRequest,
): Promise<Battery> {
  return api.patch(`/batteries/${serialUnitId}`, values, BatterySchema);
}

export function installBattery(
  serialUnitId: string,
  values: InstallBatteryRequest,
): Promise<Battery> {
  return api.post(`/batteries/${serialUnitId}/install`, values, BatterySchema);
}

export function uninstallBattery(serialUnitId: string): Promise<Battery> {
  return api.post(`/batteries/${serialUnitId}/uninstall`, {}, BatterySchema);
}

export function saleCheck(serialUnitId: string, overrideReason?: string) {
  return api.post(
    `/batteries/${serialUnitId}/sale-check`,
    overrideReason ? { overrideReason } : {},
    SaleCheckResponseSchema,
  );
}
