import type { RouteObject } from 'react-router';
import { ChangePasswordPage } from '@/features/auth/change-password-page';
import { LoginPage } from '@/features/auth/login-page';
import { RequireAuth } from '@/features/auth/require-auth';
import { RequirePermission } from '@/features/auth/require-permission';
import { RolesPage } from '@/features/roles/roles-page';
import { UsersPage } from '@/features/users/users-page';
import { BatteriesPage } from '@/features/batteries/batteries-page';
import { PurchasingPage } from '@/features/purchasing/purchasing-page';
import { TransfersPage } from '@/features/transfers/transfers-page';
import { BranchesPage } from '@/features/branches/branches-page';
import { InvoicesPage } from '@/features/billing/invoices-page';
import { BrokersPage } from '@/features/brokers/brokers-page';
import { ExchangesPage } from '@/features/exchanges/exchanges-page';
import { HrPage } from '@/features/hr/hr-page';
import { LeadsPage } from '@/features/leads/leads-page';
import { QuotationsPage } from '@/features/quotations/quotations-page';
import { PaymentsPage } from '@/features/payments/payments-page';
import { CustomersPage } from '@/features/customers/customers-page';
import { InventoryPage } from '@/features/inventory/inventory-page';
import { ItemsPage } from '@/features/items/items-page';
import { SettingsPage } from '@/features/settings/settings-page';
import { ReportsPage } from '@/features/reports/reports-page';
import { NotificationsPage } from '@/features/notifications/notifications-page';
import { DashboardPage } from '@/features/dashboard/dashboard-page';
import { AppLayout } from './app-layout';
import { NAV_ITEMS } from './navigation';
import { PlaceholderPage } from './placeholder-page';

const IMPLEMENTED_PATHS = new Set([
  '/',
  '/branches',
  '/users',
  '/roles',
  '/customers',
  '/sales',
  '/payments',
  '/leads',
  '/brokers',
  '/exchanges',
  '/hr',
  '/quotations',
  '/items',
  '/inventory',
  '/batteries',
  '/purchasing',
  '/transfers',
  '/reports',
  '/settings',
]);

export const routes: RouteObject[] = [
  { path: '/login', element: <LoginPage /> },
  {
    element: <RequireAuth />,
    children: [
      {
        path: '/',
        element: <AppLayout />,
        children: [
          { index: true, element: <DashboardPage /> },
          { path: 'change-password', element: <ChangePasswordPage /> },
          {
            path: 'settings',
            element: <SettingsPage />,
          },
          {
            path: 'reports',
            element: (
              <RequirePermission permission="reports.view">
                <ReportsPage />
              </RequirePermission>
            ),
          },
          {
            path: 'notifications',
            element: (
              <RequirePermission permission="notifications.view">
                <NotificationsPage />
              </RequirePermission>
            ),
          },
          {
            path: 'branches',
            element: (
              <RequirePermission permission="branches.view">
                <BranchesPage />
              </RequirePermission>
            ),
          },
          {
            path: 'users',
            element: (
              <RequirePermission permission="users.view">
                <UsersPage />
              </RequirePermission>
            ),
          },
          {
            path: 'roles',
            element: (
              <RequirePermission permission="roles.view">
                <RolesPage />
              </RequirePermission>
            ),
          },
          {
            path: 'sales',
            element: (
              <RequirePermission permission="invoices.view">
                <InvoicesPage />
              </RequirePermission>
            ),
          },
          {
            path: 'quotations',
            element: (
              <RequirePermission permission="quotations.view">
                <QuotationsPage />
              </RequirePermission>
            ),
          },
          {
            path: 'exchanges',
            element: (
              <RequirePermission permission="invoices.view">
                <ExchangesPage />
              </RequirePermission>
            ),
          },
          {
            path: 'hr',
            element: (
              <RequirePermission permission="hr.view">
                <HrPage />
              </RequirePermission>
            ),
          },
          {
            path: 'brokers',
            element: (
              <RequirePermission permission="brokers.view">
                <BrokersPage />
              </RequirePermission>
            ),
          },
          {
            path: 'leads',
            element: (
              <RequirePermission permission="leads.view">
                <LeadsPage />
              </RequirePermission>
            ),
          },
          {
            path: 'payments',
            element: (
              <RequirePermission permission="payments.view">
                <PaymentsPage />
              </RequirePermission>
            ),
          },
          {
            path: 'customers',
            element: (
              <RequirePermission permission="customers.view">
                <CustomersPage />
              </RequirePermission>
            ),
          },
          {
            path: 'items',
            element: (
              <RequirePermission permission="items.view">
                <ItemsPage />
              </RequirePermission>
            ),
          },
          {
            path: 'transfers',
            element: (
              <RequirePermission permission="transfers.view">
                <TransfersPage />
              </RequirePermission>
            ),
          },
          {
            path: 'purchasing',
            element: (
              <RequirePermission permission="purchases.view">
                <PurchasingPage />
              </RequirePermission>
            ),
          },
          {
            path: 'batteries',
            element: (
              <RequirePermission permission="batteries.view">
                <BatteriesPage />
              </RequirePermission>
            ),
          },
          {
            path: 'inventory',
            element: (
              <RequirePermission permission="stock.view">
                <InventoryPage />
              </RequirePermission>
            ),
          },
          ...NAV_ITEMS.filter((item) => !IMPLEMENTED_PATHS.has(item.path)).map((item) => ({
            path: item.path.slice(1),
            element: (
              <RequirePermission permission={item.permission}>
                <PlaceholderPage title={item.label} />
              </RequirePermission>
            ),
          })),
          { path: '*', element: <PlaceholderPage title="Page not found" /> },
        ],
      },
    ],
  },
];
