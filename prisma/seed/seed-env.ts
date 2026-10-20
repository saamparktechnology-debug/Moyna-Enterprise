import { z } from 'zod';

const SeedEnvSchema = z.object({
  MIGRATION_DATABASE_URL: z
    .string()
    .refine(
      (value) => /^postgres(ql)?:\/\//.test(value),
      'must be a postgres:// or postgresql:// URL',
    ),
  SEED_SUPER_ADMIN_EMAIL: z.email(),
  SEED_SUPER_ADMIN_USERNAME: z
    .string()
    .regex(/^[a-z0-9._-]{3,32}$/, 'use 3 to 32 lowercase letters, digits, dot, dash or underscore')
    .default('superadmin'),
  SEED_SUPER_ADMIN_NAME: z.string().min(2).default('Super Admin'),
  SEED_SUPER_ADMIN_PASSWORD: z.string().min(12, 'must be at least 12 characters'),
  SEED_BRANCH_CODE: z
    .string()
    .regex(
      /^[A-Z0-9]{2,4}$/,
      'use 2 to 4 uppercase letters or digits (GST invoice numbers are limited to 16 characters)',
    ),
  SEED_BRANCH_NAME: z.string().min(2),
  SEED_BRANCH_STATE_CODE: z.string().regex(/^\d{2}$/, 'use the 2-digit GST state code'),
  SEED_BRANCH_GSTIN: z.string().optional(),
});

export interface SeedConfig {
  databaseUrl: string;
  superAdmin: { email: string; username: string; fullName: string; password: string };
  branch: { code: string; name: string; stateCode: string; gstin?: string | undefined };
}

export function loadSeedConfig(
  source: Record<string, string | undefined> = process.env,
): SeedConfig {
  const parsed = SeedEnvSchema.safeParse(source);
  if (!parsed.success) {
    const problems = parsed.error.issues.map(
      (issue) => `  - ${issue.path.join('.')}: ${issue.message}`,
    );
    throw new Error(`Invalid seed configuration:\n${problems.join('\n')}`);
  }
  const env = parsed.data;
  return {
    databaseUrl: env.MIGRATION_DATABASE_URL,
    superAdmin: {
      email: env.SEED_SUPER_ADMIN_EMAIL,
      username: env.SEED_SUPER_ADMIN_USERNAME,
      fullName: env.SEED_SUPER_ADMIN_NAME,
      password: env.SEED_SUPER_ADMIN_PASSWORD,
    },
    branch: {
      code: env.SEED_BRANCH_CODE,
      name: env.SEED_BRANCH_NAME,
      stateCode: env.SEED_BRANCH_STATE_CODE,
      gstin: env.SEED_BRANCH_GSTIN,
    },
  };
}
