import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  CreateAgreementRequest,
  CreateAgreementTemplateRequest,
  DiscardAgreementRequest,
  EndAgreementRequest,
  UpdateAgreementRequest,
  UpdateAgreementTemplateRequest,
} from '@erp/contracts';
import {
  createAgreement,
  createAgreementTemplate,
  discardAgreement,
  endAgreement,
  listAgreementTemplates,
  listAgreements,
  listMyAgreements,
  updateAgreement,
  updateAgreementTemplate,
  uploadSignedCopy,
} from './agreements-api';
import type { AgreementListParams } from './agreements-api';

const KEY = 'agreements';

export const useAgreements = (params: AgreementListParams) =>
  useQuery({
    queryKey: [KEY, 'list', params],
    queryFn: () => listAgreements(params),
    placeholderData: keepPreviousData,
  });
export const useMyAgreements = (enabled = true) =>
  useQuery({ queryKey: [KEY, 'mine'], queryFn: listMyAgreements, enabled });
export const useAgreementTemplates = (enabled = true) =>
  useQuery({ queryKey: [KEY, 'templates'], queryFn: listAgreementTemplates, enabled });

export function useAgreementMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: [KEY] });
  return {
    create: useMutation({
      mutationFn: (values: CreateAgreementRequest) => createAgreement(values),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, values }: { id: string; values: UpdateAgreementRequest }) =>
        updateAgreement(id, values),
      onSuccess: refresh,
    }),
    discard: useMutation({
      mutationFn: ({ id, values }: { id: string; values: DiscardAgreementRequest }) =>
        discardAgreement(id, values),
      onSuccess: refresh,
    }),
    end: useMutation({
      mutationFn: ({ id, values }: { id: string; values: EndAgreementRequest }) =>
        endAgreement(id, values),
      onSuccess: refresh,
    }),
    uploadSigned: useMutation({
      mutationFn: ({
        id,
        file,
        values,
      }: {
        id: string;
        file: File;
        values: { signedOn: string; rowVersion: number };
      }) => uploadSignedCopy(id, file, values),
      onSuccess: refresh,
    }),
    createTemplate: useMutation({
      mutationFn: (values: CreateAgreementTemplateRequest) => createAgreementTemplate(values),
      onSuccess: refresh,
    }),
    updateTemplate: useMutation({
      mutationFn: ({ id, values }: { id: string; values: UpdateAgreementTemplateRequest }) =>
        updateAgreementTemplate(id, values),
      onSuccess: refresh,
    }),
  };
}
