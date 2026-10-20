-- Stage 4 migration 7 (module 4.2, inventory and stock ledger): stock adjustment requests, and a check that stock balances
-- equal the sum of the ledger. A request records what an approval will do; nothing moves until it is approved.

CREATE TYPE "StockAdjustmentKind" AS ENUM ('IN', 'OUT', 'WRITE_OFF', 'STATE_CHANGE');

CREATE TABLE "stock_adjustments" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "branch_id" UUID NOT NULL,
    "item_id" UUID NOT NULL,
    "serial_unit_id" UUID,
    "serial_no" TEXT,
    "chassis_no" TEXT,
    "kind" "StockAdjustmentKind" NOT NULL,
    "state" "StockState" NOT NULL,
    "to_state" "StockState",
    "qty" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "ApprovalStatus" NOT NULL DEFAULT 'PENDING',
    "requested_by" UUID NOT NULL,
    "approved_by" UUID,
    "decided_at" TIMESTAMP(3),
    "decision_note" TEXT,
    "created_by" UUID,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,
    CONSTRAINT "stock_adjustments_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "stock_adjustments_branch_id_status_idx" ON "stock_adjustments"("branch_id", "status");
CREATE INDEX "stock_adjustments_item_id_idx" ON "stock_adjustments"("item_id");
CREATE INDEX "stock_adjustments_serial_unit_id_idx" ON "stock_adjustments"("serial_unit_id");
CREATE INDEX "stock_adjustments_requested_by_idx" ON "stock_adjustments"("requested_by");
CREATE INDEX "stock_adjustments_approved_by_idx" ON "stock_adjustments"("approved_by");

ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_serial_unit_id_fkey" FOREIGN KEY ("serial_unit_id") REFERENCES "serial_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "stock_adjustments_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "stock_adjustments" ADD CONSTRAINT "chk_stock_adjustments_qty_positive" CHECK (qty > 0);
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "chk_stock_adjustments_reason_given" CHECK (char_length(btrim(reason)) >= 3);
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "chk_stock_adjustments_to_state_only_for_state_change" CHECK ((kind = 'STATE_CHANGE') = (to_state IS NOT NULL));
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "chk_stock_adjustments_state_actually_changes" CHECK (to_state IS NULL OR to_state <> state);
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "chk_stock_adjustments_new_serial_only_when_adding" CHECK (serial_no IS NULL OR kind = 'IN');
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "chk_stock_adjustments_existing_serial_not_when_adding" CHECK (serial_unit_id IS NULL OR kind <> 'IN');
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "chk_stock_adjustments_serial_quantity_is_one" CHECK ((serial_no IS NULL AND serial_unit_id IS NULL) OR qty = 1);
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "chk_stock_adjustments_chassis_needs_serial" CHECK (chassis_no IS NULL OR serial_no IS NOT NULL);
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "chk_stock_adjustments_decision_recorded" CHECK (status = 'PENDING' OR decided_at IS NOT NULL);
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "chk_stock_adjustments_decider_recorded" CHECK (status IN ('PENDING', 'CANCELLED') OR approved_by IS NOT NULL);

CREATE TRIGGER "stock_adjustments_row_version" BEFORE UPDATE ON "stock_adjustments" FOR EACH ROW EXECUTE FUNCTION bump_row_version();

ALTER TABLE "stock_adjustments" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "stock_adjustments_branch_scope" ON "stock_adjustments" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));
GRANT SELECT, INSERT, UPDATE ON "stock_adjustments" TO erp_app;

-- Rows where a balance differs from the sum of its ledger entries. It must always return nothing. For operations and tests;
-- the application role cannot call it.
CREATE FUNCTION stock_balance_drift() RETURNS TABLE (branch_id uuid, item_id uuid, state "StockState", balance bigint, ledger_sum bigint)
LANGUAGE sql STABLE AS $$
  SELECT coalesce(b.branch_id, l.branch_id), coalesce(b.item_id, l.item_id), coalesce(b.state, l.state),
         coalesce(b.quantity, 0)::bigint, coalesce(l.total, 0)::bigint
  FROM stock_balances b
  FULL JOIN (SELECT sl.branch_id, sl.item_id, sl.state, sum(sl.qty_delta) AS total FROM stock_ledger sl GROUP BY 1, 2, 3) l
    ON l.branch_id = b.branch_id AND l.item_id = b.item_id AND l.state = b.state
  WHERE coalesce(b.quantity, 0) <> coalesce(l.total, 0)
$$;
REVOKE ALL ON FUNCTION stock_balance_drift() FROM PUBLIC;

-- Serial and chassis numbers are unique across the company, but row-level security hides other branches' units and
-- requests from a branch user. This yes/no check runs with the owner's rights so a duplicate is refused when it is asked
-- for, not only when it is approved.
CREATE FUNCTION serial_number_in_use(p_serial_no text, p_chassis_no text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM serial_units WHERE serial_no = p_serial_no OR (p_chassis_no IS NOT NULL AND chassis_no = p_chassis_no))
      OR EXISTS (SELECT 1 FROM stock_adjustments WHERE status = 'PENDING' AND serial_no = p_serial_no)
$$;
REVOKE ALL ON FUNCTION serial_number_in_use(text, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION serial_number_in_use(text, text) TO erp_app;
