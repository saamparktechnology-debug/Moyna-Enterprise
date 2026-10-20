-- Module 5.1 (Dashboards): the SQL views every dashboard (and, later, every report) reads from.
-- Rules for these views:
--   * Each one is created WITH (security_invoker = true), so the caller's row-level security applies to the tables
--     underneath: a branch user can never see another branch's rows through a view.
--   * The one exception is v_item_latest_cost. It exposes only an item and its latest purchase cost (no branch, no
--     quantity), because the stock value of a branch must not change depending on which branch bought the item.
--   * Views only read. Nothing in this migration changes a table's data or its constraints.

-- Plain composite indexes (modelled in schema.prisma) for the date ranges the views filter on.
CREATE INDEX "invoices_branch_id_issued_on_idx" ON "invoices" ("branch_id", "issued_on");
CREATE INDEX "payments_branch_id_paid_on_idx" ON "payments" ("branch_id", "paid_on");
CREATE INDEX "purchase_orders_branch_id_order_date_idx" ON "purchase_orders" ("branch_id", "order_date");
CREATE INDEX "credit_notes_branch_id_decided_at_idx" ON "credit_notes" ("branch_id", "decided_at");
CREATE INDEX "transfers_status_idx" ON "transfers" ("status");

-- ---------------------------------------------------------------------------------------------------------------
-- Cost: the latest purchase cost of each item, from the newest approved, partly received or received purchase order.
-- ---------------------------------------------------------------------------------------------------------------
CREATE VIEW v_item_latest_cost AS
SELECT DISTINCT ON (pl.item_id) pl.item_id, pl.unit_cost
FROM po_lines pl
JOIN purchase_orders po ON po.id = pl.po_id
WHERE po.status IN ('APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED')
ORDER BY pl.item_id, po.order_date DESC, po.created_at DESC, pl.id DESC;
COMMENT ON VIEW v_item_latest_cost IS 'Latest purchase cost per item (company-wide, definer rights on purpose).';

-- Stock on hand (available, reserved and in transit) per branch and item, valued at the latest purchase cost.
CREATE VIEW v_stock_value_by_branch WITH (security_invoker = true) AS
SELECT sb.branch_id,
       sb.item_id,
       sum(sb.quantity)::int AS units,
       c.unit_cost,
       (c.unit_cost IS NULL) AS cost_missing,
       round(sum(sb.quantity) * coalesce(c.unit_cost, 0), 2) AS value
FROM stock_balances sb
LEFT JOIN v_item_latest_cost c ON c.item_id = sb.item_id
WHERE sb.state IN ('AVAILABLE', 'RESERVED', 'IN_TRANSIT')
GROUP BY sb.branch_id, sb.item_id, c.unit_cost;

-- ---------------------------------------------------------------------------------------------------------------
-- Money in and out, one row per branch and day.
-- ---------------------------------------------------------------------------------------------------------------
CREATE VIEW v_daily_sales WITH (security_invoker = true) AS
SELECT i.branch_id,
       i.issued_on AS day,
       count(*)::int AS invoices,
       sum(i.total) AS total,
       sum(i.taxable_value) AS taxable_value,
       sum(i.cgst_amount + i.sgst_amount + i.igst_amount) AS tax_total
FROM invoices i
WHERE i.status = 'ISSUED' AND i.issued_on IS NOT NULL
GROUP BY i.branch_id, i.issued_on;

CREATE VIEW v_daily_credit_notes WITH (security_invoker = true) AS
SELECT n.branch_id,
       (n.decided_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
       count(*)::int AS credit_notes,
       sum(n.amount) AS total,
       sum(n.taxable_value) AS taxable_value
FROM credit_notes n
WHERE n.status = 'APPROVED' AND n.decided_at IS NOT NULL
GROUP BY n.branch_id, (n.decided_at AT TIME ZONE 'Asia/Kolkata')::date;

CREATE VIEW v_daily_purchases WITH (security_invoker = true) AS
SELECT po.branch_id,
       po.order_date AS day,
       count(DISTINCT po.id)::int AS orders,
       sum(pl.qty_ordered * pl.unit_cost) AS value
FROM purchase_orders po
JOIN po_lines pl ON pl.po_id = po.id
WHERE po.status IN ('APPROVED', 'PARTIALLY_RECEIVED', 'RECEIVED')
GROUP BY po.branch_id, po.order_date;

-- Money received from customers: reversed payments and the non-cash EXCHANGE trade-in are left out.
CREATE VIEW v_daily_collections WITH (security_invoker = true) AS
SELECT p.branch_id,
       p.paid_on AS day,
       count(*)::int AS payments,
       sum(p.amount) AS received
FROM payments p
WHERE p.mode <> 'EXCHANGE'
  AND NOT EXISTS (SELECT 1 FROM payment_reversals r WHERE r.payment_id = p.id)
GROUP BY p.branch_id, p.paid_on;

-- ---------------------------------------------------------------------------------------------------------------
-- Dues: one row per issued invoice, worked out the same way as the payments module (credit notes count once
-- approved; a payment counts until it is reversed).
-- ---------------------------------------------------------------------------------------------------------------
CREATE VIEW v_invoice_balances WITH (security_invoker = true) AS
SELECT i.id AS invoice_id,
       i.branch_id,
       i.customer_id,
       i.due_date,
       i.total,
       coalesce(c.credited, 0) AS credited,
       coalesce(p.paid, 0) AS paid,
       greatest(i.total - coalesce(c.credited, 0) - coalesce(p.paid, 0), 0) AS outstanding
FROM invoices i
LEFT JOIN LATERAL (
  SELECT sum(n.amount) AS credited FROM credit_notes n WHERE n.invoice_id = i.id AND n.status = 'APPROVED'
) c ON TRUE
LEFT JOIN LATERAL (
  SELECT sum(a.amount) AS paid FROM payment_allocations a
  WHERE a.invoice_id = i.id
    AND NOT EXISTS (SELECT 1 FROM payment_reversals r WHERE r.payment_id = a.payment_id)
) p ON TRUE
WHERE i.status = 'ISSUED';

-- ---------------------------------------------------------------------------------------------------------------
-- Leads and follow-ups.
-- ---------------------------------------------------------------------------------------------------------------
CREATE VIEW v_daily_leads WITH (security_invoker = true) AS
SELECT l.branch_id,
       (l.created_at AT TIME ZONE 'Asia/Kolkata')::date AS day,
       count(*)::int AS created,
       (count(*) FILTER (WHERE l.stage = 'WON'))::int AS won,
       (count(*) FILTER (WHERE l.stage = 'LOST'))::int AS lost
FROM leads l
GROUP BY l.branch_id, (l.created_at AT TIME ZONE 'Asia/Kolkata')::date;

CREATE VIEW v_open_followups WITH (security_invoker = true) AS
SELECT f.id AS followup_id, f.branch_id, f.lead_id, f.due_at
FROM lead_followups f
WHERE f.completed_at IS NULL;

-- ---------------------------------------------------------------------------------------------------------------
-- Commission: what each commission is worth now (the amount less what credit notes took back).
-- ---------------------------------------------------------------------------------------------------------------
CREATE VIEW v_commission_worth WITH (security_invoker = true) AS
SELECT c.id AS commission_id,
       c.branch_id,
       c.broker_id,
       c.status,
       CASE WHEN c.status = 'PAYABLE'
            THEN greatest(c.amount - coalesce(a.taken, 0), 0)
            ELSE 0 END AS payable_amount,
       CASE WHEN c.status = 'PAID' THEN coalesce(c.paid_amount, 0) ELSE 0 END AS paid_amount,
       (c.paid_at AT TIME ZONE 'Asia/Kolkata')::date AS paid_day
FROM commissions c
LEFT JOIN LATERAL (
  SELECT sum(j.amount) AS taken FROM commission_adjustments j WHERE j.commission_id = c.id
) a ON TRUE;

-- ---------------------------------------------------------------------------------------------------------------
-- Transfers still on their way, and stock alerts.
-- ---------------------------------------------------------------------------------------------------------------
CREATE VIEW v_pending_transfers WITH (security_invoker = true) AS
SELECT t.id AS transfer_id, t.from_branch_id, t.to_branch_id, t.status
FROM transfers t
WHERE t.status IN ('REQUESTED', 'APPROVED', 'DISPATCHED', 'IN_TRANSIT');

-- Active items at or below their reorder level in an active branch the caller may see (items with no stock row
-- count as zero). Branches are not row-secured, so the caller's scope is applied here.
CREATE VIEW v_low_stock WITH (security_invoker = true) AS
SELECT b.id AS branch_id,
       i.id AS item_id,
       coalesce(sb.quantity, 0)::int AS available,
       i.reorder_level
FROM branches b
CROSS JOIN items i
LEFT JOIN stock_balances sb ON sb.branch_id = b.id AND sb.item_id = i.id AND sb.state = 'AVAILABLE'
WHERE b.is_active AND i.is_active AND i.reorder_level > 0
  AND coalesce(sb.quantity, 0) <= i.reorder_level
  AND app_branch_allowed(b.id);

-- Batteries that are still in stock (in any state the batteries module counts as in stock) and have an expiry date.
CREATE VIEW v_battery_expiry_stock WITH (security_invoker = true) AS
SELECT su.branch_id, su.id AS serial_unit_id, su.item_id, b.expiry_on
FROM batteries b
JOIN serial_units su ON su.id = b.serial_unit_id
WHERE b.expiry_on IS NOT NULL
  AND su.state IN ('AVAILABLE', 'RESERVED', 'IN_TRANSIT', 'DAMAGED', 'RETURNED', 'QUARANTINE');

-- The application reads the views; nobody writes through them.
GRANT SELECT ON
  v_item_latest_cost, v_stock_value_by_branch, v_daily_sales, v_daily_credit_notes, v_daily_purchases,
  v_daily_collections, v_invoice_balances, v_daily_leads, v_open_followups, v_commission_worth,
  v_pending_transfers, v_low_stock, v_battery_expiry_stock
TO erp_app;
