import { randomUUID } from 'node:crypto';
import type { Logger } from 'pino';
import type pg from 'pg';

export type Channel = 'IN_APP' | 'EMAIL' | 'SMS' | 'WHATSAPP';

export const DUE_SOON_DAYS = 3;
export const BATTERY_WINDOW_DAYS = 30;

export interface ReminderOptions {
  /** IN_APP is always used; the others are added when configured. */
  channels: Channel[];
  now?: Date;
}

export interface ReminderResult {
  alerts: number;
  created: number;
  duplicates: number;
  byKind: Record<string, number>;
}

interface Alert {
  kind: string;
  branchId: string | null;
  /** Who gets it: this user, or, when null, everyone holding the permission. */
  userId: string | null;
  permission: string;
  title: string;
  message: string;
  link: string;
  /** Names this alert for one day, so running the job twice that day does not notify twice. */
  key: string;
}

const IST_DAY = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Asia/Kolkata',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
});
const DAY_MS = 86_400_000;

export const todayIst = (now: Date): string => IST_DAY.format(now);
export const tomorrowStartIst = (now: Date): Date =>
  new Date(new Date(`${todayIst(now)}T00:00:00.000+05:30`).getTime() + DAY_MS);

const plural = (n: number, one: string, many: string): string => `${n} ${n === 1 ? one : many}`;
const rupees = (value: string): string =>
  new Intl.NumberFormat('en-IN', { style: 'currency', currency: 'INR' }).format(Number(value));

type Query = (client: pg.PoolClient, ctx: Context) => Promise<Alert[]>;

interface Context {
  now: Date;
  today: string;
  tomorrow: Date;
}

const followups: Query = async (client, ctx) => {
  const { rows } = await client.query<{
    branch_id: string;
    user_id: string | null;
    total: number;
    overdue: number;
  }>('SELECT * FROM worker_alert_followups($1, $2)', [ctx.now, ctx.tomorrow]);
  return rows.map((row) => ({
    kind: 'FOLLOWUP_DUE',
    branchId: row.branch_id,
    userId: row.user_id,
    permission: 'leads.manage',
    title: 'Follow-ups to do',
    message: `${plural(row.total, 'follow-up is', 'follow-ups are')} due today or late, ${row.overdue} of them already overdue.`,
    link: '/leads',
    key: `FOLLOWUP_DUE:${ctx.today}:${row.branch_id}:${row.user_id ?? 'unassigned'}`,
  }));
};

const paymentDue: Query = async (client, ctx) => {
  const { rows } = await client.query<{
    branch_id: string;
    overdue: number;
    soon: number;
    outstanding: string;
  }>(
    'SELECT branch_id, overdue, soon, outstanding::text FROM worker_alert_payments($1::date, $2::int)',
    [ctx.today, DUE_SOON_DAYS],
  );
  return rows.map((row) => ({
    kind: 'PAYMENT_DUE',
    branchId: row.branch_id,
    userId: null,
    permission: 'payments.view',
    title: 'Payments due',
    message: `${rupees(row.outstanding)} is due within ${DUE_SOON_DAYS} days or overdue: ${plural(row.overdue, 'invoice', 'invoices')} overdue, ${plural(row.soon, 'invoice', 'invoices')} due soon.`,
    link: '/payments',
    key: `PAYMENT_DUE:${ctx.today}:${row.branch_id}`,
  }));
};

const lowStock: Query = async (client, ctx) => {
  const { rows } = await client.query<{ branch_id: string; n: number }>(
    'SELECT branch_id, n FROM worker_alert_low_stock()',
  );
  return rows.map((row) => ({
    kind: 'LOW_STOCK',
    branchId: row.branch_id,
    userId: null,
    permission: 'stock.view',
    title: 'Low stock',
    message: `${plural(row.n, 'item is', 'items are')} at or below the reorder level.`,
    link: '/inventory',
    key: `LOW_STOCK:${ctx.today}:${row.branch_id}`,
  }));
};

const batteryExpiry: Query = async (client, ctx) => {
  const { rows } = await client.query<{ branch_id: string; expired: number; expiring: number }>(
    'SELECT branch_id, expired, expiring FROM worker_alert_battery_expiry($1::date, $2::int)',
    [ctx.today, BATTERY_WINDOW_DAYS],
  );
  return rows.map((row) => ({
    kind: 'BATTERY_EXPIRY',
    branchId: row.branch_id,
    userId: null,
    permission: 'batteries.view',
    title: 'Batteries expiring',
    message: `${plural(row.expired, 'battery has', 'batteries have')} expired and ${plural(row.expiring, 'battery expires', 'batteries expire')} within ${BATTERY_WINDOW_DAYS} days.`,
    link: '/batteries',
    key: `BATTERY_EXPIRY:${ctx.today}:${row.branch_id}`,
  }));
};

const pendingTransfers: Query = async (client, ctx) => {
  const { rows } = await client.query<{ stage: string; branch_id: string; n: number }>(
    'SELECT stage, branch_id, n FROM worker_alert_transfers()',
  );
  const waiting = rows.filter((row) => row.stage === 'approve');
  const coming = rows.filter((row) => row.stage === 'receive');
  return [
    ...waiting.map((row) => ({
      kind: 'PENDING_TRANSFER',
      branchId: row.branch_id,
      userId: null,
      permission: 'transfers.approve',
      title: 'Transfers to approve',
      message: `${plural(row.n, 'transfer is', 'transfers are')} waiting for your approval.`,
      link: '/transfers',
      key: `PENDING_TRANSFER:approve:${ctx.today}:${row.branch_id}`,
    })),
    ...coming.map((row) => ({
      kind: 'PENDING_TRANSFER',
      branchId: row.branch_id,
      userId: null,
      permission: 'transfers.receive',
      title: 'Transfers to receive',
      message: `${plural(row.n, 'transfer is', 'transfers are')} on the way to your branch.`,
      link: '/transfers',
      key: `PENDING_TRANSFER:receive:${ctx.today}:${row.branch_id}`,
    })),
  ];
};

const purchaseMismatches: Query = async (client, ctx) => {
  const { rows } = await client.query<{ branch_id: string; n: number }>(
    'SELECT branch_id, n FROM worker_alert_mismatches()',
  );
  return rows.map((row) => ({
    kind: 'PURCHASE_MISMATCH',
    branchId: row.branch_id,
    userId: null,
    permission: 'discrepancies.resolve',
    title: 'Purchase mismatches',
    message: `${plural(row.n, 'receiving mismatch is', 'receiving mismatches are')} still open.`,
    link: '/purchasing',
    key: `PURCHASE_MISMATCH:${ctx.today}:${row.branch_id}`,
  }));
};

const pendingKyc: Query = async (client, ctx) => {
  const { rows } = await client.query<{ n: number }>('SELECT n FROM worker_alert_kyc()');
  const n = rows[0]?.n ?? 0;
  if (n === 0) return [];
  return [
    {
      kind: 'PENDING_KYC',
      branchId: null,
      userId: null,
      permission: 'kyc.verify',
      title: 'KYC to verify',
      message: `${plural(n, 'KYC document is', 'KYC documents are')} waiting to be verified.`,
      link: '/customers',
      key: `PENDING_KYC:${ctx.today}`,
    },
  ];
};

const unpaidCommission: Query = async (client, ctx) => {
  const { rows } = await client.query<{ branch_id: string; n: number; total: string }>(
    'SELECT branch_id, n, total::text FROM worker_alert_commission()',
  );
  return rows.map((row) => ({
    kind: 'UNPAID_COMMISSION',
    branchId: row.branch_id,
    userId: null,
    permission: 'commissions.approve_payout',
    title: 'Commission to pay',
    message: `${rupees(row.total)} of commission is payable across ${plural(row.n, 'commission', 'commissions')}.`,
    link: '/brokers',
    key: `UNPAID_COMMISSION:${ctx.today}:${row.branch_id}`,
  }));
};

const QUERIES: Query[] = [
  followups,
  paymentDue,
  lowStock,
  batteryExpiry,
  pendingTransfers,
  purchaseMismatches,
  pendingKyc,
  unpaidCommission,
];

/** Active users to tell: the named user, or whoever holds the permission in the branch (a Super Admin holds all). */
async function recipients(client: pg.PoolClient, alert: Alert): Promise<string[]> {
  const { rows } = await client.query<{ user_id: string }>(
    'SELECT user_id FROM worker_recipients($1::uuid, $2, $3::uuid)',
    [alert.userId, alert.permission, alert.branchId],
  );
  return rows.map((row) => row.user_id);
}

/**
 * Looks for everything that needs attention and tells the people who can act on it. One notification per person, per
 * kind, per branch, per day: running it again the same day creates nothing new. External messages (email and so on)
 * are written as outbox events in the same transaction, and the relay hands them to the delivery handler.
 */
export async function runReminders(
  pool: pg.Pool,
  logger: Logger,
  options: ReminderOptions,
): Promise<ReminderResult> {
  const now = options.now ?? new Date();
  const ctx: Context = { now, today: todayIst(now), tomorrow: tomorrowStartIst(now) };
  const channels = [...new Set<Channel>(['IN_APP', ...options.channels])];
  const result: ReminderResult = { alerts: 0, created: 0, duplicates: 0, byKind: {} };

  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const alerts: Alert[] = [];
    for (const query of QUERIES) alerts.push(...(await query(client, ctx)));
    result.alerts = alerts.length;

    for (const alert of alerts) {
      for (const userId of await recipients(client, alert)) {
        // Row-level security lets a notification be written and checked for duplicates only as its owner.
        await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
        for (const channel of channels) {
          const id = randomUUID();
          const inserted = await client.query(
            `INSERT INTO notifications
               (id, user_id, branch_id, channel, message, status, kind, title, link, dedupe_key)
             VALUES ($1, $2, $3, $4::"NotificationChannel", $5, $6::"NotificationStatus", $7, $8, $9, $10)
             ON CONFLICT (user_id, channel, dedupe_key) DO NOTHING`,
            [
              id,
              userId,
              alert.branchId,
              channel,
              alert.message,
              channel === 'IN_APP' ? 'SENT' : 'PENDING',
              alert.kind,
              alert.title,
              alert.link,
              alert.key,
            ],
          );
          if (inserted.rowCount === 0) {
            result.duplicates += 1;
            continue;
          }
          result.created += 1;
          result.byKind[alert.kind] = (result.byKind[alert.kind] ?? 0) + 1;
          if (channel !== 'IN_APP')
            await client.query('SELECT worker_enqueue_delivery($1::uuid, $2::uuid)', [id, userId]);
        }
      }
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  logger.info(result, 'Reminders run');
  return result;
}
