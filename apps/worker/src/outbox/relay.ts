import type { Logger } from 'pino';
import type pg from 'pg';
import type { EventPublisher, OutboxEvent } from './publisher.js';

const MAX_ERROR_LENGTH = 500;

export interface RelayOptions {
  batchSize: number;
  maxAttempts: number;
}

export interface RelayResult {
  published: number;
  retrying: number;
  failed: number;
}

interface OutboxRow {
  id: string;
  event_type: string;
  payload: unknown;
  branch_id: string | null;
  attempts: number;
}

function describeError(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.slice(0, MAX_ERROR_LENGTH);
}

export class OutboxRelay {
  constructor(
    private readonly pool: pg.Pool,
    private readonly publisher: EventPublisher,
    private readonly logger: Logger,
    private readonly options: RelayOptions,
  ) {}

  /**
   * Publishes one batch of pending events. Rows stay locked until the batch commits, so several relays
   * can run side by side without publishing the same event twice. Delivery is at least once: if the
   * process dies after publishing but before the commit, the event is published again, and consumers
   * use the event id to ignore the repeat.
   */
  async relayBatch(): Promise<RelayResult> {
    const client = await this.pool.connect();
    const result: RelayResult = { published: 0, retrying: 0, failed: 0 };
    try {
      await client.query('BEGIN');
      const { rows } = await client.query<OutboxRow>(
        `SELECT id, event_type, payload, branch_id, attempts
         FROM outbox_events
         WHERE status = 'PENDING'
         ORDER BY created_at, id
         LIMIT $1
         FOR UPDATE SKIP LOCKED`,
        [this.options.batchSize],
      );
      for (const row of rows) {
        await this.relayOne(client, row, result);
      }
      await client.query('COMMIT');
    } catch (error) {
      await client.query('ROLLBACK').catch(() => undefined);
      throw error;
    } finally {
      client.release();
    }
    return result;
  }

  private async relayOne(
    client: pg.PoolClient,
    row: OutboxRow,
    result: RelayResult,
  ): Promise<void> {
    const event: OutboxEvent = {
      id: row.id,
      eventType: row.event_type,
      payload: row.payload,
      branchId: row.branch_id,
    };
    try {
      await this.publisher.publish(event);
      await client.query(
        `UPDATE outbox_events
         SET status = 'PROCESSED', processed_at = CURRENT_TIMESTAMP, attempts = attempts + 1, last_error = NULL
         WHERE id = $1`,
        [row.id],
      );
      result.published += 1;
    } catch (error) {
      const attempts = row.attempts + 1;
      const exhausted = attempts >= this.options.maxAttempts;
      await client.query(
        `UPDATE outbox_events SET status = $2::"OutboxStatus", attempts = $3, last_error = $4 WHERE id = $1`,
        [row.id, exhausted ? 'FAILED' : 'PENDING', attempts, describeError(error)],
      );
      this.logger.warn(
        { eventId: row.id, eventType: row.event_type, attempts, exhausted },
        'Outbox event could not be published',
      );
      if (exhausted) result.failed += 1;
      else result.retrying += 1;
    }
  }
}
