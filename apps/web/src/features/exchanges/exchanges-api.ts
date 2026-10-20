import { ExchangeListResponseSchema, ExchangeOptionsSchema, ExchangeSchema } from '@erp/contracts';
import type {
  ApproveExchangeRequest,
  CancelExchangeRequest,
  Exchange,
  ExchangeListResponse,
  ExchangeOptions,
  RejectExchangeRequest,
  RequestExchangeRequest,
} from '@erp/contracts';
import { api } from '@/lib/api';

function query(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined && value !== '') params.set(key, String(value));
  return params.toString();
}

export interface ExchangeListParams {
  page: number;
  pageSize: number;
  search: string;
  status: string;
  kind: string;
  /** One of `EXCHANGE_SORT_FIELDS`. Left out until the person picks a column. */
  sortBy?: string | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
}

export const listExchanges = (params: ExchangeListParams): Promise<ExchangeListResponse> =>
  api.get(
    `/exchanges?${query({ ...params, sortOrder: params.sortBy ? params.sortOrder : undefined })}`,
    ExchangeListResponseSchema,
  );

export const getExchange = (id: string): Promise<Exchange> =>
  api.get(`/exchanges/${id}`, ExchangeSchema);

export const getExchangeOptions = (invoiceId: string): Promise<ExchangeOptions> =>
  api.get(`/exchanges/options?${query({ invoiceId })}`, ExchangeOptionsSchema);

export const requestExchange = (values: RequestExchangeRequest): Promise<Exchange> =>
  api.post('/exchanges', values, ExchangeSchema);

export const approveExchange = (id: string, values: ApproveExchangeRequest): Promise<Exchange> =>
  api.post(`/exchanges/${id}/approve`, values, ExchangeSchema);

export const rejectExchange = (id: string, values: RejectExchangeRequest): Promise<Exchange> =>
  api.post(`/exchanges/${id}/reject`, values, ExchangeSchema);

export const cancelExchange = (id: string, values: CancelExchangeRequest): Promise<Exchange> =>
  api.post(`/exchanges/${id}/cancel`, values, ExchangeSchema);
