import pg from 'pg';
import { OWNER_URL } from './env.js';

export async function ownerClient(): Promise<pg.Client> {
  const client = new pg.Client({ connectionString: OWNER_URL });
  await client.connect();
  return client;
}

export async function resetOutbox(owner: pg.Client): Promise<void> {
  await owner.query('TRUNCATE outbox_events');
}

export async function addEvents(
  owner: pg.Client,
  count: number,
  eventType = 'test.event',
): Promise<string[]> {
  const ids: string[] = [];
  for (let i = 0; i < count; i += 1) {
    const { rows } = await owner.query<{ id: string }>(
      `INSERT INTO outbox_events (event_type, payload, created_at) VALUES ($1, $2::jsonb, now() + ($3 || ' milliseconds')::interval) RETURNING id`,
      [eventType, JSON.stringify({ n: i }), String(i)],
    );
    ids.push(rows[0]!.id);
  }
  return ids;
}

export async function waitFor<T>(
  check: () => Promise<T | undefined | false>,
  timeoutMs = 10000,
): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const value = await check();
    if (value) return value;
    if (Date.now() > deadline) throw new Error('Timed out waiting for the condition');
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
