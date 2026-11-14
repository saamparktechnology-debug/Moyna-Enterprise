-- Chunk 17: what is promised on an invoice that is not paid yet, and who stands guarantor for it.

-- Each promise is a row, never changed: the latest one is the "next promised date", the earlier ones are the history.
CREATE TABLE "due_promises" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "branch_id" uuid NOT NULL,
  "invoice_id" uuid NOT NULL,
  "promised_date" date NOT NULL,
  "note" text,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" integer NOT NULL DEFAULT 1,
  CONSTRAINT "due_promises_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "due_promises_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "due_promises_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "chk_due_promises_note" CHECK (note IS NULL OR char_length(btrim(note)) BETWEEN 1 AND 200)
);
CREATE INDEX "due_promises_invoice_id_created_at_idx" ON "due_promises" ("invoice_id", "created_at");
CREATE INDEX "due_promises_branch_id_idx" ON "due_promises" ("branch_id");
CREATE TRIGGER "due_promises_row_version" BEFORE UPDATE ON "due_promises" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
REVOKE UPDATE ON "due_promises" FROM erp_app;
ALTER TABLE "due_promises" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "due_promises_branch_scope" ON "due_promises" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));

-- The person who stands guarantor for what an invoice leaves unpaid: contact details, and optionally one KYC file.
CREATE TABLE "invoice_guarantors" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "branch_id" uuid NOT NULL,
  "invoice_id" uuid NOT NULL,
  "name" text NOT NULL,
  "phone" text NOT NULL,
  "address" text,
  "relation" text,
  "kyc_object_key" text,
  "kyc_file_name" text,
  "kyc_mime_type" text,
  "kyc_size_bytes" integer,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" integer NOT NULL DEFAULT 1,
  CONSTRAINT "invoice_guarantors_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "invoice_guarantors_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "invoice_guarantors_invoice_id_fkey" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "chk_invoice_guarantors_name" CHECK (char_length(btrim(name)) BETWEEN 2 AND 120),
  CONSTRAINT "chk_invoice_guarantors_phone" CHECK (char_length(btrim(phone)) BETWEEN 7 AND 20),
  CONSTRAINT "chk_invoice_guarantors_address" CHECK (address IS NULL OR char_length(btrim(address)) BETWEEN 1 AND 300),
  CONSTRAINT "chk_invoice_guarantors_relation" CHECK (relation IS NULL OR char_length(btrim(relation)) BETWEEN 1 AND 60),
  CONSTRAINT "chk_invoice_guarantors_kyc" CHECK (
    (kyc_object_key IS NULL) = (kyc_file_name IS NULL)
    AND (kyc_object_key IS NULL) = (kyc_mime_type IS NULL)
    AND (kyc_object_key IS NULL) = (kyc_size_bytes IS NULL)
    AND (kyc_size_bytes IS NULL OR kyc_size_bytes > 0)
    AND (kyc_mime_type IS NULL OR kyc_mime_type IN ('application/pdf', 'image/jpeg', 'image/png'))
  )
);
-- One guarantor for each invoice; a change replaces their details.
CREATE UNIQUE INDEX "invoice_guarantors_invoice_id_key" ON "invoice_guarantors" ("invoice_id");
CREATE UNIQUE INDEX "invoice_guarantors_kyc_object_key_key" ON "invoice_guarantors" ("kyc_object_key");
CREATE INDEX "invoice_guarantors_branch_id_idx" ON "invoice_guarantors" ("branch_id");
CREATE TRIGGER "invoice_guarantors_row_version" BEFORE UPDATE ON "invoice_guarantors" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
GRANT DELETE ON "invoice_guarantors" TO erp_app;
ALTER TABLE "invoice_guarantors" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "invoice_guarantors_branch_scope" ON "invoice_guarantors" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));
