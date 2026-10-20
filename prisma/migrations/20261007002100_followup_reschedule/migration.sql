-- Stage 4 migration 21 (pending item from module 4.9): rescheduling a follow-up. A follow-up that is still waiting can be moved to a
-- later (or earlier) time. Every move is counted on the follow-up, and the old and new times are in the audit trail with the
-- reason. A follow-up is completed or moved, never both at once, and a completed one never changes. Nothing else about it
-- can be written.

ALTER TABLE "lead_followups" ADD COLUMN "rescheduled_count" integer NOT NULL DEFAULT 0;
ALTER TABLE "lead_followups" ADD CONSTRAINT "chk_lead_followups_rescheduled_count" CHECK (rescheduled_count >= 0);

CREATE OR REPLACE FUNCTION lead_followups_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  writable text[] := ARRAY['completed_at', 'completed_by', 'completion_note', 'due_at', 'rescheduled_count', 'row_version', 'updated_at', 'updated_by'];
BEGIN
  IF OLD.completed_at IS NOT NULL THEN
    RAISE EXCEPTION 'A completed follow-up cannot be changed' USING ERRCODE = '23514';
  END IF;
  IF (to_jsonb(NEW) - writable) IS DISTINCT FROM (to_jsonb(OLD) - writable) THEN
    RAISE EXCEPTION 'Only the completion or the time of a follow-up can be written' USING ERRCODE = '23514';
  END IF;
  IF NEW.due_at IS DISTINCT FROM OLD.due_at THEN
    IF NEW.completed_at IS NOT NULL THEN
      RAISE EXCEPTION 'A follow-up is completed or moved, not both' USING ERRCODE = '23514';
    END IF;
    IF NEW.rescheduled_count <> OLD.rescheduled_count + 1 THEN
      RAISE EXCEPTION 'Moving a follow-up must be counted' USING ERRCODE = '23514';
    END IF;
  ELSIF NEW.rescheduled_count <> OLD.rescheduled_count THEN
    RAISE EXCEPTION 'The count of moves changes only when the time does' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
