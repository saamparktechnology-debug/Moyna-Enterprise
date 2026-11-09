//apps/web/src/features/health/use-health.ts
import { HealthResponseSchema } from '@erp/contracts';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';

export function useHealth() {
  return useQuery({
    queryKey: ['health'],
    queryFn: () => api.get('/health', HealthResponseSchema),
  });
}
