-- Module 5.2 (Notifications): richer notification rows, deduplication, and the read rights the worker needs.

ALTER TABLE "notifications"
  ADD COLUMN "kind" TEXT NOT NULL DEFAULT 'GENERAL',
  ADD COLUMN "title" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "link" TEXT,
  ADD COLUMN "dedupe_key" TEXT,
  ADD COLUMN "read_at" TIMESTAMP(3),
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "last_error" TEXT;

ALTER TABLE "notifications" ADD CONSTRAINT "notifications_kind_check" CHECK ("kind" IN (
  'GENERAL', 'FOLLOWUP_DUE', 'PAYMENT_DUE', 'LOW_STOCK', 'BATTERY_EXPIRY',
  'PENDING_TRANSFER', 'PURCHASE_MISMATCH', 'PENDING_KYC', 'UNPAID_COMMISSION'
));
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_attempts_check" CHECK ("attempts" >= 0);

-- One notification per user, channel and dedupe key: a job that runs twice cannot notify twice. Rows with no key are never deduplicated.
CREATE UNIQUE INDEX "notifications_user_id_channel_dedupe_key_key"
  ON "notifications" ("user_id", "channel", "dedupe_key");
CREATE INDEX "notifications_user_id_created_at_idx" ON "notifications" ("user_id", "created_at");

-- The worker stays as narrow as before: it cannot read business tables or write outbox events directly. What the
-- reminder jobs need is exposed as small functions that run with the owner's rights, read only, and return counts
-- and ids (never customer or money details beyond a branch total). Each one runs as a system actor (app.is_super)
-- only while it executes.

-- Follow-ups due before p_tomorrow, per branch and assignee.
CREATE FUNCTION worker_alert_followups(p_now TIMESTAMP, p_tomorrow TIMESTAMP)
RETURNS TABLE (branch_id UUID, user_id UUID, total INT, overdue INT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET app.is_super = 'true' AS $$
  SELECT l.branch_id, l.assigned_to, count(*)::int, (count(*) FILTER (WHERE f.due_at < p_now))::int
  FROM v_open_followups f JOIN leads l ON l.id = f.lead_id
  WHERE f.due_at < p_tomorrow GROUP BY l.branch_id, l.assigned_to
$$;

-- Invoices overdue or due within p_days, per branch.
CREATE FUNCTION worker_alert_payments(p_today DATE, p_days INT)
RETURNS TABLE (branch_id UUID, overdue INT, soon INT, outstanding NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET app.is_super = 'true' AS $$
  SELECT b.branch_id,
         (count(*) FILTER (WHERE b.due_date < p_today))::int,
         (count(*) FILTER (WHERE b.due_date >= p_today))::int,
         sum(b.outstanding)
  FROM v_invoice_balances b
  WHERE b.outstanding > 0 AND b.due_date IS NOT NULL AND b.due_date <= p_today + p_days
  GROUP BY b.branch_id
$$;

CREATE FUNCTION worker_alert_low_stock()
RETURNS TABLE (branch_id UUID, n INT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET app.is_super = 'true' AS $$
  SELECT s.branch_id, count(*)::int FROM v_low_stock s GROUP BY s.branch_id
$$;

CREATE FUNCTION worker_alert_battery_expiry(p_today DATE, p_days INT)
RETURNS TABLE (branch_id UUID, expired INT, expiring INT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET app.is_super = 'true' AS $$
  SELECT v.branch_id,
         (count(*) FILTER (WHERE v.expiry_on < p_today))::int,
         (count(*) FILTER (WHERE v.expiry_on >= p_today))::int
  FROM v_battery_expiry_stock v WHERE v.expiry_on <= p_today + p_days GROUP BY v.branch_id
$$;

-- 'approve' rows are transfers waiting for the sending branch; 'receive' rows are transfers on their way in.
CREATE FUNCTION worker_alert_transfers()
RETURNS TABLE (stage TEXT, branch_id UUID, n INT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET app.is_super = 'true' AS $$
  SELECT 'approve', t.from_branch_id, count(*)::int FROM transfers t
  WHERE t.status = 'REQUESTED' GROUP BY t.from_branch_id
  UNION ALL
  SELECT 'receive', t.to_branch_id, count(*)::int FROM transfers t
  WHERE t.status IN ('DISPATCHED', 'IN_TRANSIT') GROUP BY t.to_branch_id
$$;

CREATE FUNCTION worker_alert_mismatches()
RETURNS TABLE (branch_id UUID, n INT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET app.is_super = 'true' AS $$
  SELECT d.branch_id, count(*)::int FROM discrepancies d WHERE d.status = 'OPEN' GROUP BY d.branch_id
$$;

CREATE FUNCTION worker_alert_kyc()
RETURNS TABLE (n INT)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET app.is_super = 'true' AS $$
  SELECT count(*)::int FROM kyc_documents WHERE status = 'PENDING'
$$;

CREATE FUNCTION worker_alert_commission()
RETURNS TABLE (branch_id UUID, n INT, total NUMERIC)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public SET app.is_super = 'true' AS $$
  SELECT c.branch_id, count(*)::int, sum(c.payable_amount)
  FROM v_commission_worth c WHERE c.payable_amount > 0 GROUP BY c.branch_id
$$;

-- Who is told: the named user when still active, otherwise every active user holding the permission in the branch
-- (a Super Admin holds every permission everywhere; a null branch means company-wide).
CREATE FUNCTION worker_recipients(p_user UUID, p_permission TEXT, p_branch UUID)
RETURNS TABLE (user_id UUID)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT u.id FROM users u WHERE p_user IS NOT NULL AND u.id = p_user AND u.status = 'ACTIVE'
  UNION
  SELECT u.id FROM users u
  WHERE u.status = 'ACTIVE'
    AND NOT EXISTS (SELECT 1 FROM users a WHERE a.id = p_user AND a.status = 'ACTIVE')
    AND (
      EXISTS (SELECT 1 FROM user_roles ur JOIN roles r ON r.id = ur.role_id
              WHERE ur.user_id = u.id AND r.tier = 'SUPER_ADMIN')
      OR (
        EXISTS (SELECT 1 FROM user_roles ur
                JOIN role_permissions rp ON rp.role_id = ur.role_id
                JOIN permissions p ON p.id = rp.permission_id
                WHERE ur.user_id = u.id AND p.code = p_permission)
        AND (p_branch IS NULL OR EXISTS (SELECT 1 FROM user_branches ub
                                          WHERE ub.user_id = u.id AND ub.branch_id = p_branch))
      )
    )
$$;

-- The one event the worker may write: a request to deliver a notification that exists and is not in-app.
CREATE FUNCTION worker_enqueue_delivery(p_notification UUID, p_user UUID)
RETURNS VOID
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO outbox_events (event_type, payload, branch_id)
  SELECT 'notification.deliver',
         jsonb_build_object('notificationId', n.id, 'userId', n.user_id),
         n.branch_id
  FROM notifications n
  WHERE n.id = p_notification AND n.user_id = p_user AND n.channel <> 'IN_APP'
$$;

-- What the delivery handler needs for one notification, locked while it is sent: the message and the address.
CREATE FUNCTION worker_notification_for_delivery(p_notification UUID, p_user UUID)
RETURNS TABLE (id UUID, channel "NotificationChannel", status "NotificationStatus",
               title TEXT, message TEXT, attempts INT, email TEXT)
LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path = public AS $$
  SELECT n.id, n.channel, n.status, n.title, n.message, n.attempts, u.email
  FROM notifications n JOIN users u ON u.id = n.user_id
  WHERE n.id = p_notification AND n.user_id = p_user
  FOR UPDATE OF n
$$;

REVOKE ALL ON FUNCTION
  worker_alert_followups(TIMESTAMP, TIMESTAMP), worker_alert_payments(DATE, INT), worker_alert_low_stock(),
  worker_alert_battery_expiry(DATE, INT), worker_alert_transfers(), worker_alert_mismatches(),
  worker_alert_kyc(), worker_alert_commission(), worker_recipients(UUID, TEXT, UUID),
  worker_enqueue_delivery(UUID, UUID), worker_notification_for_delivery(UUID, UUID)
FROM PUBLIC;
GRANT EXECUTE ON FUNCTION
  worker_alert_followups(TIMESTAMP, TIMESTAMP), worker_alert_payments(DATE, INT), worker_alert_low_stock(),
  worker_alert_battery_expiry(DATE, INT), worker_alert_transfers(), worker_alert_mismatches(),
  worker_alert_kyc(), worker_alert_commission(), worker_recipients(UUID, TEXT, UUID),
  worker_enqueue_delivery(UUID, UUID), worker_notification_for_delivery(UUID, UUID)
TO erp_worker;

-- Notifications themselves: the worker writes them (row-level security still applies) and updates delivery progress.
GRANT SELECT, INSERT ON "notifications" TO erp_worker;
GRANT UPDATE ("status", "attempts", "last_error") ON "notifications" TO erp_worker;
