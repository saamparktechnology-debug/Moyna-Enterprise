import { z } from 'zod';

export const ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'PASSWORD_CHANGE_REQUIRED',
  'RATE_LIMITED',
  'NOT_FOUND',
  'CONFLICT',
  'INVALID_STATE',
  'BUSINESS_RULE_VIOLATION',
  'DATABASE_UNAVAILABLE',
  'INTERNAL_ERROR',
] as const;

export const ErrorCodeSchema = z.enum(ERROR_CODES);
export type ErrorCode = z.infer<typeof ErrorCodeSchema>;

export const ErrorDetailSchema = z.object({
  field: z.string(),
  message: z.string(),
});
export type ErrorDetail = z.infer<typeof ErrorDetailSchema>;

export const ErrorResponseSchema = z.object({
  code: ErrorCodeSchema,
  message: z.string(),
  details: z.array(ErrorDetailSchema),
  requestId: z.string(),
});
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
