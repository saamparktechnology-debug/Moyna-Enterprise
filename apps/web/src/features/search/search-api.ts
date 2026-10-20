import { SearchResponseSchema } from '@erp/contracts';
import type { SearchResponse } from '@erp/contracts';
import { api } from '@/lib/api';

export const searchEverything = (q: string): Promise<SearchResponse> =>
  api.get(`/search?${new URLSearchParams({ q, limit: '5' }).toString()}`, SearchResponseSchema);
