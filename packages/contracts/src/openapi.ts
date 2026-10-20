import { z } from 'zod';

export function toOpenApiSchema(schema: z.ZodType): Record<string, unknown> {
  return z.toJSONSchema(schema, { target: 'openapi-3.0', io: 'output' }) as Record<string, unknown>;
}
