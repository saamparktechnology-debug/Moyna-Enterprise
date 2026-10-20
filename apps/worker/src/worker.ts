import pg from 'pg';
import { runReminders } from './jobs/reminders.js';
import { deliverNotification, NOTIFICATION_DELIVER_EVENT } from './notifications/deliver.js';
import { LoggingProvider } from './notifications/provider.js';
import type { NotificationProvider } from './notifications/provider.js';
import type { Logger } from 'pino';
import type { WorkerEnv } from './config.js';
import { PgBossPublisher } from './outbox/publisher.js';
import { OutboxRelay } from './outbox/relay.js';
import { startRelayLoop } from './outbox/relay-loop.js';
import { createBoss, QUEUES, setupQueues } from './queue.js';

export interface Worker {
  stop(signal: string): Promise<void>;
}

export interface WorkerOptions {
  /**
   * Also run the jobs: handle domain events (sending notifications) and schedule the daily reminders. Off by default
   * so tests can read the queue themselves; the real process turns it on.
   */
  consumers?: boolean;
  provider?: NotificationProvider;
}

export async function startWorker(
  env: WorkerEnv,
  logger: Logger,
  options: WorkerOptions = {},
): Promise<Worker> {
  const pool = new pg.Pool({ connectionString: env.WORKER_DATABASE_URL, max: 4 });
  pool.on('error', (error) => logger.error({ err: error }, 'Database pool error'));
  const boss = createBoss(env.WORKER_DATABASE_URL);
  boss.on('error', (error) => logger.error({ err: error }, 'Queue error'));

  try {
    await boss.start();
    await setupQueues(boss);
  } catch (error) {
    await pool.end().catch(() => undefined);
    throw error;
  }

  const relay = new OutboxRelay(pool, new PgBossPublisher(boss), logger, {
    batchSize: env.OUTBOX_BATCH_SIZE,
    maxAttempts: env.OUTBOX_MAX_ATTEMPTS,
  });
  const loop = startRelayLoop(relay, env.OUTBOX_POLL_INTERVAL_MS, env.OUTBOX_BATCH_SIZE, logger);
  logger.info('Worker started: relaying outbox events to the domain-events queue');

  if (options.consumers) {
    const provider = options.provider ?? new LoggingProvider(logger);
    await boss.work<{ eventType: string; payload: { notificationId: string; userId: string } }>(
      QUEUES.DOMAIN_EVENTS,
      { batchSize: 10, pollingIntervalSeconds: 1 },
      async (jobs) => {
        for (const job of jobs) {
          // Events nobody here handles are acknowledged and ignored.
          if (job.data.eventType === NOTIFICATION_DELIVER_EVENT)
            await deliverNotification(pool, provider, logger, job.data.payload);
        }
      },
    );
    await boss.work(QUEUES.REMINDERS, async () => {
      await runReminders(pool, logger, { channels: env.NOTIFICATION_CHANNELS });
    });
    await boss.schedule(QUEUES.REMINDERS, env.REMINDER_CRON, {}, { tz: 'Asia/Kolkata' });
    logger.info({ cron: env.REMINDER_CRON }, 'Notification delivery and daily reminders are on');
  }

  return {
    async stop(signal: string): Promise<void> {
      await loop.stop();
      await boss.stop({ graceful: true });
      await pool.end();
      logger.info({ signal }, 'Worker stopped');
    },
  };
}
