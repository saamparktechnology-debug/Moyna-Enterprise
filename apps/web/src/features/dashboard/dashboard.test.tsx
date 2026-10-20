import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { cloneElement } from 'react';
import type { ReactElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { BranchDashboard, CompanyDashboard } from '@erp/contracts';
import { jsonResponse, makeSession, routeFetch, signedIn } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';

vi.mock('recharts', async () => {
  const actual = await vi.importActual<typeof import('recharts')>('recharts');
  return {
    ...actual,
    // jsdom has no layout, so give the charts a fixed size.
    ResponsiveContainer: ({
      children,
    }: {
      children: ReactElement<{ width?: number; height?: number }>;
    }) => cloneElement(children, { width: 600, height: 250 }),
  };
});

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

const sales = (total: string) => ({
  invoices: 3,
  sales: total,
  creditNotes: '0.00',
  revenue: total,
  collected: '100.00',
});
const dues = { invoices: 2, outstanding: '1500.00', overdue: '500.00', overdueInvoices: 1 };
const leads = { created: 6, won: 1, conversionRate: 16.7 };
const stock = { units: 14, value: '300.00', itemsWithoutCost: 2 };

const performance = (id: string, code: string, name: string, total: string) => ({
  branchId: id,
  branchCode: code,
  branchName: name,
  isActive: true,
  sales: sales(total),
  purchases: { orders: 1, value: '200.00' },
  stock,
  dues,
  leads,
  commissionPayable: '5.00',
  commissionPaid: '2.00',
  lowStockItems: 1,
  batteriesExpired: 0,
  batteriesExpiring: 1,
});

const trend = [
  { day: '2026-10-01', sales: '10.00', purchases: '0.00', collected: '5.00' },
  { day: '2026-10-02', sales: '0.00', purchases: '3.00', collected: '0.00' },
];

const company: CompanyDashboard = {
  period: { from: '2026-10-01', to: '2026-10-02' },
  withinDays: 30,
  branchCount: 2,
  sales: { ...sales('1050.00'), revenue: '1000.00' },
  purchases: { orders: 2, value: '400.00' },
  stock,
  dues,
  leads,
  commissions: { payable: '10.00', paid: '4.00' },
  alerts: { lowStockItems: 2, batteriesExpired: 3, batteriesExpiring: 4 },
  branches: [performance(A, 'AA', 'Alpha', '630.00'), performance(B, 'BB', 'Beta', '420.00')],
  trend,
};

const branchOf = (id: string, code: string, name: string): BranchDashboard => ({
  period: { from: '2026-10-01', to: '2026-10-02' },
  withinDays: 30,
  branch: { id, code, name },
  sales: sales('630.00'),
  purchases: { orders: 2, value: '740.00' },
  stock: { ...stock, lowStockItems: 1 },
  transfers: { incoming: 2, outgoing: 1 },
  dues,
  followups: { overdue: 1, today: 2, upcoming: 3 },
  leads,
  alerts: { batteriesExpired: 1, batteriesExpiring: 2 },
  trend,
});

const SUPER = ['dashboards.view_company', 'dashboards.view_branch'];
const BRANCH_ONLY = ['dashboards.view_branch'];

function setup(
  handlers: Record<string, RouteHandler>,
  permissions: string[],
  branches = [{ id: A, code: 'AA', name: 'Alpha' }],
) {
  return routeFetch({
    ...signedIn(makeSession({ permissions, branches })),
    ...handlers,
  });
}

beforeEach(() => {
  class FakeResizeObserver {
    observe(): void {}
    unobserve(): void {}
    disconnect(): void {}
  }
  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
});

describe('dashboard', () => {
  it('shows the company figures, a line per branch and the charts to a user who may see them', async () => {
    const calls = setup({ 'GET /api/dashboards/company*': () => jsonResponse(company) }, SUPER);
    renderApp('/');

    expect(await screen.findByText('₹1,050.00')).toBeInTheDocument();
    expect(screen.getByText('Active branches').nextSibling).toHaveTextContent('2');
    expect(screen.getByText('Lead conversion').nextSibling).toHaveTextContent('16.7%');
    expect(
      await screen.findByRole('img', { name: /for each day/i }, { timeout: 5000 }),
    ).toBeInTheDocument();
    expect(
      await screen.findByRole('img', { name: /for each branch/i }, { timeout: 5000 }),
    ).toBeInTheDocument();
    const table = screen.getByRole('table');
    expect(within(table).getByRole('button', { name: 'AA · Alpha' })).toBeInTheDocument();
    expect(within(table).getByRole('button', { name: 'BB · Beta' })).toBeInTheDocument();
    expect(
      calls.calls.some((c) =>
        /^GET \/api\/dashboards\/company\?from=\d{4}-\d{2}-01&to=/.test(c.key),
      ),
    ).toBe(true);
  });

  it('opens one branch from the table and can go back to the company', async () => {
    const user = userEvent.setup();
    setup(
      {
        'GET /api/dashboards/company*': () => jsonResponse(company),
        [`GET /api/dashboards/branch?branchId=${B}&`]: () =>
          jsonResponse(branchOf(B, 'BB', 'Beta')),
        'GET /api/dashboards/branch*': () => jsonResponse(branchOf(B, 'BB', 'Beta')),
      },
      SUPER,
    );
    renderApp('/');

    await user.click(await screen.findByRole('button', { name: 'BB · Beta' }));
    expect(await screen.findByRole('heading', { name: 'BB · Beta' })).toBeInTheDocument();
    expect(screen.getByText('Transfers coming in').nextSibling).toHaveTextContent('2');
    expect(screen.getByText('Follow-ups overdue').nextSibling).toHaveTextContent('1');

    await user.selectOptions(screen.getByLabelText('Show'), '');
    expect(await screen.findByText('Branch performance')).toBeInTheDocument();
  });

  it('shows a branch user their own branch without asking for the company', async () => {
    const calls = setup(
      { 'GET /api/dashboards/branch*': () => jsonResponse(branchOf(A, 'AA', 'Alpha')) },
      BRANCH_ONLY,
    );
    renderApp('/');

    expect(await screen.findByRole('heading', { name: 'AA · Alpha' })).toBeInTheDocument();
    expect(screen.getByText('Current stock').nextSibling).toHaveTextContent('14 units');
    expect(calls.calls.some((c) => c.key.startsWith('GET /api/dashboards/company'))).toBe(false);
    expect(screen.queryByLabelText('Show')).not.toBeInTheDocument();
  });

  it('asks a user with several branches to choose one', async () => {
    const user = userEvent.setup();
    setup(
      { 'GET /api/dashboards/branch*': () => jsonResponse(branchOf(B, 'BB', 'Beta')) },
      BRANCH_ONLY,
      [
        { id: A, code: 'AA', name: 'Alpha' },
        { id: B, code: 'BB', name: 'Beta' },
      ],
    );
    renderApp('/');

    expect(await screen.findByText('Choose a branch to see its dashboard.')).toBeInTheDocument();
    await user.selectOptions(screen.getByLabelText('Show'), B);
    expect(await screen.findByRole('heading', { name: 'BB · Beta' })).toBeInTheDocument();
  });

  it('shows only the system status to a user with no dashboard permission, and asks the server for nothing', async () => {
    const calls = setup({}, ['stock.view']);
    renderApp('/');

    expect(await screen.findByText('System status')).toBeInTheDocument();
    expect(screen.queryByLabelText('Dashboard period')).not.toBeInTheDocument();
    expect(calls.calls.some((c) => c.key.includes('/dashboards/'))).toBe(false);
  });

  it('shows a loading state, then an error with a working retry', async () => {
    const user = userEvent.setup();
    let failing = true;
    setup(
      {
        'GET /api/dashboards/company*': () =>
          failing
            ? jsonResponse(
                {
                  code: 'INTERNAL_ERROR',
                  message: 'Database is busy',
                  details: [],
                  requestId: 'r',
                },
                500,
              )
            : jsonResponse(company),
      },
      SUPER,
    );
    renderApp('/');

    expect(await screen.findByRole('alert')).toHaveTextContent('Database is busy');
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('₹1,050.00')).toBeInTheDocument();
  });

  it('shows empty figures as zeros and a dash for conversion, not a broken page', async () => {
    const empty: CompanyDashboard = {
      ...company,
      sales: sales('0.00'),
      leads: { created: 0, won: 0, conversionRate: null },
      branches: [],
      trend: [],
    };
    setup({ 'GET /api/dashboards/company*': () => jsonResponse(empty) }, SUPER);
    renderApp('/');

    expect((await screen.findByText('Lead conversion')).nextSibling).toHaveTextContent('—');
    expect(screen.getAllByText('₹0.00').length).toBeGreaterThan(0);
  });

  it('does not ask the server for a back-to-front or over-long period', async () => {
    const user = userEvent.setup();
    const calls = setup({ 'GET /api/dashboards/company*': () => jsonResponse(company) }, SUPER);
    renderApp('/');
    await screen.findByText('₹1,050.00');
    const dashboardCalls = () => calls.calls.filter((c) => c.key.includes('/dashboards/')).length;
    const before = dashboardCalls();

    const to = screen.getByLabelText('To');
    await user.clear(to);
    await user.type(to, '2020-01-01');
    expect(await screen.findByRole('alert')).toHaveTextContent('The end date is before the start');

    const from = screen.getByLabelText('From');
    await user.clear(from);
    await user.type(from, '2018-01-01');
    expect(await screen.findByRole('alert')).toHaveTextContent('Choose at most 366 days');
    expect(dashboardCalls()).toBe(before);
    await user.click(screen.getByRole('button', { name: 'This month' }));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
  });
});
