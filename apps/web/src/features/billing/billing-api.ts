import { z } from 'zod';
import { InvoiceListResponseSchema, InvoicePreviewSchema, InvoiceSchema } from '@erp/contracts';
import type {
  CancelInvoiceRequest,
  CreateInvoiceRequest,
  Invoice,
  InvoiceListResponse,
  InvoicePreview,
  IssueInvoiceRequest,
  UpdateInvoiceRequest,
} from '@erp/contracts';
import { api } from '@/lib/api';

export interface InvoiceListParams {
  page: number;
  pageSize: number;
  search: string;
  status: string;
  type: string;
  /** One of `INVOICE_SORT_FIELDS`. Left out until the person picks a column. */
  sortBy?: string | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
}

function query(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined && value !== '') params.set(key, String(value));
  return params.toString();
}

export function listInvoices(params: InvoiceListParams): Promise<InvoiceListResponse> {
  return api.get(
    `/invoices?${query({ ...params, sortOrder: params.sortBy ? params.sortOrder : undefined })}`,
    InvoiceListResponseSchema,
  );
}

export function getInvoice(id: string): Promise<Invoice> {
  return api.get(`/invoices/${id}`, InvoiceSchema);
}

export function previewInvoice(values: CreateInvoiceRequest): Promise<InvoicePreview> {
  return api.post('/invoices/preview', values, InvoicePreviewSchema);
}

export function createInvoice(values: CreateInvoiceRequest): Promise<Invoice> {
  return api.post('/invoices', values, InvoiceSchema);
}

export function updateInvoice(id: string, values: UpdateInvoiceRequest): Promise<Invoice> {
  return api.patch(`/invoices/${id}`, values, InvoiceSchema);
}

export function discardInvoice(id: string, rowVersion: number): Promise<unknown> {
  return api.post(`/invoices/${id}/discard`, { rowVersion }, z.unknown());
}

export function issueInvoice(id: string, values: IssueInvoiceRequest): Promise<Invoice> {
  return api.post(`/invoices/${id}/issue`, values, InvoiceSchema);
}

export function cancelInvoice(id: string, values: CancelInvoiceRequest): Promise<Invoice> {
  return api.post(`/invoices/${id}/cancel`, values, InvoiceSchema);
}

export function reissueInvoice(id: string, values: CancelInvoiceRequest): Promise<Invoice> {
  return api.post(`/invoices/${id}/reissue`, values, InvoiceSchema);
}

export function downloadInvoicePdf(id: string): Promise<Blob> {
  return api.download(`/invoices/${id}/pdf`);
}
