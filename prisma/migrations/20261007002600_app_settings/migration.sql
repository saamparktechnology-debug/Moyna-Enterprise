-- Module 5.5 (Settings and admin): company details and approval limits that an administrator can change
-- without a new release. One row per setting that has been changed; a setting with no row uses its default.
CREATE TABLE "app_settings" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updated_by" UUID,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "row_version" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "app_settings_pkey" PRIMARY KEY ("key")
);

ALTER TABLE "app_settings" ADD CONSTRAINT "chk_app_settings_key_known" CHECK ("key" IN (
  'company.name', 'company.address', 'company.gstin', 'company.phone', 'company.email',
  'approvals.exchange_admin_limit', 'approvals.adjustment_admin_limit'
));
ALTER TABLE "app_settings" ADD CONSTRAINT "app_settings_updated_by_fkey"
  FOREIGN KEY ("updated_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TRIGGER "app_settings_touch" BEFORE UPDATE ON "app_settings" FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
CREATE TRIGGER "app_settings_row_version" BEFORE UPDATE ON "app_settings" FOR EACH ROW EXECUTE FUNCTION bump_row_version();

-- The application reads and writes settings; nobody needs to delete one (a reset deletes the row, which is allowed).
GRANT SELECT, INSERT, UPDATE, DELETE ON "app_settings" TO erp_app;
