import { pino } from 'pino';
import type pg from 'pg';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { loadWorkerEnv } from '../src/config.js';
import { PgBossPublisher } from '../src/outbox/publisher.js';
import { createBoss, QUEUES, setupQueues } from '../src/queue.js';
import { startWorker } from '../src/worker.js';
import { WORKER_URL } from './env.js';
import { addEvents, ownerClient, resetOutbox, waitFor } from './support.js';

describe('queues and the running worker', () => {
  let owner: pg.Client;

  beforeAll(async () => {
    owner = await ownerClient();
    return async () => {
      await resetOutbox(owner);
      await owner.end();
    };
  });
  afterAll(async () => {
    await resetOutbox(owner);
  });

  it('sets up the queues, and can do so again without error', async () => {
    const boss = createBoss(WORKER_URL);
    await boss.start();
    await setupQueues(boss);
    await setupQueues(boss);
    const names = (await boss.getQueues()).map((queue) => queue.name);
    expect(names).toEqual(
      expect.arrayContaining([QUEUES.DOMAIN_EVENTS, QUEUES.DOMAIN_EVENTS_DEAD]),
    );
    const main = await boss.getQueue(QUEUES.DOMAIN_EVENTS);
    expect(main).toMatchObject({
      policy: 'short',
      retryLimit: 5,
      deadLetter: QUEUES.DOMAIN_EVENTS_DEAD,
    });
    await boss.stop({ graceful: true });
  });

  it('turns a published event into a queued job carrying the event id, once', async () => {
    const boss = createBoss(WORKER_URL);
    await boss.start();
    await setupQueues(boss);
    await boss.deleteAllJobs(QUEUES.DOMAIN_EVENTS);
    const publisher = new PgBossPublisher(boss);
    const event = {
      id: '11111111-1111-4111-8111-111111111111',
      eventType: 'invoice.issued',
      payload: { total: '105.00' },
      branchId: null,
    };

    await publisher.publish(event);
    await publisher.publish(event);

    const jobs = await boss.fetch<{ eventId: string; eventType: string; payload: unknown }>(
      QUEUES.DOMAIN_EVENTS,
      { batchSize: 10 },
    );
    expect(jobs).toHaveLength(1);
    expect(jobs[0]?.data).toEqual({
      eventId: event.id,
      eventType: 'invoice.issued',
      payload: { total: '105.00' },
      branchId: null,
    });
    await boss.stop({ graceful: true });
  });

  it('relays outbox events to the queue while running, and stops cleanly', async () => {
    const env = loadWorkerEnv({
      WORKER_DATABASE_URL: WORKER_URL,
      LOG_LEVEL: 'silent',
      OUTBOX_POLL_INTERVAL_MS: '50',
      OUTBOX_BATCH_SIZE: '10',
    });
    const probe = createBoss(WORKER_URL);
    await probe.start();
    await setupQueues(probe);
    await probe.deleteAllJobs(QUEUES.DOMAIN_EVENTS);

    const worker = await startWorker(env, pino({ level: 'silent' }));
    const ids = await addEvents(owner, 25, 'stock.low');

    await waitFor(
      async () =>
        (await owner.query("SELECT 1 FROM outbox_events WHERE status <> 'PROCESSED'")).rowCount ===
        0,
    );
    const jobs = await probe.fetch<{ eventId: string }>(QUEUES.DOMAIN_EVENTS, { batchSize: 100 });
    expect(jobs.map((job) => job.data.eventId).sort()).toEqual(ids.slice().sort());

    await worker.stop('SIGTERM');
    await probe.stop({ graceful: true });
  });

  it('picks up events that arrive after it has started', async () => {
    const env = loadWorkerEnv({
      WORKER_DATABASE_URL: WORKER_URL,
      LOG_LEVEL: 'silent',
      OUTBOX_POLL_INTERVAL_MS: '50',
    });
    const worker = await startWorker(env, pino({ level: 'silent' }));
    await new Promise((resolve) => setTimeout(resolve, 200));
    const [id] = await addEvents(owner, 1, 'late.event');
    await waitFor(
      async () =>
        (
          await owner.query("SELECT 1 FROM outbox_events WHERE id = $1 AND status = 'PROCESSED'", [
            id,
          ])
        ).rowCount === 1,
    );
    await worker.stop('SIGINT');
  });

  it('fails to start with a clear error when it cannot reach the database', async () => {
    const env = loadWorkerEnv({
      WORKER_DATABASE_URL: 'postgresql://erp_worker:erp_worker@127.0.0.1:1/erp_test',
      LOG_LEVEL: 'silent',
    });
    await expect(startWorker(env, pino({ level: 'silent' }))).rejects.toThrow();
  });
});
