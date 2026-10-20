import { z } from 'zod';

export const HealthResponseSchema = z.object({
  status: z.literal('ok'),
  database: z.literal('up'),
  uptimeSeconds: z.number().nonnegative(),
});
export type HealthResponse = z.infer<typeof HealthResponseSchema>;
