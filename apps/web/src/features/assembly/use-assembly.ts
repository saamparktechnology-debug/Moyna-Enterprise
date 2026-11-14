import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { CreateAssemblyRequest, ReverseAssemblyRequest } from '@erp/contracts';
import { createAssembly, listAssemblies, reverseAssembly } from './assembly-api';
import type { AssemblyListParams } from './assembly-api';

const KEY = 'assemblies';

export const useAssemblies = (params: AssemblyListParams) =>
  useQuery({
    queryKey: [KEY, params],
    queryFn: () => listAssemblies(params),
    placeholderData: keepPreviousData,
  });

export function useAssemblyMutations() {
  const queryClient = useQueryClient();
  return {
    // An assembly changes stock and the product's price, so what is shown elsewhere is refreshed too.
    create: useMutation({
      mutationFn: (values: CreateAssemblyRequest) => createAssembly(values),
      onSuccess: () => queryClient.invalidateQueries(),
    }),
    reverse: useMutation({
      mutationFn: ({ id, values }: { id: string; values: ReverseAssemblyRequest }) =>
        reverseAssembly(id, values),
      onSuccess: () => queryClient.invalidateQueries(),
    }),
  };
}
