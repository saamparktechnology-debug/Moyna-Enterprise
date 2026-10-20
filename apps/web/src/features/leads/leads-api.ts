import {
  ConvertLeadResponseSchema,
  FollowupCountsSchema,
  FollowupListResponseSchema,
  FollowupSchema,
  LeadSourceAdminListResponseSchema,
  LeadSourceAdminSchema,
  LeadAssigneeListResponseSchema,
  LeadListResponseSchema,
  LeadSchema,
  LeadSourceListResponseSchema,
} from '@erp/contracts';
import type {
  AddLeadNoteRequest,
  AssignLeadRequest,
  ChangeStageRequest,
  CompleteFollowupRequest,
  CreateLeadSourceRequest,
  LeadSourceAdmin,
  UpdateLeadSourceRequest,
  RescheduleFollowupRequest,
  ConvertLeadRequest,
  ConvertLeadResponse,
  CreateFollowupRequest,
  CreateLeadRequest,
  Followup,
  FollowupCounts,
  FollowupListResponse,
  Lead,
  LeadAssignee,
  LeadListResponse,
  LeadSourceOption,
  UpdateLeadRequest,
} from '@erp/contracts';
import { z } from 'zod';
import { api } from '@/lib/api';

function query(values: Record<string, string | number | boolean | undefined>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values))
    if (value !== undefined && value !== '' && value !== false) params.set(key, String(value));
  return params.toString();
}

export interface LeadListParams {
  page: number;
  pageSize: number;
  search: string;
  stage: string;
  assignedTo: string;
  overdue: boolean;
  /** One of `LEAD_SORT_FIELDS`. Left out until the person picks a column. */
  sortBy?: string | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
}

export interface FollowupListParams {
  page: number;
  pageSize: number;
  scope: string;
  mine: boolean;
  /** One of `FOLLOWUP_SORT_FIELDS`. Left out until the person picks a column. */
  sortBy?: string | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
}

export const listLeads = (params: LeadListParams): Promise<LeadListResponse> =>
  api.get(
    `/leads?${query({ ...params, sortOrder: params.sortBy ? params.sortOrder : undefined })}`,
    LeadListResponseSchema,
  );

export const getLead = (id: string): Promise<Lead> => api.get(`/leads/${id}`, LeadSchema);

export const createLead = (values: CreateLeadRequest): Promise<Lead> =>
  api.post('/leads', values, LeadSchema);

export const updateLead = (id: string, values: UpdateLeadRequest): Promise<Lead> =>
  api.patch(`/leads/${id}`, values, LeadSchema);

export const changeStage = (id: string, values: ChangeStageRequest): Promise<Lead> =>
  api.post(`/leads/${id}/stage`, values, LeadSchema);

export const assignLead = (id: string, values: AssignLeadRequest): Promise<Lead> =>
  api.post(`/leads/${id}/assign`, values, LeadSchema);

export const addLeadNote = (id: string, values: AddLeadNoteRequest): Promise<unknown> =>
  api.post(`/leads/${id}/notes`, values, z.unknown());

export const convertLead = (id: string, values: ConvertLeadRequest): Promise<ConvertLeadResponse> =>
  api.post(`/leads/${id}/convert`, values, ConvertLeadResponseSchema);

export const scheduleFollowup = (id: string, values: CreateFollowupRequest): Promise<Followup> =>
  api.post(`/leads/${id}/followups`, values, FollowupSchema);

export const completeFollowup = (id: string, values: CompleteFollowupRequest): Promise<Followup> =>
  api.post(`/followups/${id}/complete`, values, FollowupSchema);

export const listFollowups = (params: FollowupListParams): Promise<FollowupListResponse> =>
  api.get(
    `/followups?${query({ ...params, sortOrder: params.sortBy ? params.sortOrder : undefined })}`,
    FollowupListResponseSchema,
  );

export const getFollowupCounts = (mine: boolean): Promise<FollowupCounts> =>
  api.get(`/followups/counts?${query({ mine })}`, FollowupCountsSchema);

export const listAssignees = (): Promise<LeadAssignee[]> =>
  api.get('/leads/assignees', LeadAssigneeListResponseSchema);

export const listLeadSources = (): Promise<LeadSourceOption[]> =>
  api.get('/reference/lead-sources', LeadSourceListResponseSchema);

export function rescheduleFollowup(
  id: string,
  values: RescheduleFollowupRequest,
): Promise<Followup> {
  return api.post(`/followups/${id}/reschedule`, values, FollowupSchema);
}

export const listLeadSourcesAdmin = (): Promise<LeadSourceAdmin[]> =>
  api.get('/lead-sources', LeadSourceAdminListResponseSchema);
export const createLeadSource = (values: CreateLeadSourceRequest): Promise<LeadSourceAdmin> =>
  api.post('/lead-sources', values, LeadSourceAdminSchema);
export const updateLeadSource = (
  code: string,
  values: UpdateLeadSourceRequest,
): Promise<LeadSourceAdmin> => api.patch(`/lead-sources/${code}`, values, LeadSourceAdminSchema);
