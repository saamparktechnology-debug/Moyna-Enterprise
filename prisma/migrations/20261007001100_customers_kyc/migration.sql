-- Stage 4 migration 11 (module 4.6, customers and KYC): customer integrity, file details and review details on KYC
-- documents, a masked document number (the full number is never stored), and rules that keep decided documents
-- unchanged so the history cannot be rewritten.

ALTER TABLE "customers" ADD CONSTRAINT "chk_customers_phone_format" CHECK (phone ~ '^[6-9][0-9]{9}$');
ALTER TABLE "customers" ADD CONSTRAINT "chk_customers_name_not_blank" CHECK (btrim(name) <> '');
CREATE UNIQUE INDEX "customers_phone_key" ON "customers" (phone);
CREATE UNIQUE INDEX "customers_gstin_key" ON "customers" (gstin) WHERE gstin IS NOT NULL;

ALTER TABLE "kyc_documents"
  ADD COLUMN "file_name" text NOT NULL DEFAULT 'document',
  ADD COLUMN "mime_type" text NOT NULL DEFAULT 'application/pdf',
  ADD COLUMN "size_bytes" integer NOT NULL DEFAULT 1,
  ADD COLUMN "doc_number_masked" text,
  ADD COLUMN "reviewed_by" uuid,
  ADD COLUMN "reviewed_at" timestamptz,
  ADD COLUMN "rejection_reason" text;
ALTER TABLE "kyc_documents"
  ALTER COLUMN "file_name" DROP DEFAULT,
  ALTER COLUMN "mime_type" DROP DEFAULT,
  ALTER COLUMN "size_bytes" DROP DEFAULT;

ALTER TABLE "kyc_documents"
  ADD CONSTRAINT "kyc_documents_reviewed_by_fkey" FOREIGN KEY ("reviewed_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "kyc_documents" ADD CONSTRAINT "chk_kyc_documents_mime" CHECK (mime_type IN ('application/pdf', 'image/jpeg', 'image/png'));
ALTER TABLE "kyc_documents" ADD CONSTRAINT "chk_kyc_documents_size" CHECK (size_bytes BETWEEN 1 AND 5242880);
ALTER TABLE "kyc_documents" ADD CONSTRAINT "chk_kyc_documents_file_name" CHECK (btrim(file_name) <> '' AND char_length(file_name) <= 160);
-- Only the last four characters of a document number may be kept; at least one character is always hidden.
ALTER TABLE "kyc_documents" ADD CONSTRAINT "chk_kyc_documents_masked" CHECK (doc_number_masked IS NULL OR doc_number_masked ~ '^X+[A-Z0-9]{1,4}$');
-- A document is never "not submitted"; a decided document says who decided and when, and a rejection says why.
ALTER TABLE "kyc_documents" ADD CONSTRAINT "chk_kyc_documents_status" CHECK (status <> 'NOT_SUBMITTED');
ALTER TABLE "kyc_documents" ADD CONSTRAINT "chk_kyc_documents_review" CHECK (
  (status = 'PENDING' AND reviewed_by IS NULL AND reviewed_at IS NULL AND rejection_reason IS NULL)
  OR (status = 'VERIFIED' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND rejection_reason IS NULL)
  OR (status = 'REJECTED' AND reviewed_by IS NOT NULL AND reviewed_at IS NOT NULL AND rejection_reason IS NOT NULL AND btrim(rejection_reason) <> '')
);
CREATE INDEX "kyc_documents_customer_type_created_idx" ON "kyc_documents" (customer_id, doc_type, created_at DESC);

-- The file and what it says never change after upload, and a decision is final: a rejected document is replaced by a
-- new upload, which keeps the history of every attempt.
CREATE FUNCTION kyc_documents_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id
     OR NEW.doc_type IS DISTINCT FROM OLD.doc_type
     OR NEW.object_key IS DISTINCT FROM OLD.object_key
     OR NEW.file_name IS DISTINCT FROM OLD.file_name
     OR NEW.mime_type IS DISTINCT FROM OLD.mime_type
     OR NEW.size_bytes IS DISTINCT FROM OLD.size_bytes
     OR NEW.doc_number_masked IS DISTINCT FROM OLD.doc_number_masked THEN
    RAISE EXCEPTION 'A KYC document cannot be changed after it was uploaded' USING ERRCODE = '23514';
  END IF;
  IF OLD.status <> 'PENDING' AND NEW.status IS DISTINCT FROM OLD.status THEN
    RAISE EXCEPTION 'A decided KYC document cannot be decided again' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "kyc_documents_guard" BEFORE UPDATE ON "kyc_documents" FOR EACH ROW EXECUTE FUNCTION kyc_documents_guard();

-- History is kept: the application may add and decide documents but never delete them.
REVOKE DELETE ON "kyc_documents" FROM erp_app;
