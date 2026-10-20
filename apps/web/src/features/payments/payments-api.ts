import {
  CustomerCreditSchema,
  CustomerDueListResponseSchema,
  CustomerLedgerSchema,
  DueListResponseSchema,
  PaymentListResponseSchema,
  PaymentSchema,
  RefundSchema,
} from '@erp/contracts';
import type {
  ApplyPaymentRequest,
  CreateRefundRequest,
  CustomerCredit,
  CustomerDueListResponse,
  CustomerLedger,
  DueListResponse,
  Payment,
  PaymentListResponse,
  RecordPaymentRequest,
  Refund,
  ReversePaymentRequest,
} from '@erp/contracts';
import { api } from '@/lib/api';

function query(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined && value !== '') params.set(key, String(value));
  return params.toString();
}

/** The sort direction is only meaningful once a column is chosen. */
const order = (params: { sortBy?: string | undefined; sortOrder?: 'asc' | 'desc' | undefined }) =>
  params.sortBy ? params.sortOrder : undefined;

export interface PaymentListParams {
  page: number;
  pageSize: number;
  search: string;
  status: string;
  customerId?: string;
  withCredit?: boolean;
  /** One of the endpoint's sort fields. Left out until the person picks a column. */
  sortBy?: string | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
}

export interface DueListParams {
  page: number;
  pageSize: number;
  search: string;
  scope: string;
  customerId?: string;
  /** One of the endpoint's sort fields. Left out until the person picks a column. */
  sortBy?: string | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
}

export interface CustomerDueParams {
  page: number;
  pageSize: number;
  search: string;
  /** One of the endpoint's sort fields. Left out until the person picks a column. */
  sortBy?: string | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
}

export interface LedgerParams {
  page: number;
  pageSize: number;
}

export function listPayments(params: PaymentListParams): Promise<PaymentListResponse> {
  const { withCredit, ...rest } = params;
  return api.get(
    `/payments?${query({ ...rest, sortOrder: order(rest), withCredit: withCredit ? 'true' : undefined })}`,
    PaymentListResponseSchema,
  );
}

export function getPayment(id: string): Promise<Payment> {
  return api.get(`/payments/${id}`, PaymentSchema);
}

export function recordPayment(values: RecordPaymentRequest): Promise<Payment> {
  return api.post('/payments', values, PaymentSchema);
}

export function applyPayment(id: string, values: ApplyPaymentRequest): Promise<Payment> {
  return api.post(`/payments/${id}/allocations`, values, PaymentSchema);
}

export function reversePayment(id: string, values: ReversePaymentRequest): Promise<Payment> {
  return api.post(`/payments/${id}/reverse`, values, PaymentSchema);
}

export function listDues(params: DueListParams): Promise<DueListResponse> {
  return api.get(`/dues?${query({ ...params, sortOrder: order(params) })}`, DueListResponseSchema);
}

export function listCustomerDues(params: CustomerDueParams): Promise<CustomerDueListResponse> {
  return api.get(
    `/dues/customers?${query({ ...params, sortOrder: order(params) })}`,
    CustomerDueListResponseSchema,
  );
}

export function getLedger(customerId: string, params: LedgerParams): Promise<CustomerLedger> {
  return api.get(
    `/dues/customers/${customerId}/ledger?${query({ ...params, sortOrder: 'desc' })}`,
    CustomerLedgerSchema,
  );
}

/** What a customer holds in a branch and how much of it can be paid back. */
export function getCustomerCredit(customerId: string, branchId: string): Promise<CustomerCredit> {
  return api.get(`/refunds/credit?${query({ customerId, branchId })}`, CustomerCreditSchema);
}

export function payRefund(values: CreateRefundRequest): Promise<Refund> {
  return api.post('/refunds', values, RefundSchema);
}
