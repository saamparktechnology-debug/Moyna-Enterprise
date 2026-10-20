-- Stage 4 migration 19 (module 4.13, staff and HR): a staff profile gets an employee code, a designation, a monthly salary
-- and the day the person left; leave gets a kind (paid or unpaid), a reason and who decided it; attendance records who
-- corrected it and why; a payroll record gets a status, the deductions, a snapshot of the salary and the days it was worked
-- out on, and is locked once final. The database holds the rules that matter most: leave for one person never overlaps,
-- attendance is only for the days a person worked here (never before they joined, after they left or on approved leave),
-- a shift is never longer than a day, and nothing changes in a month whose payroll is final. Existing rows (the
-- application never made any) are given safe values.

ALTER TABLE "staff"
  ADD COLUMN "employee_code" text,
  ADD COLUMN "designation" text,
  ADD COLUMN "monthly_salary" numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "left_on" date;
UPDATE "staff" SET "employee_code" = 'EMP-' || upper(substr(replace("id"::text, '-', ''), 1, 8));
ALTER TABLE "staff" ALTER COLUMN "employee_code" SET NOT NULL;
ALTER TABLE "staff" ALTER COLUMN "monthly_salary" DROP DEFAULT;
ALTER TABLE "staff"
  ADD CONSTRAINT "chk_staff_employee_code" CHECK (btrim(employee_code) <> ''),
  ADD CONSTRAINT "chk_staff_designation" CHECK (designation IS NULL OR btrim(designation) <> ''),
  ADD CONSTRAINT "chk_staff_monthly_salary" CHECK (monthly_salary >= 0),
  ADD CONSTRAINT "chk_staff_left_after_joined" CHECK (left_on IS NULL OR left_on >= join_date),
  ADD CONSTRAINT "chk_staff_inactive_has_left_on" CHECK ((status = 'INACTIVE') = (left_on IS NOT NULL)) NOT VALID;
CREATE UNIQUE INDEX "staff_employee_code_key" ON "staff" ("employee_code");

-- A staff profile stays with its person and its branch.
CREATE FUNCTION staff_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.user_id <> OLD.user_id OR NEW.branch_id <> OLD.branch_id THEN
    RAISE EXCEPTION 'A staff profile cannot move to another person or branch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "staff_guard" BEFORE UPDATE ON "staff" FOR EACH ROW EXECUTE FUNCTION staff_guard();

ALTER TABLE "leave_requests"
  ADD COLUMN "kind" text NOT NULL DEFAULT 'PAID',
  ADD COLUMN "reason" text,
  ADD COLUMN "decided_by" uuid,
  ADD COLUMN "decided_at" timestamptz,
  ADD COLUMN "decision_note" text;
ALTER TABLE "leave_requests" ALTER COLUMN "kind" DROP DEFAULT;
ALTER TABLE "leave_requests"
  ADD CONSTRAINT "leave_requests_decided_by_fkey" FOREIGN KEY ("decided_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "chk_leave_requests_kind" CHECK (kind IN ('PAID', 'UNPAID')),
  ADD CONSTRAINT "chk_leave_requests_reason" CHECK (reason IS NULL OR btrim(reason) <> ''),
  ADD CONSTRAINT "chk_leave_requests_decision_note" CHECK (decision_note IS NULL OR btrim(decision_note) <> ''),
  ADD CONSTRAINT "chk_leave_requests_span" CHECK (to_date - from_date <= 365) NOT VALID,
  ADD CONSTRAINT "chk_leave_requests_decided_pair" CHECK ((status IN ('APPROVED', 'REJECTED')) = (decided_at IS NOT NULL) OR status = 'CANCELLED') NOT VALID;
CREATE INDEX "leave_requests_decided_by_idx" ON "leave_requests" ("decided_by");
CREATE INDEX "leave_requests_staff_id_status_idx" ON "leave_requests" ("staff_id", "status");

-- Leave: one person never has two live requests (waiting or approved) over the same days; a request is in the person's
-- branch, for a person who is active and has joined; approving it needs the days to be free of attendance; and its terms
-- never change, only its status along PENDING to APPROVED, REJECTED or CANCELLED and APPROVED to CANCELLED.
CREATE FUNCTION leave_requests_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  s record;
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF NEW.staff_id <> OLD.staff_id OR NEW.from_date <> OLD.from_date OR NEW.to_date <> OLD.to_date
       OR NEW.kind <> OLD.kind OR NEW.reason IS DISTINCT FROM OLD.reason OR NEW.branch_id <> OLD.branch_id THEN
      RAISE EXCEPTION 'The terms of a leave request cannot be changed' USING ERRCODE = '23514';
    END IF;
    IF NEW.status <> OLD.status AND NOT (
      (OLD.status = 'PENDING' AND NEW.status IN ('APPROVED', 'REJECTED', 'CANCELLED')) OR
      (OLD.status = 'APPROVED' AND NEW.status = 'CANCELLED')
    ) THEN
      RAISE EXCEPTION 'Leave cannot move from % to %', OLD.status, NEW.status USING ERRCODE = '23514';
    END IF;
    IF OLD.status IN ('REJECTED', 'CANCELLED') AND NEW.status = OLD.status AND NEW.decision_note IS DISTINCT FROM OLD.decision_note THEN
      RAISE EXCEPTION 'A closed leave request cannot be changed' USING ERRCODE = '23514';
    END IF;
  END IF;
  SELECT branch_id, join_date, status INTO s FROM staff WHERE id = NEW.staff_id;
  IF s.branch_id IS NULL OR s.branch_id <> NEW.branch_id THEN
    RAISE EXCEPTION 'Leave is in the branch of the staff member' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF s.status <> 'ACTIVE' THEN
      RAISE EXCEPTION 'A staff member who has left cannot ask for leave' USING ERRCODE = '23514';
    END IF;
    IF NEW.from_date < s.join_date THEN
      RAISE EXCEPTION 'Leave cannot start before the staff member joined' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.status IN ('PENDING', 'APPROVED') THEN
    PERFORM pg_advisory_xact_lock(hashtextextended('leave:' || NEW.staff_id::text, 0));
    IF EXISTS (
      SELECT 1 FROM leave_requests o
      WHERE o.staff_id = NEW.staff_id AND o.id <> NEW.id AND o.status IN ('PENDING', 'APPROVED')
        AND o.from_date <= NEW.to_date AND o.to_date >= NEW.from_date
    ) THEN
      RAISE EXCEPTION 'These dates overlap other leave of the same person' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.status = 'APPROVED' AND (TG_OP = 'INSERT' OR OLD.status <> 'APPROVED') AND EXISTS (
    SELECT 1 FROM attendance a
    WHERE a.staff_id = NEW.staff_id AND a.work_date BETWEEN NEW.from_date AND NEW.to_date AND a.check_in IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Attendance has been recorded on these days, so they cannot be approved as leave' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "leave_requests_guard" BEFORE INSERT OR UPDATE ON "leave_requests" FOR EACH ROW EXECUTE FUNCTION leave_requests_guard();

ALTER TABLE "attendance"
  ADD COLUMN "corrected_by" uuid,
  ADD COLUMN "correction_reason" text;
ALTER TABLE "attendance"
  ADD CONSTRAINT "attendance_corrected_by_fkey" FOREIGN KEY ("corrected_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "chk_attendance_correction_reason" CHECK (correction_reason IS NULL OR btrim(correction_reason) <> ''),
  ADD CONSTRAINT "chk_attendance_check_out_needs_check_in" CHECK (check_out IS NULL OR check_in IS NOT NULL) NOT VALID,
  ADD CONSTRAINT "chk_attendance_shift_within_a_day" CHECK (check_in IS NULL OR check_out IS NULL OR check_out - check_in <= interval '24 hours') NOT VALID;
CREATE INDEX "attendance_corrected_by_idx" ON "attendance" ("corrected_by");
CREATE INDEX "attendance_work_date_idx" ON "attendance" ("work_date");

ALTER TABLE "payroll_records"
  ADD COLUMN "status" text NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "deductions" numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "deduction_note" text,
  ADD COLUMN "monthly_salary" numeric(14,2) NOT NULL DEFAULT 0,
  ADD COLUMN "days_in_month" integer NOT NULL DEFAULT 0,
  ADD COLUMN "days_employed" integer NOT NULL DEFAULT 0,
  ADD COLUMN "days_present" integer NOT NULL DEFAULT 0,
  ADD COLUMN "paid_leave_days" integer NOT NULL DEFAULT 0,
  ADD COLUMN "unpaid_leave_days" integer NOT NULL DEFAULT 0,
  ADD COLUMN "finalized_by" uuid,
  ADD COLUMN "finalized_at" timestamptz;
ALTER TABLE "payroll_records"
  ALTER COLUMN "monthly_salary" DROP DEFAULT,
  ALTER COLUMN "days_in_month" DROP DEFAULT,
  ALTER COLUMN "days_employed" DROP DEFAULT,
  ALTER COLUMN "days_present" DROP DEFAULT,
  ALTER COLUMN "paid_leave_days" DROP DEFAULT,
  ALTER COLUMN "unpaid_leave_days" DROP DEFAULT;
ALTER TABLE "payroll_records"
  ADD CONSTRAINT "payroll_records_finalized_by_fkey" FOREIGN KEY ("finalized_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT "chk_payroll_records_status" CHECK (status IN ('DRAFT', 'FINALIZED')),
  ADD CONSTRAINT "chk_payroll_records_deduction_note" CHECK (deduction_note IS NULL OR btrim(deduction_note) <> ''),
  ADD CONSTRAINT "chk_payroll_records_deductions" CHECK (deductions >= 0 AND deductions <= gross) NOT VALID,
  ADD CONSTRAINT "chk_payroll_records_net_is_gross_less_deductions" CHECK (net = gross - deductions) NOT VALID,
  ADD CONSTRAINT "chk_payroll_records_days" CHECK (days_in_month BETWEEN 28 AND 31 AND days_employed BETWEEN 0 AND days_in_month
    AND days_present >= 0 AND paid_leave_days >= 0 AND unpaid_leave_days >= 0) NOT VALID,
  ADD CONSTRAINT "chk_payroll_records_finalized_pair" CHECK ((status = 'FINALIZED') = (finalized_at IS NOT NULL)) NOT VALID;
CREATE INDEX "payroll_records_finalized_by_idx" ON "payroll_records" ("finalized_by");
CREATE INDEX "payroll_records_month_idx" ON "payroll_records" ("month");

-- Payroll: a record is made for a person who was employed in its month, in their branch; what it was worked out on never
-- changes; until it is final only the deductions (and so the net) and their note change; once final nothing does.
CREATE FUNCTION payroll_records_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  s record;
  first_day date;
  last_day date;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- A malformed month is refused by the table's own format check.
    IF NEW.month !~ '^[0-9]{4}-(0[1-9]|1[0-2])$' THEN
      RETURN NEW;
    END IF;
    SELECT branch_id, join_date, left_on INTO s FROM staff WHERE id = NEW.staff_id;
    first_day := (NEW.month || '-01')::date;
    last_day := (first_day + interval '1 month' - interval '1 day')::date;
    IF s.branch_id IS NULL OR s.branch_id <> NEW.branch_id THEN
      RAISE EXCEPTION 'Payroll is in the branch of the staff member' USING ERRCODE = '23514';
    END IF;
    IF s.join_date > last_day OR (s.left_on IS NOT NULL AND s.left_on < first_day) THEN
      RAISE EXCEPTION 'The staff member was not employed in %', NEW.month USING ERRCODE = '23514';
    END IF;
    IF NEW.status <> 'DRAFT' THEN
      RAISE EXCEPTION 'A payroll record starts as a draft' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;
  IF NEW.staff_id <> OLD.staff_id OR NEW.branch_id <> OLD.branch_id OR NEW.month <> OLD.month OR NEW.gross <> OLD.gross
     OR NEW.monthly_salary <> OLD.monthly_salary OR NEW.days_in_month <> OLD.days_in_month OR NEW.days_employed <> OLD.days_employed
     OR NEW.days_present <> OLD.days_present OR NEW.paid_leave_days <> OLD.paid_leave_days OR NEW.unpaid_leave_days <> OLD.unpaid_leave_days THEN
    RAISE EXCEPTION 'What a payroll record was worked out on cannot be changed' USING ERRCODE = '23514';
  END IF;
  IF OLD.status = 'FINALIZED' THEN
    IF (to_jsonb(NEW) - ARRAY['row_version', 'updated_at', 'updated_by']) IS DISTINCT FROM (to_jsonb(OLD) - ARRAY['row_version', 'updated_at', 'updated_by']) THEN
      RAISE EXCEPTION 'A final payroll record cannot be changed' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "payroll_records_guard" BEFORE INSERT OR UPDATE ON "payroll_records" FOR EACH ROW EXECUTE FUNCTION payroll_records_guard();

-- Attendance is for the days a person worked here: in their branch, from the day they joined to the day they left, never on
-- approved leave, never in a month whose payroll is final, and a record keeps its person and its day.
CREATE FUNCTION attendance_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
  s record;
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW.staff_id <> OLD.staff_id OR NEW.work_date <> OLD.work_date OR NEW.branch_id <> OLD.branch_id) THEN
    RAISE EXCEPTION 'An attendance record keeps its person and its day' USING ERRCODE = '23514';
  END IF;
  SELECT branch_id, join_date, left_on INTO s FROM staff WHERE id = NEW.staff_id;
  IF s.branch_id IS NULL OR s.branch_id <> NEW.branch_id THEN
    RAISE EXCEPTION 'Attendance is in the branch of the staff member' USING ERRCODE = '23514';
  END IF;
  IF NEW.work_date < s.join_date THEN
    RAISE EXCEPTION 'Attendance cannot be before the staff member joined' USING ERRCODE = '23514';
  END IF;
  IF s.left_on IS NOT NULL AND NEW.work_date > s.left_on THEN
    RAISE EXCEPTION 'Attendance cannot be after the staff member left' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'INSERT' AND EXISTS (
    SELECT 1 FROM leave_requests l
    WHERE l.staff_id = NEW.staff_id AND l.status = 'APPROVED' AND NEW.work_date BETWEEN l.from_date AND l.to_date
  ) THEN
    RAISE EXCEPTION 'The staff member is on approved leave that day' USING ERRCODE = '23514';
  END IF;
  IF EXISTS (
    SELECT 1 FROM payroll_records p
    WHERE p.staff_id = NEW.staff_id AND p.month = to_char(NEW.work_date, 'YYYY-MM') AND p.status = 'FINALIZED'
  ) THEN
    RAISE EXCEPTION 'The payroll for this month is final, so its attendance cannot change' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER "attendance_guard" BEFORE INSERT OR UPDATE ON "attendance" FOR EACH ROW EXECUTE FUNCTION attendance_guard();
