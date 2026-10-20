import {
  CreateUserResponseSchema,
  ResetPasswordResponseSchema,
  UserListResponseSchema,
  UserSchema,
} from '@erp/contracts';
import type {
  CreateUserRequest,
  CreateUserResponse,
  ResetPasswordResponse,
  UpdateUserRequest,
  User,
  UserListResponse,
} from '@erp/contracts';
import { api } from '@/lib/api';

export interface UserListParams {
  page: number;
  pageSize: number;
  search: string;
  status: 'active' | 'inactive' | 'all';
  roleId: string;
  branchId: string;
  /** One of `USER_SORT_FIELDS`. Left out until a column is chosen, so the server's order applies. */
  sortBy?: string | undefined;
  sortOrder?: 'asc' | 'desc' | undefined;
}

export function listUsers(params: UserListParams): Promise<UserListResponse> {
  const query = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
    status: params.status,
  });
  if (params.search) query.set('search', params.search);
  if (params.roleId) query.set('roleId', params.roleId);
  if (params.branchId) query.set('branchId', params.branchId);
  if (params.sortBy) {
    query.set('sortBy', params.sortBy);
    query.set('sortOrder', params.sortOrder ?? 'asc');
  }
  return api.get(`/users?${query.toString()}`, UserListResponseSchema);
}

export function createUser(values: CreateUserRequest): Promise<CreateUserResponse> {
  return api.post('/users', values, CreateUserResponseSchema);
}

export function updateUser(id: string, values: UpdateUserRequest): Promise<User> {
  return api.patch(`/users/${id}`, values, UserSchema);
}

export function setUserActive(id: string, active: boolean): Promise<User> {
  return api.post(`/users/${id}/${active ? 'reactivate' : 'deactivate'}`, {}, UserSchema);
}

export function resetUserPassword(id: string): Promise<ResetPasswordResponse> {
  return api.post(`/auth/users/${id}/reset-password`, {}, ResetPasswordResponseSchema);
}
