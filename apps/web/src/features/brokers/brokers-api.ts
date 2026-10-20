import {
  BrokerLedgerSchema,
  BrokerListResponseSchema,
  BrokerSchema,
  CommissionListResponseSchema,
  PayoutResponseSchema,
} from '@erp/contracts';
import type {
  AddCommissionRuleRequest,
  Broker,
  BrokerLedger,
  BrokerListResponse,
  CommissionListResponse,
  CreateBrokerRequest,
  PayoutRequest,
  PayoutResponse,
  UpdateBrokerRequest,
} from '@erp/contracts';
import { api } from '@/lib/api';

function query(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined && value !== '') params.set(key, String(value));
  return params.toString();
}

export interface BrokerListParams {
  page: number;
  pageSize: number;
  search: string;
  status: string;
  /** One of the endpoint's sort fields. Left out until the person picks a column. */
  sortBy?: string | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
}

export interface CommissionListParams {
  page: number;
  pageSize: number;
  search: string;
  status: string;
  brokerId?: string;
  /** One of the endpoint's sort fields. Left out until the person picks a column. */
  sortBy?: string | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
}

export const listBrokers = (params: BrokerListParams): Promise<BrokerListResponse> =>
  api.get(
    `/brokers?${query({ ...params, sortOrder: params.sortBy ? params.sortOrder : undefined })}`,
    BrokerListResponseSchema,
  );

export const getBroker = (id: string): Promise<Broker> => api.get(`/brokers/${id}`, BrokerSchema);

export const createBroker = (values: CreateBrokerRequest): Promise<Broker> =>
  api.post('/brokers', values, BrokerSchema);

export const updateBroker = (id: string, values: UpdateBrokerRequest): Promise<Broker> =>
  api.patch(`/brokers/${id}`, values, BrokerSchema);

export const addRule = (id: string, values: AddCommissionRuleRequest): Promise<Broker> =>
  api.post(`/brokers/${id}/rules`, values, BrokerSchema);

export const getBrokerLedger = (
  id: string,
  params: { page: number; pageSize: number },
): Promise<BrokerLedger> =>
  api.get(`/brokers/${id}/ledger?${query({ ...params, sortOrder: 'desc' })}`, BrokerLedgerSchema);

export const listCommissions = (params: CommissionListParams): Promise<CommissionListResponse> =>
  api.get(
    `/commissions?${query({ ...params, sortOrder: params.sortBy ? params.sortOrder : undefined })}`,
    CommissionListResponseSchema,
  );

export const payoutCommissions = (values: PayoutRequest): Promise<PayoutResponse> =>
  api.post('/commissions/payout', values, PayoutResponseSchema);
