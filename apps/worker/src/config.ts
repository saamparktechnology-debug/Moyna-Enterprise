import { pino } from 'pino';
import type { Logger } from 'pino';
import { z } from 'zod';

const WorkerEnvSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  WORKER_DATABASE_URL: z
    .string()
    .refine(
      (value) => /^postgres(ql)?:\/\//.test(value),
      'must be a postgres:// or postgresql:// URL',
    ),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  OUTBOX_POLL_INTERVAL_MS: z.coerce.number().int().min(10).max(60_000).default(2000),
  OUTBOX_BATCH_SIZE: z.coerce.number().int().min(1).max(500).default(50),
  OUTBOX_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(50).default(5),
  /** Channels used besides the in-app inbox, such as EMAIL,SMS. */
  NOTIFICATION_CHANNELS: z
    .string()
    .default('')
    .transform((value) =>
      value
        .split(',')
        .map((part) => part.trim().toUpperCase())
        .filter(Boolean),
    )
    .pipe(z.array(z.enum(['EMAIL', 'SMS', 'WHATSAPP']))),
  /** When the daily reminders run (cron, India time). */
  REMINDER_CRON: z.string().default('0 8 * * *'),
});

export type WorkerEnv = z.infer<typeof WorkerEnvSchema>;

export function loadWorkerEnv(source: Record<string, string | undefined> = process.env): WorkerEnv {
  const result = WorkerEnvSchema.safeParse(source);
  if (!result.success) {
    const problems = result.error.issues.map(
      (issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`,
    );
    throw new Error(`Invalid worker environment configuration:\n${problems.join('\n')}`);
  }
  return result.data;
}

export function createLogger(env: WorkerEnv): Logger {
  return pino({ level: env.LOG_LEVEL, base: { service: 'worker' } });
}
