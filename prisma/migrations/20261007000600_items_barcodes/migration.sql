-- Stage 4 migration 6 (module 4.1, item master and barcodes): item and barcode integrity, internal barcode numbering,
-- case-insensitive category names, and two company-wide stock checks that row-level security would otherwise hide.

-- The database accepts 1 to 32 characters; the API asks for at least 2.
ALTER TABLE "items" ADD CONSTRAINT "chk_items_item_code_format" CHECK (item_code ~ '^[A-Z0-9][A-Z0-9._-]{0,31}$');
ALTER TABLE "item_barcodes" ADD CONSTRAINT "chk_item_barcodes_format" CHECK (barcode ~ '^[!-~]{4,48}$');

-- A category name is unique among its siblings, ignoring case. Postgres treats NULL parents as different, so root
-- categories are folded onto one placeholder value.
CREATE UNIQUE INDEX "item_categories_sibling_name_key"
  ON "item_categories" (coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name));

-- Internal barcodes are EAN-13 numbers built from this sequence (prefix 20, ten digits, check digit). A sequence may
-- skip numbers after a rollback; barcodes only have to be unique.
CREATE SEQUENCE "item_barcode_seq" AS bigint MINVALUE 1 MAXVALUE 9999999999 NO CYCLE;
GRANT USAGE, SELECT ON SEQUENCE "item_barcode_seq" TO erp_app;

-- Stock tables are protected by row-level security, so a branch user cannot see another branch's rows. These two
-- checks need the whole company, so they run with the owner's rights (SECURITY DEFINER) and reveal only a yes/no
-- and a total.
CREATE FUNCTION item_has_stock_history(p_item_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM stock_ledger WHERE item_id = p_item_id)
      OR EXISTS (SELECT 1 FROM serial_units WHERE item_id = p_item_id)
      OR EXISTS (SELECT 1 FROM stock_balances WHERE item_id = p_item_id)
$$;

CREATE FUNCTION item_stock_on_hand(p_item_id uuid) RETURNS bigint
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT coalesce(sum(quantity), 0)::bigint FROM stock_balances WHERE item_id = p_item_id
$$;

REVOKE ALL ON FUNCTION item_has_stock_history(uuid), item_stock_on_hand(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION item_has_stock_history(uuid), item_stock_on_hand(uuid) TO erp_app;
