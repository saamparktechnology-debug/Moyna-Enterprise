import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateCreditNoteRequest, RejectCreditNoteRequest } from '@erp/contracts';
import {
  approveCreditNote,
  getCreditNote,
  getReturnable,
  listCreditNotes,
  rejectCreditNote,
  requestCreditNote,
} from './credit-notes-api';
import type { CreditNoteListParams } from './credit-notes-api';

const KEY = 'credit-notes';

export function useCreditNotes(params: CreditNoteListParams) {
  return useQuery({
    queryKey: [KEY, 'list', params],
    queryFn: () => listCreditNotes(params),
    placeholderData: keepPreviousData,
  });
}

export function useCreditNote(id: string) {
  return useQuery({ queryKey: [KEY, 'one', id], queryFn: () => getCreditNote(id) });
}

export function useReturnable(invoiceId: string) {
  return useQuery({
    queryKey: [KEY, 'returnable', invoiceId],
    queryFn: () => getReturnable(invoiceId),
  });
}

export function useCreditNoteMutations() {
  const queryClient = useQueryClient();
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: [KEY] }),
      queryClient.invalidateQueries({ queryKey: ['invoices'] }),
    ]);
  return {
    request: useMutation({
      mutationFn: (values: CreateCreditNoteRequest) => requestCreditNote(values),
      onSuccess: refresh,
    }),
    approve: useMutation({
      mutationFn: ({ id, rowVersion }: { id: string; rowVersion: number }) =>
        approveCreditNote(id, rowVersion),
      onSuccess: refresh,
    }),
    reject: useMutation({
      mutationFn: ({ id, values }: { id: string; values: RejectCreditNoteRequest }) =>
        rejectCreditNote(id, values),
      onSuccess: refresh,
    }),
  };
}
