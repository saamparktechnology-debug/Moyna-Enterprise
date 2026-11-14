-- Chunk 14: a WhatsApp template for each purpose (general, invoice, receipt, reminder) and a list of customers who asked
-- not to get bulk messages.

ALTER TABLE "message_campaigns" ADD COLUMN "template_key" text NOT NULL DEFAULT 'GENERAL';
ALTER TABLE "message_campaigns" ADD CONSTRAINT "chk_message_campaigns_template_key" CHECK (template_key IN ('GENERAL', 'INVOICE', 'RECEIPT', 'REMINDER'));

-- One row for each customer who asked to stop getting bulk messages. Company-wide, like the customer itself.
CREATE TABLE "message_opt_outs" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "customer_id" uuid NOT NULL,
  "reason" text,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" integer NOT NULL DEFAULT 1,
  CONSTRAINT "message_opt_outs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "message_opt_outs_customer_id_fkey" FOREIGN KEY ("customer_id") REFERENCES "customers"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "chk_message_opt_outs_reason" CHECK (reason IS NULL OR btrim(reason) <> '')
);
CREATE UNIQUE INDEX "message_opt_outs_customer_id_key" ON "message_opt_outs" ("customer_id");
CREATE TRIGGER "message_opt_outs_row_version" BEFORE UPDATE ON "message_opt_outs" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
-- Taking a customer off the list removes the row; the audit log keeps the history.
GRANT DELETE ON "message_opt_outs" TO erp_app;
