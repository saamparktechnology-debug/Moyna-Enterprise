-- Stage 4 migration 17 (module 4.11, quotations and customized TOTO orders): a quotation gets its lines, the tax worked
-- out when it was written, a validity date, an optional broker and, for a customized build, a specification and a build
-- stage with a history; an advance is a payment that names the quotation it is for; a vehicle gets a motor number next
-- to its chassis number. The database holds the rules: a quotation moves only along the allowed statuses and is fixed once
-- sent (apart from the build and the units assigned to it), its lines and build history are fixed, an advance matches the
-- quotation's customer and branch, and one vehicle is promised to one live quotation line. Existing rows are not changed.

ALTER TABLE "quotations"
  ADD COLUMN "type" "InvoiceType" NOT NULL DEFAULT 'GST',
  ADD COLUMN "valid_until" date NOT NULL DEFAULT CURRENT_DATE,
  ADD COLUMN "subtotal" numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "discount_total" numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "taxable_value" numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "cgst_amount" numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "sgst_amount" numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "igst_amount" numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "round_off" numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "place_of_supply" text,
  ADD COLUMN "broker_id" uuid,
  ADD COLUMN "is_custom_build" boolean NOT NULL DEFAULT false,
  ADD COLUMN "specification" text,
  ADD COLUMN "build_stage" text NOT NULL DEFAULT 'NOT_STARTED',
  ADD COLUMN "sent_at" timestamptz,
  ADD COLUMN "accepted_at" timestamptz,
  ADD COLUMN "cancelled_at" timestamptz,
  ADD COLUMN "cancel_reason" text;
ALTER TABLE "quotations" ALTER COLUMN "type" DROP DEFAULT;
ALTER TABLE "quotations" ALTER COLUMN "valid_until" DROP DEFAULT;
ALTER TABLE "quotations"
  ADD CONSTRAINT "quotations_place_of_supply_fkey" FOREIGN KEY ("place_of_supply") REFERENCES "states"("code") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "quotations_broker_id_fkey" FOREIGN KEY ("broker_id") REFERENCES "brokers"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  ADD CONSTRAINT "chk_quotations_build_stage" CHECK (build_stage IN ('NOT_STARTED', 'IN_BUILD', 'QUALITY_CHECK', 'READY')),
  ADD CONSTRAINT "chk_quotations_specification" CHECK (specification IS NULL OR btrim(specification) <> ''),
  ADD CONSTRAINT "chk_quotations_cancel_reason" CHECK (cancel_reason IS NULL OR btrim(cancel_reason) <> ''),
  ADD CONSTRAINT "chk_quotations_build_only_custom" CHECK (is_custom_build OR build_stage = 'NOT_STARTED');
CREATE INDEX "quotations_broker_id_idx" ON "quotations" ("broker_id");
CREATE INDEX "quotations_place_of_supply_idx" ON "quotations" ("place_of_supply");
CREATE INDEX "quotations_branch_id_status_idx" ON "quotations" ("branch_id", "status");

ALTER TABLE "serial_units" ADD COLUMN "motor_no" text;
ALTER TABLE "serial_units" ADD CONSTRAINT "chk_serial_units_motor_no" CHECK (motor_no IS NULL OR btrim(motor_no) <> '');
CREATE UNIQUE INDEX "serial_units_motor_no_key" ON "serial_units" ("motor_no");

CREATE TABLE "quotation_lines" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "branch_id" uuid NOT NULL,
  "quotation_id" uuid NOT NULL,
  "line_no" integer NOT NULL,
  "item_id" uuid NOT NULL,
  "serial_unit_id" uuid,
  "qty" integer NOT NULL,
  "hsn_code" text,
  "tax_rate" numeric(5,2),
  "unit_price" numeric(14,2) NOT NULL,
  "discount_amount" numeric(14,2) NOT NULL DEFAULT 0,
  "taxable_amount" numeric(14,2) NOT NULL DEFAULT 0,
  "cgst_amount" numeric(14,2) NOT NULL DEFAULT 0,
  "sgst_amount" numeric(14,2) NOT NULL DEFAULT 0,
  "igst_amount" numeric(14,2) NOT NULL DEFAULT 0,
  "amount" numeric(14,2) NOT NULL DEFAULT 0,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" integer NOT NULL DEFAULT 1,
  CONSTRAINT "quotation_lines_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quotation_lines_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "quotation_lines_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "quotation_lines_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "items"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "quotation_lines_serial_unit_id_fkey" FOREIGN KEY ("serial_unit_id") REFERENCES "serial_units"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "chk_quotation_lines_qty" CHECK (qty > 0),
  CONSTRAINT "chk_quotation_lines_money" CHECK (unit_price >= 0 AND discount_amount >= 0 AND taxable_amount >= 0 AND amount >= 0)
);
CREATE UNIQUE INDEX "quotation_lines_quotation_id_line_no_key" ON "quotation_lines" ("quotation_id", "line_no");
CREATE INDEX "quotation_lines_branch_id_idx" ON "quotation_lines" ("branch_id");
CREATE INDEX "quotation_lines_item_id_idx" ON "quotation_lines" ("item_id");
CREATE INDEX "quotation_lines_serial_unit_id_idx" ON "quotation_lines" ("serial_unit_id");
CREATE TRIGGER "quotation_lines_row_version" BEFORE UPDATE ON "quotation_lines" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
ALTER TABLE "quotation_lines" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quotation_lines_branch_scope" ON "quotation_lines" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));

CREATE TABLE "quotation_build_updates" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "branch_id" uuid NOT NULL,
  "quotation_id" uuid NOT NULL,
  "stage" text NOT NULL,
  "note" text,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" integer NOT NULL DEFAULT 1,
  CONSTRAINT "quotation_build_updates_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "quotation_build_updates_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "quotation_build_updates_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "chk_quotation_build_updates_stage" CHECK (stage IN ('NOT_STARTED', 'IN_BUILD', 'QUALITY_CHECK', 'READY')),
  CONSTRAINT "chk_quotation_build_updates_note" CHECK (note IS NULL OR btrim(note) <> '')
);
CREATE INDEX "quotation_build_updates_quotation_id_created_at_idx" ON "quotation_build_updates" ("quotation_id", "created_at");
CREATE INDEX "quotation_build_updates_branch_id_idx" ON "quotation_build_updates" ("branch_id");
CREATE TRIGGER "quotation_build_updates_row_version" BEFORE UPDATE ON "quotation_build_updates" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
ALTER TABLE "quotation_build_updates" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "quotation_build_updates_branch_scope" ON "quotation_build_updates" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));

CREATE FUNCTION quotation_build_updates_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'The build history cannot be changed or deleted' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER "quotation_build_updates_frozen" BEFORE UPDATE OR DELETE ON "quotation_build_updates" FOR EACH ROW EXECUTE FUNCTION quotation_build_updates_frozen();

-- An advance is a payment that names the quotation it is for, and money taken for it must be the customer's, in the
-- quotation's branch, for a quotation the customer has accepted.
ALTER TABLE "payments" ADD COLUMN "quotation_id" uuid;
ALTER TABLE "payments" ADD CONSTRAINT "payments_quotation_id_fkey" FOREIGN KEY ("quotation_id") REFERENCES "quotations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "payments_quotation_id_idx" ON "payments" ("quotation_id");
CREATE FUNCTION payments_quotation_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  q record;
BEGIN
  IF NEW.quotation_id IS NULL THEN
    RETURN NEW;
  END IF;
  SELECT branch_id, customer_id, status INTO q FROM quotations WHERE id = NEW.quotation_id;
  IF q.branch_id IS NULL OR q.branch_id <> NEW.branch_id OR q.customer_id <> NEW.customer_id THEN
    RAISE EXCEPTION 'An advance must be the quotation''s customer''s, in the quotation''s branch' USING ERRCODE = '23514';
  END IF;
  IF q.status <> 'ACCEPTED' THEN
    RAISE EXCEPTION 'An advance can be taken only for an accepted quotation' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "payments_quotation_check" BEFORE INSERT ON "payments" FOR EACH ROW EXECUTE FUNCTION payments_quotation_check();

-- DRAFT, SENT, ACCEPTED, then CONVERTED (an invoice was issued from it). A quotation can lapse (EXPIRED) or be CANCELLED
-- at any point before that. Cancelling the invoice that converted it reopens it as ACCEPTED. Nothing else moves.
CREATE FUNCTION quotation_status_allowed(from_status "QuotationStatus", to_status "QuotationStatus") RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT (from_status, to_status) IN (
    ('DRAFT', 'SENT'), ('DRAFT', 'CANCELLED'),
    ('SENT', 'ACCEPTED'), ('SENT', 'EXPIRED'), ('SENT', 'CANCELLED'),
    ('ACCEPTED', 'CONVERTED'), ('ACCEPTED', 'EXPIRED'), ('ACCEPTED', 'CANCELLED'),
    ('CONVERTED', 'ACCEPTED')
  )
$$;

CREATE FUNCTION quotation_build_stage_allowed(from_stage text, to_stage text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN from_stage = to_stage THEN false
    WHEN from_stage = 'QUALITY_CHECK' AND to_stage = 'IN_BUILD' THEN true
    ELSE array_position(ARRAY['NOT_STARTED','IN_BUILD','QUALITY_CHECK','READY']::text[], to_stage)
       > array_position(ARRAY['NOT_STARTED','IN_BUILD','QUALITY_CHECK','READY']::text[], from_stage)
  END
$$;

CREATE FUNCTION quotations_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  settable text[] := ARRAY['status', 'sent_at', 'accepted_at', 'cancelled_at', 'cancel_reason', 'build_stage', 'row_version', 'updated_at', 'updated_by'];
BEGIN
  IF NEW.status <> OLD.status THEN
    IF NOT quotation_status_allowed(OLD.status, NEW.status) THEN
      RAISE EXCEPTION 'A quotation cannot move from % to %', OLD.status, NEW.status USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'EXPIRED' AND EXISTS (
      SELECT 1 FROM payments p
      WHERE p.quotation_id = NEW.id AND NOT EXISTS (SELECT 1 FROM payment_reversals r WHERE r.payment_id = p.id)
    ) THEN
      RAISE EXCEPTION 'A quotation with an advance paid against it does not expire' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'CANCELLED' AND EXISTS (
      SELECT 1 FROM payments p
      WHERE p.quotation_id = NEW.id AND NOT EXISTS (SELECT 1 FROM payment_reversals r WHERE r.payment_id = p.id)
    ) THEN
      RAISE EXCEPTION 'Reverse the advance before cancelling the quotation' USING ERRCODE = '23514';
    END IF;
    IF NEW.status = 'CANCELLED' AND NEW.cancel_reason IS NULL THEN
      RAISE EXCEPTION 'A cancelled quotation needs a reason' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF OLD.status <> 'DRAFT' AND (to_jsonb(NEW) - settable) IS DISTINCT FROM (to_jsonb(OLD) - settable) THEN
    RAISE EXCEPTION 'A quotation that has been sent cannot be changed' USING ERRCODE = '23514';
  END IF;
  IF NEW.build_stage <> OLD.build_stage THEN
    IF NOT quotation_build_stage_allowed(OLD.build_stage, NEW.build_stage) THEN
      RAISE EXCEPTION 'The build cannot move from % to %', OLD.build_stage, NEW.build_stage USING ERRCODE = '23514';
    END IF;
    IF NEW.status <> 'ACCEPTED' THEN
      RAISE EXCEPTION 'The build is tracked once the quotation has been accepted' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "quotations_guard" BEFORE UPDATE ON "quotations" FOR EACH ROW EXECUTE FUNCTION quotations_guard();

-- Lines are written while the quotation is a draft. Afterwards only the vehicle assigned to a line can change.
CREATE FUNCTION quotation_lines_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  parent record;
  unit record;
  item_serialized boolean;
BEGIN
  IF TG_OP = 'DELETE' THEN
    SELECT status INTO parent FROM quotations WHERE id = OLD.quotation_id;
    IF parent.status IS NOT NULL AND parent.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'The lines of a quotation that has been sent cannot be removed' USING ERRCODE = '23514';
    END IF;
    RETURN OLD;
  END IF;
  SELECT branch_id, status INTO parent FROM quotations WHERE id = NEW.quotation_id;
  IF parent.branch_id IS NULL OR parent.branch_id <> NEW.branch_id THEN
    RAISE EXCEPTION 'A line must be in the branch of its quotation' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF parent.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'Lines can be added only to a draft quotation' USING ERRCODE = '23514';
    END IF;
  ELSIF parent.status <> 'DRAFT' THEN
    IF (to_jsonb(NEW) - ARRAY['serial_unit_id', 'row_version', 'updated_at', 'updated_by'])
         IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['serial_unit_id', 'row_version', 'updated_at', 'updated_by']) THEN
      RAISE EXCEPTION 'The lines of a quotation that has been sent cannot be changed' USING ERRCODE = '23514';
    END IF;
    IF NEW.serial_unit_id IS DISTINCT FROM OLD.serial_unit_id AND parent.status NOT IN ('SENT', 'ACCEPTED') THEN
      RAISE EXCEPTION 'A vehicle can be assigned only while the quotation is open' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.serial_unit_id IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtextextended(NEW.serial_unit_id::text, 0));
    SELECT u.item_id, u.branch_id INTO unit FROM serial_units u WHERE u.id = NEW.serial_unit_id;
    SELECT is_serialized INTO item_serialized FROM items WHERE id = NEW.item_id;
    IF unit.item_id IS DISTINCT FROM NEW.item_id OR unit.branch_id IS DISTINCT FROM NEW.branch_id OR item_serialized IS NOT TRUE THEN
      RAISE EXCEPTION 'The unit must be of the line''s item, in the quotation''s branch' USING ERRCODE = '23514';
    END IF;
    IF EXISTS (
      SELECT 1 FROM quotation_lines l JOIN quotations q ON q.id = l.quotation_id
      WHERE l.serial_unit_id = NEW.serial_unit_id AND l.id <> NEW.id AND q.status IN ('DRAFT', 'SENT', 'ACCEPTED')
    ) THEN
      RAISE EXCEPTION 'This unit is already promised to another quotation' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "quotation_lines_guard" BEFORE INSERT OR UPDATE OR DELETE ON "quotation_lines" FOR EACH ROW EXECUTE FUNCTION quotation_lines_guard();

-- A build update is for a custom build in the quotation's branch, once it has been accepted.
CREATE FUNCTION quotation_build_updates_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  q record;
BEGIN
  SELECT branch_id, status, is_custom_build INTO q FROM quotations WHERE id = NEW.quotation_id;
  IF q.branch_id IS NULL OR q.branch_id <> NEW.branch_id OR NOT q.is_custom_build OR q.status <> 'ACCEPTED' THEN
    RAISE EXCEPTION 'A build update is for an accepted custom order, in its branch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "quotation_build_updates_check" BEFORE INSERT ON "quotation_build_updates" FOR EACH ROW EXECUTE FUNCTION quotation_build_updates_check();

-- Editing a draft replaces its lines. Like invoices, that goes through a function that refuses anything but a draft in
-- a branch the caller may use, because the application role cannot delete rows itself.
CREATE FUNCTION clear_quotation_draft_lines(p_quotation_id uuid) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_branch uuid;
  v_status "QuotationStatus";
BEGIN
  SELECT branch_id, status INTO v_branch, v_status FROM quotations WHERE id = p_quotation_id FOR UPDATE;
  IF NOT FOUND OR NOT app_branch_allowed(v_branch) THEN
    RETURN false;
  END IF;
  IF v_status <> 'DRAFT' THEN
    RAISE EXCEPTION 'Only the lines of a draft quotation can be replaced' USING ERRCODE = '23514';
  END IF;
  DELETE FROM quotation_lines WHERE quotation_id = p_quotation_id;
  RETURN true;
END $$;
REVOKE ALL ON FUNCTION clear_quotation_draft_lines(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION clear_quotation_draft_lines(uuid) TO erp_app;
