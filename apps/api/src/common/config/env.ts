import { isAbsolute } from 'node:path';
import { z } from 'zod';

const postgresUrl = z
  .string()
  .refine(
    (value) => /^postgres(ql)?:\/\//.test(value),
    'must be a postgres:// or postgresql:// URL',
  );

export const EnvSchema = z
  .object({
    NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
    API_PORT: z.coerce.number().int().min(1).max(65535).default(3000),
    DATABASE_URL: postgresUrl,
    LOG_LEVEL: z
      .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'])
      .default('info'),
    SESSION_SECRET: z.string().min(32, 'must be at least 32 characters'),
    WEB_ORIGIN: z.url().default('http://localhost:5173'),
    /** Where uploaded files are kept. `memory` forgets them on restart and is only for tests. */
    STORAGE_DRIVER: z.enum(['local', 'memory']).optional(),
    /** Absolute folder for KYC documents, outside the application folder. Required in production. */
    KYC_STORAGE_PATH: z.string().trim().min(1).optional(),
    /**
     * The most an Admin may approve as the valuation of an exchange, in rupees. Above it only a Super Admin may approve.
     * Leave it unset for no limit.
     */
    EXCHANGE_ADMIN_APPROVAL_LIMIT: z
      .string()
      .trim()
      .regex(/^\d+(\.\d{1,2})?$/, 'must be an amount in rupees, such as 50000 or 50000.50')
      .optional(),
  })
  .superRefine((env, context) => {
    if (env.KYC_STORAGE_PATH && !isAbsolute(env.KYC_STORAGE_PATH))
      context.addIssue({
        code: 'custom',
        path: ['KYC_STORAGE_PATH'],
        message: 'must be an absolute path, for example /var/lib/my-erp/kyc',
      });
    if (env.NODE_ENV !== 'production') return;
    if (env.STORAGE_DRIVER === 'memory')
      context.addIssue({
        code: 'custom',
        path: ['STORAGE_DRIVER'],
        message: 'memory storage loses uploaded files on restart and cannot be used in production',
      });
    if (!env.KYC_STORAGE_PATH)
      context.addIssue({
        code: 'custom',
        path: ['KYC_STORAGE_PATH'],
        message: 'is required in production (a persistent folder outside the application folder)',
      });
  });

export type Env = z.infer<typeof EnvSchema>;

export class ConfigValidationError extends Error {
  constructor(readonly problems: string[]) {
    super(`Invalid environment configuration:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    this.name = 'ConfigValidationError';
  }
}

export function loadEnv(source: Record<string, string | undefined> = process.env): Env {
  const result = EnvSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new ConfigValidationError(problems);
  }
  return result.data;
}
