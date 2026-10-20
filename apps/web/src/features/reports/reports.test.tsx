import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { ReportInfo, ReportResponse } from '@erp/contracts';
import { jsonResponse, makeSession, routeFetch, signedIn } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';

const SALES: ReportInfo = {
  code: 'SALES',
  title: 'Sales',
  description: 'Issued invoices in the period.',
  usesPeriod: true,
  columns: [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'customer', label: 'Customer', type: 'text' },
    { key: 'total', label: 'Total', type: 'money' },
  ],
};
const STOCK: ReportInfo = {
  code: 'STOCK',
  title: 'Stock',
  description: 'Stock on hand today.',
  usesPeriod: false,
  columns: [
    { key: 'item', label: 'Item', type: 'text' },
    { key: 'available', label: 'Available', type: 'int' },
  ],
};

const response = (info: ReportInfo, over: Partial<ReportResponse> = {}): ReportResponse => ({
  report: info,
  period: info.usesPeriod ? { from: '2026-10-01', to: '2026-10-10' } : null,
  branchId: null,
  rows: [
    { date: '2026-10-02', customer: 'Sunita Rao', total: '1050.50' },
    { date: '2026-10-03', customer: 'Meera', total: '99.00' },
  ],
  totals: { total: '1149.50' },
  page: 1,
  pageSize: 25,
  total: 2,
  totalPages: 1,
  ...over,
});

const BRANCHES = [{ id: '11111111-1111-4111-8111-111111111111', code: 'AA', name: 'Alpha' }];
const PERMS = ['reports.view', 'reports.export'];
const base = (permissions = PERMS, catalog = [SALES, STOCK]) => ({
  ...signedIn(makeSession({ permissions })),
  'GET /api/reports': () => jsonResponse(catalog),
  'GET /api/reference/branches': () => jsonResponse(BRANCHES),
});

describe('reports page', () => {
  it('lists the reports the person may open and shows one with its totals row', async () => {
    const user = userEvent.setup();
    const calls = routeFetch({
      ...base(),
      'GET /api/reports/SALES?*': () => jsonResponse(response(SALES)),
    });
    renderApp('/reports');

    await user.selectOptions(await screen.findByLabelText('Report'), 'SALES');
    const table = await screen.findByRole('table', { name: 'Sales report' });
    expect(within(table).getByText('Sunita Rao')).toBeInTheDocument();
    expect(within(table).getByText('1,050.50')).toBeInTheDocument();
    expect(within(table).getByRole('cell', { name: 'Total' })).toBeInTheDocument();
    expect(within(table).getByText('1,149.50')).toBeInTheDocument();
    expect(screen.getByText('Issued invoices in the period.')).toBeInTheDocument();
    expect(calls.calls.some((c) => /reports\/SALES\?from=\d{4}-\d{2}-01&to=/.test(c.key))).toBe(
      true,
    );
  });

  it('hides the dates for a report about today, and does not send them', async () => {
    const user = userEvent.setup();
    const calls = routeFetch({
      ...base(),
      'GET /api/reports/STOCK?*': () =>
        jsonResponse(
          response(STOCK, { rows: [{ item: 'TOTO', available: 3 }], totals: { available: '3' } }),
        ),
    });
    renderApp('/reports');
    await user.selectOptions(await screen.findByLabelText('Report'), 'STOCK');
    expect(await screen.findByText('TOTO')).toBeInTheDocument();
    expect(screen.queryByLabelText('From')).not.toBeInTheDocument();
    expect(screen.getByText(/the dates do not apply/)).toBeInTheDocument();
    const stockCall = calls.calls.find((c) => c.key.includes('/reports/STOCK'))!;
    expect(stockCall.key).not.toContain('from=');
  });

  it('sorts by a column when its heading is clicked, and back again', async () => {
    const user = userEvent.setup();
    const calls = routeFetch({
      ...base(),
      'GET /api/reports/SALES?*': () => jsonResponse(response(SALES)),
    });
    renderApp('/reports');
    await user.selectOptions(await screen.findByLabelText('Report'), 'SALES');
    await user.click(await screen.findByRole('button', { name: 'Total' }));
    await waitFor(() =>
      expect(calls.calls.some((c) => c.key.includes('sortBy=total&sortOrder=asc'))).toBe(true),
    );
    await user.click(screen.getByRole('button', { name: /Total/ }));
    await waitFor(() =>
      expect(calls.calls.some((c) => c.key.includes('sortBy=total&sortOrder=desc'))).toBe(true),
    );
    expect(screen.getByRole('columnheader', { name: /Total/ })).toHaveAttribute(
      'aria-sort',
      'descending',
    );
  });

  it('filters by branch and pages through a long result', async () => {
    const user = userEvent.setup();
    const calls = routeFetch({
      ...base(),
      'GET /api/reports/SALES?*': () => jsonResponse(response(SALES, { total: 60, totalPages: 3 })),
    });
    renderApp('/reports');
    await user.selectOptions(await screen.findByLabelText('Report'), 'SALES');
    await user.click(await screen.findByRole('button', { name: 'Next' }));
    await waitFor(() => expect(calls.calls.some((c) => c.key.includes('page=2'))).toBe(true));
    await user.selectOptions(screen.getByLabelText('Branch'), BRANCHES[0]!.id);
    await waitFor(() =>
      expect(
        calls.calls.some(
          (c) => c.key.includes(`branchId=${BRANCHES[0]!.id}`) && c.key.includes('page=1'),
        ),
      ).toBe(true),
    );
  });

  it('offers downloads that carry the chosen filters, only with the export permission', async () => {
    const user = userEvent.setup();
    routeFetch({ ...base(), 'GET /api/reports/SALES?*': () => jsonResponse(response(SALES)) });
    renderApp('/reports');
    await user.selectOptions(await screen.findByLabelText('Report'), 'SALES');
    const excel = await screen.findByRole('link', { name: 'Download Excel' });
    expect(excel.getAttribute('href')).toMatch(
      /^\/api\/reports\/SALES\/export\?from=\d{4}-\d{2}-01&to=\d{4}-\d{2}-\d{2}&format=xlsx/,
    );
    expect(screen.getByRole('link', { name: 'Download PDF' }).getAttribute('href')).toContain(
      'format=pdf',
    );
  });

  it('hides the downloads from someone who may only view', async () => {
    const user = userEvent.setup();
    routeFetch({
      ...base(['reports.view']),
      'GET /api/reports/SALES?*': () => jsonResponse(response(SALES)),
    });
    renderApp('/reports');
    await user.selectOptions(await screen.findByLabelText('Report'), 'SALES');
    await screen.findByRole('table', { name: 'Sales report' });
    expect(screen.queryByRole('link', { name: 'Download Excel' })).not.toBeInTheDocument();
  });

  it('refuses a back-to-front period on the page without asking the server', async () => {
    const user = userEvent.setup();
    const calls = routeFetch({
      ...base(),
      'GET /api/reports/SALES?*': () => jsonResponse(response(SALES)),
    });
    renderApp('/reports');
    await user.selectOptions(await screen.findByLabelText('Report'), 'SALES');
    await screen.findByRole('table', { name: 'Sales report' });
    const before = calls.calls.filter((c) => c.key.includes('/reports/SALES')).length;
    const to = screen.getByLabelText('To');
    await user.clear(to);
    await user.type(to, '2020-01-01');
    expect(await screen.findByRole('alert')).toHaveTextContent('The end date is before the start');
    expect(calls.calls.filter((c) => c.key.includes('/reports/SALES')).length).toBe(before);
  });

  it('says so when there are no rows, and when the person may open no reports', async () => {
    const user = userEvent.setup();
    routeFetch({
      ...base(),
      'GET /api/reports/SALES?*': () =>
        jsonResponse(
          response(SALES, { rows: [], total: 0, totalPages: 0, totals: { total: '0.00' } }),
        ),
    });
    renderApp('/reports');
    await user.selectOptions(await screen.findByLabelText('Report'), 'SALES');
    expect(await screen.findByText('No rows for these filters.')).toBeInTheDocument();
  });

  it('explains when the person may open no reports', async () => {
    routeFetch(base(PERMS, []));
    renderApp('/reports');
    expect(await screen.findByText(/may not open any reports/)).toBeInTheDocument();
  });

  it('shows an error with a retry', async () => {
    const user = userEvent.setup();
    let failing = true;
    routeFetch({
      ...base(),
      'GET /api/reports/SALES?*': () =>
        failing
          ? jsonResponse(
              { code: 'INTERNAL_ERROR', message: 'Database is busy', details: [], requestId: 'r' },
              500,
            )
          : jsonResponse(response(SALES)),
    });
    renderApp('/reports');
    await user.selectOptions(await screen.findByLabelText('Report'), 'SALES');
    expect(await screen.findByRole('alert')).toHaveTextContent('Database is busy');
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Sunita Rao')).toBeInTheDocument();
  });

  it('is closed to a user without the permission', async () => {
    routeFetch(signedIn(makeSession({ permissions: ['stock.view'] })));
    renderApp('/reports');
    expect(await screen.findByText('You do not have access')).toBeInTheDocument();
  });
});
