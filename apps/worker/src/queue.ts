import { PgBoss } from 'pg-boss';

export const QUEUES = {
  DOMAIN_EVENTS: 'domain-events',
  DOMAIN_EVENTS_DEAD: 'domain-events-dead',
  REMINDERS: 'reminders',
} as const;

const PGBOSS_SCHEMA = 'pgboss';
const MAX_POOL_CONNECTIONS = 4;
const RETRY_LIMIT = 5;
const RETRY_DELAY_SECONDS = 30;

export function createBoss(connectionString: string): PgBoss {
  // The pgboss schema is created and handed to the worker role by `pnpm db:provision`, so the worker needs no CREATE right on the database.
  return new PgBoss({
    connectionString,
    schema: PGBOSS_SCHEMA,
    max: MAX_POOL_CONNECTIONS,
    createSchema: false,
  });
}

export async function setupQueues(boss: PgBoss): Promise<void> {
  await boss.createQueue(QUEUES.DOMAIN_EVENTS_DEAD);
  await boss.createQueue(QUEUES.DOMAIN_EVENTS, {
    policy: 'short',
    retryLimit: RETRY_LIMIT,
    retryDelay: RETRY_DELAY_SECONDS,
    retryBackoff: true,
    deadLetter: QUEUES.DOMAIN_EVENTS_DEAD,
  });
  await boss.createQueue(QUEUES.REMINDERS, { policy: 'short', retryLimit: 2, retryDelay: 60 });
}
