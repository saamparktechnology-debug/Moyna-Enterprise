-- Chunk 2: a broker has an address, one photo and any number of documents; commission is agreed with the broker at the time
-- of the sale (a fixed amount, or a gift with a name, a value and a photo) instead of coming only from a standing rule.
-- A gift is not stock: it never touches the stock ledger. Existing rows are not changed.

ALTER TABLE "brokers" ADD COLUMN "address" text;
ALTER TABLE "brokers" ADD CONSTRAINT "chk_brokers_address" CHECK (address IS NULL OR char_length(btrim(address)) BETWEEN 1 AND 500);

CREATE TABLE "broker_files" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "broker_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "label" text,
  "object_key" text NOT NULL,
  "file_name" text NOT NULL,
  "mime_type" text NOT NULL,
  "size_bytes" integer NOT NULL,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" integer NOT NULL DEFAULT 1,
  CONSTRAINT "broker_files_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "broker_files_broker_id_fkey" FOREIGN KEY ("broker_id") REFERENCES "brokers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "chk_broker_files_kind" CHECK (kind IN ('PHOTO', 'DOCUMENT')),
  CONSTRAINT "chk_broker_files_label" CHECK (label IS NULL OR char_length(btrim(label)) BETWEEN 1 AND 80),
  CONSTRAINT "chk_broker_files_size" CHECK (size_bytes > 0),
  CONSTRAINT "chk_broker_files_photo_is_image" CHECK (kind <> 'PHOTO' OR mime_type IN ('image/jpeg', 'image/png'))
);
CREATE UNIQUE INDEX "broker_files_object_key_key" ON "broker_files" ("object_key");
CREATE INDEX "broker_files_broker_id_idx" ON "broker_files" ("broker_id");
-- A broker has at most one photo; a new one replaces it.
CREATE UNIQUE INDEX "broker_files_one_photo_key" ON "broker_files" ("broker_id") WHERE kind = 'PHOTO';
CREATE TRIGGER "broker_files_row_version" BEFORE UPDATE ON "broker_files" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
-- Files can be taken off a broker, as barcodes can be taken off an item.
GRANT DELETE ON "broker_files" TO erp_app;

-- What was agreed for the sale, written on the draft invoice and frozen with it by the existing invoice guard.
-- NULL means nothing was agreed on the invoice (older drafts), so the broker's standing rule, if any, still applies.
ALTER TABLE "invoices"
  ADD COLUMN "commission_type" text,
  ADD COLUMN "commission_amount" numeric(14,2),
  ADD COLUMN "gift_name" text,
  ADD COLUMN "gift_photo_key" text,
  ADD COLUMN "gift_photo_file_name" text,
  ADD COLUMN "gift_photo_mime" text,
  ADD COLUMN "gift_photo_size" integer;
ALTER TABLE "invoices" ADD CONSTRAINT "chk_invoices_commission_terms" CHECK (
  (commission_type IS NULL OR commission_type IN ('NONE', 'FIXED', 'GIFT'))
  AND (commission_type IS NULL OR broker_id IS NOT NULL)
  AND ((COALESCE(commission_type, '') IN ('FIXED', 'GIFT')) = (commission_amount IS NOT NULL))
  AND (commission_amount IS NULL OR commission_amount > 0)
  AND ((COALESCE(commission_type, '') = 'GIFT') = (gift_name IS NOT NULL))
  AND (gift_name IS NULL OR char_length(btrim(gift_name)) BETWEEN 1 AND 120)
  AND (gift_photo_key IS NULL OR commission_type = 'GIFT')
  AND ((gift_photo_key IS NULL) = (gift_photo_file_name IS NULL))
  AND ((gift_photo_key IS NULL) = (gift_photo_mime IS NULL))
  AND ((gift_photo_key IS NULL) = (gift_photo_size IS NULL))
);

-- A commission is either worked out from the broker's rule, or agreed on the invoice as a fixed amount or a gift.
ALTER TABLE "commissions" ALTER COLUMN "rule_id" DROP NOT NULL;
ALTER TABLE "commissions"
  ADD COLUMN "kind" text NOT NULL DEFAULT 'RULE',
  ADD COLUMN "gift_name" text,
  ADD COLUMN "gift_photo_key" text,
  ADD COLUMN "gift_photo_file_name" text,
  ADD COLUMN "gift_photo_mime" text,
  ADD COLUMN "gift_photo_size" integer;
ALTER TABLE "commissions" ADD CONSTRAINT "chk_commissions_kind" CHECK (
  kind IN ('RULE', 'FIXED', 'GIFT')
  AND ((kind = 'RULE') = (rule_id IS NOT NULL))
  AND ((kind = 'GIFT') = (gift_name IS NOT NULL))
  AND (gift_photo_key IS NULL OR kind = 'GIFT')
  AND ((gift_photo_key IS NULL) = (gift_photo_file_name IS NULL))
  AND ((gift_photo_key IS NULL) = (gift_photo_mime IS NULL))
  AND ((gift_photo_key IS NULL) = (gift_photo_size IS NULL))
);

-- The rule check applies only to a commission that comes from a rule.
CREATE OR REPLACE FUNCTION commissions_insert_check() RETURNS trigger LANGUAGE plpgsql AS $$
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
  IF NEW.rule_id IS NOT NULL THEN
    SELECT broker_id INTO rule_broker FROM commission_rules WHERE id = NEW.rule_id;
    IF rule_broker IS DISTINCT FROM NEW.broker_id THEN
      RAISE EXCEPTION 'The rule belongs to another broker' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
