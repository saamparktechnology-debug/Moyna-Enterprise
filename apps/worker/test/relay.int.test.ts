import { pino } from 'pino';
import pg from 'pg';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { EventPublisher, OutboxEvent } from '../src/outbox/publisher.js';
import { OutboxRelay } from '../src/outbox/relay.js';
import { WORKER_URL } from './env.js';
import { addEvents, ownerClient, resetOutbox } from './support.js';

class RecordingPublisher implements EventPublisher {
  readonly published: string[] = [];
  constructor(
    private readonly behaviour: (event: OutboxEvent) => Promise<void> = async () => undefined,
  ) {}
  async publish(event: OutboxEvent): Promise<void> {
    await this.behaviour(event);
    this.published.push(event.id);
  }
}

describe('outbox relay', () => {
  let owner: pg.Client;
  let pool: pg.Pool;
  const logger = pino({ level: 'silent' });
  const relayWith = (publisher: EventPublisher, batchSize = 50, maxAttempts = 3): OutboxRelay =>
    new OutboxRelay(pool, publisher, logger, { batchSize, maxAttempts });
  const rows = async () =>
    (
      await owner.query(
        'SELECT id, status, attempts, last_error, processed_at FROM outbox_events ORDER BY created_at',
      )
    ).rows;

  beforeAll(async () => {
    owner = await ownerClient();
    pool = new pg.Pool({ connectionString: WORKER_URL, max: 6 });
    return async () => {
      await pool.end();
      await owner.end();
    };
  });
  beforeEach(async () => {
    await resetOutbox(owner);
  });
  afterAll(async () => {
    await resetOutbox(owner);
  });

  it('publishes pending events oldest first and marks them processed', async () => {
    const ids = await addEvents(owner, 3);
    const publisher = new RecordingPublisher();

    const result = await relayWith(publisher).relayBatch();

    expect(result).toEqual({ published: 3, retrying: 0, failed: 0 });
    expect(publisher.published).toEqual(ids);
    for (const row of await rows()) {
      expect(row).toMatchObject({ status: 'PROCESSED', attempts: 1, last_error: null });
      expect(row.processed_at).toBeInstanceOf(Date);
    }
  });

  it('does nothing when there is nothing to publish, and never republishes a processed event', async () => {
    const publisher = new RecordingPublisher();
    expect(await relayWith(publisher).relayBatch()).toEqual({
      published: 0,
      retrying: 0,
      failed: 0,
    });
    await addEvents(owner, 2);
    await relayWith(publisher).relayBatch();
    await relayWith(publisher).relayBatch();
    expect(publisher.published).toHaveLength(2);
  });

  it('respects the batch size and continues on the next batch', async () => {
    await addEvents(owner, 5);
    const publisher = new RecordingPublisher();
    const relay = relayWith(publisher, 2);
    expect((await relay.relayBatch()).published).toBe(2);
    expect((await relay.relayBatch()).published).toBe(2);
    expect((await relay.relayBatch()).published).toBe(1);
    expect(publisher.published).toHaveLength(5);
  });

  it('keeps a failing event pending with its error, and does not block the others', async () => {
    const [bad] = await addEvents(owner, 1, 'bad.event');
    await addEvents(owner, 2);
    const publisher = new RecordingPublisher(async (event) => {
      if (event.eventType === 'bad.event') throw new Error('queue is down');
    });

    const result = await relayWith(publisher).relayBatch();

    expect(result).toEqual({ published: 2, retrying: 1, failed: 0 });
    const failing = (await rows()).find((r) => r.id === bad);
    expect(failing).toMatchObject({
      status: 'PENDING',
      attempts: 1,
      last_error: 'queue is down',
      processed_at: null,
    });
  });

  it('gives up after the maximum attempts and then leaves the event alone', async () => {
    await addEvents(owner, 1);
    const publisher = new RecordingPublisher(async () => {
      throw new Error('still down');
    });
    const relay = relayWith(publisher, 50, 3);

    expect(await relay.relayBatch()).toMatchObject({ retrying: 1, failed: 0 });
    expect(await relay.relayBatch()).toMatchObject({ retrying: 1, failed: 0 });
    expect(await relay.relayBatch()).toMatchObject({ retrying: 0, failed: 1 });
    expect(await relay.relayBatch()).toEqual({ published: 0, retrying: 0, failed: 0 });
    expect((await rows())[0]).toMatchObject({
      status: 'FAILED',
      attempts: 3,
      last_error: 'still down',
    });
  });

  it('truncates a very long error message', async () => {
    await addEvents(owner, 1);
    await relayWith(
      new RecordingPublisher(async () => {
        throw new Error('x'.repeat(5000));
      }),
    ).relayBatch();
    expect(((await rows())[0]!.last_error as string).length).toBe(500);
  });

  it('publishes every event exactly once when several relays run at the same time', async () => {
    const ids = await addEvents(owner, 60);
    const publisher = new RecordingPublisher(async () => {
      await new Promise((resolve) => setTimeout(resolve, 5));
    });
    const relays = Array.from({ length: 4 }, () => relayWith(publisher, 10));

    await Promise.all(
      relays.map(async (relay) => {
        for (let i = 0; i < 8; i += 1) await relay.relayBatch();
      }),
    );

    expect(publisher.published.slice().sort()).toEqual(ids.slice().sort());
    expect((await rows()).every((r) => r.status === 'PROCESSED' && r.attempts === 1)).toBe(true);
  });

  it('keeps the event pending, to be sent again, when the batch fails to commit after publishing', async () => {
    await addEvents(owner, 1);
    let commitFailed = false;
    const flakyPool = {
      async connect() {
        const client = await pool.connect();
        const query = client.query.bind(client) as (...args: unknown[]) => Promise<unknown>;
        (client as unknown as { query: unknown }).query = (...args: unknown[]) => {
          if (args[0] === 'COMMIT' && !commitFailed) {
            commitFailed = true;
            return Promise.reject(new Error('connection lost'));
          }
          return query(...args);
        };
        return client;
      },
    } as unknown as pg.Pool;
    const publisher = new RecordingPublisher();

    await expect(
      new OutboxRelay(flakyPool, publisher, logger, { batchSize: 50, maxAttempts: 3 }).relayBatch(),
    ).rejects.toThrow('connection lost');

    expect(publisher.published).toHaveLength(1);
    expect((await rows())[0]).toMatchObject({ status: 'PENDING', attempts: 0, processed_at: null });
    await relayWith(publisher).relayBatch();
    expect((await rows())[0]).toMatchObject({ status: 'PROCESSED', attempts: 1 });
  });

  it('cannot change what an event says, only how it was processed', async () => {
    const [id] = await addEvents(owner, 1);
    await expect(
      pool.query("UPDATE outbox_events SET payload = '{}' WHERE id = $1", [id]),
    ).rejects.toMatchObject({ code: '42501' });
    await expect(
      pool.query("INSERT INTO outbox_events (event_type, payload) VALUES ('forged', '{}')"),
    ).rejects.toMatchObject({ code: '42501' });
  });
});
