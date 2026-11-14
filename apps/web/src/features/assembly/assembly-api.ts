import { AssemblyListResponseSchema, AssemblySchema } from '@erp/contracts';
import type {
  Assembly,
  AssemblyListResponse,
  CreateAssemblyRequest,
  ReverseAssemblyRequest,
} from '@erp/contracts';
import { api } from '@/lib/api';

export interface AssemblyListParams {
  page: number;
  pageSize: number;
  search: string;
}

export function listAssemblies(params: AssemblyListParams): Promise<AssemblyListResponse> {
  const query = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  if (params.search) query.set('search', params.search);
  return api.get(`/assemblies?${query.toString()}`, AssemblyListResponseSchema);
}

/** Assembles a product from parts in stock and sets its selling price. */
export function createAssembly(values: CreateAssemblyRequest): Promise<Assembly> {
  return api.post('/assemblies', values, AssemblySchema);
}

/** Takes an assembly apart again: the product leaves stock and the parts come back. */
export function reverseAssembly(id: string, values: ReverseAssemblyRequest): Promise<Assembly> {
  return api.post(`/assemblies/${id}/reverse`, values, AssemblySchema);
}
