-- Stage 4 migration 8 (module 4.3, batteries): which vehicle a battery is installed in, and battery dates carried on an
-- incoming stock adjustment so a battery arrives with its dates in one step.

ALTER TABLE "batteries" ADD COLUMN "installed_in_serial_unit_id" UUID;
ALTER TABLE "batteries" ADD COLUMN "installed_on" DATE;
CREATE INDEX "batteries_installed_in_serial_unit_id_idx" ON "batteries"("installed_in_serial_unit_id");
ALTER TABLE "batteries" ADD CONSTRAINT "batteries_installed_in_serial_unit_id_fkey" FOREIGN KEY ("installed_in_serial_unit_id") REFERENCES "serial_units"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "batteries" ADD CONSTRAINT "chk_batteries_installation_complete" CHECK ((installed_in_serial_unit_id IS NULL) = (installed_on IS NULL));
ALTER TABLE "batteries" ADD CONSTRAINT "chk_batteries_not_installed_in_itself" CHECK (installed_in_serial_unit_id IS NULL OR installed_in_serial_unit_id <> serial_unit_id);

ALTER TABLE "stock_adjustments" ADD COLUMN "manufactured_on" DATE;
ALTER TABLE "stock_adjustments" ADD COLUMN "expiry_on" DATE;
ALTER TABLE "stock_adjustments" ADD COLUMN "warranty_months" INTEGER;
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "chk_stock_adjustments_battery_details_need_serial" CHECK ((manufactured_on IS NULL AND expiry_on IS NULL AND warranty_months IS NULL) OR serial_no IS NOT NULL);
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "chk_stock_adjustments_battery_dates_ordered" CHECK (expiry_on IS NULL OR manufactured_on IS NULL OR expiry_on > manufactured_on);
ALTER TABLE "stock_adjustments" ADD CONSTRAINT "chk_stock_adjustments_warranty_months_valid" CHECK (warranty_months IS NULL OR (warranty_months >= 0 AND warranty_months <= 120));
ALTER TABLE "batteries" ADD CONSTRAINT "chk_batteries_warranty_months_at_most_ten_years" CHECK (warranty_months IS NULL OR warranty_months <= 120);
