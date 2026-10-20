import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { listBranchOptions } from '@/features/transfers/transfers-api';
import {
  advanceSeries,
  createRate,
  getAuditFacets,
  getUserActivity,
  listAuditUsers,
  listAudit,
  listRates,
  listSeries,
  listSettings,
  resetSetting,
  saveSetting,
  updateRate,
} from './settings-api';
import type { AuditParams, SeriesParams } from './settings-api';

export const useSettings = () => useQuery({ queryKey: ['settings', 'all'], queryFn: listSettings });

export function useSettingMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['settings'] });
  return {
    save: useMutation({
      mutationFn: (v: { key: string; value: string | number; rowVersion: number | null }) =>
        saveSetting(v.key, v.value, v.rowVersion),
      onSuccess: refresh,
    }),
    reset: useMutation({
      mutationFn: (v: { key: string; rowVersion: number }) => resetSetting(v.key, v.rowVersion),
      onSuccess: refresh,
    }),
  };
}

export const useSeries = (params: SeriesParams) =>
  useQuery({
    queryKey: ['settings', 'series', params],
    queryFn: () => listSeries(params),
    placeholderData: keepPreviousData,
  });

export function useAdvanceSeries() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: (v: { id: string; nextNumber: number; reason: string; rowVersion: number }) =>
      advanceSeries(v.id, { nextNumber: v.nextNumber, reason: v.reason, rowVersion: v.rowVersion }),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['settings', 'series'] }),
  });
}

export const useRates = () => useQuery({ queryKey: ['settings', 'rates'], queryFn: listRates });

export function useRateMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['settings', 'rates'] });
  return {
    create: useMutation({ mutationFn: createRate, onSuccess: refresh }),
    update: useMutation({
      mutationFn: ({
        id,
        ...body
      }: {
        id: string;
        label?: string;
        isActive?: boolean;
        rowVersion: number;
      }) => updateRate(id, body),
      onSuccess: refresh,
    }),
  };
}

export const useAudit = (params: AuditParams) =>
  useQuery({
    queryKey: ['settings', 'audit', params],
    queryFn: () => listAudit(params),
    placeholderData: keepPreviousData,
  });
export const useAuditFacets = () =>
  useQuery({ queryKey: ['settings', 'audit-facets'], queryFn: getAuditFacets, staleTime: 60_000 });
export const useUserActivity = (id: string) =>
  useQuery({
    queryKey: ['settings', 'activity', id],
    queryFn: () => getUserActivity(id),
    enabled: id !== '',
  });
export const useAuditUsers = () =>
  useQuery({
    queryKey: ['settings', 'audit-users'],
    queryFn: listAuditUsers,
    staleTime: 60_000,
  });
export const useSettingsBranches = () =>
  useQuery({ queryKey: ['settings', 'branches'], queryFn: listBranchOptions, staleTime: 60_000 });
