// The API stamps every new document with today's date, so a freshly seeded demo has a single day of trading. This step
// spreads the documents over the last weeks, as a real business would have them, by editing dates directly in the
// database. It is meant for a demo database only: it switches off the "issued documents are frozen" triggers while it
// works and switches them back on at the end, in one transaction.
import pg from 'pg';
import { rng } from './client.mjs';

if (process.env.NODE_ENV === 'production')
  throw new Error('Refusing to run: this edits dates directly and is for a demo database only.');
if (!process.argv.includes('--yes'))
  throw new Error(
    'This edits document dates directly in the database (demo databases only). Run it with --yes to confirm.',
  );
const url = process.env.MIGRATION_DATABASE_URL;
if (!url)
  throw new Error('Set MIGRATION_DATABASE_URL to the owner connection of the DEMO database.');
const r = rng(7);
const log = (m) => process.stdout.write(`${m}\n`);
const TABLES = [
  'invoices',
  'payments',
  'payment_allocations',
  'credit_notes',
  'quotations',
  'leads',
  'commissions',
  'customer_refunds',
  'exchanges',
  'transfers',
  'stock_adjustments',
  'goods_receipts',
  'purchase_orders',
  'supplier_payments',
];

const client = new pg.Client({ connectionString: url });
await client.connect();
const q = (text, params) => client.query(text, params);

try {
  await q('BEGIN');
  for (const t of TABLES) await q(`ALTER TABLE ${t} DISABLE TRIGGER USER`);
  const {
    rows: [{ today }],
  } = await q(`SELECT to_char(current_date, 'YYYY-MM-DD') AS today`);
  const addDays = (iso, n) =>
    new Date(Date.parse(`${iso}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);
  const minDate = (a, b) => (a < b ? a : b);
  const maxDate = (a, b) => (a > b ? a : b);

  // ---- Purchases came first: orders 16 to 42 days ago, goods received two days after each order ----
  await q(
    `UPDATE purchase_orders SET order_date = order_date - 14, created_at = created_at - interval '14 days', updated_at = updated_at - interval '14 days'`,
  );
  await q(`UPDATE goods_receipts g SET received_at = ((p.order_date + 2)::timestamp + g.received_at::time),
             created_at = ((p.order_date + 2)::timestamp + g.created_at::time) FROM purchase_orders p WHERE p.id = g.po_id`);
  await q(`WITH ranked AS (SELECT id, row_number() OVER (ORDER BY created_at, id) rn, count(*) OVER () n FROM supplier_payments)
           UPDATE supplier_payments s SET paid_on = current_date - (2 + floor(25 * (1 - (ranked.rn - 1)::float / greatest(ranked.n - 1, 1))))::int
           FROM ranked WHERE ranked.id = s.id`);

  // ---- Documents numbered in order must be dated in order: spread each series evenly over a window ----
  const spread = async (table, columns, branchColumn, windowStart, windowEnd, where = 'true') => {
    // Each row moves back by an amount that shrinks from windowStart (oldest) to windowEnd (newest), keeping order.
    const shifts = columns
      .map((c) =>
        c.kind === 'date'
          ? `${c.name} = ${c.name} - d.back::int`
          : `${c.name} = ${c.name} - (d.back::int || ' days')::interval`,
      )
      .join(', ');
    await q(`WITH d AS (
               SELECT id, ${windowEnd} + floor((${windowStart} - ${windowEnd}) * (1 - (row_number() OVER (PARTITION BY ${branchColumn} ORDER BY created_at, id) - 1)::float
                 / greatest(count(*) OVER (PARTITION BY ${branchColumn}) - 1, 1))) AS back
               FROM ${table} WHERE ${where})
             UPDATE ${table} t SET ${shifts} FROM d WHERE d.id = t.id`);
  };
  const ts = (name) => ({ name, kind: 'ts' });
  const dt = (name) => ({ name, kind: 'date' });
  await spread(
    'invoices',
    [dt('issued_on'), dt('due_date'), ts('created_at'), ts('updated_at')],
    'branch_id',
    34,
    3,
    `status <> 'DRAFT' AND issued_on IS NOT NULL`,
  );
  await spread(
    'quotations',
    [ts('created_at'), ts('updated_at'), ts('sent_at'), ts('accepted_at'), ts('cancelled_at')],
    'branch_id',
    22,
    9,
  );
  await spread('leads', [ts('created_at'), ts('updated_at')], 'branch_id', 45, 1);
  await spread('transfers', [ts('created_at'), ts('updated_at')], 'from_branch_id', 30, 3);
  await spread(
    'stock_adjustments',
    [ts('created_at'), ts('updated_at'), ts('decided_at')],
    'branch_id',
    26,
    2,
  );

  // ---- Payments follow the invoice they pay, and stay in receipt order ----
  const { rows: payments } = await q(
    `
    SELECT p.id, p.branch_id, p.idempotency_key AS key, p.created_at::time AS at,
           coalesce(max(i.issued_on)::text, (qu.created_at::date + 1)::text, $1) AS earliest
    FROM payments p
    LEFT JOIN payment_allocations a ON a.payment_id = p.id
    LEFT JOIN invoices i ON i.id = a.invoice_id
    LEFT JOIN quotations qu ON qu.id = p.quotation_id
    GROUP BY p.id, qu.created_at ORDER BY p.branch_id, p.created_at, p.id`,
    [addDays(today, -34)],
  );
  const prev = {};
  for (const p of payments) {
    const kind = (p.key ?? '').split('-')[1] ?? 'inv';
    let date = kind === 'later' ? addDays(today, -r.int(0, 8)) : addDays(p.earliest, r.int(0, 2));
    date = maxDate(date, prev[p.branch_id] ?? date);
    date = maxDate(date, p.earliest);
    date = minDate(date, today);
    prev[p.branch_id] = date;
    await q(
      `UPDATE payments SET paid_on = $2::date, created_at = ($2::date + $3::time), updated_at = ($2::date + $3::time) WHERE id = $1`,
      [p.id, date, p.at],
    );
    await q(
      `UPDATE payment_allocations SET created_at = ($2::date + $3::time) WHERE payment_id = $1`,
      [p.id, date, p.at],
    );
  }

  // ---- Things that follow an invoice: credit notes, commissions, exchanges, refunds ----
  await q(`UPDATE credit_notes c SET created_at = (least(i.issued_on + 2, current_date)::timestamp + c.created_at::time),
             updated_at = (least(i.issued_on + 2, current_date)::timestamp + c.created_at::time),
             decided_at = CASE WHEN c.decided_at IS NULL THEN NULL ELSE (least(i.issued_on + 3, current_date)::timestamp + c.created_at::time) END
           FROM invoices i WHERE i.id = c.invoice_id`);
  await q(`UPDATE commissions c SET created_at = (i.issued_on::timestamp + c.created_at::time), updated_at = (i.issued_on::timestamp + c.created_at::time),
             paid_at = CASE WHEN c.paid_at IS NULL THEN NULL ELSE (least(i.issued_on + 6, current_date)::timestamp + c.created_at::time) END
           FROM invoices i WHERE i.id = c.invoice_id`);
  await q(`UPDATE exchanges e SET created_at = (least(i.issued_on + 1, current_date)::timestamp + e.created_at::time),
             updated_at = (least(i.issued_on + 1, current_date)::timestamp + e.created_at::time),
             decided_at = CASE WHEN e.decided_at IS NULL THEN NULL ELSE (least(i.issued_on + 2, current_date)::timestamp + e.created_at::time) END
           FROM invoices i WHERE i.id = e.invoice_id`);
  await q(`WITH ranked AS (SELECT id, row_number() OVER (ORDER BY created_at, id) rn, count(*) OVER () n FROM customer_refunds)
           UPDATE customer_refunds f SET paid_on = current_date - (1 + floor(6 * (1 - (ranked.rn - 1)::float / greatest(ranked.n - 1, 1))))::int,
             created_at = (current_date - (1 + floor(6 * (1 - (ranked.rn - 1)::float / greatest(ranked.n - 1, 1))))::int)::timestamp + f.created_at::time
           FROM ranked WHERE ranked.id = f.id`);

  for (const t of TABLES) await q(`ALTER TABLE ${t} ENABLE TRIGGER USER`);
  await q('COMMIT');

  const {
    rows: [{ first, last, n }],
  } = await q(
    `SELECT min(issued_on)::text AS first, max(issued_on)::text AS last, count(*)::int AS n FROM invoices WHERE issued_on IS NOT NULL`,
  );
  const {
    rows: [{ bad }],
  } = await q(
    `SELECT count(*)::int AS bad FROM payments p JOIN payment_allocations a ON a.payment_id = p.id JOIN invoices i ON i.id = a.invoice_id WHERE p.paid_on < i.issued_on`,
  );
  log(
    `Dates spread: ${n} invoices from ${first} to ${last}; payments dated before their invoice: ${bad}`,
  );
} catch (error) {
  await q('ROLLBACK').catch(() => undefined);
  throw error;
} finally {
  await client.end();
}
