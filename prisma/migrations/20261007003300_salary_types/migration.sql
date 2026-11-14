-- Chunk 12 (HR): two kinds of salary. FIXED is a monthly salary. DAILY is "no work, no pay": a fixed rate for a full duty
-- day, paid by the work done, counted in 30-minute blocks.
ALTER TABLE "staff"
  ADD COLUMN "salary_type" text NOT NULL DEFAULT 'FIXED',
  ADD COLUMN "daily_rate" numeric(14,2);
ALTER TABLE "staff"
  ADD CONSTRAINT "chk_staff_salary_type" CHECK (salary_type IN ('FIXED', 'DAILY')),
  ADD CONSTRAINT "chk_staff_daily_rate" CHECK (
    (salary_type = 'DAILY' AND daily_rate IS NOT NULL AND daily_rate > 0 AND monthly_salary = 0)
    OR (salary_type = 'FIXED' AND daily_rate IS NULL)
  );

-- What a payroll record was worked out on.
ALTER TABLE "payroll_records"
  ADD COLUMN "salary_type" text NOT NULL DEFAULT 'FIXED',
  ADD COLUMN "daily_rate" numeric(14,2),
  ADD COLUMN "paid_minutes" integer NOT NULL DEFAULT 0;
ALTER TABLE "payroll_records"
  ADD CONSTRAINT "chk_payroll_records_salary_type" CHECK (salary_type IN ('FIXED', 'DAILY')),
  ADD CONSTRAINT "chk_payroll_records_paid_minutes" CHECK (paid_minutes >= 0);
