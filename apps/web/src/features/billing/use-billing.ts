import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CancelInvoiceRequest,
  CreateInvoiceRequest,
  IssueInvoiceRequest,
  UpdateInvoiceRequest,
} from '@erp/contracts';
import { listSerialUnits } from '../inventory/inventory-api';
import {
  cancelInvoice,
  createInvoice,
  discardInvoice,
  getInvoice,
  issueInvoice,
  listInvoices,
  previewInvoice,
  reissueInvoice,
  updateInvoice,
} from './billing-api';
import type { InvoiceListParams } from './billing-api';

const KEY = 'invoices';

export function useInvoices(params: InvoiceListParams) {
  return useQuery({
    queryKey: [KEY, 'list', params],
    queryFn: () => listInvoices(params),
    placeholderData: keepPreviousData,
  });
}

export function useInvoice(id: string) {
  return useQuery({ queryKey: [KEY, 'one', id], queryFn: () => getInvoice(id) });
}

/** The totals an invoice would come to. The server works them out, so the screen never does its own tax sums. */
export function useInvoicePreview(request: CreateInvoiceRequest | null) {
  return useQuery({
    queryKey: [KEY, 'preview', request],
    queryFn: () => previewInvoice(request as CreateInvoiceRequest),
    enabled: request !== null,
    placeholderData: keepPreviousData,
    retry: false,
  });
}

/** The units of an item that can be sold now, in one branch. */
export function useSellableUnits(itemId: string, branchId: string) {
  return useQuery({
    queryKey: ['serial-units', 'sellable', itemId, branchId],
    queryFn: () =>
      listSerialUnits({ page: 1, pageSize: 50, search: '', state: 'AVAILABLE', itemId, branchId }),
    enabled: itemId !== '' && branchId !== '',
  });
}

export function useInvoiceMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: [KEY] });
  return {
    create: useMutation({
      mutationFn: (values: CreateInvoiceRequest) => createInvoice(values),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, values }: { id: string; values: UpdateInvoiceRequest }) =>
        updateInvoice(id, values),
      onSuccess: refresh,
    }),
    discard: useMutation({
      mutationFn: ({ id, rowVersion }: { id: string; rowVersion: number }) =>
        discardInvoice(id, rowVersion),
      onSuccess: refresh,
    }),
    issue: useMutation({
      mutationFn: ({ id, values }: { id: string; values: IssueInvoiceRequest }) =>
        issueInvoice(id, values),
      onSuccess: refresh,
    }),
    cancel: useMutation({
      mutationFn: ({ id, values }: { id: string; values: CancelInvoiceRequest }) =>
        cancelInvoice(id, values),
      onSuccess: refresh,
    }),
    reissue: useMutation({
      mutationFn: ({ id, values }: { id: string; values: CancelInvoiceRequest }) =>
        reissueInvoice(id, values),
      onSuccess: refresh,
    }),
  };
}
