import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateBranchRequest, UpdateBranchRequest } from '@erp/contracts';
import {
  createBranch,
  listBranches,
  listStates,
  setBranchActive,
  updateBranch,
} from './branches-api';
import type { BranchListParams } from './branches-api';

const BRANCHES_KEY = 'branches';

export function useBranches(params: BranchListParams) {
  return useQuery({
    queryKey: [BRANCHES_KEY, params],
    queryFn: () => listBranches(params),
    placeholderData: keepPreviousData,
  });
}

export function useStates() {
  return useQuery({ queryKey: ['reference', 'states'], queryFn: listStates, staleTime: Infinity });
}

export function useBranchMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: [BRANCHES_KEY] });
  return {
    create: useMutation({
      mutationFn: (values: CreateBranchRequest) => createBranch(values),
      onSuccess: refresh,
    }),
    update: useMutation({
      mutationFn: ({ id, values }: { id: string; values: UpdateBranchRequest }) =>
        updateBranch(id, values),
      onSuccess: refresh,
    }),
    setActive: useMutation({
      mutationFn: ({ id, active }: { id: string; active: boolean }) => setBranchActive(id, active),
      onSuccess: refresh,
    }),
  };
}
