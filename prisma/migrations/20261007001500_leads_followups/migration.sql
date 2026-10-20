-- Stage 4 migration 15 (module 4.9, leads and follow-ups): what a lead is interested in, a notes trail that also
-- records every stage change, who completed a follow-up and what came of it, and database guards so that a lead only
-- moves along the allowed stages, a won lead always has its customer and is never edited again, and a completed
-- follow-up never changes. Existing rows are not changed: the checks that could fail on old data are added NOT VALID.

ALTER TABLE "leads" ADD COLUMN "interest" text;
ALTER TABLE "leads"
  ADD CONSTRAINT "chk_leads_interest" CHECK (interest IS NULL OR btrim(interest) <> ''),
  ADD CONSTRAINT "chk_leads_name_not_blank" CHECK (btrim(name) <> '') NOT VALID,
  ADD CONSTRAINT "chk_leads_phone_format" CHECK (phone ~ '^[6-9][0-9]{9}$') NOT VALID,
  ADD CONSTRAINT "chk_leads_won_has_customer" CHECK (stage <> 'WON' OR customer_id IS NOT NULL) NOT VALID;
CREATE INDEX "leads_phone_idx" ON "leads" ("phone");

ALTER TABLE "lead_followups"
  ADD COLUMN "completed_by" uuid,
  ADD COLUMN "completion_note" text;
ALTER TABLE "lead_followups"
  ADD CONSTRAINT "chk_lead_followups_note" CHECK (note IS NULL OR btrim(note) <> ''),
  ADD CONSTRAINT "chk_lead_followups_completion_note" CHECK (completion_note IS NULL OR btrim(completion_note) <> '');

CREATE TABLE "lead_notes" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "branch_id" uuid NOT NULL,
  "lead_id" uuid NOT NULL,
  "body" text NOT NULL,
  "from_stage" "LeadStage",
  "to_stage" "LeadStage",
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamptz NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" integer NOT NULL DEFAULT 1,
  CONSTRAINT "lead_notes_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "lead_notes_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "lead_notes_lead_id_fkey" FOREIGN KEY ("lead_id") REFERENCES "leads"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "chk_lead_notes_body" CHECK (btrim(body) <> ''),
  CONSTRAINT "chk_lead_notes_stages" CHECK ((from_stage IS NULL) = (to_stage IS NULL))
);
CREATE INDEX "lead_notes_lead_id_created_at_idx" ON "lead_notes" ("lead_id", "created_at");
CREATE INDEX "lead_notes_branch_id_idx" ON "lead_notes" ("branch_id");
CREATE TRIGGER "lead_notes_row_version" BEFORE UPDATE ON "lead_notes" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
ALTER TABLE "lead_notes" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "lead_notes_branch_scope" ON "lead_notes" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));

-- A note is a record of what was said or done. It is never changed or removed.
CREATE FUNCTION lead_notes_frozen() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Lead notes cannot be changed or deleted' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER "lead_notes_frozen" BEFORE UPDATE OR DELETE ON "lead_notes" FOR EACH ROW EXECUTE FUNCTION lead_notes_frozen();

-- A note and a follow-up belong to the branch of their lead.
CREATE FUNCTION lead_child_branch_check() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  lead_branch uuid;
BEGIN
  SELECT branch_id INTO lead_branch FROM leads WHERE id = NEW.lead_id;
  IF lead_branch IS NULL OR lead_branch <> NEW.branch_id THEN
    RAISE EXCEPTION 'A note or follow-up must be in the branch of its lead' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "lead_notes_branch_check" BEFORE INSERT ON "lead_notes" FOR EACH ROW EXECUTE FUNCTION lead_child_branch_check();
CREATE TRIGGER "lead_followups_branch_check" BEFORE INSERT ON "lead_followups" FOR EACH ROW EXECUTE FUNCTION lead_child_branch_check();

-- Stages: NEW, CONTACTED, QUALIFIED, QUOTED and NEGOTIATION are the open funnel, in that order. A lead may move
-- forward to any later open stage, from NEGOTIATION back to QUOTED, and from any open stage to LOST. A lost lead may
-- be reopened to CONTACTED. WON is reached only by converting the lead to a customer, and nothing leaves WON.
CREATE FUNCTION lead_stage_allowed(from_stage "LeadStage", to_stage "LeadStage") RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN from_stage = to_stage THEN false
    WHEN from_stage = 'WON' THEN false
    WHEN from_stage = 'LOST' THEN to_stage = 'CONTACTED'
    WHEN to_stage = 'LOST' THEN true
    WHEN to_stage = 'WON' THEN true
    WHEN from_stage = 'NEGOTIATION' AND to_stage = 'QUOTED' THEN true
    ELSE array_position(ARRAY['NEW','CONTACTED','QUALIFIED','QUOTED','NEGOTIATION']::text[], to_stage::text)
       > array_position(ARRAY['NEW','CONTACTED','QUALIFIED','QUOTED','NEGOTIATION']::text[], from_stage::text)
  END
$$;

CREATE FUNCTION leads_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.stage = 'WON' AND (to_jsonb(NEW) - ARRAY['row_version', 'updated_at', 'updated_by'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['row_version', 'updated_at', 'updated_by']) THEN
    RAISE EXCEPTION 'A converted lead cannot be changed' USING ERRCODE = '23514';
  END IF;
  IF NEW.stage <> OLD.stage THEN
    IF NOT lead_stage_allowed(OLD.stage, NEW.stage) THEN
      RAISE EXCEPTION 'A lead cannot move from % to %', OLD.stage, NEW.stage USING ERRCODE = '23514';
    END IF;
    IF NEW.stage = 'WON' AND NEW.customer_id IS NULL THEN
      RAISE EXCEPTION 'A lead is won only by converting it to a customer' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.customer_id IS DISTINCT FROM OLD.customer_id AND OLD.customer_id IS NOT NULL THEN
    RAISE EXCEPTION 'A lead keeps the customer it was converted to' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "leads_guard" BEFORE UPDATE ON "leads" FOR EACH ROW EXECUTE FUNCTION leads_guard();

-- A follow-up is completed once, and after that it never changes. Before that only its completion can be written.
CREATE FUNCTION lead_followups_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'A completed follow-up cannot be changed' USING ERRCODE = '23514';
  END IF;
  IF (to_jsonb(NEW) - ARRAY['completed_at', 'completed_by', 'completion_note', 'row_version', 'updated_at', 'updated_by'])
       IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['completed_at', 'completed_by', 'completion_note', 'row_version', 'updated_at', 'updated_by']) THEN
    RAISE EXCEPTION 'Only the completion of a follow-up can be written' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "lead_followups_guard" BEFORE UPDATE ON "lead_followups" FOR EACH ROW EXECUTE FUNCTION lead_followups_guard();
CREATE FUNCTION lead_followups_no_delete() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'Follow-ups cannot be deleted' USING ERRCODE = '23514';
END $$;
CREATE TRIGGER "lead_followups_no_delete" BEFORE DELETE ON "lead_followups" FOR EACH ROW EXECUTE FUNCTION lead_followups_no_delete();
