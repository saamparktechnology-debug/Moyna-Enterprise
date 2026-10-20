import { PERMISSION_CODES } from './catalog.js';
import type { PermissionCode } from './catalog.js';
import type { Role } from './roles.js';

const COMPANY_LEVEL: readonly PermissionCode[] = [
  'branches.manage',
  'roles.manage',
  'settings.manage',
  'dashboards.view_company',
];

const MANAGER_ONLY: readonly PermissionCode[] = [
  'users.manage',
  'users.reset_password',
  'items.manage',
  'stock.adjust_approve',
  'batteries.override_expiry',
  'suppliers.manage',
  'purchases.create',
  'purchases.approve',
  'purchases.return',
  'supplier_payments.create',
  'discrepancies.resolve',
  'transfers.approve',
  'kyc.verify',
  'invoices.cancel',
  'credit_notes.approve',
  'discounts.approve',
  'payments.reverse',
  'payments.refund',
  'leads.manage_sources',
  'brokers.manage',
  'commissions.approve_payout',
  'quotations.deliver_unpaid',
  'exchanges.approve',
  'hr.manage',
  'reports.export',
  'audit.view',
];

const adminCodes = PERMISSION_CODES.filter((code) => !COMPANY_LEVEL.includes(code));
const staffCodes = adminCodes.filter((code) => !MANAGER_ONLY.includes(code));

export const ROLE_PRESETS: Readonly<Record<Role, readonly PermissionCode[]>> = {
  SUPER_ADMIN: PERMISSION_CODES,
  ADMIN: adminCodes,
  STAFF: staffCodes,
};

export const ROLE_DESCRIPTIONS: Readonly<Record<Role, string>> = {
  SUPER_ADMIN: 'Full access to every module and every branch',
  ADMIN: 'Branch manager: runs the assigned branches and manages their staff',
  STAFF: 'Branch staff: day-to-day billing, receiving, stock and customer work',
};
