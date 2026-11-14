-- Chunk 8 (HR): a person can punch in and out as many times as they like in a day. Each punch is its own row; the day's
-- attendance row keeps the first punch in, the last punch out and the minutes worked, and pay can follow the hours worked.

CREATE TABLE "attendance_punches" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "branch_id" uuid NOT NULL,
  "staff_id" uuid NOT NULL,
  "work_date" date NOT NULL,
  "punched_in_at" timestamp(3) NOT NULL,
  "punched_out_at" timestamp(3),
  "source" text NOT NULL DEFAULT 'SELF',
  "edited_by" uuid,
  "edit_reason" text,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" integer NOT NULL DEFAULT 1,
  CONSTRAINT "attendance_punches_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "attendance_punches_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "attendance_punches_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "attendance_punches_edited_by_fkey" FOREIGN KEY ("edited_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "chk_attendance_punches_source" CHECK (source IN ('SELF', 'MANAGER')),
  CONSTRAINT "chk_attendance_punches_order" CHECK (punched_out_at IS NULL OR punched_out_at >= punched_in_at),
  CONSTRAINT "chk_attendance_punches_length" CHECK (punched_out_at IS NULL OR punched_out_at - punched_in_at <= interval '24 hours'),
  CONSTRAINT "chk_attendance_punches_reason" CHECK (edit_reason IS NULL OR btrim(edit_reason) <> '')
);
CREATE INDEX "attendance_punches_staff_id_work_date_idx" ON "attendance_punches" ("staff_id", "work_date");
CREATE INDEX "attendance_punches_branch_id_idx" ON "attendance_punches" ("branch_id");
CREATE INDEX "attendance_punches_edited_by_idx" ON "attendance_punches" ("edited_by");
-- A person has at most one punch open at a time.
CREATE UNIQUE INDEX "attendance_punches_one_open_key" ON "attendance_punches" ("staff_id") WHERE punched_out_at IS NULL;

-- The day's attendance row summarises its punches.
ALTER TABLE "attendance" ADD COLUMN "worked_minutes" integer NOT NULL DEFAULT 0;
ALTER TABLE "attendance" ADD CONSTRAINT "chk_attendance_worked_minutes" CHECK (worked_minutes >= 0 AND worked_minutes <= 24 * 60 * 2);
-- One shift is no longer the whole day, so the limit moves to each punch (above).
ALTER TABLE "attendance" DROP CONSTRAINT "chk_attendance_shift_within_a_day";
UPDATE "attendance"
   SET "worked_minutes" = LEAST(2880, GREATEST(0, round(extract(epoch FROM (check_out - check_in)) / 60)::int))
 WHERE check_in IS NOT NULL AND check_out IS NOT NULL;

-- Every attendance row there already is becomes one punch (before the guard below exists, so history is never refused).
INSERT INTO "attendance_punches" ("branch_id", "staff_id", "work_date", "punched_in_at", "punched_out_at", "source", "edited_by", "edit_reason", "created_by", "updated_by", "created_at", "updated_at")
SELECT branch_id, staff_id, work_date, check_in,
       CASE WHEN check_out > check_in THEN check_out ELSE NULL END,
       CASE WHEN corrected_by IS NULL THEN 'SELF' ELSE 'MANAGER' END,
       corrected_by, correction_reason, created_by, updated_by, created_at, updated_at
  FROM "attendance"
 WHERE check_in IS NOT NULL
   AND NOT (check_out IS NOT NULL AND check_out - check_in > interval '24 hours');

ALTER TABLE "payroll_records"
  ADD COLUMN "hours_worked" numeric(8,2) NOT NULL DEFAULT 0,
  ADD COLUMN "credited_days" numeric(6,2) NOT NULL DEFAULT 0,
  ADD COLUMN "pay_basis" text NOT NULL DEFAULT 'DAYS';
ALTER TABLE "payroll_records" ADD CONSTRAINT "chk_payroll_records_pay_basis" CHECK (pay_basis IN ('DAYS', 'HOURS'));

-- A punch is for the days a person worked here, never overlaps another punch of theirs, and never changes in a month whose
-- payroll is final.
CREATE FUNCTION attendance_punches_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  s record;
  r record;
BEGIN
  r := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  IF EXISTS (
    SELECT 1 FROM payroll_records p
    WHERE p.staff_id = r.staff_id AND p.month = to_char(r.work_date, 'YYYY-MM') AND p.status = 'FINALIZED'
  ) THEN
    RAISE EXCEPTION 'The payroll for this month is final, so its punches cannot change' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  IF TG_OP = 'UPDATE' AND (NEW.staff_id <> OLD.staff_id OR NEW.branch_id <> OLD.branch_id) THEN
    RAISE EXCEPTION 'A punch keeps its person' USING ERRCODE = '23514';
  END IF;
  SELECT branch_id, join_date, left_on INTO s FROM staff WHERE id = NEW.staff_id;
  IF s.branch_id IS NULL OR s.branch_id <> NEW.branch_id THEN
    RAISE EXCEPTION 'A punch is in the branch of the staff member' USING ERRCODE = '23514';
  END IF;
  IF NEW.work_date < s.join_date THEN
    RAISE EXCEPTION 'A punch cannot be before the staff member joined' USING ERRCODE = '23514';
  END IF;
  IF s.left_on IS NOT NULL AND NEW.work_date > s.left_on THEN
    RAISE EXCEPTION 'A punch cannot be after the staff member left' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM attendance_punches p
    WHERE p.staff_id = NEW.staff_id AND p.id <> NEW.id
      AND p.punched_in_at < COALESCE(NEW.punched_out_at, 'infinity'::timestamp)
      AND COALESCE(p.punched_out_at, 'infinity'::timestamp) > NEW.punched_in_at
  ) THEN
    RAISE EXCEPTION 'A punch cannot overlap another punch of the same person' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "attendance_punches_guard" BEFORE INSERT OR UPDATE OR DELETE ON "attendance_punches" FOR EACH ROW EXECUTE FUNCTION attendance_punches_guard();
CREATE TRIGGER "attendance_punches_row_version" BEFORE UPDATE ON "attendance_punches" FOR EACH ROW EXECUTE FUNCTION bump_row_version();

ALTER TABLE "attendance_punches" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "attendance_punches_branch_scope" ON "attendance_punches" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));
-- A manager can take a wrong punch away; the removal is audited with its reason.
GRANT DELETE ON "attendance_punches" TO erp_app;
