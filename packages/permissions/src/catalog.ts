export interface PermissionDefinition {
  code: string;
  module: string;
  description: string;
}

function define<const T extends readonly PermissionDefinition[]>(items: T): T {
  return items;
}

export const PERMISSION_CATALOG = define([
  { code: 'branches.view', module: 'branches', description: 'View branches' },
  {
    code: 'branches.manage',
    module: 'branches',
    description: 'Create, edit and deactivate branches',
  },
  { code: 'users.view', module: 'users', description: 'View users' },
  { code: 'users.manage', module: 'users', description: 'Create, edit and deactivate users' },
  { code: 'users.reset_password', module: 'users', description: 'Reset a user password' },
  { code: 'roles.view', module: 'roles', description: 'View roles and permissions' },
  { code: 'roles.manage', module: 'roles', description: 'Create and edit roles' },
  { code: 'items.view', module: 'items', description: 'View items, categories and barcodes' },
  {
    code: 'items.manage',
    module: 'items',
    description: 'Create and edit items, categories and barcodes',
  },
  { code: 'stock.view', module: 'stock', description: 'View stock balances and movement history' },
  { code: 'stock.adjust', module: 'stock', description: 'Request a stock adjustment' },
  { code: 'stock.adjust_approve', module: 'stock', description: 'Approve a stock adjustment' },
  {
    code: 'batteries.view',
    module: 'batteries',
    description: 'View batteries, expiry and warranty',
  },
  {
    code: 'batteries.override_expiry',
    module: 'batteries',
    description: 'Sell an expired battery with an override',
  },
  {
    code: 'suppliers.view',
    module: 'purchasing',
    description: 'View suppliers and supplier ledger',
  },
  { code: 'suppliers.manage', module: 'purchasing', description: 'Create and edit suppliers' },
  {
    code: 'purchases.view',
    module: 'purchasing',
    description: 'View purchase orders and receipts',
  },
  { code: 'purchases.create', module: 'purchasing', description: 'Create purchase orders' },
  { code: 'purchases.approve', module: 'purchasing', description: 'Approve purchase orders' },
  {
    code: 'purchases.receive',
    module: 'purchasing',
    description: 'Receive goods against a purchase',
  },
  { code: 'purchases.return', module: 'purchasing', description: 'Return goods to a supplier' },
  {
    code: 'supplier_payments.create',
    module: 'purchasing',
    description: 'Record supplier payments',
  },
  { code: 'discrepancies.view', module: 'purchasing', description: 'View receiving discrepancies' },
  {
    code: 'discrepancies.resolve',
    module: 'purchasing',
    description: 'Resolve receiving discrepancies',
  },
  { code: 'transfers.view', module: 'transfers', description: 'View inter-branch transfers' },
  { code: 'transfers.request', module: 'transfers', description: 'Request a stock transfer' },
  {
    code: 'transfers.approve',
    module: 'transfers',
    description: 'Approve a transfer from the sending branch',
  },
  { code: 'transfers.dispatch', module: 'transfers', description: 'Dispatch an approved transfer' },
  { code: 'transfers.receive', module: 'transfers', description: 'Receive and verify a transfer' },
  { code: 'customers.view', module: 'customers', description: 'View customers' },
  { code: 'customers.manage', module: 'customers', description: 'Create and edit customers' },
  { code: 'kyc.view', module: 'customers', description: 'View KYC documents' },
  { code: 'kyc.upload', module: 'customers', description: 'Upload KYC documents' },
  { code: 'kyc.verify', module: 'customers', description: 'Verify or reject KYC documents' },
  { code: 'invoices.view', module: 'billing', description: 'View invoices' },
  { code: 'invoices.create', module: 'billing', description: 'Create and issue invoices' },
  { code: 'invoices.cancel', module: 'billing', description: 'Cancel and reissue invoices' },
  { code: 'credit_notes.create', module: 'billing', description: 'Request a credit note' },
  { code: 'credit_notes.approve', module: 'billing', description: 'Approve a credit note' },
  {
    code: 'discounts.approve',
    module: 'billing',
    description: 'Approve discounts above the staff limit',
  },
  { code: 'payments.view', module: 'payments', description: 'View payments and customer dues' },
  { code: 'payments.create', module: 'payments', description: 'Record customer payments' },
  { code: 'payments.reverse', module: 'payments', description: 'Reverse a customer payment' },
  { code: 'payments.refund', module: 'payments', description: "Refund a customer's credit" },
  { code: 'leads.view', module: 'leads', description: 'View leads and follow-ups' },
  { code: 'leads.manage', module: 'leads', description: 'Create and work leads' },
  { code: 'leads.manage_sources', module: 'leads', description: 'Add and change lead sources' },
  { code: 'brokers.view', module: 'brokers', description: 'View brokers and commission' },
  { code: 'brokers.manage', module: 'brokers', description: 'Manage brokers and commission rules' },
  {
    code: 'commissions.approve_payout',
    module: 'brokers',
    description: 'Approve broker commission payout',
  },
  {
    code: 'quotations.view',
    module: 'quotations',
    description: 'View quotations and custom orders',
  },
  { code: 'quotations.manage', module: 'quotations', description: 'Create and convert quotations' },
  {
    code: 'quotations.deliver_unpaid',
    module: 'quotations',
    description: 'Deliver a custom order before it is fully paid',
  },
  { code: 'exchanges.request', module: 'exchanges', description: 'Request an exchange' },
  { code: 'exchanges.approve', module: 'exchanges', description: 'Approve an exchange' },
  { code: 'hr.view', module: 'hr', description: 'View staff, leave and payroll' },
  { code: 'hr.manage', module: 'hr', description: 'Manage staff, leave and payroll' },
  { code: 'attendance.mark', module: 'hr', description: 'Mark own attendance' },
  { code: 'leave.request', module: 'hr', description: 'Ask for own leave' },
  {
    code: 'dashboards.view_branch',
    module: 'dashboards',
    description: 'View the branch dashboard',
  },
  {
    code: 'dashboards.view_company',
    module: 'dashboards',
    description: 'View the company dashboard',
  },
  { code: 'reports.view', module: 'reports', description: 'View reports' },
  { code: 'reports.export', module: 'reports', description: 'Export reports' },
  { code: 'notifications.view', module: 'notifications', description: 'View own notifications' },
  { code: 'approvals.view', module: 'approvals', description: 'View approval requests' },
  {
    code: 'settings.manage',
    module: 'settings',
    description: 'Manage company settings, masters and number series',
  },
  { code: 'audit.view', module: 'audit', description: 'View the audit log' },
] as const);

export type PermissionCode = (typeof PERMISSION_CATALOG)[number]['code'];

export const PERMISSION_CODES: readonly PermissionCode[] = PERMISSION_CATALOG.map((p) => p.code);

export function isPermissionCode(value: string): value is PermissionCode {
  return (PERMISSION_CODES as readonly string[]).includes(value);
}
