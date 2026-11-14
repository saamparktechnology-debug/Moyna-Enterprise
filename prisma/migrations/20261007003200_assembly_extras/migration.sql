-- Chunk 11: an assembly keeps the cost of its parts as they were (from the items' purchase prices), and can be reversed.
ALTER TYPE "MovementType" ADD VALUE IF NOT EXISTS 'ASSEMBLY_RETURNED';
ALTER TYPE "MovementType" ADD VALUE IF NOT EXISTS 'ASSEMBLY_UNMADE';

-- The cost of the parts: the real one (shown to a Super Admin) and the one shown to everyone else, as on invoice lines.
-- Empty when a part had no purchase price. `previous_selling_price` is what the product was sold at before this assembly.
ALTER TABLE "assemblies"
  ADD COLUMN "cost_actual" numeric(14,2),
  ADD COLUMN "cost_display" numeric(14,2),
  ADD COLUMN "previous_selling_price" numeric(14,2);
ALTER TABLE "assemblies" ADD CONSTRAINT "chk_assemblies_costs" CHECK (
  (cost_actual IS NULL OR cost_actual >= 0) AND (cost_display IS NULL OR cost_display >= 0)
  AND (previous_selling_price IS NULL OR previous_selling_price >= 0)
);

-- An assembly that was taken apart again. One per assembly; never changed afterwards.
CREATE TABLE "assembly_reversals" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "branch_id" uuid NOT NULL,
  "assembly_id" uuid NOT NULL,
  "reason" text NOT NULL,
  "reversed_by" uuid,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" integer NOT NULL DEFAULT 1,
  CONSTRAINT "assembly_reversals_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "assembly_reversals_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "assembly_reversals_assembly_id_fkey" FOREIGN KEY ("assembly_id") REFERENCES "assemblies"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "chk_assembly_reversals_reason" CHECK (btrim(reason) <> '')
);
CREATE UNIQUE INDEX "assembly_reversals_assembly_id_key" ON "assembly_reversals" ("assembly_id");
REVOKE UPDATE ON "assembly_reversals" FROM erp_app;
ALTER TABLE "assembly_reversals" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "assembly_reversals_branch_scope" ON "assembly_reversals" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));
