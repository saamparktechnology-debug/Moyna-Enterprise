-- Chunk 9: assembling a product from our own stock (module "Manufacturing"). Nothing is costed: the parts leave stock, the
-- finished product comes into stock, and a selling price is set. A part that is a serial-numbered unit (a battery, a motor)
-- becomes INSTALLED, so it can never be sold again.

ALTER TYPE "MovementType" ADD VALUE IF NOT EXISTS 'ASSEMBLY_USED';
ALTER TYPE "MovementType" ADD VALUE IF NOT EXISTS 'ASSEMBLY_MADE';
ALTER TYPE "SerialUnitState" ADD VALUE IF NOT EXISTS 'INSTALLED';

-- The price an item is sold at, set when it is assembled. Billing starts from it and the biller may change it.
ALTER TABLE "items" ADD COLUMN "selling_price" numeric(14,2);
ALTER TABLE "items" ADD CONSTRAINT "chk_items_selling_price" CHECK (selling_price IS NULL OR selling_price >= 0);

CREATE TABLE "assemblies" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "branch_id" uuid NOT NULL,
  "assembly_no" text NOT NULL,
  "finished_item_id" uuid NOT NULL,
  "qty" integer NOT NULL,
  "selling_price" numeric(14,2) NOT NULL,
  "note" text,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" integer NOT NULL DEFAULT 1,
  CONSTRAINT "assemblies_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assemblies_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assemblies_finished_item_id_fkey" FOREIGN KEY ("finished_item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "chk_assemblies_qty" CHECK (qty BETWEEN 1 AND 1000),
  CONSTRAINT "chk_assemblies_selling_price" CHECK (selling_price > 0),
  CONSTRAINT "chk_assemblies_note" CHECK (note IS NULL OR btrim(note) <> '')
);
CREATE UNIQUE INDEX "assemblies_branch_id_assembly_no_key" ON "assemblies" ("branch_id", "assembly_no");
CREATE INDEX "assemblies_finished_item_id_idx" ON "assemblies" ("finished_item_id");
CREATE INDEX "assemblies_created_at_idx" ON "assemblies" ("created_at");

-- What went into an assembly: one row for a part counted by quantity, one row for each serial-numbered unit.
CREATE TABLE "assembly_parts" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "branch_id" uuid NOT NULL,
  "assembly_id" uuid NOT NULL,
  "item_id" uuid NOT NULL,
  "qty" integer NOT NULL,
  "serial_unit_id" uuid,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" integer NOT NULL DEFAULT 1,
  CONSTRAINT "assembly_parts_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assembly_parts_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assembly_parts_assembly_id_fkey" FOREIGN KEY ("assembly_id") REFERENCES "assemblies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assembly_parts_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assembly_parts_serial_unit_id_fkey" FOREIGN KEY ("serial_unit_id") REFERENCES "serial_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "chk_assembly_parts_qty" CHECK (qty >= 1 AND (serial_unit_id IS NULL OR qty = 1))
);
CREATE INDEX "assembly_parts_assembly_id_idx" ON "assembly_parts" ("assembly_id");
CREATE INDEX "assembly_parts_item_id_idx" ON "assembly_parts" ("item_id");
CREATE UNIQUE INDEX "assembly_parts_serial_unit_id_key" ON "assembly_parts" ("serial_unit_id") WHERE serial_unit_id IS NOT NULL;

-- The serial-numbered units an assembly made.
CREATE TABLE "assembly_units" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "branch_id" uuid NOT NULL,
  "assembly_id" uuid NOT NULL,
  "serial_unit_id" uuid NOT NULL,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" integer NOT NULL DEFAULT 1,
  CONSTRAINT "assembly_units_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assembly_units_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assembly_units_assembly_id_fkey" FOREIGN KEY ("assembly_id") REFERENCES "assemblies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assembly_units_serial_unit_id_fkey" FOREIGN KEY ("serial_unit_id") REFERENCES "serial_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE
);
CREATE INDEX "assembly_units_assembly_id_idx" ON "assembly_units" ("assembly_id");
CREATE UNIQUE INDEX "assembly_units_serial_unit_id_key" ON "assembly_units" ("serial_unit_id");

-- An assembly is a record of what was done, like a ledger: it is never changed afterwards.
REVOKE UPDATE ON "assemblies", "assembly_parts", "assembly_units" FROM erp_app;

ALTER TABLE "assemblies" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "assemblies_branch_scope" ON "assemblies" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));
ALTER TABLE "assembly_parts" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "assembly_parts_branch_scope" ON "assembly_parts" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));
ALTER TABLE "assembly_units" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "assembly_units_branch_scope" ON "assembly_units" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));
