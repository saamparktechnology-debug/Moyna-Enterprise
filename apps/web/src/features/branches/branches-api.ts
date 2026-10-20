import { BranchListResponseSchema, BranchSchema, StateListResponseSchema } from '@erp/contracts';
import type {
  Branch,
  BranchListResponse,
  CreateBranchRequest,
  State,
  UpdateBranchRequest,
} from '@erp/contracts';
import { api } from '@/lib/api';

export interface BranchListParams {
  page: number;
  pageSize: number;
  search: string;
  status: 'active' | 'inactive' | 'all';
  /** One of `BRANCH_SORT_FIELDS`. Left out until the person picks a column, so the server's order applies. */
  sortBy?: string | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
}

export function listBranches(params: BranchListParams): Promise<BranchListResponse> {
  const query = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
    status: params.status,
  });
  if (params.search) query.set('search', params.search);
  if (params.sortBy) {
    query.set('sortBy', params.sortBy);
    query.set('sortOrder', params.sortOrder ?? 'asc');
  }
  return api.get(`/branches?${query.toString()}`, BranchListResponseSchema);
}

export function listStates(): Promise<State[]> {
  return api.get('/reference/states', StateListResponseSchema);
}

export function createBranch(values: CreateBranchRequest): Promise<Branch> {
  return api.post('/branches', values, BranchSchema);
}

export async function updateBranch(id: string, values: UpdateBranchRequest): Promise<Branch> {
  return api.patch(`/branches/${id}`, values, BranchSchema);
}

export function setBranchActive(id: string, active: boolean): Promise<Branch> {
  return api.post(`/branches/${id}/${active ? 'reactivate' : 'deactivate'}`, {}, BranchSchema);
}
