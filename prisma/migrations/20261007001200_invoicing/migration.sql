-- Stage 4 migration 12 (module 4.7, billing and invoicing): cancel and reissue details, arithmetic the database checks
-- for itself, and a guard that makes an issued invoice unchangeable. Only a draft may be edited or deleted; an issued
-- invoice can only ever be cancelled, and a cancelled one never changes again.

ALTER TABLE "invoices"
  ADD COLUMN "cancelled_at" timestamptz,
  ADD COLUMN "cancelled_by" uuid,
  ADD COLUMN "cancel_reason" text,
  ADD COLUMN "replaces_invoice_id" uuid;

ALTER TABLE "invoices"
  ADD CONSTRAINT "invoices_cancelled_by_fkey" FOREIGN KEY ("cancelled_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "invoices_replaces_invoice_id_fkey" FOREIGN KEY ("replaces_invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "invoices_replaces_invoice_id_idx" ON "invoices" ("replaces_invoice_id");

ALTER TABLE "invoices" ADD CONSTRAINT "chk_invoices_cancel_details" CHECK (
  (status = 'CANCELLED') = (cancelled_at IS NOT NULL)
  AND (status = 'CANCELLED') = (cancelled_by IS NOT NULL)
  AND (status = 'CANCELLED') = (cancel_reason IS NOT NULL)
);
ALTER TABLE "invoices" ADD CONSTRAINT "chk_invoices_taxable_value" CHECK (taxable_value = subtotal - discount_total);
ALTER TABLE "invoices" ADD CONSTRAINT "chk_invoices_total" CHECK (total = taxable_value + cgst_amount + sgst_amount + igst_amount + round_off);
ALTER TABLE "invoices" ADD CONSTRAINT "chk_invoices_round_off" CHECK (round_off BETWEEN -0.50 AND 0.50);
ALTER TABLE "invoices" ADD CONSTRAINT "chk_invoices_not_self_replacing" CHECK (replaces_invoice_id IS NULL OR replaces_invoice_id <> id);

-- Lines print in the order they were entered, so each keeps its position on the invoice.
ALTER TABLE "invoice_lines" ADD COLUMN "line_no" integer NOT NULL DEFAULT 1;
ALTER TABLE "invoice_lines" ADD CONSTRAINT "chk_invoice_lines_line_no" CHECK (line_no >= 1);
CREATE UNIQUE INDEX "invoice_lines_invoice_id_line_no_key" ON "invoice_lines" (invoice_id, line_no);

ALTER TABLE "invoice_lines" ADD CONSTRAINT "chk_invoice_lines_taxable" CHECK (taxable_amount = unit_price * qty - discount_amount);
ALTER TABLE "invoice_lines" ADD CONSTRAINT "chk_invoice_lines_discount_within_price" CHECK (discount_amount <= unit_price * qty);
ALTER TABLE "invoice_lines" ADD CONSTRAINT "chk_invoice_lines_igst_excludes_cgst_sgst" CHECK (igst_amount = 0 OR (cgst_amount = 0 AND sgst_amount = 0));

-- A draft is free to change. Once issued, an invoice changes in only two ways: it can be cancelled, which fills in the
-- cancel details, and its due date can be moved. A cancelled invoice never changes. Only drafts can be deleted. These
-- guards run AFTER the row is written so that row-level security answers first for a branch the user does not have.
CREATE FUNCTION invoices_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  ignored text[] := ARRAY['status', 'cancelled_at', 'cancelled_by', 'cancel_reason', 'due_date', 'row_version', 'updated_at', 'updated_by'];
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'An issued invoice cannot be deleted' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.status = 'DRAFT' THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'ISSUED' AND NEW.status = 'ISSUED'
     AND (to_jsonb(NEW) - ignored) IS NOT DISTINCT FROM (to_jsonb(OLD) - ignored) THEN
    RETURN NEW;
  END IF;
  IF OLD.status = 'CANCELLED' THEN
    RAISE EXCEPTION 'A cancelled invoice cannot be changed' USING ERRCODE = '23514';
  END IF;
  IF NEW.status NOT IN ('ISSUED', 'CANCELLED')
     OR (to_jsonb(NEW) - ignored) IS DISTINCT FROM (to_jsonb(OLD) - ignored) THEN
    RAISE EXCEPTION 'An issued invoice cannot be changed, only cancelled' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "invoices_guard" AFTER UPDATE OR DELETE ON "invoices" FOR EACH ROW EXECUTE FUNCTION invoices_guard();

-- Lines are fixed once their invoice has been issued and the transaction that created or issued it is over. Inside that
-- same transaction (for example when an invoice is loaded already issued) they may still be written.
CREATE FUNCTION invoice_lines_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent_status "InvoiceStatus";
  parent_xmin bigint;
BEGIN
  SELECT status, xmin::text::bigint INTO parent_status, parent_xmin
  FROM invoices WHERE id = COALESCE(NEW.invoice_id, OLD.invoice_id);
  IF parent_status IS NOT NULL AND parent_status <> 'DRAFT'
     AND parent_xmin <> (txid_current() % 4294967296) THEN
    RAISE EXCEPTION 'The lines of an issued invoice cannot be changed' USING ERRCODE = '23514';
  END IF;
  RETURN COALESCE(NEW, OLD);
END $$;
CREATE TRIGGER "invoice_lines_guard" AFTER INSERT OR UPDATE OR DELETE ON "invoice_lines" FOR EACH ROW EXECUTE FUNCTION invoice_lines_guard();

-- The application role cannot delete rows from business tables, and that stays true for invoices. Discarding a draft
-- (which has no number and has not touched stock) goes through this one function, which refuses anything but a draft
-- in a branch the caller may use.
CREATE FUNCTION discard_invoice_draft(p_invoice_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_branch uuid;
  v_status "InvoiceStatus";
BEGIN
  SELECT branch_id, status INTO v_branch, v_status FROM invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND OR NOT app_branch_allowed(v_branch) THEN
    RETURN false;
  END IF;
  IF v_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Only a draft invoice can be discarded' USING ERRCODE = '23514';
  END IF;
  DELETE FROM invoice_lines WHERE invoice_id = p_invoice_id;
  DELETE FROM invoices WHERE id = p_invoice_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION discard_invoice_draft(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION discard_invoice_draft(uuid) TO erp_app;

-- Editing a draft replaces its lines. That is the one other place lines are removed, so it too goes through a function
-- that refuses anything but a draft in a branch the caller may use.
CREATE FUNCTION clear_invoice_draft_lines(p_invoice_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_branch uuid;
  v_status "InvoiceStatus";
BEGIN
  SELECT branch_id, status INTO v_branch, v_status FROM invoices WHERE id = p_invoice_id FOR UPDATE;
  IF NOT FOUND OR NOT app_branch_allowed(v_branch) THEN
    RETURN false;
  END IF;
  IF v_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Only the lines of a draft invoice can be replaced' USING ERRCODE = '23514';
  END IF;
  DELETE FROM invoice_lines WHERE invoice_id = p_invoice_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION clear_invoice_draft_lines(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION clear_invoice_draft_lines(uuid) TO erp_app;
