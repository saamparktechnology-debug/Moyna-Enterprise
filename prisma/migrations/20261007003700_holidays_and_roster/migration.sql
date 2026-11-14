-- Chunk 15: weekly offs and holidays. The Super Admin sets the company's weekly off days and holidays (settings and the
-- holidays table), and the roster of each employee: their own weekly off days and their own days off.

-- A holiday for the whole company. Company-wide, so it is not branch-scoped.
CREATE TABLE "holidays" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "holiday_date" date NOT NULL,
  "name" text NOT NULL,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" integer NOT NULL DEFAULT 1,
  CONSTRAINT "holidays_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "chk_holidays_name" CHECK (btrim(name) <> '')
);
CREATE UNIQUE INDEX "holidays_holiday_date_key" ON "holidays" ("holiday_date");
CREATE TRIGGER "holidays_row_version" BEFORE UPDATE ON "holidays" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
GRANT DELETE ON "holidays" TO erp_app;

-- The weekly off days of one employee, for example SAT,SUN or NONE. Empty means the company's weekly off days apply.
ALTER TABLE "staff" ADD COLUMN "weekly_off_days" text;
ALTER TABLE "staff" ADD CONSTRAINT "chk_staff_weekly_off_days" CHECK (
  weekly_off_days IS NULL OR weekly_off_days ~ '^(NONE|(MON|TUE|WED|THU|FRI|SAT|SUN)(,(MON|TUE|WED|THU|FRI|SAT|SUN))*)$'
);

-- A day off for one employee only (on top of the company's holidays).
CREATE TABLE "staff_days_off" (
  "id" uuid NOT NULL DEFAULT gen_random_uuid(),
  "branch_id" uuid NOT NULL,
  "staff_id" uuid NOT NULL,
  "off_date" date NOT NULL,
  "name" text,
  "created_by" uuid,
  "updated_by" uuid,
  "created_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "row_version" integer NOT NULL DEFAULT 1,
  CONSTRAINT "staff_days_off_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "staff_days_off_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "staff_days_off_staff_id_fkey" FOREIGN KEY ("staff_id") REFERENCES "staff"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "chk_staff_days_off_name" CHECK (name IS NULL OR btrim(name) <> '')
);
CREATE UNIQUE INDEX "staff_days_off_staff_id_off_date_key" ON "staff_days_off" ("staff_id", "off_date");
CREATE INDEX "staff_days_off_branch_id_idx" ON "staff_days_off" ("branch_id");
CREATE TRIGGER "staff_days_off_row_version" BEFORE UPDATE ON "staff_days_off" FOR EACH ROW EXECUTE FUNCTION bump_row_version();
GRANT DELETE ON "staff_days_off" TO erp_app;
ALTER TABLE "staff_days_off" ENABLE ROW LEVEL SECURITY;
CREATE POLICY "staff_days_off_branch_scope" ON "staff_days_off" USING (app_branch_allowed(branch_id)) WITH CHECK (app_branch_allowed(branch_id));
