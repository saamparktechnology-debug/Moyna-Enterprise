import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateTransferRequest,
  DispatchTransferRequest,
  ReceiveTransferRequest,
} from '@erp/contracts';
import {
  approveTransfer,
  cancelTransfer,
  createTransfer,
  dispatchTransfer,
  getTransfer,
  listBranchOptions,
  listTransfers,
  receiveTransfer,
  rejectTransfer,
} from './transfers-api';
import type { TransferListParams } from './transfers-api';

const KEY = 'transfers';

export function useTransfers(params: TransferListParams) {
  return useQuery({
    queryKey: [KEY, 'list', params],
    queryFn: () => listTransfers(params),
    placeholderData: keepPreviousData,
  });
}

export function useTransfer(id: string) {
  return useQuery({ queryKey: [KEY, 'one', id], queryFn: () => getTransfer(id) });
}

export function useBranchOptions() {
  return useQuery({
    queryKey: ['reference', 'branches'],
    queryFn: listBranchOptions,
    staleTime: 5 * 60_000,
  });
}

export function useTransferMutations() {
  const queryClient = useQueryClient();
  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['stock'] });
    void queryClient.invalidateQueries({ queryKey: ['purchasing'] });
    return queryClient.invalidateQueries({ queryKey: [KEY] });
  };
  return {
    create: useMutation({
      mutationFn: (values: CreateTransferRequest) => createTransfer(values),
      onSuccess: refresh,
    }),
    approve: useMutation({
      mutationFn: ({ id, rowVersion }: { id: string; rowVersion: number }) =>
        approveTransfer(id, rowVersion),
      onSuccess: refresh,
    }),
    reject: useMutation({
      mutationFn: ({ id, values }: { id: string; values: { rowVersion: number; note: string } }) =>
        rejectTransfer(id, values),
      onSuccess: refresh,
    }),
    cancel: useMutation({
      mutationFn: ({ id, values }: { id: string; values: { rowVersion: number; note?: string } }) =>
        cancelTransfer(id, values),
      onSuccess: refresh,
    }),
    dispatch: useMutation({
      mutationFn: ({ id, values }: { id: string; values: DispatchTransferRequest }) =>
        dispatchTransfer(id, values),
      onSuccess: refresh,
    }),
    receive: useMutation({
      mutationFn: ({ id, values }: { id: string; values: ReceiveTransferRequest }) =>
        receiveTransfer(id, values),
      onSuccess: refresh,
    }),
  };
}
