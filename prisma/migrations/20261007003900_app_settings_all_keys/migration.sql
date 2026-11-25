-- Fix: saving company.full_duty_hours, company.weekly_off_days, company.pay_off_days_daily, company.invoice_prefix,
-- company.proprietor, company.tagline and company.invoice_terms failed with INTERNAL_ERROR, because the key check
-- from the first settings migration only allowed five company keys and the two approval limits.
ALTER TABLE "app_settings" DROP CONSTRAINT "chk_app_settings_key_known";
ALTER TABLE "app_settings" ADD CONSTRAINT "chk_app_settings_key_known" CHECK ("key" IN (
  'company.name', 'company.address', 'company.gstin', 'company.phone', 'company.email',
  'company.full_duty_hours', 'company.weekly_off_days', 'company.pay_off_days_daily',
  'company.invoice_prefix', 'company.proprietor', 'company.tagline', 'company.invoice_terms',
  'approvals.exchange_admin_limit', 'approvals.adjustment_admin_limit'
));
