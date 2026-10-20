import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  AddLeadNoteRequest,
  AssignLeadRequest,
  ChangeStageRequest,
  CompleteFollowupRequest,
  CreateLeadSourceRequest,
  UpdateLeadSourceRequest,
  RescheduleFollowupRequest,
  ConvertLeadRequest,
  CreateFollowupRequest,
  CreateLeadRequest,
  UpdateLeadRequest,
} from '@erp/contracts';
import {
  addLeadNote,
  assignLead,
  changeStage,
  completeFollowup,
  createLeadSource,
  listLeadSources,
  listLeadSourcesAdmin,
  updateLeadSource,
  rescheduleFollowup,
  convertLead,
  createLead,
  getFollowupCounts,
  getLead,
  listAssignees,
  listFollowups,
  listLeads,
  scheduleFollowup,
  updateLead,
} from './leads-api';
import type { FollowupListParams, LeadListParams } from './leads-api';

const KEY = 'leads';

export const useLeads = (params: LeadListParams) =>
  useQuery({
    queryKey: [KEY, 'list', params],
    queryFn: () => listLeads(params),
    placeholderData: keepPreviousData,
  });

export const useLead = (id: string) =>
  useQuery({ queryKey: [KEY, 'one', id], queryFn: () => getLead(id) });

export const useFollowups = (params: FollowupListParams) =>
  useQuery({
    queryKey: [KEY, 'followups', params],
    queryFn: () => listFollowups(params),
    placeholderData: keepPreviousData,
  });

export const useFollowupCounts = (mine: boolean) =>
  useQuery({ queryKey: [KEY, 'counts', mine], queryFn: () => getFollowupCounts(mine) });

export const useAssignees = (enabled = true) =>
  useQuery({ queryKey: [KEY, 'assignees'], queryFn: listAssignees, enabled, staleTime: 60_000 });

export const useLeadSources = () =>
  useQuery({
    queryKey: ['reference', 'lead-sources'],
    queryFn: listLeadSources,
    staleTime: Infinity,
  });

export const useLeadSourceAdmin = (enabled = true) =>
  useQuery({ queryKey: ['lead-sources'], queryFn: listLeadSourcesAdmin, enabled });

export function useLeadSourceMutations() {
  const queryClient = useQueryClient();
  // The list leads are filed under (and the pickers on the lead forms) change with the sources.
  const refresh = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ['lead-sources'] }),
      queryClient.invalidateQueries({ queryKey: ['reference'] }),
    ]);
  return {
    create: useMutation({
      mutationFn: (v: CreateLeadSourceRequest) => createLeadSource(v),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ code, values }: { code: string; values: UpdateLeadSourceRequest }) =>
        updateLeadSource(code, values),
      onSuccess: refresh,
    }),
  };
}

export function useLeadMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: [KEY] });
  const refreshAll = () =>
    Promise.all([refresh(), queryClient.invalidateQueries({ queryKey: ['customers'] })]);
  return {
    create: useMutation({
      mutationFn: (values: CreateLeadRequest) => createLead(values),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, values }: { id: string; values: UpdateLeadRequest }) =>
        updateLead(id, values),
      onSuccess: refresh,
    }),
    stage: useMutation({
      mutationFn: ({ id, values }: { id: string; values: ChangeStageRequest }) =>
        changeStage(id, values),
      onSuccess: refresh,
    }),
    assign: useMutation({
      mutationFn: ({ id, values }: { id: string; values: AssignLeadRequest }) =>
        assignLead(id, values),
      onSuccess: refresh,
    }),
    note: useMutation({
      mutationFn: ({ id, values }: { id: string; values: AddLeadNoteRequest }) =>
        addLeadNote(id, values),
      onSuccess: refresh,
    }),
    convert: useMutation({
      mutationFn: ({ id, values }: { id: string; values: ConvertLeadRequest }) =>
        convertLead(id, values),
      onSuccess: refreshAll,
    }),
    schedule: useMutation({
      mutationFn: ({ id, values }: { id: string; values: CreateFollowupRequest }) =>
        scheduleFollowup(id, values),
      onSuccess: refresh,
    }),
    complete: useMutation({
      mutationFn: ({ id, values }: { id: string; values: CompleteFollowupRequest }) =>
        completeFollowup(id, values),
      onSuccess: refresh,
    }),
    reschedule: useMutation({
      mutationFn: ({ id, values }: { id: string; values: RescheduleFollowupRequest }) =>
        rescheduleFollowup(id, values),
      onSuccess: refresh,
    }),
  };
}
