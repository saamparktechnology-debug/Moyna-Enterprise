import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreatePurchaseOrderRequest,
  CreatePurchaseReturnRequest,
  CreateSupplierRequest,
  ReceiveGoodsRequest,
  RecordSupplierPaymentRequest,
  ResolveDiscrepancyRequest,
  UpdatePurchaseOrderRequest,
  UpdateSupplierRequest,
} from '@erp/contracts';
import { RESERVED_PAYMENT_MODES } from '@erp/contracts';
import {
  approveOrder,
  cancelOrder,
  createOrder,
  createReturn,
  createSupplier,
  getOrder,
  getReceipt,
  getSupplier,
  getSupplierLedger,
  listDiscrepancies,
  listOrders,
  listPaymentModes,
  listReceipts,
  listReturns,
  listSuppliers,
  receiveGoods,
  recordSupplierPayment,
  resolveDiscrepancy,
  updateOrder,
  updateSupplier,
} from './purchasing-api';
import type { DiscrepancyParams, OrderParams, PageParams, SupplierParams } from './purchasing-api';

const KEY = 'purchasing';

export const useSuppliers = (params: SupplierParams) =>
  useQuery({
    queryKey: [KEY, 'suppliers', params],
    queryFn: () => listSuppliers(params),
    placeholderData: keepPreviousData,
  });
export const useSupplier = (id: string | null) =>
  useQuery({
    queryKey: [KEY, 'supplier', id],
    queryFn: () => getSupplier(id ?? ''),
    enabled: id !== null,
  });
export const useSupplierLedger = (id: string, params: PageParams) =>
  useQuery({
    queryKey: [KEY, 'ledger', id, params],
    queryFn: () => getSupplierLedger(id, params),
    placeholderData: keepPreviousData,
  });
/** The modes a person may choose. Those the system uses on its own, such as the value of an old unit in an exchange, are left out. */
export const usePaymentModes = () =>
  useQuery({
    queryKey: ['reference', 'payment-modes'],
    queryFn: listPaymentModes,
    staleTime: Infinity,
    select: (modes) => modes.filter((mode) => !RESERVED_PAYMENT_MODES.includes(mode.code)),
  });

export const useOrders = (params: OrderParams) =>
  useQuery({
    queryKey: [KEY, 'orders', params],
    queryFn: () => listOrders(params),
    placeholderData: keepPreviousData,
  });
export const useOrder = (id: string | null) =>
  useQuery({
    queryKey: [KEY, 'order', id],
    queryFn: () => getOrder(id ?? ''),
    enabled: id !== null,
  });
export const useReceipts = (params: PageParams) =>
  useQuery({
    queryKey: [KEY, 'receipts', params],
    queryFn: () => listReceipts(params),
    placeholderData: keepPreviousData,
  });
export const useReceipt = (id: string | null) =>
  useQuery({
    queryKey: [KEY, 'receipt', id],
    queryFn: () => getReceipt(id ?? ''),
    enabled: id !== null,
  });
export const useDiscrepancies = (params: DiscrepancyParams) =>
  useQuery({
    queryKey: [KEY, 'discrepancies', params],
    queryFn: () => listDiscrepancies(params),
    placeholderData: keepPreviousData,
  });
export const useReturns = (params: PageParams) =>
  useQuery({
    queryKey: [KEY, 'returns', params],
    queryFn: () => listReturns(params),
    placeholderData: keepPreviousData,
  });

/** Stock and the purchasing lists change together, so every purchasing and stock list is refreshed after a change. */
export function usePurchasingMutations() {
  const queryClient = useQueryClient();
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: [KEY] });
    await queryClient.invalidateQueries({ queryKey: ['stock'] });
  };
  return {
    createSupplier: useMutation({
      mutationFn: (values: CreateSupplierRequest) => createSupplier(values),
      onSuccess: refresh,
    }),
    updateSupplier: useMutation({
      mutationFn: ({ id, values }: { id: string; values: UpdateSupplierRequest }) =>
        updateSupplier(id, values),
      onSuccess: refresh,
    }),
    pay: useMutation({
      mutationFn: ({ id, values }: { id: string; values: RecordSupplierPaymentRequest }) =>
        recordSupplierPayment(id, values),
      onSuccess: refresh,
    }),
    createOrder: useMutation({
      mutationFn: (values: CreatePurchaseOrderRequest) => createOrder(values),
      onSuccess: refresh,
    }),
    updateOrder: useMutation({
      mutationFn: ({ id, values }: { id: string; values: UpdatePurchaseOrderRequest }) =>
        updateOrder(id, values),
      onSuccess: refresh,
    }),
    approve: useMutation({
      mutationFn: ({ id, rowVersion }: { id: string; rowVersion: number }) =>
        approveOrder(id, rowVersion),
      onSuccess: refresh,
    }),
    cancel: useMutation({
      mutationFn: ({
        id,
        values,
      }: {
        id: string;
        values: { rowVersion: number; reason: string };
      }) => cancelOrder(id, values),
      onSuccess: refresh,
    }),
    receive: useMutation({
      mutationFn: ({ id, values }: { id: string; values: ReceiveGoodsRequest }) =>
        receiveGoods(id, values),
      onSuccess: refresh,
    }),
    resolve: useMutation({
      mutationFn: ({ id, values }: { id: string; values: ResolveDiscrepancyRequest }) =>
        resolveDiscrepancy(id, values),
      onSuccess: refresh,
    }),
    createReturn: useMutation({
      mutationFn: (values: CreatePurchaseReturnRequest) => createReturn(values),
      onSuccess: refresh,
    }),
  };
}
