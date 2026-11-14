import {
  AgreementListResponseSchema,
  AgreementSchema,
  AgreementTemplateListResponseSchema,
  AgreementTemplateSchema,
} from '@erp/contracts';
import type {
  Agreement,
  AgreementListResponse,
  AgreementTemplate,
  AgreementTemplateListResponse,
  CreateAgreementRequest,
  CreateAgreementTemplateRequest,
  DiscardAgreementRequest,
  EndAgreementRequest,
  UpdateAgreementRequest,
  UpdateAgreementTemplateRequest,
} from '@erp/contracts';
import { api } from '@/lib/api';

function query(values: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined && value !== '') params.set(key, String(value));
  return params.toString();
}

export interface AgreementListParams {
  staffId: string;
  status: string;
}

export function listAgreements(params: AgreementListParams): Promise<AgreementListResponse> {
  return api.get(
    `/agreements?${query({ staffId: params.staffId, status: params.status })}`,
    AgreementListResponseSchema,
  );
}
/** The signed agreements of the person signed in. */
export function listMyAgreements(): Promise<AgreementListResponse> {
  return api.get('/agreements/mine', AgreementListResponseSchema);
}
export function createAgreement(values: CreateAgreementRequest): Promise<Agreement> {
  return api.post('/agreements', values, AgreementSchema);
}
export function updateAgreement(id: string, values: UpdateAgreementRequest): Promise<Agreement> {
  return api.patch(`/agreements/${id}`, values, AgreementSchema);
}
export function discardAgreement(id: string, values: DiscardAgreementRequest): Promise<Agreement> {
  return api.post(`/agreements/${id}/discard`, values, AgreementSchema);
}
export function endAgreement(id: string, values: EndAgreementRequest): Promise<Agreement> {
  return api.post(`/agreements/${id}/end`, values, AgreementSchema);
}
/** Uploads the printed agreement, signed by the employee and the Super Admin, as the acceptance. */
export function uploadSignedCopy(
  id: string,
  file: File,
  values: { signedOn: string; rowVersion: number },
): Promise<Agreement> {
  return api.upload(
    `/agreements/${id}/signed-copy?${query({
      fileName: file.name,
      signedOn: values.signedOn,
      employeeSigned: 'true',
      adminSigned: 'true',
      rowVersion: values.rowVersion,
    })}`,
    file,
    {},
    AgreementSchema,
  );
}
export const downloadAgreementPdf = (id: string): Promise<Blob> =>
  api.download(`/agreements/${id}/pdf`);
export const downloadSignedCopy = (id: string): Promise<Blob> =>
  api.download(`/agreements/${id}/signed-copy`);

export function listAgreementTemplates(): Promise<AgreementTemplateListResponse> {
  return api.get('/agreement-templates', AgreementTemplateListResponseSchema);
}
export function createAgreementTemplate(
  values: CreateAgreementTemplateRequest,
): Promise<AgreementTemplate> {
  return api.post('/agreement-templates', values, AgreementTemplateSchema);
}
export function updateAgreementTemplate(
  id: string,
  values: UpdateAgreementTemplateRequest,
): Promise<AgreementTemplate> {
  return api.patch(`/agreement-templates/${id}`, values, AgreementTemplateSchema);
}
