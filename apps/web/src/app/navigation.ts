import {
  Banknote,
  BarChart3,
  Battery,
  Boxes,
  Building2,
  ClipboardList,
  FileText,
  Handshake,
  LayoutDashboard,
  Package,
  Receipt,
  Repeat,
  Settings,
  ShieldCheck,
  ShoppingCart,
  Target,
  Truck,
  UserCog,
  Users,
  UsersRound,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

export interface NavItem {
  path: string;
  label: string;
  /** The business function the screen belongs to; used for the sidebar groups and the breadcrumb. */
  group: string;
  icon: LucideIcon;
  /** One line on what the screen is for, shown beside search results. */
  description: string;
  /** Extra words that should find the screen when searching. */
  keywords?: readonly string[];
  /** The permission needed to see and open the page. No permission means any signed-in user. */
  permission?: string;
  /** Alternatively, any one of these permissions is enough. */
  anyPermission?: readonly string[];
}

export interface NavGroup {
  label: string;
  items: NavItem[];
}

/**
 * The order of the groups, and of the screens inside them, is the order of the menu. Keep Dashboard,
 * Inventory, Sales, Exchanges, Customers, Reports and Settings in that relative order.
 */
export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [
      {
        path: '/',
        label: 'Dashboard',
        group: 'Overview',
        icon: LayoutDashboard,
        description: 'Sales, stock and dues at a glance',
        keywords: ['home', 'summary', 'kpi'],
      },
    ],
  },
  {
    label: 'Stock and purchasing',
    items: [
      {
        path: '/items',
        label: 'Items',
        group: 'Stock and purchasing',
        icon: Package,
        description: 'Products, barcodes and categories',
        keywords: ['products', 'barcode', 'catalogue', 'labels'],
        permission: 'items.view',
      },
      {
        path: '/inventory',
        label: 'Inventory',
        group: 'Stock and purchasing',
        icon: Boxes,
        description: 'Stock by branch, movements and adjustments',
        keywords: ['stock', 'serial', 'low stock', 'adjustment'],
        permission: 'stock.view',
      },
      {
        path: '/purchasing',
        label: 'Purchasing',
        group: 'Stock and purchasing',
        icon: ShoppingCart,
        description: 'Suppliers, purchase orders and receiving',
        keywords: ['supplier', 'purchase order', 'receipt', 'grn', 'returns'],
        permission: 'purchases.view',
      },
      {
        path: '/transfers',
        label: 'Transfers',
        group: 'Stock and purchasing',
        icon: Truck,
        description: 'Stock moving between branches',
        keywords: ['branch transfer', 'dispatch'],
        permission: 'transfers.view',
      },
      {
        path: '/batteries',
        label: 'Batteries',
        group: 'Stock and purchasing',
        icon: Battery,
        description: 'Battery expiry, warranty and installation',
        keywords: ['expiry', 'warranty'],
        permission: 'batteries.view',
      },
    ],
  },
  {
    label: 'Sales and customers',
    items: [
      {
        path: '/leads',
        label: 'Leads',
        group: 'Sales and customers',
        icon: Target,
        description: 'Enquiries and follow-ups',
        keywords: ['follow-up', 'enquiry', 'prospect'],
        permission: 'leads.view',
      },
      {
        path: '/quotations',
        label: 'Quotations',
        group: 'Sales and customers',
        icon: ClipboardList,
        description: 'Quotes, advances and customized orders',
        keywords: ['quote', 'advance', 'toto', 'custom order'],
        permission: 'quotations.view',
      },
      {
        path: '/brokers',
        label: 'Brokers',
        group: 'Sales and customers',
        icon: Handshake,
        description: 'Brokers, commission rules and payouts',
        keywords: ['commission', 'agent'],
        permission: 'brokers.view',
      },
      {
        path: '/sales',
        label: 'Sales',
        group: 'Sales and customers',
        icon: Receipt,
        description: 'Invoices, credit notes and billing',
        keywords: ['invoice', 'billing', 'gst', 'credit note'],
        permission: 'invoices.view',
      },
      {
        path: '/exchanges',
        label: 'Exchanges',
        group: 'Sales and customers',
        icon: Repeat,
        description: 'Old-for-new vehicle exchanges',
        keywords: ['trade-in', 'swap'],
        permission: 'invoices.view',
      },
      {
        path: '/payments',
        label: 'Payments',
        group: 'Sales and customers',
        icon: Banknote,
        description: 'Receipts, dues and customer ledgers',
        keywords: ['dues', 'outstanding', 'receipt', 'ledger', 'refund'],
        permission: 'payments.view',
      },
      {
        path: '/customers',
        label: 'Customers',
        group: 'Sales and customers',
        icon: Users,
        description: 'Customers and KYC documents',
        keywords: ['kyc', 'client'],
        permission: 'customers.view',
      },
    ],
  },
  {
    label: 'Insights',
    items: [
      {
        path: '/reports',
        label: 'Reports',
        group: 'Insights',
        icon: BarChart3,
        description: 'Monthly reports with PDF and Excel export',
        keywords: ['export', 'excel', 'pdf', 'gst report'],
        permission: 'reports.view',
      },
    ],
  },
  {
    label: 'Administration',
    items: [
      {
        path: '/branches',
        label: 'Branches',
        group: 'Administration',
        icon: Building2,
        description: 'Branch details and GSTIN',
        permission: 'branches.view',
      },
      {
        path: '/users',
        label: 'Users',
        group: 'Administration',
        icon: UserCog,
        description: 'Staff logins and branch access',
        keywords: ['staff', 'accounts', 'password'],
        permission: 'users.view',
      },
      {
        path: '/roles',
        label: 'Roles',
        group: 'Administration',
        icon: ShieldCheck,
        description: 'Roles and permissions',
        keywords: ['access', 'rbac'],
        permission: 'roles.view',
      },
      {
        path: '/hr',
        label: 'HR',
        group: 'Administration',
        icon: UsersRound,
        description: 'Attendance, leave and payroll',
        keywords: ['attendance', 'leave', 'payroll', 'salary', 'staff'],
        permission: 'hr.view',
      },
      {
        path: '/settings',
        label: 'Settings',
        group: 'Administration',
        icon: Settings,
        description: 'Company settings, number series, tax rates and audit log',
        keywords: ['audit', 'gst rates', 'document numbers', 'approval limits'],
        anyPermission: ['settings.manage', 'audit.view'],
      },
    ],
  },
];

export const NAV_ITEMS: NavItem[] = NAV_GROUPS.flatMap((group) => group.items);

/** Screens that exist but are not menu entries (reached from a button or a link). */
export const EXTRA_TITLES: Record<string, { label: string; group: string; icon: LucideIcon }> = {
  '/notifications': { label: 'Notifications', group: 'Overview', icon: FileText },
  '/change-password': { label: 'Change password', group: 'Account', icon: ShieldCheck },
};

export function canSeeNavItem(item: NavItem, can: (permission: string) => boolean): boolean {
  if (!item.permission && !item.anyPermission) return true;
  if (item.permission !== undefined && can(item.permission)) return true;
  return item.anyPermission?.some((code) => can(code)) ?? false;
}

export function findNavItem(path: string): NavItem | undefined {
  return NAV_ITEMS.find((item) => item.path === path);
}

/** The menu entry a location belongs to: `/sales/anything` belongs to `/sales`. */
export function navItemForLocation(pathname: string): NavItem | undefined {
  if (pathname === '/') return findNavItem('/');
  return NAV_ITEMS.filter((item) => item.path !== '/')
    .sort((a, b) => b.path.length - a.path.length)
    .find((item) => pathname === item.path || pathname.startsWith(`${item.path}/`));
}

export interface NavMatch {
  item: NavItem;
  score: number;
}

/**
 * Finds screens by label, group, description or keyword. A label that starts with the text ranks first,
 * then a label that contains it, then the other fields. An empty query matches everything in menu order.
 */
export function searchNavItems(items: readonly NavItem[], query: string): NavItem[] {
  const text = query.trim().toLowerCase();
  if (text === '') return [...items];
  const matches: NavMatch[] = [];
  for (const item of items) {
    const label = item.label.toLowerCase();
    let score = 0;
    if (label.startsWith(text)) score = 4;
    else if (label.includes(text)) score = 3;
    else if (item.group.toLowerCase().includes(text)) score = 2;
    else if (
      item.description.toLowerCase().includes(text) ||
      (item.keywords ?? []).some((word) => word.toLowerCase().includes(text))
    )
      score = 1;
    if (score > 0) matches.push({ item, score });
  }
  return matches.sort((a, b) => b.score - a.score).map((match) => match.item);
}
