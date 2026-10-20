-- Stage 4 migration 13 (module 4.7 part C, credit notes): a credit note is requested, then approved or rejected. It
-- carries the goods being returned as lines and the tax it credits. Its number is taken only when it is approved, so a
-- rejected request never uses one. A decided credit note, and every line, is fixed for good, and the database itself
-- refuses to credit more of an invoice line than was sold.

ALTER TABLE "credit_notes" ALTER COLUMN "credit_note_no" DROP NOT NULL;
ALTER TABLE "credit_notes"
  ADD COLUMN "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "taxable_value" decimal(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN "cgst_amount" decimal(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN "sgst_amount" decimal(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN "igst_amount" decimal(14, 2) NOT NULL DEFAULT 0,
  ADD COLUMN "decided_by" uuid,
  ADD COLUMN "decided_at" timestamptz,
  ADD COLUMN "decision_note" text;
ALTER TABLE "credit_notes"
  ADD CONSTRAINT "credit_notes_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "credit_notes_status_idx" ON "credit_notes" ("status");

ALTER TABLE "credit_notes" ADD CONSTRAINT "chk_credit_notes_number" CHECK ((status = 'APPROVED') = (credit_note_no IS NOT NULL));
ALTER TABLE "credit_notes" ADD CONSTRAINT "chk_credit_notes_decision" CHECK (
  (status = 'PENDING' AND decided_by IS NULL AND decided_at IS NULL AND decision_note IS NULL)
  OR (status = 'APPROVED' AND decided_by IS NOT NULL AND decided_at IS NOT NULL)
  OR (status = 'REJECTED' AND decided_by IS NOT NULL AND decided_at IS NOT NULL AND decision_note IS NOT NULL AND btrim(decision_note) <> '')
);
ALTER TABLE "credit_notes" ADD CONSTRAINT "chk_credit_notes_amounts" CHECK (
  amount > 0 AND taxable_value >= 0 AND cgst_amount >= 0 AND sgst_amount >= 0 AND igst_amount >= 0
  AND amount = taxable_value + cgst_amount + sgst_amount + igst_amount
  AND (igst_amount = 0 OR (cgst_amount = 0 AND sgst_amount = 0))
);
ALTER TABLE "credit_notes" ADD CONSTRAINT "chk_credit_notes_reason" CHECK (btrim(reason) <> '');

CREATE TABLE "credit_note_lines" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "branch_id" uuid NOT NULL,
  "credit_note_id" uuid NOT NULL,
  "invoice_line_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "serial_unit_id" uuid,
  "line_no" integer NOT NULL,
  "qty" integer NOT NULL,
  "taxable_amount" decimal(14, 2) NOT NULL,
  "cgst_amount" decimal(14, 2) NOT NULL DEFAULT 0,
  "sgst_amount" decimal(14, 2) NOT NULL DEFAULT 0,
  "igst_amount" decimal(14, 2) NOT NULL DEFAULT 0,
  "amount" decimal(14, 2) NOT NULL,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" integer NOT NULL DEFAULT 1,
  CONSTRAINT "credit_note_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "credit_note_lines_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "credit_note_lines_credit_note_id_fkey" FOREIGN KEY ("credit_note_id") REFERENCES "credit_notes"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "credit_note_lines_invoice_line_id_fkey" FOREIGN KEY ("invoice_line_id") REFERENCES "invoice_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "credit_note_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "credit_note_lines_serial_unit_id_fkey" FOREIGN KEY ("serial_unit_id") REFERENCES "serial_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "chk_credit_note_lines_line_no" CHECK (line_no >= 1),
  CONSTRAINT "chk_credit_note_lines_qty" CHECK (qty > 0),
  CONSTRAINT "chk_credit_note_lines_serial_qty" CHECK (serial_unit_id IS NULL OR qty = 1),
  CONSTRAINT "chk_credit_note_lines_amounts" CHECK (
    taxable_amount >= 0 AND cgst_amount >= 0 AND sgst_amount >= 0 AND igst_amount >= 0
    AND amount = taxable_amount + cgst_amount + sgst_amount + igst_amount
    AND (igst_amount = 0 OR (cgst_amount = 0 AND sgst_amount = 0))
  )
);
CREATE UNIQUE INDEX "credit_note_lines_credit_note_id_line_no_key" ON "credit_note_lines" ("credit_note_id", "line_no");
CREATE UNIQUE INDEX "credit_note_lines_credit_note_id_invoice_line_id_key" ON "credit_note_lines" ("credit_note_id", "invoice_line_id");
CREATE INDEX "credit_note_lines_branch_id_idx" ON "credit_note_lines" ("branch_id");
CREATE INDEX "credit_note_lines_invoice_line_id_idx" ON "credit_note_lines" ("invoice_line_id");
CREATE INDEX "credit_note_lines_item_id_idx" ON "credit_note_lines" ("item_id");
CREATE INDEX "credit_note_lines_serial_unit_id_idx" ON "credit_note_lines" ("serial_unit_id");

CREATE TRIGGER "credit_note_lines_row_version" BEFORE UPDATE ON "credit_note_lines" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
ALTER TABLE "credit_note_lines" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "credit_note_lines_branch_scope" ON "credit_note_lines" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));

-- A credit note is decided once: after that it never changes. Its lines never change at all.
CREATE FUNCTION credit_notes_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.status <> 'PENDING' THEN
    RAISE EXCEPTION 'A decided credit note cannot be changed' USING ERRCODE = '23514';
  END IF;
  IF NEW.status = 'PENDING' AND (to_jsonb(NEW) - ARRAY['row_version', 'updated_at', 'updated_by'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['row_version', 'updated_at', 'updated_by']) THEN
    RAISE EXCEPTION 'A credit note waiting for a decision cannot be edited' USING ERRCODE = '23514';
  END IF;
  IF NEW.status <> 'PENDING' AND (to_jsonb(NEW) - ARRAY['status', 'credit_note_no', 'decided_by', 'decided_at', 'decision_note', 'row_version', 'updated_at', 'updated_by'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['status', 'credit_note_no', 'decided_by', 'decided_at', 'decision_note', 'row_version', 'updated_at', 'updated_by']) THEN
    RAISE EXCEPTION 'A decision cannot change what the credit note says' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "credit_notes_guard" AFTER UPDATE ON "credit_notes" FOR EACH ROW EXECUTE FUNCTION credit_notes_guard();

CREATE FUNCTION credit_note_lines_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'The lines of a credit note cannot be changed' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER "credit_note_lines_frozen" BEFORE UPDATE OR DELETE ON "credit_note_lines" FOR EACH ROW EXECUTE FUNCTION credit_note_lines_frozen();

-- Whatever the application does, no more of an invoice line can be credited than was sold. Rejected credit notes
-- do not count.
CREATE FUNCTION credit_note_lines_cap() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  sold integer;
  credited bigint;
BEGIN
  SELECT qty INTO sold FROM invoice_lines WHERE id = NEW.invoice_line_id;
  SELECT COALESCE(SUM(l.qty), 0) INTO credited
  FROM credit_note_lines l JOIN credit_notes n ON n.id = l.credit_note_id
  WHERE l.invoice_line_id = NEW.invoice_line_id AND n.status <> 'REJECTED';
  IF credited > sold THEN
    RAISE EXCEPTION 'More of an invoice line is being credited than was sold' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE CONSTRAINT TRIGGER "credit_note_lines_cap" AFTER INSERT ON "credit_note_lines"
  DEFERRABLE INITIALLY IMMEDIATE FOR EACH ROW EXECUTE FUNCTION credit_note_lines_cap();
