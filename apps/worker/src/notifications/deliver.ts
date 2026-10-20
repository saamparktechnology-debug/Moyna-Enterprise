import type { Logger } from 'pino';
import type pg from 'pg';
import { PermanentDeliveryError } from './provider.js';
import type { ExternalChannel, NotificationProvider } from './provider.js';

export const NOTIFICATION_DELIVER_EVENT = 'notification.deliver';
export const MAX_DELIVERY_ATTEMPTS = 5;

interface DeliveryRow {
  id: string;
  channel: 'IN_APP' | ExternalChannel;
  status: string;
  title: string;
  message: string;
  attempts: number;
  email: string;
}

export type DeliveryOutcome = 'sent' | 'skipped' | 'failed' | 'retry';

/**
 * Sends one external notification. Safe to run twice for the same notification: once it is no longer PENDING the
 * repeat does nothing. A temporary failure throws (the queue retries it); after MAX_DELIVERY_ATTEMPTS, or on a
 * failure that can never succeed, the row is marked FAILED with the reason and the event is acknowledged.
 */
export async function deliverNotification(
  pool: pg.Pool,
  provider: NotificationProvider,
  logger: Logger,
  payload: { notificationId: string; userId: string },
): Promise<DeliveryOutcome> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.user_id', $1, true)", [payload.userId]);
    const { rows } = await client.query<DeliveryRow>(
      'SELECT id, channel, status, title, message, attempts, email FROM worker_notification_for_delivery($1::uuid, $2::uuid)',
      [payload.notificationId, payload.userId],
    );
    const row = rows[0];
    if (!row || row.status !== 'PENDING' || row.channel === 'IN_APP') {
      await client.query('COMMIT');
      return 'skipped';
    }

    let outcome: DeliveryOutcome = 'sent';
    let error: string | null = null;
    try {
      if (row.channel !== 'EMAIL')
        throw new PermanentDeliveryError('No phone number is held for this user');
      await provider.send({
        notificationId: row.id,
        channel: row.channel,
        to: row.email,
        subject: row.title,
        body: row.message,
      });
    } catch (failure) {
      error = (failure instanceof Error ? failure.message : String(failure)).slice(0, 500);
      const attempts = row.attempts + 1;
      outcome =
        failure instanceof PermanentDeliveryError || attempts >= MAX_DELIVERY_ATTEMPTS
          ? 'failed'
          : 'retry';
      await client.query(
        `UPDATE notifications SET attempts = $2, last_error = $3, status = $4::"NotificationStatus" WHERE id = $1`,
        [row.id, attempts, error, outcome === 'failed' ? 'FAILED' : 'PENDING'],
      );
    }
    if (outcome === 'sent')
      await client.query(
        `UPDATE notifications SET status = 'SENT', attempts = attempts + 1, last_error = NULL WHERE id = $1`,
        [row.id],
      );
    await client.query('COMMIT');
    if (outcome === 'retry') throw new Error(`Delivery failed, will retry: ${error}`);
    if (outcome === 'failed') logger.warn({ notificationId: row.id, error }, 'Notification failed');
    return outcome;
  } catch (failure) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw failure;
  } finally {
    client.release();
  }
}
