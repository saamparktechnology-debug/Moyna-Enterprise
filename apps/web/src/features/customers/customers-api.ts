import {
  CustomerListResponseSchema,
  CustomerSchema,
  KycDocumentSchema,
  KycDocumentTypeListResponseSchema,
  KycOverviewSchema,
} from '@erp/contracts';
import type {
  CreateCustomerRequest,
  Customer,
  CustomerListResponse,
  KycDocument,
  KycDocumentType,
  KycOverview,
  KycStatusName,
  RejectKycRequest,
  UpdateCustomerRequest,
} from '@erp/contracts';
import { api } from '@/lib/api';

export interface CustomerListParams {
  page: number;
  pageSize: number;
  search: string;
  kycStatus: KycStatusName | '';
  /** One of `CUSTOMER_SORT_FIELDS`. The list is by name unless the person picks a column. */
  sortBy?: string | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
}

function query(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== '') params.set(key, String(value));
  }
  return params.toString();
}

export function listCustomers(params: CustomerListParams): Promise<CustomerListResponse> {
  const { sortBy = 'name', sortOrder = 'asc', ...rest } = params;
  return api.get(`/customers?${query({ ...rest, sortBy, sortOrder })}`, CustomerListResponseSchema);
}

export function createCustomer(values: CreateCustomerRequest): Promise<Customer> {
  return api.post('/customers', values, CustomerSchema);
}

export function updateCustomer(id: string, values: UpdateCustomerRequest): Promise<Customer> {
  return api.patch(`/customers/${id}`, values, CustomerSchema);
}

export function getKyc(customerId: string): Promise<KycOverview> {
  return api.get(`/customers/${customerId}/kyc`, KycOverviewSchema);
}

export function listKycDocumentTypes(): Promise<KycDocumentType[]> {
  return api.get('/reference/kyc-document-types', KycDocumentTypeListResponseSchema);
}

export interface UploadValues {
  docType: string;
  file: File;
  documentNumber: string;
}

export function uploadKycDocument(customerId: string, values: UploadValues): Promise<KycDocument> {
  const path = `/customers/${customerId}/kyc-documents?${query({
    docType: values.docType,
    fileName: values.file.name,
  })}`;
  const headers: Record<string, string> = {};
  if (values.documentNumber.trim()) headers['x-document-number'] = values.documentNumber.trim();
  return api.upload(path, values.file, headers, KycDocumentSchema);
}

export function verifyKycDocument(customerId: string, document: KycDocument): Promise<KycDocument> {
  return api.post(
    `/customers/${customerId}/kyc-documents/${document.id}/verify`,
    { rowVersion: document.rowVersion },
    KycDocumentSchema,
  );
}

export function rejectKycDocument(
  customerId: string,
  documentId: string,
  values: RejectKycRequest,
): Promise<KycDocument> {
  return api.post(
    `/customers/${customerId}/kyc-documents/${documentId}/reject`,
    values,
    KycDocumentSchema,
  );
}

export function downloadKycDocument(customerId: string, documentId: string): Promise<Blob> {
  return api.download(`/customers/${customerId}/kyc-documents/${documentId}/file`);
}
