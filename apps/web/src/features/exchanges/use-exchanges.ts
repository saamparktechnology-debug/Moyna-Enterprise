import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  ApproveExchangeRequest,
  CancelExchangeRequest,
  RejectExchangeRequest,
  RequestExchangeRequest,
} from '@erp/contracts';
import {
  approveExchange,
  cancelExchange,
  getExchange,
  getExchangeOptions,
  listExchanges,
  rejectExchange,
  requestExchange,
} from './exchanges-api';
import type { ExchangeListParams } from './exchanges-api';

const KEY = 'exchanges';

export const useExchanges = (params: ExchangeListParams) =>
  useQuery({
    queryKey: [KEY, 'list', params],
    queryFn: () => listExchanges(params),
    placeholderData: keepPreviousData,
  });

export const useExchange = (id: string) =>
  useQuery({ queryKey: [KEY, 'one', id], queryFn: () => getExchange(id) });

export const useExchangeOptions = (invoiceId: string) =>
  useQuery({
    queryKey: [KEY, 'options', invoiceId],
    queryFn: () => getExchangeOptions(invoiceId),
    enabled: invoiceId !== '',
  });

export function useExchangeMutations() {
  const queryClient = useQueryClient();
  // Approving takes stock in and money in, so lists of invoices, payments, stock and commission may all change.
  const refresh = () =>
    Promise.all(
      [KEY, 'invoices', 'payments', 'stock', 'brokers', 'serial-units'].map((key) =>
        queryClient.invalidateQueries({ queryKey: [key] }),
      ),
    );
  return {
    request: useMutation({
      mutationFn: (values: RequestExchangeRequest) => requestExchange(values),
      onSuccess: refresh,
    }),
    approve: useMutation({
      mutationFn: ({ id, values }: { id: string; values: ApproveExchangeRequest }) =>
        approveExchange(id, values),
      onSuccess: refresh,
    }),
    reject: useMutation({
      mutationFn: ({ id, values }: { id: string; values: RejectExchangeRequest }) =>
        rejectExchange(id, values),
      onSuccess: refresh,
    }),
    cancel: useMutation({
      mutationFn: ({ id, values }: { id: string; values: CancelExchangeRequest }) =>
        cancelExchange(id, values),
      onSuccess: refresh,
    }),
  };
}
