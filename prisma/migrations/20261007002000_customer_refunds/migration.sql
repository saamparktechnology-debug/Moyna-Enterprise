-- Stage 4 migration 20 (pending items from module 4.8): refunding a customer's credit. A refund is money paid out to a customer
-- from the credit held for them (unapplied payments and what they overpaid on invoices), in a payment mode, with its own number
-- (a new REFUND series), a reason and a retry key. A refund is a record of a payout: it is never changed or removed. The amount
-- is checked against the customer's credit under the customer's lock in the application; the database makes sure a refund is
-- for more than nothing, in a mode people may choose, and cannot be altered afterwards.

ALTER TYPE "DocumentType" ADD VALUE IF NOT EXISTS 'REFUND';

CREATE TABLE "customer_refunds" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "branch_id" uuid NOT NULL,
  "customer_id" uuid NOT NULL,
  "refund_no" text NOT NULL,
  "amount" numeric(14,2) NOT NULL,
  "mode" text NOT NULL,
  "paid_on" date NOT NULL,
  "reference" text,
  "reason" text NOT NULL,
  "idempotency_key" text NOT NULL,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" integer NOT NULL DEFAULT 1,
  CONSTRAINT "customer_refunds_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "customer_refunds_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "customer_refunds_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "customer_refunds_mode_fkey" FOREIGN KEY ("mode") REFERENCES "payment_modes"("code") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "chk_customer_refunds_amount" CHECK (amount > 0),
  CONSTRAINT "chk_customer_refunds_mode" CHECK (mode <> 'EXCHANGE'),
  CONSTRAINT "chk_customer_refunds_reason" CHECK (btrim(reason) <> ''),
  CONSTRAINT "chk_customer_refunds_reference" CHECK (reference IS NULL OR btrim(reference) <> ''),
  CONSTRAINT "chk_customer_refunds_key" CHECK (btrim(idempotency_key) <> '')
);
CREATE UNIQUE INDEX "customer_refunds_branch_id_refund_no_key" ON "customer_refunds" ("branch_id", "refund_no");
CREATE UNIQUE INDEX "customer_refunds_branch_id_idempotency_key_key" ON "customer_refunds" ("branch_id", "idempotency_key");
CREATE INDEX "customer_refunds_customer_id_paid_on_idx" ON "customer_refunds" ("customer_id", "paid_on");
CREATE INDEX "customer_refunds_mode_idx" ON "customer_refunds" ("mode");
CREATE TRIGGER "customer_refunds_row_version" BEFORE UPDATE ON "customer_refunds" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
ALTER TABLE "customer_refunds" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "customer_refunds_branch_scope" ON "customer_refunds" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));

CREATE FUNCTION customer_refunds_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'A refund is a record of money paid out and cannot be changed or deleted' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER "customer_refunds_frozen" BEFORE UPDATE OR DELETE ON "customer_refunds" FOR EACH ROW EXECUTE FUNCTION customer_refunds_frozen();
