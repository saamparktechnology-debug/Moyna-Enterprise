import {
  AdjustmentListResponseSchema,
  LowStockListResponseSchema,
  MovementListResponseSchema,
  SerialUnitListResponseSchema,
  StockAdjustmentSchema,
  StockBalanceListResponseSchema,
} from '@erp/contracts';
import type {
  AdjustmentListResponse,
  ApproveAdjustmentRequest,
  CancelAdjustmentRequest,
  CreateStockAdjustmentRequest,
  LowStockListResponse,
  MovementListResponse,
  RejectAdjustmentRequest,
  SerialUnitListResponse,
  StockAdjustment,
  StockBalanceListResponse,
} from '@erp/contracts';
import { api } from '@/lib/api';

function query(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return params.toString();
}

/** The sort direction is only meaningful once a column is chosen. */
const order = (params: { sortBy?: string | undefined; sortOrder?: 'asc' | 'desc' | undefined }) =>
  params.sortBy ? params.sortOrder : undefined;

export interface PageParams {
  page: number;
  pageSize: number;
  /** One of the endpoint's sort fields. Left out until the person picks a column. */
  sortBy?: string | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
}

export interface BalanceParams extends PageParams {
  search: string;
  lowOnly: boolean;
}
export function listBalances(params: BalanceParams): Promise<StockBalanceListResponse> {
  return api.get(
    `/stock/balances?${query({ ...params, sortOrder: order(params), lowOnly: params.lowOnly ? 'true' : 'false' })}`,
    StockBalanceListResponseSchema,
  );
}

export function listLowStock(params: PageParams): Promise<LowStockListResponse> {
  return api.get(
    `/stock/low-stock?${query({ ...params, sortOrder: order(params) })}`,
    LowStockListResponseSchema,
  );
}

export interface MovementParams extends PageParams {
  movementType: string;
  serialNo: string;
}
export function listMovements(params: MovementParams): Promise<MovementListResponse> {
  return api.get(
    `/stock/movements?${query({ ...params, sortOrder: order(params) })}`,
    MovementListResponseSchema,
  );
}

export interface SerialUnitParams extends PageParams {
  search: string;
  state: string;
  itemId?: string | undefined;
  branchId?: string | undefined;
}
export function listSerialUnits(params: SerialUnitParams): Promise<SerialUnitListResponse> {
  return api.get(
    `/stock/serial-units?${query({ ...params, sortOrder: order(params) })}`,
    SerialUnitListResponseSchema,
  );
}

export interface AdjustmentParams extends PageParams {
  status: string;
}
export function listAdjustments(params: AdjustmentParams): Promise<AdjustmentListResponse> {
  return api.get(
    `/stock/adjustments?${query({ ...params, sortOrder: order(params) })}`,
    AdjustmentListResponseSchema,
  );
}

export function createAdjustment(values: CreateStockAdjustmentRequest): Promise<StockAdjustment> {
  return api.post('/stock/adjustments', values, StockAdjustmentSchema);
}

export function approveAdjustment(id: string, values: ApproveAdjustmentRequest) {
  return api.post(`/stock/adjustments/${id}/approve`, values, StockAdjustmentSchema);
}

export function rejectAdjustment(id: string, values: RejectAdjustmentRequest) {
  return api.post(`/stock/adjustments/${id}/reject`, values, StockAdjustmentSchema);
}

export function cancelAdjustment(id: string, values: CancelAdjustmentRequest) {
  return api.post(`/stock/adjustments/${id}/cancel`, values, StockAdjustmentSchema);
}
