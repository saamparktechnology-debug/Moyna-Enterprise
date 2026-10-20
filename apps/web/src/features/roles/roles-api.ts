import { PermissionGroupsResponseSchema, RoleListResponseSchema, RoleSchema } from '@erp/contracts';
import type { CreateRoleRequest, PermissionGroup, Role, UpdateRoleRequest } from '@erp/contracts';
import { api } from '@/lib/api';

export function listRoles(): Promise<Role[]> {
  return api.get('/roles', RoleListResponseSchema);
}

export function listPermissions(): Promise<PermissionGroup[]> {
  return api.get('/permissions', PermissionGroupsResponseSchema);
}

export function createRole(values: CreateRoleRequest): Promise<Role> {
  return api.post('/roles', values, RoleSchema);
}

export function updateRole(id: string, values: UpdateRoleRequest): Promise<Role> {
  return api.patch(`/roles/${id}`, values, RoleSchema);
}
