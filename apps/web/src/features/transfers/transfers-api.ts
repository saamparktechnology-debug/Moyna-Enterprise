import {
  BranchOptionListResponseSchema,
  TransferListResponseSchema,
  TransferSchema,
} from '@erp/contracts';
import type {
  BranchOption,
  CreateTransferRequest,
  DispatchTransferRequest,
  ReceiveTransferRequest,
  Transfer,
  TransferListResponse,
} from '@erp/contracts';
import { api } from '@/lib/api';

export interface TransferListParams {
  page: number;
  pageSize: number;
  search: string;
  status: string;
  direction: string;
  /** One of `TRANSFER_SORT_FIELDS`. Left out until the person picks a column. */
  sortBy?: string | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
}

function query(values: Record<string, string | number>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== '') params.set(key, String(value));
  }
  return params.toString();
}

export const listTransfers = (params: TransferListParams): Promise<TransferListResponse> => {
  const { sortBy, sortOrder, ...rest } = params;
  const sort: Record<string, string> = sortBy ? { sortBy, sortOrder: sortOrder ?? 'asc' } : {};
  return api.get(`/transfers?${query({ ...rest, ...sort })}`, TransferListResponseSchema);
};
export const getTransfer = (id: string): Promise<Transfer> =>
  api.get(`/transfers/${id}`, TransferSchema);
export const createTransfer = (values: CreateTransferRequest): Promise<Transfer> =>
  api.post('/transfers', values, TransferSchema);
export const approveTransfer = (id: string, rowVersion: number): Promise<Transfer> =>
  api.post(`/transfers/${id}/approve`, { rowVersion }, TransferSchema);
export const rejectTransfer = (
  id: string,
  values: { rowVersion: number; note: string },
): Promise<Transfer> => api.post(`/transfers/${id}/reject`, values, TransferSchema);
export const cancelTransfer = (
  id: string,
  values: { rowVersion: number; note?: string },
): Promise<Transfer> => api.post(`/transfers/${id}/cancel`, values, TransferSchema);
export const dispatchTransfer = (id: string, values: DispatchTransferRequest): Promise<Transfer> =>
  api.post(`/transfers/${id}/dispatch`, values, TransferSchema);
export const receiveTransfer = (id: string, values: ReceiveTransferRequest): Promise<Transfer> =>
  api.post(`/transfers/${id}/receive`, values, TransferSchema);
export const listBranchOptions = (): Promise<BranchOption[]> =>
  api.get('/reference/branches', BranchOptionListResponseSchema);
