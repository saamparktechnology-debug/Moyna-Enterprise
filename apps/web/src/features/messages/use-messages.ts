import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AddOptOutRequest,
  CreateBulkMessageRequest,
  PreviewBulkRequest,
  SendDocumentRequest,
} from '@erp/contracts';
import {
  addOptOut,
  createBulk,
  getCampaign,
  getMessagingStatus,
  listCampaigns,
  listOptOuts,
  previewBulk,
  removeOptOut,
  retryCampaign,
  sendCampaign,
  sendDocument,
} from './messages-api';

const KEY = 'messages';

export const useMessagingStatus = (enabled = true) =>
  useQuery({ queryKey: [KEY, 'status'], queryFn: getMessagingStatus, enabled, staleTime: 60_000 });
export const useCampaigns = (params: { page: number; pageSize: number }) =>
  useQuery({
    queryKey: [KEY, 'campaigns', params],
    queryFn: () => listCampaigns(params),
    placeholderData: keepPreviousData,
  });
export const useOptOuts = (enabled = true) =>
  useQuery({ queryKey: [KEY, 'opt-outs'], queryFn: listOptOuts, enabled });
export const useCampaign = (id: string | null) =>
  useQuery({
    queryKey: [KEY, 'campaign', id],
    queryFn: () => getCampaign(id as string),
    enabled: id !== null,
  });

export function useMessageMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: [KEY] });
  return {
    preview: useMutation({ mutationFn: (values: PreviewBulkRequest) => previewBulk(values) }),
    create: useMutation({
      mutationFn: (values: CreateBulkMessageRequest) => createBulk(values),
      onSuccess: refresh,
    }),
    send: useMutation({ mutationFn: (id: string) => sendCampaign(id), onSuccess: refresh }),
    retry: useMutation({ mutationFn: (id: string) => retryCampaign(id), onSuccess: refresh }),
    addOptOut: useMutation({
      mutationFn: (values: AddOptOutRequest) => addOptOut(values),
      onSuccess: refresh,
    }),
    removeOptOut: useMutation({
      mutationFn: (customerId: string) => removeOptOut(customerId),
      onSuccess: refresh,
    }),
    document: useMutation({
      mutationFn: (values: SendDocumentRequest) => sendDocument(values),
      onSuccess: refresh,
    }),
  };
}
