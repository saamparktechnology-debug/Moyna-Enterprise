import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateCustomerRequest,
  KycDocument,
  RejectKycRequest,
  UpdateCustomerRequest,
} from '@erp/contracts';
import {
  createCustomer,
  downloadKycDocument,
  getKyc,
  listCustomers,
  listKycDocumentTypes,
  rejectKycDocument,
  updateCustomer,
  uploadKycDocument,
  verifyKycDocument,
} from './customers-api';
import type { CustomerListParams, UploadValues } from './customers-api';

const CUSTOMERS = 'customers';
const KYC = 'kyc';

export function useCustomers(params: CustomerListParams) {
  return useQuery({
    queryKey: [CUSTOMERS, params],
    queryFn: () => listCustomers(params),
    placeholderData: keepPreviousData,
  });
}

export function useKyc(customerId: string) {
  return useQuery({ queryKey: [KYC, customerId], queryFn: () => getKyc(customerId) });
}

export function useKycDocumentTypes() {
  return useQuery({
    queryKey: ['reference', 'kyc-document-types'],
    queryFn: listKycDocumentTypes,
    staleTime: Infinity,
  });
}

export function useCustomerMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: [CUSTOMERS] });
  return {
    create: useMutation({
      mutationFn: (values: CreateCustomerRequest) => createCustomer(values),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, values }: { id: string; values: UpdateCustomerRequest }) =>
        updateCustomer(id, values),
      onSuccess: refresh,
    }),
  };
}

export function useKycMutations(customerId: string) {
  const queryClient = useQueryClient();
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: [KYC, customerId] });
    await queryClient.invalidateQueries({ queryKey: [CUSTOMERS] });
  };
  return {
    upload: useMutation({
      mutationFn: (values: UploadValues) => uploadKycDocument(customerId, values),
      onSuccess: refresh,
    }),
    verify: useMutation({
      mutationFn: (document: KycDocument) => verifyKycDocument(customerId, document),
      onSuccess: refresh,
    }),
    reject: useMutation({
      mutationFn: ({ documentId, values }: { documentId: string; values: RejectKycRequest }) =>
        rejectKycDocument(customerId, documentId, values),
      onSuccess: refresh,
    }),
    download: useMutation({
      mutationFn: (documentId: string) => downloadKycDocument(customerId, documentId),
    }),
  };
}
