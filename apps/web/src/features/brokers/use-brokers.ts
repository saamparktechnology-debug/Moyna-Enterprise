//apps/web/src/features/brokers/use-brokers.ts
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AddCommissionRuleRequest,
  CreateBrokerRequest,
  PayoutRequest,
  UpdateBrokerRequest,
} from '@erp/contracts';
import {
  addBrokerDocument,
  addRule,
  createBroker,
  deleteBrokerDocument,
  deleteBrokerPhoto,
  getBroker,
  getBrokerLedger,
  listBrokers,
  listCommissions,
  payoutCommissions,
  updateBroker,
  uploadBrokerPhoto,
} from './brokers-api';
import type { BrokerListParams, CommissionListParams } from './brokers-api';

const KEY = 'brokers';

export const useBrokers = (params: BrokerListParams, enabled = true) =>
  useQuery({
    queryKey: [KEY, 'list', params],
    queryFn: () => listBrokers(params),
    placeholderData: keepPreviousData,
    enabled,
  });

export const useBroker = (id: string) =>
  useQuery({ queryKey: [KEY, 'one', id], queryFn: () => getBroker(id) });

export const useBrokerLedger = (id: string, params: { page: number; pageSize: number }) =>
  useQuery({
    queryKey: [KEY, 'ledger', id, params],
    queryFn: () => getBrokerLedger(id, params),
    placeholderData: keepPreviousData,
  });

export const useCommissions = (params: CommissionListParams) =>
  useQuery({
    queryKey: [KEY, 'commissions', params],
    queryFn: () => listCommissions(params),
    placeholderData: keepPreviousData,
  });

export function useBrokerMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: [KEY] });
  return {
    create: useMutation({
      mutationFn: (values: CreateBrokerRequest) => createBroker(values),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, values }: { id: string; values: UpdateBrokerRequest }) =>
        updateBroker(id, values),
      onSuccess: refresh,
    }),
    addRule: useMutation({
      mutationFn: ({ id, values }: { id: string; values: AddCommissionRuleRequest }) =>
        addRule(id, values),
      onSuccess: refresh,
    }),
    setPhoto: useMutation({
      mutationFn: ({ id, file }: { id: string; file: File }) => uploadBrokerPhoto(id, file),
      onSuccess: refresh,
    }),
    removePhoto: useMutation({
      mutationFn: (id: string) => deleteBrokerPhoto(id),
      onSuccess: refresh,
    }),
    addDocument: useMutation({
      mutationFn: ({ id, file, label }: { id: string; file: File; label: string }) =>
        addBrokerDocument(id, file, label),
      onSuccess: refresh,
    }),
    removeDocument: useMutation({
      mutationFn: ({ id, fileId }: { id: string; fileId: string }) =>
        deleteBrokerDocument(id, fileId),
      onSuccess: refresh,
    }),
    payout: useMutation({
      mutationFn: (values: PayoutRequest) => payoutCommissions(values),
      onSuccess: refresh,
    }),
  };
}
