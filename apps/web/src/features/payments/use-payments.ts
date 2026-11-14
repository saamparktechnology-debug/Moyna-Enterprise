//apps/web/src/features/payments/use-payments.ts
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApplyPaymentRequest,
  CreateDuePromiseRequest,
  CreateRefundRequest,
  RecordPaymentRequest,
  ReversePaymentRequest,
  SetGuarantorRequest,
} from '@erp/contracts';
import {
  addPromise,
  applyPayment,
  getGuarantor,
  listPromises,
  removeGuarantor,
  removeGuarantorKyc,
  setGuarantor,
  uploadGuarantorKyc,
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

/** The promises made on an invoice and its guarantor, for the dialog that follows up a due. */
export function useDueFollowup(invoiceId: string) {
  return {
    promises: useQuery({
      queryKey: [KEY, 'promises', invoiceId],
      queryFn: () => listPromises(invoiceId),
    }),
    guarantor: useQuery({
      queryKey: [KEY, 'guarantor', invoiceId],
      queryFn: () => getGuarantor(invoiceId),
    }),
  };
}

export function useDueFollowupMutations(invoiceId: string) {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: [KEY] });
  return {
    addPromise: useMutation({
      mutationFn: (values: CreateDuePromiseRequest) => addPromise(invoiceId, values),
      onSuccess: refresh,
    }),
    setGuarantor: useMutation({
      mutationFn: (values: SetGuarantorRequest) => setGuarantor(invoiceId, values),
      onSuccess: refresh,
    }),
    removeGuarantor: useMutation({
      mutationFn: () => removeGuarantor(invoiceId),
      onSuccess: refresh,
    }),
    uploadKyc: useMutation({
      mutationFn: (file: File) => uploadGuarantorKyc(invoiceId, file),
      onSuccess: refresh,
    }),
    removeKyc: useMutation({ mutationFn: () => removeGuarantorKyc(invoiceId), onSuccess: refresh }),
  };
}
