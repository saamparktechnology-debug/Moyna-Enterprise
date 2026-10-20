-- Stage 4 migration 9 (module 4.4, purchasing and receiving): purchase returns, supplier payment references, delivery
-- note details, one line per item on a purchase order, unique GSTINs, and deleting the lines of a draft order.

ALTER TYPE "DocumentType" ADD VALUE 'PURCHASE_RETURN';

ALTER TABLE "supplier_payments" ADD COLUMN "reference" TEXT;
ALTER TABLE "supplier_payments" ADD CONSTRAINT "chk_supplier_payments_reference_not_blank" CHECK (reference IS NULL OR char_length(btrim(reference)) >= 1);
ALTER TABLE "goods_receipts" ADD COLUMN "delivery_note_no" TEXT;
ALTER TABLE "goods_receipts" ADD COLUMN "note" TEXT;

CREATE UNIQUE INDEX "suppliers_gstin_key" ON "suppliers"("gstin");
CREATE UNIQUE INDEX "po_lines_po_id_item_id_key" ON "po_lines"("po_id", "item_id");

CREATE TABLE "purchase_returns" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "return_no" TEXT NOT NULL,
    "supplier_id" UUID NOT NULL,
    "po_id" UUID,
    "discrepancy_id" UUID,
    "reason" TEXT NOT NULL,
    "returned_on" DATE NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "purchase_returns_pkey" PRIMARY KEY ("id")
);
CREATE TABLE "purchase_return_lines" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "return_id" UUID NOT NULL,
    "po_line_id" UUID,
    "item_id" UUID NOT NULL,
    "serial_unit_id" UUID,
    "qty" INTEGER NOT NULL,
    "unit_cost" DECIMAL(14,2) NOT NULL,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "purchase_return_lines_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "purchase_returns_branch_id_return_no_key" ON "purchase_returns"("branch_id", "return_no");
CREATE INDEX "purchase_returns_supplier_id_idx" ON "purchase_returns"("supplier_id");
CREATE INDEX "purchase_returns_po_id_idx" ON "purchase_returns"("po_id");
CREATE INDEX "purchase_returns_discrepancy_id_idx" ON "purchase_returns"("discrepancy_id");
CREATE INDEX "purchase_return_lines_branch_id_idx" ON "purchase_return_lines"("branch_id");
CREATE INDEX "purchase_return_lines_return_id_idx" ON "purchase_return_lines"("return_id");
CREATE INDEX "purchase_return_lines_po_line_id_idx" ON "purchase_return_lines"("po_line_id");
CREATE INDEX "purchase_return_lines_item_id_idx" ON "purchase_return_lines"("item_id");
CREATE INDEX "purchase_return_lines_serial_unit_id_idx" ON "purchase_return_lines"("serial_unit_id");

ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_supplier_id_fkey" FOREIGN KEY ("supplier_id") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_po_id_fkey" FOREIGN KEY ("po_id") REFERENCES "purchase_orders"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchase_returns" ADD CONSTRAINT "purchase_returns_discrepancy_id_fkey" FOREIGN KEY ("discrepancy_id") REFERENCES "discrepancies"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "purchase_return_lines_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "purchase_return_lines_return_id_fkey" FOREIGN KEY ("return_id") REFERENCES "purchase_returns"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "purchase_return_lines_po_line_id_fkey" FOREIGN KEY ("po_line_id") REFERENCES "po_lines"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "purchase_return_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "purchase_return_lines_serial_unit_id_fkey" FOREIGN KEY ("serial_unit_id") REFERENCES "serial_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "purchase_returns" ADD CONSTRAINT "chk_purchase_returns_reason_given" CHECK (char_length(btrim(reason)) >= 3);
ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "chk_purchase_return_lines_qty_positive" CHECK (qty > 0);
ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "chk_purchase_return_lines_cost_non_negative" CHECK (unit_cost >= 0);
ALTER TABLE "purchase_return_lines" ADD CONSTRAINT "chk_purchase_return_lines_serial_is_one_piece" CHECK (serial_unit_id IS NULL OR qty = 1);

CREATE TRIGGER "purchase_returns_row_version" BEFORE UPDATE ON "purchase_returns" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
CREATE TRIGGER "purchase_return_lines_row_version" BEFORE UPDATE ON "purchase_return_lines" FOR EACH ROW EXECUTE FUNCTION bump_row_version();

-- A return is a record of something that happened, so the application can add it but never change it.
ALTER TABLE "purchase_returns" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "purchase_returns_branch_scope" ON "purchase_returns" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));
ALTER TABLE "purchase_return_lines" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "purchase_return_lines_branch_scope" ON "purchase_return_lines" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));
REVOKE UPDATE ON "purchase_returns", "purchase_return_lines" FROM erp_app;

-- The lines of a purchase order may be removed while it is a draft, and never afterwards.
GRANT DELETE ON "po_lines" TO erp_app;
CREATE FUNCTION po_lines_only_delete_draft() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM purchase_orders WHERE id = OLD.po_id AND status <> 'DRAFT') THEN
    RAISE EXCEPTION 'Only the lines of a draft purchase order can be deleted' USING ERRCODE = 'check_violation';
  END IF;
  RETURN OLD;
END $$;
CREATE TRIGGER "po_lines_only_delete_draft" BEFORE DELETE ON "po_lines" FOR EACH ROW EXECUTE FUNCTION po_lines_only_delete_draft();

-- A supplier with orders still open in any branch cannot be deactivated. Row-level security hides other branches'
-- orders from a branch user, so this yes/no check runs with the owner's rights.
CREATE FUNCTION supplier_has_open_orders(p_supplier_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM purchase_orders WHERE supplier_id = p_supplier_id AND status IN ('DRAFT', 'APPROVED', 'PARTIALLY_RECEIVED'))
$$;
REVOKE ALL ON FUNCTION supplier_has_open_orders(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION supplier_has_open_orders(uuid) TO erp_app;
