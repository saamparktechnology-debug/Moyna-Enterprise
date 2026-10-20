import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateUserRequest, UpdateUserRequest } from '@erp/contracts';
import { createUser, listUsers, resetUserPassword, setUserActive, updateUser } from './users-api';
import type { UserListParams } from './users-api';

const USERS_KEY = 'users';

export function useUsers(params: UserListParams) {
  return useQuery({
    queryKey: [USERS_KEY, params],
    queryFn: () => listUsers(params),
    placeholderData: keepPreviousData,
  });
}

export function useUserMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: [USERS_KEY] });
  return {
    create: useMutation({
      mutationFn: (values: CreateUserRequest) => createUser(values),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, values }: { id: string; values: UpdateUserRequest }) =>
        updateUser(id, values),
      onSuccess: refresh,
    }),
    setActive: useMutation({
      mutationFn: ({ id, active }: { id: string; active: boolean }) => setUserActive(id, active),
      onSuccess: refresh,
    }),
    resetPassword: useMutation({
      mutationFn: (id: string) => resetUserPassword(id),
      onSuccess: refresh,
    }),
  };
}
