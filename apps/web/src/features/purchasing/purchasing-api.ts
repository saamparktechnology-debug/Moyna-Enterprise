import {
  DiscrepancyListResponseSchema,
  DiscrepancySchema,
  GoodsReceiptListResponseSchema,
  GoodsReceiptSchema,
  PaymentModeListResponseSchema,
  PurchaseOrderListResponseSchema,
  PurchaseOrderSchema,
  PurchaseReturnListResponseSchema,
  PurchaseReturnSchema,
  SupplierDetailSchema,
  SupplierLedgerResponseSchema,
  SupplierListResponseSchema,
  SupplierPaymentSchema,
  SupplierSchema,
} from '@erp/contracts';
import type {
  CreatePurchaseOrderRequest,
  CreatePurchaseReturnRequest,
  CreateSupplierRequest,
  Discrepancy,
  DiscrepancyListResponse,
  GoodsReceipt,
  GoodsReceiptListResponse,
  PaymentMode,
  PurchaseOrder,
  PurchaseOrderListResponse,
  PurchaseReturn,
  PurchaseReturnListResponse,
  ReceiveGoodsRequest,
  RecordSupplierPaymentRequest,
  ResolveDiscrepancyRequest,
  Supplier,
  SupplierDetail,
  SupplierLedgerResponse,
  SupplierListResponse,
  SupplierPayment,
  UpdatePurchaseOrderRequest,
  UpdateSupplierRequest,
} from '@erp/contracts';
import { api } from '@/lib/api';

export interface PageParams {
  page: number;
  pageSize: number;
  /** One of the endpoint's sort fields. Left out until the person picks a column. */
  sortBy?: string | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
}

/** The sort direction is only meaningful once a column is chosen. */
const order = (params: PageParams) => (params.sortBy ? params.sortOrder : undefined);

function query(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return params.toString();
}

export interface SupplierParams extends PageParams {
  search: string;
  status: string;
}
export const listSuppliers = (params: SupplierParams): Promise<SupplierListResponse> =>
  api.get(
    `/suppliers?${query({ ...params, sortOrder: order(params) })}`,
    SupplierListResponseSchema,
  );
export const getSupplier = (id: string): Promise<SupplierDetail> =>
  api.get(`/suppliers/${id}`, SupplierDetailSchema);
export const createSupplier = (values: CreateSupplierRequest): Promise<Supplier> =>
  api.post('/suppliers', values, SupplierSchema);
export const updateSupplier = (id: string, values: UpdateSupplierRequest): Promise<Supplier> =>
  api.patch(`/suppliers/${id}`, values, SupplierSchema);
export const getSupplierLedger = (
  id: string,
  params: PageParams,
): Promise<SupplierLedgerResponse> =>
  api.get(
    `/suppliers/${id}/ledger?${query({ ...params, sortOrder: order(params) })}`,
    SupplierLedgerResponseSchema,
  );
export const recordSupplierPayment = (
  id: string,
  values: RecordSupplierPaymentRequest,
): Promise<SupplierPayment> => api.post(`/suppliers/${id}/payments`, values, SupplierPaymentSchema);
export const listPaymentModes = (): Promise<PaymentMode[]> =>
  api.get('/reference/payment-modes', PaymentModeListResponseSchema);

export interface OrderParams extends PageParams {
  search: string;
  status: string;
}
export const listOrders = (params: OrderParams): Promise<PurchaseOrderListResponse> =>
  api.get(
    `/purchase-orders?${query({ ...params, sortOrder: order(params) })}`,
    PurchaseOrderListResponseSchema,
  );
export const getOrder = (id: string): Promise<PurchaseOrder> =>
  api.get(`/purchase-orders/${id}`, PurchaseOrderSchema);
export const createOrder = (values: CreatePurchaseOrderRequest): Promise<PurchaseOrder> =>
  api.post('/purchase-orders', values, PurchaseOrderSchema);
export const updateOrder = (
  id: string,
  values: UpdatePurchaseOrderRequest,
): Promise<PurchaseOrder> => api.patch(`/purchase-orders/${id}`, values, PurchaseOrderSchema);
export const approveOrder = (id: string, rowVersion: number): Promise<PurchaseOrder> =>
  api.post(`/purchase-orders/${id}/approve`, { rowVersion }, PurchaseOrderSchema);
export const cancelOrder = (
  id: string,
  values: { rowVersion: number; reason: string },
): Promise<PurchaseOrder> => api.post(`/purchase-orders/${id}/cancel`, values, PurchaseOrderSchema);
export const receiveGoods = (id: string, values: ReceiveGoodsRequest): Promise<GoodsReceipt> =>
  api.post(`/purchase-orders/${id}/receive`, values, GoodsReceiptSchema);

export const listReceipts = (params: PageParams): Promise<GoodsReceiptListResponse> =>
  api.get(
    `/goods-receipts?${query({ ...params, sortOrder: order(params) })}`,
    GoodsReceiptListResponseSchema,
  );
export const getReceipt = (id: string): Promise<GoodsReceipt> =>
  api.get(`/goods-receipts/${id}`, GoodsReceiptSchema);

export interface DiscrepancyParams extends PageParams {
  status: string;
  type: string;
}
export const listDiscrepancies = (params: DiscrepancyParams): Promise<DiscrepancyListResponse> =>
  api.get(
    `/discrepancies?${query({ ...params, sortOrder: order(params) })}`,
    DiscrepancyListResponseSchema,
  );
export const resolveDiscrepancy = (
  id: string,
  values: ResolveDiscrepancyRequest,
): Promise<Discrepancy> => api.post(`/discrepancies/${id}/resolve`, values, DiscrepancySchema);

export const listReturns = (params: PageParams): Promise<PurchaseReturnListResponse> =>
  api.get(
    `/purchase-returns?${query({ ...params, sortOrder: order(params) })}`,
    PurchaseReturnListResponseSchema,
  );
export const createReturn = (values: CreatePurchaseReturnRequest): Promise<PurchaseReturn> =>
  api.post('/purchase-returns', values, PurchaseReturnSchema);
