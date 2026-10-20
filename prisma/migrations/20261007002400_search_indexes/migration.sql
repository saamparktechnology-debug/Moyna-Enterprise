-- Module 5.3 (Search): trigram indexes so "contains" searches on names, codes, serial numbers and invoice numbers stay
-- fast as the data grows. pg_trgm ships with PostgreSQL; the migration user creates it once.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX "customers_name_trgm_idx" ON "customers" USING gin ("name" gin_trgm_ops);
CREATE INDEX "customers_phone_trgm_idx" ON "customers" USING gin ("phone" gin_trgm_ops);
CREATE INDEX "items_item_code_trgm_idx" ON "items" USING gin ("item_code" gin_trgm_ops);
CREATE INDEX "items_name_trgm_idx" ON "items" USING gin ("name" gin_trgm_ops);
CREATE INDEX "serial_units_serial_no_trgm_idx" ON "serial_units" USING gin ("serial_no" gin_trgm_ops);
CREATE INDEX "invoices_invoice_no_trgm_idx" ON "invoices" USING gin ("invoice_no" gin_trgm_ops);
