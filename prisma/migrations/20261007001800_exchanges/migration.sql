-- Stage 4 migration 18 (module 4.12, exchange): an exchange takes back a vehicle that was sold to the customer (the old
-- unit, on an earlier invoice) against a vehicle on an issued delivery invoice (the new unit). It is requested, then
-- approved or rejected; it records its own number, the valuation of the old unit, what the new unit cost, the
-- difference, what happens to the old unit (back into stock or scrapped), and the trade-in payment that applies the
-- valuation to the delivery invoice. A commission lowered because the old sale is undone is recorded as an adjustment
-- of kind EXCHANGE. The database holds the rules: the terms never change, the same unit is in one open exchange at a
-- time, a unit with a credit note cannot be exchanged, and the difference is exactly the new price less the valuation.
-- Existing rows (none are made by the application before this module) are given safe values.

ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'EXCHANGE';

-- Money taken as the value of an old unit is paid in this mode. It is reserved for exchanges.
INSERT INTO "payment_modes" ("code", "name", "is_active") VALUES ('EXCHANGE', 'Exchange (old unit taken back)', true)
ON CONFLICT ("code") DO NOTHING;

ALTER TABLE "exchanges"
  ADD COLUMN "exchange_no" text,
  ADD COLUMN "kind" text,
  ADD COLUMN "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
  ADD COLUMN "original_invoice_id" uuid,
  ADD COLUMN "returned_amount" numeric(14,2),
  ADD COLUMN "returned_taxable" numeric(14,2),
  ADD COLUMN "valuation_amount" numeric(14,2),
  ADD COLUMN "new_amount" numeric(14,2),
  ADD COLUMN "disposition" text,
  ADD COLUMN "reason" text,
  ADD COLUMN "decided_by" uuid,
  ADD COLUMN "decided_at" timestamptz,
  ADD COLUMN "decision_note" text,
  ADD COLUMN "trade_in_payment_id" uuid;
UPDATE "exchanges" SET
  "exchange_no" = 'LEGACY-' || "id"::text,
  "kind" = 'OLD_FOR_NEW',
  "original_invoice_id" = "invoice_id",
  "returned_amount" = 0, "returned_taxable" = 0, "valuation_amount" = 0, "new_amount" = 0,
  "disposition" = 'STOCK',
  "reason" = 'Recorded before exchanges were built',
  "status" = 'APPROVED';
ALTER TABLE "exchanges"
  ALTER COLUMN "exchange_no" SET NOT NULL,
  ALTER COLUMN "kind" SET NOT NULL,
  ALTER COLUMN "original_invoice_id" SET NOT NULL,
  ALTER COLUMN "returned_amount" SET NOT NULL,
  ALTER COLUMN "returned_taxable" SET NOT NULL,
  ALTER COLUMN "valuation_amount" SET NOT NULL,
  ALTER COLUMN "new_amount" SET NOT NULL,
  ALTER COLUMN "disposition" SET NOT NULL,
  ALTER COLUMN "reason" SET NOT NULL;
ALTER TABLE "exchanges" ALTER COLUMN "status" DROP DEFAULT;
ALTER TABLE "exchanges" ALTER COLUMN "status" SET DEFAULT 'PENDING';
ALTER TABLE "exchanges"
  ADD CONSTRAINT "exchanges_original_invoice_id_fkey" FOREIGN KEY ("original_invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "exchanges_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "exchanges_trade_in_payment_id_fkey" FOREIGN KEY ("trade_in_payment_id") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "chk_exchanges_kind" CHECK (kind IN ('OLD_FOR_NEW', 'NEW_FOR_NEW')),
  ADD CONSTRAINT "chk_exchanges_disposition" CHECK (disposition IN ('STOCK', 'SCRAP')),
  ADD CONSTRAINT "chk_exchanges_reason" CHECK (btrim(reason) <> ''),
  ADD CONSTRAINT "chk_exchanges_decision_note" CHECK (decision_note IS NULL OR btrim(decision_note) <> ''),
  ADD CONSTRAINT "chk_exchanges_different_invoices" CHECK (original_invoice_id <> invoice_id) NOT VALID,
  ADD CONSTRAINT "chk_exchanges_valuation" CHECK (valuation_amount > 0 AND valuation_amount <= returned_amount) NOT VALID,
  ADD CONSTRAINT "chk_exchanges_new_for_new_at_price" CHECK (kind <> 'NEW_FOR_NEW' OR valuation_amount = returned_amount) NOT VALID,
  ADD CONSTRAINT "chk_exchanges_difference" CHECK (difference_amount = new_amount - valuation_amount) NOT VALID,
  ADD CONSTRAINT "chk_exchanges_decided_pair" CHECK ((status IN ('APPROVED', 'REJECTED')) = (decided_at IS NOT NULL)) NOT VALID;
CREATE UNIQUE INDEX "exchanges_branch_id_exchange_no_key" ON "exchanges" ("branch_id", "exchange_no");
CREATE INDEX "exchanges_original_invoice_id_idx" ON "exchanges" ("original_invoice_id");
CREATE INDEX "exchanges_branch_id_status_idx" ON "exchanges" ("branch_id", "status");
CREATE INDEX "exchanges_decided_by_idx" ON "exchanges" ("decided_by");
CREATE INDEX "exchanges_trade_in_payment_id_idx" ON "exchanges" ("trade_in_payment_id");
-- A unit is in one open exchange at a time, as the unit taken back and as the unit handed over.
CREATE UNIQUE INDEX "exchanges_old_unit_open_key" ON "exchanges" ("old_serial_unit_id") WHERE status IN ('PENDING', 'APPROVED');
CREATE UNIQUE INDEX "exchanges_new_unit_open_key" ON "exchanges" ("new_serial_unit_id") WHERE status IN ('PENDING', 'APPROVED');

-- A new exchange is for issued invoices of one customer in one branch; the new unit is on the delivery invoice and the
-- old unit on the earlier one; the old unit has not been credited, and (while pending) is still sold to the customer.
CREATE FUNCTION exchanges_insert_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  delivery record;
  original record;
BEGIN
  SELECT branch_id, customer_id, status INTO delivery FROM invoices WHERE id = NEW.invoice_id;
  SELECT branch_id, customer_id, status INTO original FROM invoices WHERE id = NEW.original_invoice_id;
  IF delivery.status IS DISTINCT FROM 'ISSUED' OR original.status IS DISTINCT FROM 'ISSUED' THEN
    RAISE EXCEPTION 'An exchange is between issued invoices' USING ERRCODE = '23514';
  END IF;
  IF delivery.branch_id <> NEW.branch_id OR original.branch_id <> NEW.branch_id THEN
    RAISE EXCEPTION 'An exchange must be in the branch of both invoices' USING ERRCODE = '23514';
  END IF;
  IF delivery.customer_id <> original.customer_id THEN
    RAISE EXCEPTION 'Both invoices of an exchange are the same customer''s' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM invoice_lines WHERE invoice_id = NEW.invoice_id AND serial_unit_id = NEW.new_serial_unit_id) THEN
    RAISE EXCEPTION 'The new unit is not on the delivery invoice' USING ERRCODE = '23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM invoice_lines WHERE invoice_id = NEW.original_invoice_id AND serial_unit_id = NEW.old_serial_unit_id) THEN
    RAISE EXCEPTION 'The old unit is not on the invoice it was sold on' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM credit_note_lines l JOIN credit_notes n ON n.id = l.credit_note_id
    WHERE l.serial_unit_id = NEW.old_serial_unit_id AND n.status IN ('PENDING', 'APPROVED')
  ) THEN
    RAISE EXCEPTION 'A credit note covers the old unit, so it cannot be exchanged' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "exchanges_insert_check" BEFORE INSERT ON "exchanges" FOR EACH ROW EXECUTE FUNCTION exchanges_insert_check();

-- The terms of an exchange never change. Only a pending one is decided, once, and then nothing changes.
CREATE FUNCTION exchanges_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  settable text[] := ARRAY['status', 'decided_by', 'decided_at', 'decision_note', 'trade_in_payment_id', 'row_version', 'updated_at', 'updated_by'];
BEGIN
  IF (to_jsonb(NEW) - settable) IS DISTINCT FROM (to_jsonb(OLD) - settable) THEN
    RAISE EXCEPTION 'The terms of an exchange cannot be changed' USING ERRCODE = '23514';
  END IF;
  IF OLD.status <> 'PENDING' THEN
    IF (to_jsonb(NEW) - ARRAY['row_version', 'updated_at', 'updated_by']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['row_version', 'updated_at', 'updated_by']) THEN
      RAISE EXCEPTION 'A decided exchange cannot be changed' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.status NOT IN ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') THEN
    RAISE EXCEPTION 'An exchange cannot move to %', NEW.status USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "exchanges_guard" BEFORE UPDATE ON "exchanges" FOR EACH ROW EXECUTE FUNCTION exchanges_guard();

-- A unit that is part of an open exchange cannot also be credited.
CREATE FUNCTION credit_note_lines_exchange_check() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.serial_unit_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM exchanges WHERE old_serial_unit_id = NEW.serial_unit_id AND status IN ('PENDING', 'APPROVED')
  ) THEN
    RAISE EXCEPTION 'This unit is part of an exchange, so it cannot be credited' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "credit_note_lines_exchange_check" BEFORE INSERT ON "credit_note_lines" FOR EACH ROW EXECUTE FUNCTION credit_note_lines_exchange_check();

-- A commission lowered because the old unit's sale was undone by an exchange.
ALTER TABLE "commission_adjustments" ADD COLUMN "exchange_id" uuid;
ALTER TABLE "commission_adjustments"
  ADD CONSTRAINT "commission_adjustments_exchange_id_fkey" FOREIGN KEY ("exchange_id") REFERENCES "exchanges"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "commission_adjustments" DROP CONSTRAINT "chk_commission_adjustments_kind";
ALTER TABLE "commission_adjustments" DROP CONSTRAINT "chk_commission_adjustments_credit_note";
ALTER TABLE "commission_adjustments"
  ADD CONSTRAINT "chk_commission_adjustments_kind" CHECK (kind IN ('CREDIT_NOTE', 'INVOICE_CANCELLED', 'EXCHANGE')),
  ADD CONSTRAINT "chk_commission_adjustments_credit_note" CHECK ((kind = 'CREDIT_NOTE') = (credit_note_id IS NOT NULL)),
  ADD CONSTRAINT "chk_commission_adjustments_exchange" CHECK ((kind = 'EXCHANGE') = (exchange_id IS NOT NULL));
CREATE UNIQUE INDEX "commission_adjustments_exchange_id_key" ON "commission_adjustments" ("exchange_id");

CREATE OR REPLACE FUNCTION commission_adjustments_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  com record;
  taken numeric;
  note record;
  ex record;
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
  IF NEW.exchange_id IS NOT NULL THEN
    SELECT original_invoice_id, status INTO ex FROM exchanges WHERE id = NEW.exchange_id;
    IF ex.original_invoice_id IS DISTINCT FROM com.invoice_id OR ex.status <> 'APPROVED' THEN
      RAISE EXCEPTION 'The exchange must be an approved one that takes back a unit from the commission''s invoice' USING ERRCODE = '23514';
    END IF;
  END IF;
  SELECT COALESCE(SUM(amount), 0) INTO taken FROM commission_adjustments WHERE commission_id = NEW.commission_id;
  IF taken + NEW.amount > com.amount THEN
    RAISE EXCEPTION 'The adjustments would take more than the commission is worth' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
