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
    /**
     * WhatsApp Business (Meta Cloud API): the access token and the id of the business phone number. Without them
     * WhatsApp sending is switched off. The template is for people who have not written to you in the last 24 hours:
     * WhatsApp only allows a free message inside that window, so outside it a template with one text variable is sent.
     */
    WHATSAPP_TOKEN: z.string().trim().min(1).optional(),
    WHATSAPP_PHONE_NUMBER_ID: z
      .string()
      .trim()
      .regex(/^\d+$/, 'must be the numeric phone number id')
      .optional(),
    WHATSAPP_API_VERSION: z
      .string()
      .trim()
      .regex(/^v\d+\.\d+$/, 'must look like v21.0')
      .default('v21.0'),
    WHATSAPP_TEMPLATE_NAME: z.string().trim().min(1).optional(),
    /** Templates for a purpose of their own. A receipt falls back to the invoice template, and either to the general one. */
    WHATSAPP_TEMPLATE_INVOICE: z.string().trim().min(1).optional(),
    WHATSAPP_TEMPLATE_RECEIPT: z.string().trim().min(1).optional(),
    WHATSAPP_TEMPLATE_REMINDER: z.string().trim().min(1).optional(),
    WHATSAPP_TEMPLATE_LANGUAGE: z.string().trim().min(2).default('en'),
    /** Put in front of a 10-digit number. */
    WHATSAPP_COUNTRY_CODE: z
      .string()
      .trim()
      .regex(/^\d{1,3}$/, 'must be digits, such as 91')
      .default('91'),
    /** Email through an SMTP server, for example Google: smtp.gmail.com with an app password. */
    SMTP_HOST: z.string().trim().min(1).default('smtp.gmail.com'),
    SMTP_PORT: z.coerce.number().int().min(1).max(65535).default(465),
    SMTP_USER: z.string().trim().min(1).optional(),
    SMTP_PASSWORD: z.string().min(1).optional(),
    /** The "from" address. Defaults to SMTP_USER. */
    SMTP_FROM: z.string().trim().min(3).optional(),
    /** `fake` keeps messages in memory instead of sending them. Only for tests. */
    MESSAGING_MODE: z.enum(['live', 'fake']).optional(),
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
    if (Boolean(env.WHATSAPP_TOKEN) !== Boolean(env.WHATSAPP_PHONE_NUMBER_ID))
      context.addIssue({
        code: 'custom',
        path: [env.WHATSAPP_TOKEN ? 'WHATSAPP_PHONE_NUMBER_ID' : 'WHATSAPP_TOKEN'],
        message: 'WHATSAPP_TOKEN and WHATSAPP_PHONE_NUMBER_ID go together',
      });
    if (Boolean(env.SMTP_USER) !== Boolean(env.SMTP_PASSWORD))
      context.addIssue({
        code: 'custom',
        path: [env.SMTP_USER ? 'SMTP_PASSWORD' : 'SMTP_USER'],
        message: 'SMTP_USER and SMTP_PASSWORD go together',
      });
    if (env.NODE_ENV !== 'production') return;
    if (env.MESSAGING_MODE === 'fake')
      context.addIssue({
        code: 'custom',
        path: ['MESSAGING_MODE'],
        message: 'fake messaging sends nothing and cannot be used in production',
      });
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
