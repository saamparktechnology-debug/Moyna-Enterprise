import { InvoiceSchema, QuotationListResponseSchema, QuotationSchema } from '@erp/contracts';
import type {
  AssignUnitRequest,
  BuildUpdateRequest,
  CancelQuotationRequest,
  ConvertQuotationRequest,
  CreateQuotationRequest,
  Invoice,
  Quotation,
  QuotationListResponse,
  QuotationVersionRequest,
  TakeAdvanceRequest,
  UpdateQuotationRequest,
} from '@erp/contracts';
import { api } from '@/lib/api';

function query(values: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined && value !== '' && value !== false) params.set(key, String(value));
  return params.toString();
}

export interface QuotationListParams {
  page: number;
  pageSize: number;
  search: string;
  status: string;
  customOnly: boolean;
  /** One of `QUOTATION_SORT_FIELDS`. Left out until the person picks a column. */
  sortBy?: string | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
}

export const listQuotations = (params: QuotationListParams): Promise<QuotationListResponse> =>
  api.get(
    `/quotations?${query({ ...params, sortOrder: params.sortBy ? params.sortOrder : undefined })}`,
    QuotationListResponseSchema,
  );

export const getQuotation = (id: string): Promise<Quotation> =>
  api.get(`/quotations/${id}`, QuotationSchema);

export const createQuotation = (values: CreateQuotationRequest): Promise<Quotation> =>
  api.post('/quotations', values, QuotationSchema);

export const updateQuotation = (id: string, values: UpdateQuotationRequest): Promise<Quotation> =>
  api.patch(`/quotations/${id}`, values, QuotationSchema);

export const sendQuotation = (id: string, values: QuotationVersionRequest): Promise<Quotation> =>
  api.post(`/quotations/${id}/send`, values, QuotationSchema);

export const acceptQuotation = (id: string, values: QuotationVersionRequest): Promise<Quotation> =>
  api.post(`/quotations/${id}/accept`, values, QuotationSchema);

export const cancelQuotation = (id: string, values: CancelQuotationRequest): Promise<Quotation> =>
  api.post(`/quotations/${id}/cancel`, values, QuotationSchema);

export const takeAdvance = (id: string, values: TakeAdvanceRequest): Promise<Quotation> =>
  api.post(`/quotations/${id}/advance`, values, QuotationSchema);

export const updateBuild = (id: string, values: BuildUpdateRequest): Promise<Quotation> =>
  api.post(`/quotations/${id}/build`, values, QuotationSchema);

export const assignUnit = (
  id: string,
  lineId: string,
  values: AssignUnitRequest,
): Promise<Quotation> =>
  api.post(`/quotations/${id}/lines/${lineId}/unit`, values, QuotationSchema);

export const convertQuotation = (values: ConvertQuotationRequest): Promise<Invoice> =>
  api.post('/invoices/from-quotation', values, InvoiceSchema);
