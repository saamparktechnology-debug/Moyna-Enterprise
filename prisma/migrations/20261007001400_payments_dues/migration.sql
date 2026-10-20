-- Stage 4 migration 14 (module 4.8, payments and dues): a payment can carry a reference (cheque, UPI or bank
-- transaction number), a note and a retry key; a payment is reversed by adding a reversal row, never by changing or
-- deleting the payment; payments, their allocations and their reversals are a ledger the database itself will not
-- let anyone edit; and the database refuses to apply more money to an invoice than it is owed, or to spread a payment
-- over more than its amount, even if two requests race.

ALTER TABLE "payments"
  ADD COLUMN "reference" text,
  ADD COLUMN "note" text,
  ADD COLUMN "idempotency_key" text;
ALTER TABLE "payments"
  ADD CONSTRAINT "chk_payments_reference" CHECK (reference IS NULL OR btrim(reference) <> ''),
  ADD CONSTRAINT "chk_payments_note" CHECK (note IS NULL OR btrim(note) <> ''),
  ADD CONSTRAINT "chk_payments_idempotency_key" CHECK (idempotency_key IS NULL OR char_length(idempotency_key) BETWEEN 8 AND 100);
-- Several payments may have no key (NULLs are not compared), but one key is used once per branch.
CREATE UNIQUE INDEX "payments_branch_id_idempotency_key_key" ON "payments" ("branch_id", "idempotency_key");
CREATE INDEX "payments_customer_id_paid_on_idx" ON "payments" ("customer_id", "paid_on");

CREATE TABLE "payment_reversals" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "branch_id" uuid NOT NULL,
  "payment_id" uuid NOT NULL,
  "reason" text NOT NULL,
  "reversed_on" date NOT NULL,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" integer NOT NULL DEFAULT 1,
  CONSTRAINT "payment_reversals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "payment_reversals_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "payment_reversals_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "payments"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "chk_payment_reversals_reason" CHECK (btrim(reason) <> '')
);
-- A payment is reversed once.
CREATE UNIQUE INDEX "payment_reversals_payment_id_key" ON "payment_reversals" ("payment_id");
CREATE INDEX "payment_reversals_branch_id_idx" ON "payment_reversals" ("branch_id");

CREATE TRIGGER "payment_reversals_row_version" BEFORE UPDATE ON "payment_reversals" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
ALTER TABLE "payment_reversals" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "payment_reversals_branch_scope" ON "payment_reversals" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));

-- Money received is a ledger: rows are added, never changed or removed. A mistake is undone with a reversal.
CREATE FUNCTION payments_ledger_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Payments, their allocations and their reversals are a ledger and cannot be changed or deleted' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER "payments_frozen" BEFORE UPDATE OR DELETE ON "payments" FOR EACH ROW EXECUTE FUNCTION payments_ledger_frozen();
CREATE TRIGGER "payment_allocations_frozen" BEFORE UPDATE OR DELETE ON "payment_allocations" FOR EACH ROW EXECUTE FUNCTION payments_ledger_frozen();
CREATE TRIGGER "payment_reversals_frozen" BEFORE UPDATE OR DELETE ON "payment_reversals" FOR EACH ROW EXECUTE FUNCTION payments_ledger_frozen();

-- Whatever the application does: an allocation joins a payment and an invoice of the same branch and customer, goes
-- only to an issued invoice, never comes from a reversed payment, never takes more than the payment holds, and never
-- takes the invoice above what it is owed after its approved credit notes. Both rows are locked first, so two
-- requests racing for the same invoice or payment are checked one after the other.
CREATE FUNCTION payment_allocations_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  pay record;
  inv record;
  held numeric;
  applied numeric;
  credited numeric;
BEGIN
  SELECT id, branch_id, customer_id, amount INTO pay FROM payments WHERE id = NEW.payment_id FOR UPDATE;
  SELECT id, branch_id, customer_id, status, total INTO inv FROM invoices WHERE id = NEW.invoice_id FOR UPDATE;
  IF pay.id IS NULL OR inv.id IS NULL THEN
    RAISE EXCEPTION 'The payment or the invoice does not exist' USING ERRCODE = '23503';
  END IF;
  IF pay.branch_id <> NEW.branch_id OR inv.branch_id <> NEW.branch_id THEN
    RAISE EXCEPTION 'A payment can only be applied to an invoice of the same branch' USING ERRCODE = '23514';
  END IF;
  IF pay.customer_id <> inv.customer_id THEN
    RAISE EXCEPTION 'A payment can only be applied to an invoice of the same customer' USING ERRCODE = '23514';
  END IF;
  IF inv.status <> 'ISSUED' THEN
    RAISE EXCEPTION 'A payment can only be applied to an issued invoice' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (SELECT 1 FROM payment_reversals WHERE payment_id = NEW.payment_id) THEN
    RAISE EXCEPTION 'A reversed payment cannot be applied to an invoice' USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO held FROM payment_allocations WHERE payment_id = NEW.payment_id;
  IF held + NEW.amount > pay.amount THEN
    RAISE EXCEPTION 'More of the payment is being applied than it holds' USING ERRCODE = '23514';
  END IF;

  SELECT COALESCE(SUM(a.amount), 0) INTO applied
  FROM payment_allocations a
  WHERE a.invoice_id = NEW.invoice_id
    AND NOT EXISTS (SELECT 1 FROM payment_reversals r WHERE r.payment_id = a.payment_id);
  SELECT COALESCE(SUM(amount), 0) INTO credited FROM credit_notes WHERE invoice_id = NEW.invoice_id AND status = 'APPROVED';
  IF applied + NEW.amount > inv.total - credited THEN
    RAISE EXCEPTION 'More is being paid against the invoice than it is owed' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "payment_allocations_check" BEFORE INSERT ON "payment_allocations" FOR EACH ROW EXECUTE FUNCTION payment_allocations_check();

-- A reversal belongs to the branch of the payment it undoes.
CREATE FUNCTION payment_reversals_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  pay_branch uuid;
BEGIN
  SELECT branch_id INTO pay_branch FROM payments WHERE id = NEW.payment_id;
  IF pay_branch IS NULL OR pay_branch <> NEW.branch_id THEN
    RAISE EXCEPTION 'A reversal must be in the branch of the payment it undoes' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "payment_reversals_check" BEFORE INSERT ON "payment_reversals" FOR EACH ROW EXECUTE FUNCTION payment_reversals_check();
