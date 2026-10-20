import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateRoleRequest, UpdateRoleRequest } from '@erp/contracts';
import { createRole, listPermissions, listRoles, updateRole } from './roles-api';

export const ROLES_KEY = 'roles';

export function useRoles() {
  return useQuery({ queryKey: [ROLES_KEY], queryFn: listRoles });
}

export function usePermissionGroups() {
  return useQuery({ queryKey: ['permissions'], queryFn: listPermissions, staleTime: Infinity });
}

export function useRoleMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: [ROLES_KEY] });
  return {
    create: useMutation({
      mutationFn: (values: CreateRoleRequest) => createRole(values),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, values }: { id: string; values: UpdateRoleRequest }) =>
        updateRole(id, values),
      onSuccess: refresh,
    }),
  };
}
