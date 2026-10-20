import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApplyPaymentRequest,
  CreateRefundRequest,
  RecordPaymentRequest,
  ReversePaymentRequest,
} from '@erp/contracts';
import {
  applyPayment,
  getCustomerCredit,
  getLedger,
  getPayment,
  listCustomerDues,
  listDues,
  listPayments,
  payRefund,
  recordPayment,
  reversePayment,
} from './payments-api';
import type {
  CustomerDueParams,
  DueListParams,
  LedgerParams,
  PaymentListParams,
} from './payments-api';

const KEY = 'payments';

export function usePayments(params: PaymentListParams, enabled = true) {
  return useQuery({
    queryKey: [KEY, 'list', params],
    queryFn: () => listPayments(params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function usePayment(id: string) {
  return useQuery({ queryKey: [KEY, 'one', id], queryFn: () => getPayment(id) });
}

export function useDues(params: DueListParams, enabled = true) {
  return useQuery({
    queryKey: [KEY, 'dues', params],
    queryFn: () => listDues(params),
    placeholderData: keepPreviousData,
    enabled,
  });
}

export function useCustomerDues(params: CustomerDueParams) {
  return useQuery({
    queryKey: [KEY, 'customer-dues', params],
    queryFn: () => listCustomerDues(params),
    placeholderData: keepPreviousData,
  });
}

export function useLedger(customerId: string, params: LedgerParams) {
  return useQuery({
    queryKey: [KEY, 'ledger', customerId, params],
    queryFn: () => getLedger(customerId, params),
    placeholderData: keepPreviousData,
  });
}

export function useCustomerCredit(customerId: string, branchId: string) {
  return useQuery({
    queryKey: [KEY, 'credit', customerId, branchId],
    queryFn: () => getCustomerCredit(customerId, branchId),
    enabled: branchId !== '',
  });
}

export function useRefund() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (values: CreateRefundRequest) => payRefund(values),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: [KEY] }),
  });
}

export function usePaymentMutations() {
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: [KEY] }),
      queryClient.invalidateQueries({ queryKey: ['invoices'] }),
    ]);
  return {
    record: useMutation({
      mutationFn: (values: RecordPaymentRequest) => recordPayment(values),
      onSuccess: refresh,
    }),
    apply: useMutation({
      mutationFn: ({ id, values }: { id: string; values: ApplyPaymentRequest }) =>
        applyPayment(id, values),
      onSuccess: refresh,
    }),
    reverse: useMutation({
      mutationFn: ({ id, values }: { id: string; values: ReversePaymentRequest }) =>
        reversePayment(id, values),
      onSuccess: refresh,
    }),
  };
}
