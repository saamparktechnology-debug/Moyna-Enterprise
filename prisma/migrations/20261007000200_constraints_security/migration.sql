-- Stage 2 migration 2: check constraints, partial indexes, row_version triggers, row-level security, roles and grants.
-- Prisma cannot express these. Never run `prisma migrate dev` against this database expecting it to keep them;
-- use `prisma migrate deploy`. Roles are created NOLOGIN here; operations gives them a login and password.

-- ---------- roles
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_app') THEN CREATE ROLE erp_app NOLOGIN; END IF; END $$;
DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'erp_worker') THEN CREATE ROLE erp_worker NOLOGIN; END IF; END $$;

-- ---------- check constraints
ALTER TABLE "stock_balances" ADD CONSTRAINT "chk_stock_balances_quantity_non_negative" CHECK (quantity >= 0);
ALTER TABLE "stock_ledger" ADD CONSTRAINT "chk_stock_ledger_qty_delta_non_zero" CHECK (qty_delta <> 0);
ALTER TABLE "stock_ledger" ADD CONSTRAINT "chk_stock_ledger_serial_delta_is_one" CHECK (serial_unit_id IS NULL OR qty_delta IN (-1, 1));
ALTER TABLE "items" ADD CONSTRAINT "chk_items_reorder_level_non_negative" CHECK (reorder_level >= 0);
ALTER TABLE "gst_rates" ADD CONSTRAINT "chk_gst_rates_rate_range" CHECK (rate >= 0 AND rate <= 100);
ALTER TABLE "hsn_codes" ADD CONSTRAINT "chk_hsn_codes_gst_rate_range" CHECK (gst_rate IS NULL OR (gst_rate >= 0 AND gst_rate <= 100));
ALTER TABLE "batteries" ADD CONSTRAINT "chk_batteries_dates_ordered" CHECK (expiry_on IS NULL OR manufactured_on IS NULL OR expiry_on > manufactured_on);
ALTER TABLE "batteries" ADD CONSTRAINT "chk_batteries_warranty_months_non_negative" CHECK (warranty_months IS NULL OR warranty_months >= 0);
ALTER TABLE "batteries" ADD CONSTRAINT "chk_batteries_warranty_end_after_manufacture" CHECK (warranty_end IS NULL OR manufactured_on IS NULL OR warranty_end >= manufactured_on);
ALTER TABLE "po_lines" ADD CONSTRAINT "chk_po_lines_qty_ordered_positive" CHECK (qty_ordered > 0);
ALTER TABLE "po_lines" ADD CONSTRAINT "chk_po_lines_unit_cost_non_negative" CHECK (unit_cost >= 0);
ALTER TABLE "supplier_payments" ADD CONSTRAINT "chk_supplier_payments_amount_positive" CHECK (amount > 0);
ALTER TABLE "receipt_lines" ADD CONSTRAINT "chk_receipt_lines_quantities_non_negative" CHECK (qty_received >= 0 AND qty_accepted >= 0);
ALTER TABLE "receipt_lines" ADD CONSTRAINT "chk_receipt_lines_accepted_within_received" CHECK (qty_accepted <= qty_received);
ALTER TABLE "transfers" ADD CONSTRAINT "chk_transfers_different_branches" CHECK (from_branch_id <> to_branch_id);
ALTER TABLE "transfer_lines" ADD CONSTRAINT "chk_transfer_lines_qty_sent_positive" CHECK (qty_sent > 0);
ALTER TABLE "transfer_lines" ADD CONSTRAINT "chk_transfer_lines_qty_received_non_negative" CHECK (qty_received >= 0);
ALTER TABLE "transfer_lines" ADD CONSTRAINT "chk_transfer_lines_different_branches" CHECK (from_branch_id <> to_branch_id);
ALTER TABLE "transfer_events" ADD CONSTRAINT "chk_transfer_events_different_branches" CHECK (from_branch_id <> to_branch_id);
ALTER TABLE "discrepancies" ADD CONSTRAINT "chk_discrepancies_qty_positive" CHECK (qty > 0);
ALTER TABLE "discrepancies" ADD CONSTRAINT "chk_discrepancies_exactly_one_line" CHECK ((receipt_line_id IS NULL) <> (transfer_line_id IS NULL));
ALTER TABLE "discrepancies" ADD CONSTRAINT "chk_discrepancies_resolved_has_resolution" CHECK (status = 'OPEN' OR resolution IS NOT NULL);
ALTER TABLE "commission_rules" ADD CONSTRAINT "chk_commission_rules_value_range" CHECK (value >= 0 AND (type <> 'PERCENT' OR value <= 100));
ALTER TABLE "commissions" ADD CONSTRAINT "chk_commissions_amount_non_negative" CHECK (amount >= 0);
ALTER TABLE "quotations" ADD CONSTRAINT "chk_quotations_total_non_negative" CHECK (total >= 0);
ALTER TABLE "invoices" ADD CONSTRAINT "chk_invoices_amounts_non_negative" CHECK (total >= 0 AND subtotal >= 0 AND discount_total >= 0 AND taxable_value >= 0 AND cgst_amount >= 0 AND sgst_amount >= 0 AND igst_amount >= 0);
ALTER TABLE "invoices" ADD CONSTRAINT "chk_invoices_number_when_issued" CHECK (status = 'DRAFT' OR invoice_no IS NOT NULL);
ALTER TABLE "invoices" ADD CONSTRAINT "chk_invoices_gst_needs_place_of_supply" CHECK (type <> 'GST' OR status = 'DRAFT' OR place_of_supply IS NOT NULL);
ALTER TABLE "invoices" ADD CONSTRAINT "chk_invoices_non_gst_has_no_tax" CHECK (type <> 'NON_GST' OR (cgst_amount = 0 AND sgst_amount = 0 AND igst_amount = 0));
ALTER TABLE "invoices" ADD CONSTRAINT "chk_invoices_igst_excludes_cgst_sgst" CHECK (igst_amount = 0 OR (cgst_amount = 0 AND sgst_amount = 0));
ALTER TABLE "invoice_lines" ADD CONSTRAINT "chk_invoice_lines_qty_positive" CHECK (qty > 0);
ALTER TABLE "invoice_lines" ADD CONSTRAINT "chk_invoice_lines_serial_line_qty_is_one" CHECK (serial_unit_id IS NULL OR qty = 1);
ALTER TABLE "invoice_lines" ADD CONSTRAINT "chk_invoice_lines_amounts_non_negative" CHECK (amount >= 0 AND unit_price >= 0 AND discount_amount >= 0 AND taxable_amount >= 0 AND cgst_amount >= 0 AND sgst_amount >= 0 AND igst_amount >= 0);
ALTER TABLE "exchanges" ADD CONSTRAINT "chk_exchanges_different_units" CHECK (old_serial_unit_id <> new_serial_unit_id);
ALTER TABLE "credit_notes" ADD CONSTRAINT "chk_credit_notes_amount_positive" CHECK (amount > 0);
ALTER TABLE "payments" ADD CONSTRAINT "chk_payments_amount_positive" CHECK (amount > 0);
ALTER TABLE "payment_allocations" ADD CONSTRAINT "chk_payment_allocations_amount_positive" CHECK (amount > 0);
ALTER TABLE "leave_requests" ADD CONSTRAINT "chk_leave_requests_dates_ordered" CHECK (to_date >= from_date);
ALTER TABLE "attendance" ADD CONSTRAINT "chk_attendance_check_out_after_check_in" CHECK (check_in IS NULL OR check_out IS NULL OR check_out >= check_in);
ALTER TABLE "payroll_records" ADD CONSTRAINT "chk_payroll_records_month_format" CHECK (month ~ '^[0-9]{4}-(0[1-9]|1[0-2])$');
ALTER TABLE "payroll_records" ADD CONSTRAINT "chk_payroll_records_amounts_valid" CHECK (gross >= 0 AND net >= 0 AND net <= gross);
ALTER TABLE "document_sequences" ADD CONSTRAINT "chk_document_sequences_next_number_positive" CHECK (next_number >= 1);
ALTER TABLE "sessions" ADD CONSTRAINT "chk_sessions_expiry_after_creation" CHECK (expires_at > created_at);
ALTER TABLE "outbox_events" ADD CONSTRAINT "chk_outbox_events_attempts_non_negative" CHECK (attempts >= 0);

-- ---------- partial and expression indexes (not modelled in schema.prisma)
CREATE UNIQUE INDEX "users_username_lower_key" ON "users" (lower("username"));
CREATE UNIQUE INDEX "users_email_lower_key" ON "users" (lower("email"));
CREATE INDEX "serial_units_available_idx" ON "serial_units" ("item_id", "branch_id") WHERE "state" = 'AVAILABLE';
CREATE INDEX "discrepancies_open_idx" ON "discrepancies" ("branch_id", "created_at") WHERE "status" = 'OPEN';
CREATE INDEX "notifications_unread_idx" ON "notifications" ("user_id", "created_at") WHERE "status" <> 'READ';
CREATE INDEX "outbox_events_pending_idx" ON "outbox_events" ("created_at") WHERE "status" = 'PENDING';

-- ---------- row_version and updated_at maintenance
CREATE FUNCTION bump_row_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.row_version := OLD.row_version + 1; NEW.updated_at := CURRENT_TIMESTAMP; RETURN NEW; END $$;
CREATE FUNCTION touch_updated_at() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN NEW.updated_at := CURRENT_TIMESTAMP; RETURN NEW; END $$;
CREATE TRIGGER "users_row_version" BEFORE UPDATE ON "users" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "branches_row_version" BEFORE UPDATE ON "branches" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "roles_row_version" BEFORE UPDATE ON "roles" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "permissions_row_version" BEFORE UPDATE ON "permissions" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "item_categories_row_version" BEFORE UPDATE ON "item_categories" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "items_row_version" BEFORE UPDATE ON "items" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "item_barcodes_row_version" BEFORE UPDATE ON "item_barcodes" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "serial_units_row_version" BEFORE UPDATE ON "serial_units" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "stock_balances_row_version" BEFORE UPDATE ON "stock_balances" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "batteries_row_version" BEFORE UPDATE ON "batteries" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "suppliers_row_version" BEFORE UPDATE ON "suppliers" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "purchase_orders_row_version" BEFORE UPDATE ON "purchase_orders" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "po_lines_row_version" BEFORE UPDATE ON "po_lines" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "supplier_payments_row_version" BEFORE UPDATE ON "supplier_payments" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "goods_receipts_row_version" BEFORE UPDATE ON "goods_receipts" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "receipt_lines_row_version" BEFORE UPDATE ON "receipt_lines" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "transfers_row_version" BEFORE UPDATE ON "transfers" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "transfer_lines_row_version" BEFORE UPDATE ON "transfer_lines" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "discrepancies_row_version" BEFORE UPDATE ON "discrepancies" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "customers_row_version" BEFORE UPDATE ON "customers" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "brokers_row_version" BEFORE UPDATE ON "brokers" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "kyc_documents_row_version" BEFORE UPDATE ON "kyc_documents" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "leads_row_version" BEFORE UPDATE ON "leads" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "lead_followups_row_version" BEFORE UPDATE ON "lead_followups" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "commission_rules_row_version" BEFORE UPDATE ON "commission_rules" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "commissions_row_version" BEFORE UPDATE ON "commissions" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "quotations_row_version" BEFORE UPDATE ON "quotations" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "invoices_row_version" BEFORE UPDATE ON "invoices" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "invoice_lines_row_version" BEFORE UPDATE ON "invoice_lines" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "exchanges_row_version" BEFORE UPDATE ON "exchanges" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "credit_notes_row_version" BEFORE UPDATE ON "credit_notes" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "payments_row_version" BEFORE UPDATE ON "payments" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "staff_row_version" BEFORE UPDATE ON "staff" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "attendance_row_version" BEFORE UPDATE ON "attendance" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "leave_requests_row_version" BEFORE UPDATE ON "leave_requests" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "payroll_records_row_version" BEFORE UPDATE ON "payroll_records" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "approvals_row_version" BEFORE UPDATE ON "approvals" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "attachments_row_version" BEFORE UPDATE ON "attachments" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "states_row_version" BEFORE UPDATE ON "states" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "gst_rates_row_version" BEFORE UPDATE ON "gst_rates" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "hsn_codes_row_version" BEFORE UPDATE ON "hsn_codes" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "units_of_measure_row_version" BEFORE UPDATE ON "units_of_measure" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "payment_modes_row_version" BEFORE UPDATE ON "payment_modes" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "lead_sources_row_version" BEFORE UPDATE ON "lead_sources" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "kyc_document_types_row_version" BEFORE UPDATE ON "kyc_document_types" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "departments_row_version" BEFORE UPDATE ON "departments" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "document_sequences_row_version" BEFORE UPDATE ON "document_sequences" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "notifications_touch" BEFORE UPDATE ON "notifications" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

-- ---------- row-level security (defence in depth behind the application branch filter)
-- The application sets app.user_id, app.branch_ids (comma separated) and app.is_super with set_config(..., true) inside each transaction.
-- Unset settings match nothing, so a query without a branch context returns no rows.
CREATE FUNCTION app_is_super() RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT coalesce(current_setting('app.is_super', true), '') = 'true' $$;
CREATE FUNCTION app_branch_allowed(branch uuid) RETURNS boolean LANGUAGE sql STABLE AS $$
  SELECT app_is_super() OR (branch IS NOT NULL AND branch::text = ANY (string_to_array(coalesce(current_setting('app.branch_ids', true), ''), ',')))
$$;
ALTER TABLE "serial_units" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "serial_units_branch_scope" ON "serial_units" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));
ALTER TABLE "stock_ledger" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stock_ledger_branch_scope" ON "stock_ledger" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));
ALTER TABLE "stock_balances" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stock_balances_branch_scope" ON "stock_balances" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));
ALTER TABLE "batteries" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "batteries_via_serial_unit" ON "batteries" USING (EXISTS (SELECT 1 FROM serial_units su WHERE su.id = batteries.serial_unit_id)) WITH CHECK (EXISTS (SELECT 1 FROM serial_units su WHERE su.id = batteries.serial_unit_id));
ALTER TABLE "purchase_orders" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "purchase_orders_branch_scope" ON "purchase_orders" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));
ALTER TABLE "po_lines" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "po_lines_branch_scope" ON "po_lines" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));
ALTER TABLE "supplier_payments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "supplier_payments_branch_scope" ON "supplier_payments" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));
ALTER TABLE "goods_receipts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "goods_receipts_branch_scope" ON "goods_receipts" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));
ALTER TABLE "receipt_lines" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "receipt_lines_branch_scope" ON "receipt_lines" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));
ALTER TABLE "transfers" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "transfers_branch_scope" ON "transfers" USING (app_branch_allowed(from_branch_id) OR app_branch_allowed(to_branch_id)) WITH CHECK (app_branch_allowed(from_branch_id) OR app_branch_allowed(to_branch_id));
ALTER TABLE "transfer_lines" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "transfer_lines_branch_scope" ON "transfer_lines" USING (app_branch_allowed(from_branch_id) OR app_branch_allowed(to_branch_id)) WITH CHECK (app_branch_allowed(from_branch_id) OR app_branch_allowed(to_branch_id));
ALTER TABLE "discrepancies" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "discrepancies_branch_scope" ON "discrepancies" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));
ALTER TABLE "transfer_events" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "transfer_events_branch_scope" ON "transfer_events" USING (app_branch_allowed(from_branch_id) OR app_branch_allowed(to_branch_id)) WITH CHECK (app_branch_allowed(from_branch_id) OR app_branch_allowed(to_branch_id));
ALTER TABLE "leads" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "leads_branch_scope" ON "leads" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));
ALTER TABLE "lead_followups" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lead_followups_branch_scope" ON "lead_followups" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));
ALTER TABLE "commissions" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "commissions_branch_scope" ON "commissions" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));
ALTER TABLE "quotations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quotations_branch_scope" ON "quotations" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invoices_branch_scope" ON "invoices" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));
ALTER TABLE "invoice_lines" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invoice_lines_branch_scope" ON "invoice_lines" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));
ALTER TABLE "exchanges" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "exchanges_branch_scope" ON "exchanges" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));
ALTER TABLE "credit_notes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "credit_notes_branch_scope" ON "credit_notes" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));
ALTER TABLE "payment_allocations" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payment_allocations_branch_scope" ON "payment_allocations" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payments_branch_scope" ON "payments" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));
ALTER TABLE "staff" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_branch_scope" ON "staff" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));
ALTER TABLE "attendance" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "attendance_branch_scope" ON "attendance" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));
ALTER TABLE "leave_requests" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "leave_requests_branch_scope" ON "leave_requests" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));
ALTER TABLE "payroll_records" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payroll_records_branch_scope" ON "payroll_records" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));
ALTER TABLE "audit_log" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "audit_log_insert" ON "audit_log" FOR INSERT WITH CHECK (true);
CREATE POLICY "audit_log_select" ON "audit_log" FOR SELECT USING (app_branch_allowed(branch_id));
ALTER TABLE "notifications" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "notifications_insert" ON "notifications" FOR INSERT WITH CHECK (true);
CREATE POLICY "notifications_own_select" ON "notifications" FOR SELECT USING (user_id::text = current_setting('app.user_id', true));
CREATE POLICY "notifications_own_update" ON "notifications" FOR UPDATE USING (user_id::text = current_setting('app.user_id', true)) WITH CHECK (user_id::text = current_setting('app.user_id', true));
ALTER TABLE "approvals" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "approvals_branch_scope" ON "approvals" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));
ALTER TABLE "attachments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "attachments_branch_scope" ON "attachments" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));
ALTER TABLE "document_sequences" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "document_sequences_branch_scope" ON "document_sequences" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));

-- ---------- privileges
GRANT USAGE ON SCHEMA public TO erp_app, erp_worker;
GRANT EXECUTE ON FUNCTION app_is_super(), app_branch_allowed(uuid) TO erp_app, erp_worker;
GRANT SELECT, INSERT, UPDATE ON ALL TABLES IN SCHEMA public TO erp_app;
GRANT DELETE ON "sessions", "user_branches", "user_roles", "role_permissions", "item_barcodes" TO erp_app;
-- Ledgers: the application can only append (and read what its branches may see).
REVOKE UPDATE ON "audit_log", "stock_ledger", "outbox_events" FROM erp_app;
REVOKE SELECT ON "outbox_events" FROM erp_app;
-- The worker relays outbox events and may change only their processing columns.
GRANT SELECT ON "outbox_events" TO erp_worker;
GRANT UPDATE ("status", "processed_at", "attempts", "last_error") ON "outbox_events" TO erp_worker;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON TABLES TO erp_app;
