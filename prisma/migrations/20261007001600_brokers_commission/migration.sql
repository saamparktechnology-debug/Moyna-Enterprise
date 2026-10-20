-- Stage 4 migration 16 (module 4.10, brokers and commission): an invoice can name the broker who brought the sale (set on
-- the draft, frozen once issued by the existing invoice guard); a commission rule can never be edited, only retired and
-- replaced, with at most one live rule per broker, so the terms behind an old commission never move; a commission
-- records the amount it was worked out on and how it was paid; credit notes and cancellations lower a commission through
-- append-only adjustment rows; and the database guards all of it. Existing rows are not changed: the checks that could
-- fail on old rows are added NOT VALID.

ALTER TABLE "invoices" ADD COLUMN "broker_id" uuid;
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_broker_id_fkey" FOREIGN KEY ("broker_id") REFERENCES "brokers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "invoices_broker_id_idx" ON "invoices" ("broker_id");

ALTER TABLE "brokers"
  ADD CONSTRAINT "chk_brokers_name_not_blank" CHECK (btrim(name) <> '') NOT VALID,
  ADD CONSTRAINT "chk_brokers_phone_format" CHECK (phone IS NULL OR phone ~ '^[6-9][0-9]{9}$') NOT VALID;
-- Brokers without a phone number are not compared (NULLs are distinct), so any number of them may exist.
CREATE UNIQUE INDEX "brokers_phone_key" ON "brokers" ("phone");

ALTER TABLE "commission_rules" ADD CONSTRAINT "chk_commission_rules_value_positive" CHECK (value > 0) NOT VALID;
CREATE UNIQUE INDEX "commission_rules_one_active_key" ON "commission_rules" ("broker_id") WHERE is_active;
CREATE FUNCTION commission_rules_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.broker_id <> OLD.broker_id OR NEW.type <> OLD.type OR NEW.value <> OLD.value THEN
    RAISE EXCEPTION 'A commission rule cannot be changed. Retire it and add a new one' USING ERRCODE = '23514';
  END IF;
  IF OLD.is_active = false AND NEW.is_active = true THEN
    RAISE EXCEPTION 'A retired commission rule cannot be used again. Add a new one' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "commission_rules_guard" BEFORE UPDATE ON "commission_rules" FOR EACH ROW EXECUTE FUNCTION commission_rules_guard();

ALTER TABLE "commissions"
  ADD COLUMN "base_amount" numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "paid_at" timestamptz,
  ADD COLUMN "paid_by" uuid,
  ADD COLUMN "paid_amount" numeric(14,2),
  ADD COLUMN "payout_reference" text;
ALTER TABLE "commissions" ALTER COLUMN "base_amount" DROP DEFAULT;
ALTER TABLE "commissions"
  ADD CONSTRAINT "chk_commissions_base_non_negative" CHECK (base_amount >= 0) NOT VALID,
  ADD CONSTRAINT "chk_commissions_paid_amount" CHECK (paid_amount IS NULL OR paid_amount >= 0) NOT VALID,
  ADD CONSTRAINT "chk_commissions_paid_pair" CHECK ((status = 'PAID') = (paid_at IS NOT NULL AND paid_amount IS NOT NULL)) NOT VALID,
  ADD CONSTRAINT "chk_commissions_payout_reference" CHECK (payout_reference IS NULL OR btrim(payout_reference) <> '') NOT VALID;
-- One commission per invoice: an invoice names one broker.
DROP INDEX "commissions_invoice_id_idx";
CREATE UNIQUE INDEX "commissions_invoice_id_key" ON "commissions" ("invoice_id");

-- A commission is made once, for the broker, branch and live rule of an issued invoice.
CREATE FUNCTION commissions_insert_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  inv record;
  rule_broker uuid;
BEGIN
  SELECT branch_id, broker_id, status INTO inv FROM invoices WHERE id = NEW.invoice_id;
  IF inv.branch_id IS NULL OR inv.branch_id <> NEW.branch_id THEN
    RAISE EXCEPTION 'A commission must be in the branch of its invoice' USING ERRCODE = '23514';
  END IF;
  IF inv.broker_id IS DISTINCT FROM NEW.broker_id THEN
    RAISE EXCEPTION 'A commission goes to the broker named on its invoice' USING ERRCODE = '23514';
  END IF;
  IF inv.status <> 'ISSUED' THEN
    RAISE EXCEPTION 'A commission is worked out only for an issued invoice' USING ERRCODE = '23514';
  END IF;
  SELECT broker_id INTO rule_broker FROM commission_rules WHERE id = NEW.rule_id;
  IF rule_broker IS DISTINCT FROM NEW.broker_id THEN
    RAISE EXCEPTION 'The rule belongs to another broker' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "commissions_insert_check" BEFORE INSERT ON "commissions" FOR EACH ROW EXECUTE FUNCTION commissions_insert_check();

-- The terms of a commission never change. A payable commission can be paid or reversed; after that nothing changes.
CREATE FUNCTION commissions_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  bookkeeping text[] := ARRAY['row_version', 'updated_at', 'updated_by'];
  settling text[] := ARRAY['status', 'paid_at', 'paid_by', 'paid_amount', 'payout_reference', 'row_version', 'updated_at', 'updated_by'];
BEGIN
  IF OLD.status <> 'PAYABLE' THEN
    IF (to_jsonb(NEW) - bookkeeping) IS DISTINCT FROM (to_jsonb(OLD) - bookkeeping) THEN
      RAISE EXCEPTION 'A % commission cannot be changed', lower(OLD.status::text) USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF (to_jsonb(NEW) - settling) IS DISTINCT FROM (to_jsonb(OLD) - settling) THEN
    RAISE EXCEPTION 'The terms of a commission cannot be changed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "commissions_guard" BEFORE UPDATE ON "commissions" FOR EACH ROW EXECUTE FUNCTION commissions_guard();

-- What a credit note or a cancelled invoice takes off a commission. Rows are added, never changed.
CREATE TABLE "commission_adjustments" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "branch_id" uuid NOT NULL,
  "commission_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "credit_note_id" uuid,
  "amount" numeric(14,2) NOT NULL,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" integer NOT NULL DEFAULT 1,
  CONSTRAINT "commission_adjustments_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "commission_adjustments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "commission_adjustments_commission_id_fkey" FOREIGN KEY ("commission_id") REFERENCES "commissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "commission_adjustments_credit_note_id_fkey" FOREIGN KEY ("credit_note_id") REFERENCES "credit_notes"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "chk_commission_adjustments_kind" CHECK (kind IN ('CREDIT_NOTE', 'INVOICE_CANCELLED')),
  CONSTRAINT "chk_commission_adjustments_credit_note" CHECK ((kind = 'CREDIT_NOTE') = (credit_note_id IS NOT NULL)),
  CONSTRAINT "chk_commission_adjustments_amount" CHECK (amount > 0)
);
-- A credit note lowers a commission once.
CREATE UNIQUE INDEX "commission_adjustments_credit_note_id_key" ON "commission_adjustments" ("credit_note_id");
CREATE INDEX "commission_adjustments_commission_id_idx" ON "commission_adjustments" ("commission_id");
CREATE INDEX "commission_adjustments_branch_id_idx" ON "commission_adjustments" ("branch_id");
CREATE TRIGGER "commission_adjustments_row_version" BEFORE UPDATE ON "commission_adjustments" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
ALTER TABLE "commission_adjustments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "commission_adjustments_branch_scope" ON "commission_adjustments" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));

CREATE FUNCTION commission_adjustments_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Commission adjustments cannot be changed or deleted' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER "commission_adjustments_frozen" BEFORE UPDATE OR DELETE ON "commission_adjustments" FOR EACH ROW EXECUTE FUNCTION commission_adjustments_frozen();

-- An adjustment is in its commission's branch, never takes more than the commission is worth, and a credit note named
-- on it belongs to the commission's invoice and has been approved. The commission is locked first, so two adjustments
-- arriving together are checked one after the other.
CREATE FUNCTION commission_adjustments_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  com record;
  taken numeric;
  note record;
BEGIN
  SELECT id, branch_id, invoice_id, amount INTO com FROM commissions WHERE id = NEW.commission_id FOR UPDATE;
  IF com.id IS NULL OR com.branch_id <> NEW.branch_id THEN
    RAISE EXCEPTION 'An adjustment must be in the branch of its commission' USING ERRCODE = '23514';
  END IF;
  IF NEW.credit_note_id IS NOT NULL THEN
    SELECT invoice_id, status INTO note FROM credit_notes WHERE id = NEW.credit_note_id;
    IF note.invoice_id IS DISTINCT FROM com.invoice_id OR note.status <> 'APPROVED' THEN
      RAISE EXCEPTION 'The credit note must be an approved one against the commission''s invoice' USING ERRCODE = '23514';
    END IF;
  END IF;
  SELECT COALESCE(SUM(amount), 0) INTO taken FROM commission_adjustments WHERE commission_id = NEW.commission_id;
  IF taken + NEW.amount > com.amount THEN
    RAISE EXCEPTION 'The adjustments would take more than the commission is worth' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "commission_adjustments_check" BEFORE INSERT ON "commission_adjustments" FOR EACH ROW EXECUTE FUNCTION commission_adjustments_check();
