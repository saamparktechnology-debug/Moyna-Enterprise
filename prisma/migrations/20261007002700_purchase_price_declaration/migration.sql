-- Chunk 1: two purchase prices on an item (the real one for the Super Admin, a shown one for everyone else), the cost
-- each invoice line was sold at (kept as it was on the day, so later price changes never rewrite old profit), and the
-- "Declaration form" KYC document type.

ALTER TABLE "items" ADD COLUMN "actual_purchase_price" numeric(14,2);
ALTER TABLE "items" ADD COLUMN "display_purchase_price" numeric(14,2);
ALTER TABLE "items" ADD CONSTRAINT "chk_items_purchase_prices" CHECK (
  (actual_purchase_price IS NULL OR actual_purchase_price >= 0)
  AND (display_purchase_price IS NULL OR display_purchase_price >= 0)
  AND (display_purchase_price IS NULL OR actual_purchase_price IS NOT NULL)
);

ALTER TABLE "invoice_lines" ADD COLUMN "unit_cost_actual" numeric(14,2);
ALTER TABLE "invoice_lines" ADD COLUMN "unit_cost_display" numeric(14,2);
ALTER TABLE "invoice_lines" ADD CONSTRAINT "chk_invoice_lines_unit_costs" CHECK (
  (unit_cost_actual IS NULL OR unit_cost_actual >= 0)
  AND (unit_cost_display IS NULL OR unit_cost_display >= 0)
);

INSERT INTO "kyc_document_types" ("code", "name") VALUES ('DECLARATION', 'Declaration form')
ON CONFLICT ("code") DO NOTHING;
