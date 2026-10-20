import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type {
  AuditLogResponse,
  DocumentSeriesListResponse,
  GstRateAdmin,
  Setting,
} from '@erp/contracts';
import { jsonResponse, makeSession, routeFetch, signedIn } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';

const ID = (n: number): string => `00000000-0000-4000-8000-00000000000${n}`;
const BRANCH = '11111111-1111-4111-8111-111111111111';

const setting = (over: Partial<Setting>): Setting => ({
  key: 'company.name',
  group: 'company',
  label: 'Company name',
  description: 'The trading name of the business.',
  type: 'text',
  value: null,
  defaultValue: null,
  source: 'DEFAULT',
  rowVersion: null,
  updatedAt: null,
  ...over,
});
const SETTINGS: Setting[] = [
  setting({}),
  setting({
    key: 'approvals.adjustment_admin_limit',
    group: 'approvals',
    label: 'Stock adjustment approval limit (units)',
    description: 'The most units an Admin may approve.',
    type: 'int',
    value: 10,
    defaultValue: 10,
  }),
];
const SERIES: DocumentSeriesListResponse = {
  items: [
    {
      id: ID(1),
      branchId: BRANCH,
      branchCode: 'AA',
      docType: 'INVOICE_GST',
      financialYear: '2026-27',
      prefix: 'AA',
      nextNumber: 5,
      nextExample: 'AA/2627/00005',
      rowVersion: 1,
    },
  ],
  page: 1,
  pageSize: 20,
  total: 1,
  totalPages: 1,
};
const RATES: GstRateAdmin[] = [
  { id: ID(2), rate: '5.00', label: 'GST 5%', isActive: true, itemsUsing: 3, rowVersion: 1 },
  { id: ID(3), rate: '12.00', label: 'GST 12%', isActive: true, itemsUsing: 0, rowVersion: 2 },
];
const AUDIT: AuditLogResponse = {
  items: [
    {
      id: ID(4),
      createdAt: '2026-10-10T08:00:00.000Z',
      actorId: ID(5),
      actorName: 'Asha Verma',
      branchId: BRANCH,
      branchCode: 'AA',
      action: 'REFUND_PAID',
      entityType: 'CustomerRefund',
      entityId: null,
      oldValue: null,
      newValue: { amount: '500.00' },
      ipAddress: '10.0.0.1',
      requestId: 'req-1',
    },
  ],
  page: 1,
  pageSize: 25,
  total: 1,
  totalPages: 1,
};

const SUPER = ['settings.manage', 'audit.view'];
const base = (permissions = SUPER) => ({
  ...signedIn(makeSession({ permissions })),
  'GET /api/settings': () => jsonResponse(SETTINGS),
  'GET /api/reference/branches': () => jsonResponse([{ id: BRANCH, code: 'AA', name: 'Alpha' }]),
  'GET /api/audit-log/facets': () =>
    jsonResponse({ actions: ['REFUND_PAID'], entityTypes: ['CustomerRefund'] }),
  'GET /api/users?*': () =>
    jsonResponse({ items: [], page: 1, pageSize: 100, total: 0, totalPages: 0 }),
});

describe('settings page', () => {
  it('shows only the tabs a person may use', async () => {
    routeFetch(base(['audit.view']));
    renderApp('/settings');
    expect(await screen.findByRole('tab', { name: 'Audit log' })).toBeInTheDocument();
    expect(screen.queryByRole('tab', { name: 'Tax rates' })).not.toBeInTheDocument();
  });

  it('puts Settings in the menu for someone who may only read the audit log', async () => {
    routeFetch(base(['audit.view']));
    renderApp('/');
    const menu = await screen.findByRole('navigation', { name: 'Main navigation' });
    expect(within(menu).getByRole('link', { name: 'Settings' })).toBeInTheDocument();
  });

  it('shows company details and limits with where each value comes from', async () => {
    routeFetch(base());
    renderApp('/settings');
    expect(await screen.findByLabelText('Company name')).toHaveValue('');
    expect(screen.getByText('Not set.')).toBeInTheDocument();
    expect(screen.getByLabelText('Stock adjustment approval limit (units)')).toHaveValue('10');
    expect(screen.getByText('Default in use: 10.')).toBeInTheDocument();
  });

  it('saves a changed value and says so, and offers the default back once saved', async () => {
    const user = userEvent.setup();
    let saved = false;
    const calls = routeFetch({
      ...base(),
      'GET /api/settings': () =>
        jsonResponse(
          saved
            ? [setting({ value: 'Sharma Motors', source: 'SETTING', rowVersion: 1 }), SETTINGS[1]!]
            : SETTINGS,
        ),
      'PUT /api/settings/company.name': () => {
        saved = true;
        return jsonResponse(setting({ value: 'Sharma Motors', source: 'SETTING', rowVersion: 1 }));
      },
    });
    renderApp('/settings');
    const input = await screen.findByLabelText('Company name');
    const save = within(input.closest('div')!.parentElement!).getByRole('button', { name: 'Save' });
    expect(save).toBeDisabled();
    await user.type(input, 'Sharma Motors');
    await user.click(save);
    expect(await screen.findByText('Saved')).toBeInTheDocument();
    const put = calls.calls.find((c) => c.key === 'PUT /api/settings/company.name')!;
    expect(put.body).toEqual({ value: 'Sharma Motors' });
    expect(await screen.findByRole('button', { name: 'Use the default' })).toBeInTheDocument();
  });

  it('shows the server’s reason when a value is refused', async () => {
    const user = userEvent.setup();
    routeFetch({
      ...base(),
      'PUT /api/settings/company.name': () =>
        jsonResponse(
          {
            code: 'VALIDATION_ERROR',
            message: 'Request validation failed',
            details: [{ field: 'value', message: 'Enter a valid 15-character GSTIN' }],
            requestId: 'r',
          },
          400,
        ),
    });
    renderApp('/settings');
    const input = await screen.findByLabelText('Company name');
    await user.type(input, 'x');
    await user.click(
      within(input.closest('div')!.parentElement!).getByRole('button', { name: 'Save' }),
    );
    expect(await screen.findByRole('alert')).toHaveTextContent('Enter a valid 15-character GSTIN');
  });

  it('lists number series and moves one forward with a reason', async () => {
    const user = userEvent.setup();
    const calls = routeFetch({
      ...base(),
      'GET /api/settings/document-series?*': () => jsonResponse(SERIES),
      [`POST /api/settings/document-series/${ID(1)}/advance`]: () =>
        jsonResponse({
          ...SERIES.items[0]!,
          nextNumber: 101,
          nextExample: 'AA/2627/00101',
          rowVersion: 2,
        }),
    });
    renderApp('/settings');
    await user.click(await screen.findByRole('tab', { name: 'Document numbers' }));
    const table = await screen.findByRole('table', { name: 'Document number series' });
    expect(within(table).getByText('AA/2627/00005')).toBeInTheDocument();
    await user.click(within(table).getByRole('button', { name: 'Move AA/2627/00005 forward' }));
    const form = screen.getByRole('form', { name: 'Move AA forward' });
    const submit = within(form).getByRole('button', { name: 'Move forward' });
    expect(submit).toBeDisabled();
    await user.clear(within(form).getByLabelText('New next number'));
    await user.type(within(form).getByLabelText('New next number'), '101');
    await user.type(within(form).getByLabelText('Reason'), 'Paper book used up to 100');
    await user.click(submit);
    await waitFor(() => expect(calls.calls.some((c) => c.key.endsWith('/advance'))).toBe(true));
    const body = calls.calls.find((c) => c.key.endsWith('/advance'))!.body;
    expect(body).toEqual({ nextNumber: 101, reason: 'Paper book used up to 100', rowVersion: 1 });
  });

  it('shows the server’s reason when a number cannot move', async () => {
    const user = userEvent.setup();
    routeFetch({
      ...base(),
      'GET /api/settings/document-series?*': () => jsonResponse(SERIES),
      [`POST /api/settings/document-series/${ID(1)}/advance`]: () =>
        jsonResponse(
          {
            code: 'BUSINESS_RULE_VIOLATION',
            message: 'Numbers only move forward',
            details: [
              { field: 'nextNumber', message: 'The next number is already 9. Enter a higher one.' },
            ],
            requestId: 'r',
          },
          422,
        ),
    });
    renderApp('/settings');
    await user.click(await screen.findByRole('tab', { name: 'Document numbers' }));
    await user.click(await screen.findByRole('button', { name: 'Move AA/2627/00005 forward' }));
    const form = screen.getByRole('form', { name: 'Move AA forward' });
    await user.type(within(form).getByLabelText('Reason'), 'Because I said so');
    await user.click(within(form).getByRole('button', { name: 'Move forward' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('The next number is already 9');
  });

  it('lists tax rates, adds one and switches one off', async () => {
    const user = userEvent.setup();
    const calls = routeFetch({
      ...base(),
      'GET /api/settings/gst-rates': () => jsonResponse(RATES),
      'POST /api/settings/gst-rates': () =>
        jsonResponse(
          {
            id: ID(6),
            rate: '7.50',
            label: 'GST 7.5%',
            isActive: true,
            itemsUsing: 0,
            rowVersion: 1,
          },
          201,
        ),
      [`PATCH /api/settings/gst-rates/${ID(3)}`]: () =>
        jsonResponse({ ...RATES[1]!, isActive: false, rowVersion: 3 }),
    });
    renderApp('/settings');
    await user.click(await screen.findByRole('tab', { name: 'Tax rates' }));
    const table = await screen.findByRole('table', { name: 'GST rates' });
    expect(within(table).getByText('5.00%')).toBeInTheDocument();
    await user.click(within(table).getByRole('button', { name: 'Switch off 12.00%' }));
    await waitFor(() => expect(calls.calls.some((c) => c.key.startsWith('PATCH'))).toBe(true));
    expect(calls.calls.find((c) => c.key.startsWith('PATCH'))!.body).toEqual({
      isActive: false,
      rowVersion: 2,
    });

    const form = screen.getByRole('form', { name: 'Add a GST rate' });
    expect(within(form).getByRole('button', { name: 'Add rate' })).toBeDisabled();
    await user.type(within(form).getByLabelText('Percentage'), '7.5');
    await user.type(within(form).getByLabelText('Label'), 'GST 7.5%');
    await user.click(within(form).getByRole('button', { name: 'Add rate' }));
    await waitFor(() =>
      expect(calls.calls.some((c) => c.key === 'POST /api/settings/gst-rates')).toBe(true),
    );
  });

  it('explains why a rate in use cannot be switched off', async () => {
    const user = userEvent.setup();
    routeFetch({
      ...base(),
      'GET /api/settings/gst-rates': () => jsonResponse(RATES),
      [`PATCH /api/settings/gst-rates/${ID(2)}`]: () =>
        jsonResponse(
          {
            code: 'BUSINESS_RULE_VIOLATION',
            message: 'This rate is still in use',
            details: [
              {
                field: 'isActive',
                message: '3 active items use 5.00%. Move them to another rate first.',
              },
            ],
            requestId: 'r',
          },
          422,
        ),
    });
    renderApp('/settings');
    await user.click(await screen.findByRole('tab', { name: 'Tax rates' }));
    await user.click(await screen.findByRole('button', { name: 'Switch off 5.00%' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('3 active items use 5.00%');
  });

  it('shows the audit log, with before and after values on request', async () => {
    const user = userEvent.setup();
    routeFetch({ ...base(), 'GET /api/audit-log?*': () => jsonResponse(AUDIT) });
    renderApp('/settings');
    await user.click(await screen.findByRole('tab', { name: 'Audit log' }));
    const table = await screen.findByRole('table', { name: 'Audit log' });
    expect(within(table).getByText('Asha Verma')).toBeInTheDocument();
    expect(within(table).getByText('REFUND_PAID')).toBeInTheDocument();
    await user.click(within(table).getByRole('button', { name: 'Show details of REFUND_PAID' }));
    expect(screen.getByText(/"amount": "500.00"/)).toBeInTheDocument();
    expect(screen.getByText('Nothing recorded')).toBeInTheDocument();
    expect(screen.getByText(/Request req-1/)).toBeInTheDocument();
  });

  it('sends the filters chosen, and shows what a person has been doing', async () => {
    const user = userEvent.setup();
    const calls = routeFetch({
      ...base(),
      'GET /api/audit-log?*': () => jsonResponse(AUDIT),
      'GET /api/users?*': () =>
        jsonResponse({
          items: [{ id: ID(5), fullName: 'Asha Verma' }],
          page: 1,
          pageSize: 100,
          total: 1,
          totalPages: 1,
        }),
      [`GET /api/audit-log/users/${ID(5)}`]: () =>
        jsonResponse({
          userId: ID(5),
          fullName: 'Asha Verma',
          username: 'asha',
          status: 'ACTIVE',
          lastLoginAt: '2026-10-10T08:00:00.000Z',
          activeSessions: 2,
          actionsLast30Days: 14,
          topActions: [{ action: 'REFUND_PAID', count: 9 }],
        }),
    });
    renderApp('/settings');
    await user.click(await screen.findByRole('tab', { name: 'Audit log' }));
    await screen.findByRole('table', { name: 'Audit log' });
    await user.selectOptions(await screen.findByLabelText('Action'), 'REFUND_PAID');
    await waitFor(() =>
      expect(calls.calls.some((c) => c.key.includes('action=REFUND_PAID'))).toBe(true),
    );
    await user.selectOptions(screen.getByLabelText('Person'), ID(5));
    const activity = await screen.findByLabelText('User activity');
    expect(within(activity).getByText('Open sessions: 2')).toBeInTheDocument();
    expect(within(activity).getByText('Actions in the last 30 days: 14')).toBeInTheDocument();
    expect(within(activity).getByText(/REFUND_PAID \(9\)/)).toBeInTheDocument();
  });

  it('refuses a back-to-front date range without asking the server for it', async () => {
    const user = userEvent.setup();
    const calls = routeFetch({ ...base(), 'GET /api/audit-log?*': () => jsonResponse(AUDIT) });
    renderApp('/settings');
    await user.click(await screen.findByRole('tab', { name: 'Audit log' }));
    await screen.findByRole('table', { name: 'Audit log' });
    await user.type(screen.getByLabelText('From'), '2026-10-10');
    await user.type(screen.getByLabelText('To'), '2026-10-01');
    expect(await screen.findByRole('alert')).toHaveTextContent('The end date is before the start');
    expect(
      calls.calls.some((c) => c.key.includes('from=2026-10-10') && c.key.includes('to=2026-10-01')),
    ).toBe(false);
  });

  it('says so when nothing is recorded, and offers a retry after an error', async () => {
    const user = userEvent.setup();
    let failing = true;
    routeFetch({
      ...base(),
      'GET /api/audit-log?*': () =>
        failing
          ? jsonResponse(
              { code: 'INTERNAL_ERROR', message: 'Database is busy', details: [], requestId: 'r' },
              500,
            )
          : jsonResponse({ ...AUDIT, items: [], total: 0, totalPages: 0 }),
    });
    renderApp('/settings');
    await user.click(await screen.findByRole('tab', { name: 'Audit log' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Database is busy');
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Nothing recorded for these filters.')).toBeInTheDocument();
  });

  it('is closed to a user without any settings permission', async () => {
    routeFetch(signedIn(makeSession({ permissions: ['stock.view'] })));
    renderApp('/settings');
    expect(await screen.findByText('You do not have access')).toBeInTheDocument();
  });
});
