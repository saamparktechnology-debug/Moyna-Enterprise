import {
  CreditNoteListResponseSchema,
  CreditNoteSchema,
  ReturnableResponseSchema,
} from '@erp/contracts';
import type {
  CreateCreditNoteRequest,
  CreditNote,
  CreditNoteListResponse,
  RejectCreditNoteRequest,
  ReturnableLine,
} from '@erp/contracts';
import { api } from '@/lib/api';

export interface CreditNoteListParams {
  page: number;
  pageSize: number;
  search: string;
  status: string;
  /** One of `CREDIT_NOTE_SORT_FIELDS`. Left out until the person picks a column. */
  sortBy?: string | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
}

function query(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined && value !== '') params.set(key, String(value));
  return params.toString();
}

export function listCreditNotes(params: CreditNoteListParams): Promise<CreditNoteListResponse> {
  return api.get(
    `/credit-notes?${query({ ...params, sortOrder: params.sortBy ? params.sortOrder : undefined })}`,
    CreditNoteListResponseSchema,
  );
}

export function getCreditNote(id: string): Promise<CreditNote> {
  return api.get(`/credit-notes/${id}`, CreditNoteSchema);
}

export function getReturnable(invoiceId: string): Promise<ReturnableLine[]> {
  return api.get(`/invoices/${invoiceId}/returnable`, ReturnableResponseSchema);
}

export function requestCreditNote(values: CreateCreditNoteRequest): Promise<CreditNote> {
  return api.post('/credit-notes', values, CreditNoteSchema);
}

export function approveCreditNote(id: string, rowVersion: number): Promise<CreditNote> {
  return api.post(`/credit-notes/${id}/approve`, { rowVersion }, CreditNoteSchema);
}

export function rejectCreditNote(id: string, values: RejectCreditNoteRequest): Promise<CreditNote> {
  return api.post(`/credit-notes/${id}/reject`, values, CreditNoteSchema);
}

export function downloadCreditNotePdf(id: string): Promise<Blob> {
  return api.download(`/credit-notes/${id}/pdf`);
}
