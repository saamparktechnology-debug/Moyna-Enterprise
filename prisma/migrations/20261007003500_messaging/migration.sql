-- Chunk 13: messages to customers by WhatsApp and email: invoices and receipts sent as documents, and bulk messages. A campaign
-- is one send (one invoice, or one bulk message to many people); each person it goes to is a delivery with its own result.

CREATE TABLE "message_campaigns" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "branch_id" uuid NOT NULL,
  "kind" text NOT NULL,
  "channel" text NOT NULL,
  "subject" text,
  "body" text NOT NULL,
  "audience" text NOT NULL,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" integer NOT NULL DEFAULT 1,
  CONSTRAINT "message_campaigns_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "message_campaigns_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "chk_message_campaigns_kind" CHECK (kind IN ('BULK', 'INVOICE', 'RECEIPT')),
  CONSTRAINT "chk_message_campaigns_channel" CHECK (channel IN ('WHATSAPP', 'EMAIL')),
  CONSTRAINT "chk_message_campaigns_body" CHECK (btrim(body) <> '')
);
CREATE INDEX "message_campaigns_branch_id_created_at_idx" ON "message_campaigns" ("branch_id", "created_at");

CREATE TABLE "message_deliveries" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "branch_id" uuid NOT NULL,
  "campaign_id" uuid NOT NULL,
  "customer_id" uuid,
  "recipient_name" text NOT NULL,
  "to_address" text NOT NULL,
  "text" text NOT NULL,
  "document_kind" text,
  "document_id" uuid,
  "status" text NOT NULL DEFAULT 'PENDING',
  "via" text,
  "provider_message_id" text,
  "error" text,
  "attempts" integer NOT NULL DEFAULT 0,
  "sent_at" timestamp(3),
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" integer NOT NULL DEFAULT 1,
  CONSTRAINT "message_deliveries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "message_deliveries_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "message_deliveries_campaign_id_fkey" FOREIGN KEY ("campaign_id") REFERENCES "message_campaigns"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "message_deliveries_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "chk_message_deliveries_status" CHECK (status IN ('PENDING', 'SENT', 'FAILED')),
  CONSTRAINT "chk_message_deliveries_via" CHECK (via IS NULL OR via IN ('TEXT', 'DOCUMENT', 'TEMPLATE', 'EMAIL')),
  CONSTRAINT "chk_message_deliveries_document" CHECK (
    (document_kind IS NULL AND document_id IS NULL) OR (document_kind IN ('INVOICE', 'RECEIPT') AND document_id IS NOT NULL)
  ),
  CONSTRAINT "chk_message_deliveries_sent" CHECK (status <> 'SENT' OR sent_at IS NOT NULL),
  CONSTRAINT "chk_message_deliveries_attempts" CHECK (attempts >= 0)
);
CREATE INDEX "message_deliveries_campaign_id_status_idx" ON "message_deliveries" ("campaign_id", "status");
CREATE INDEX "message_deliveries_customer_id_idx" ON "message_deliveries" ("customer_id");
CREATE INDEX "message_deliveries_document_idx" ON "message_deliveries" ("document_kind", "document_id");

CREATE TRIGGER "message_campaigns_row_version" BEFORE UPDATE ON "message_campaigns" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "message_deliveries_row_version" BEFORE UPDATE ON "message_deliveries" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
-- A campaign never changes after it is made; only a delivery's result is written.
REVOKE UPDATE ON "message_campaigns" FROM erp_app;

ALTER TABLE "message_campaigns" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "message_campaigns_branch_scope" ON "message_campaigns" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));
ALTER TABLE "message_deliveries" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "message_deliveries_branch_scope" ON "message_deliveries" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));
