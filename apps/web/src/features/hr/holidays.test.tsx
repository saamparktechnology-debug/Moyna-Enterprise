//apps/web/src/features/hr/holidays.test.tsx
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Holiday, HolidayListResponse, Roster, Staff } from '@erp/contracts';
import { jsonResponse, routeFetch } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import { billingHandlers, pageOf } from '../billing/test-data';

const STAFF_ID = '7b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59';
const YEAR = Number(new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 4));

const SELF = ['hr.view', 'attendance.mark', 'leave.request'];
const MANAGER = [...SELF, 'hr.manage'];
const SUPER = [...MANAGER, 'settings.manage'];

const holiday = (over: Partial<Holiday> = {}): Holiday => ({
  id: 'h-1',
  date: `${YEAR}-08-15`,
  name: 'Independence Day',
  ...over,
});
const list = (over: Partial<HolidayListResponse> = {}): HolidayListResponse => ({
  year: YEAR,
  weeklyOffDays: ['SUN'],
  paidForDailyStaff: false,
  items: [holiday()],
  ...over,
});
const staff = (over: Partial<Staff> = {}): Staff => ({
  id: STAFF_ID,
  userId: '9b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59',
  fullName: 'Asha Rao',
  username: 'asha',
  branchId: 'branch-1',
  branchCode: 'HQ',
  employeeCode: 'EMP-0001',
  department: null,
  departmentName: null,
  designation: 'Fitter',
  joinDate: '2026-01-01',
  leftOn: null,
  status: 'ACTIVE',
  monthlySalary: '31000.00',
  createdAt: '2026-01-01T05:00:00.000Z',
  rowVersion: 4,
  ...over,
});
const roster = (over: Partial<Roster> = {}): Roster => ({
  staffId: STAFF_ID,
  staffName: 'Asha Rao',
  employeeCode: 'EMP-0001',
  year: YEAR,
  weeklyOffDays: ['SUN'],
  ownWeeklyOff: null,
  companyWeeklyOffDays: ['SUN'],
  daysOff: [],
  companyHolidays: [holiday()],
  rowVersion: 4,
  ...over,
});

const handlers = (
  permissions: string[],
  extra: Record<string, RouteHandler> = {},
): Record<string, RouteHandler> => ({
  ...billingHandlers(permissions, []),
  'GET /api/staff/me': () => jsonResponse(staff()),
  'GET /api/attendance/me': () =>
    jsonResponse({ staffId: STAFF_ID, today: '2026-10-10', current: null }),
  'GET /api/staff?*': () => jsonResponse(pageOf([staff()])),
  'GET /api/staff/departments': () => jsonResponse([]),
  'GET /api/staff/candidates*': () => jsonResponse([]),
  'GET /api/attendance?*': () => jsonResponse({ ...pageOf([]), daysPresent: 0 }),
  'GET /api/leave?*': () => jsonResponse(pageOf([])),
  'GET /api/payroll?*': () =>
    jsonResponse({ ...pageOf([]), totals: { gross: '0.00', deductions: '0.00', net: '0.00' } }),
  'GET /api/holidays?*': () => jsonResponse(list()),
  ...extra,
});
const open = (h: Record<string, RouteHandler>) => {
  const state = routeFetch(h);
  renderApp('/hr');
  return state;
};
const tab = async (name: string) => {
  await userEvent.click(await screen.findByRole('tab', { name }));
};
const posted = (calls: { key: string; body: unknown }[], key: string) =>
  calls.filter((call) => call.key === key).map((call) => call.body);

describe('the Holidays tab', () => {
  it('shows the weekly off, whether daily staff are paid for off days, and the holidays, to anyone in HR', async () => {
    open(handlers(SELF));
    await tab('Holidays');
    const table = await screen.findByRole('table', { name: 'Holidays' });
    expect(within(table).getByText('Independence Day')).toBeInTheDocument();
    expect(within(table).getByText(`${YEAR}-08-15 (Saturday)`)).toBeInTheDocument();
    expect(screen.getByText('Sunday')).toBeInTheDocument();
    expect(screen.getByText(/paid only for the hours they work/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add holiday' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Remove Independence Day' }),
    ).not.toBeInTheDocument();
  });

  it('says so when daily staff are paid for off days, and when there is no weekly off', async () => {
    open(
      handlers(SELF, {
        'GET /api/holidays?*': () =>
          jsonResponse(list({ weeklyOffDays: ['SAT', 'SUN'], paidForDailyStaff: true, items: [] })),
      }),
    );
    await tab('Holidays');
    expect(await screen.findByText('Saturday and Sunday')).toBeInTheDocument();
    expect(
      screen.getByText(/are paid for weekly offs and holidays they do not work/),
    ).toBeInTheDocument();
    expect(screen.getByText(`No holidays are set for ${YEAR}.`)).toBeInTheDocument();
  });

  it('lets the Super Admin add a holiday, checking the date and the name first', async () => {
    const { calls } = open(
      handlers(SUPER, {
        'POST /api/holidays': () => jsonResponse(holiday({ id: 'h-2', name: 'Diwali' }), 201),
      }),
    );
    await tab('Holidays');
    await screen.findByRole('table', { name: 'Holidays' });
    await userEvent.click(screen.getByRole('button', { name: 'Add holiday' }));
    expect(await screen.findByText('Enter a real date')).toBeInTheDocument();
    expect(posted(calls, 'POST /api/holidays')).toHaveLength(0);
    await userEvent.type(screen.getByLabelText('Date'), `${YEAR}-11-08`);
    await userEvent.type(screen.getByLabelText('Holiday name'), 'Diwali');
    await userEvent.click(screen.getByRole('button', { name: 'Add holiday' }));
    await waitFor(() =>
      expect(posted(calls, 'POST /api/holidays')[0]).toEqual({
        date: `${YEAR}-11-08`,
        name: 'Diwali',
      }),
    );
  });

  it('shows what the server refused next to the field', async () => {
    open(
      handlers(SUPER, {
        'POST /api/holidays': () =>
          jsonResponse(
            {
              code: 'CONFLICT',
              message: 'That day is already a holiday',
              details: [{ field: 'date', message: 'It is already marked as Independence Day' }],
              requestId: 'r',
            },
            409,
          ),
      }),
    );
    await tab('Holidays');
    await screen.findByRole('table', { name: 'Holidays' });
    await userEvent.type(screen.getByLabelText('Date'), `${YEAR}-08-15`);
    await userEvent.type(screen.getByLabelText('Holiday name'), 'Again');
    await userEvent.click(screen.getByRole('button', { name: 'Add holiday' }));
    expect(
      (await screen.findAllByText(/already marked as Independence Day/)).length,
    ).toBeGreaterThan(0);
  });

  it('lets the Super Admin remove a holiday', async () => {
    const { calls } = open(
      handlers(SUPER, { 'DELETE /api/holidays/h-1': () => jsonResponse(list({ items: [] })) }),
    );
    await tab('Holidays');
    await userEvent.click(await screen.findByRole('button', { name: 'Remove Independence Day' }));
    await waitFor(() =>
      expect(calls.map((call) => call.key)).toContain('DELETE /api/holidays/h-1'),
    );
  });
});

describe('the roster of an employee', () => {
  const openRoster = async (extra: Record<string, RouteHandler> = {}, permissions = SUPER) => {
    const state = open(
      handlers(permissions, {
        [`GET /api/staff/${STAFF_ID}/roster?*`]: () => jsonResponse(roster()),
        ...extra,
      }),
    );
    await tab('Staff');
    await userEvent.click(await screen.findByRole('button', { name: 'Roster of Asha Rao' }));
    return { ...state, dialog: await screen.findByRole('dialog', { name: 'Roster of Asha Rao' }) };
  };

  it('is offered to the Super Admin only', async () => {
    open(handlers(MANAGER));
    await tab('Staff');
    await screen.findByRole('button', { name: 'Edit Asha Rao' });
    expect(screen.queryByRole('button', { name: 'Roster of Asha Rao' })).not.toBeInTheDocument();
  });

  it('starts from the company’s weekly off, and saves days of their own with the version read', async () => {
    const { dialog, calls } = await openRoster({
      [`PUT /api/staff/${STAFF_ID}/roster/weekly-off`]: () =>
        jsonResponse(
          roster({ ownWeeklyOff: ['SAT', 'SUN'], weeklyOffDays: ['SAT', 'SUN'], rowVersion: 5 }),
        ),
    });
    expect(
      await within(dialog).findByText(/Using the company’s weekly off: Sunday/),
    ).toBeInTheDocument();
    expect(within(dialog).getByRole('checkbox', { name: 'Sunday' })).toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'Saturday' })).not.toBeChecked();
    expect(within(dialog).getByRole('button', { name: 'Save weekly off days' })).toBeDisabled();
    expect(
      within(dialog).getByRole('button', { name: 'Use the company’s weekly off' }),
    ).toBeDisabled();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Saturday' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save weekly off days' }));
    await waitFor(() =>
      expect(posted(calls, `PUT /api/staff/${STAFF_ID}/roster/weekly-off`)[0]).toEqual({
        weeklyOffDays: ['SAT', 'SUN'],
        rowVersion: 4,
      }),
    );
  });

  it('can hand them back to the company’s weekly off, and can give them no weekly off at all', async () => {
    const own = roster({ ownWeeklyOff: ['WED'], weeklyOffDays: ['WED'] });
    const { dialog, calls } = await openRoster({
      [`GET /api/staff/${STAFF_ID}/roster?*`]: () => jsonResponse(own),
      [`PUT /api/staff/${STAFF_ID}/roster/weekly-off`]: () =>
        jsonResponse(roster({ rowVersion: 5 })),
    });
    expect(await within(dialog).findByText(/Their own weekly off: Wednesday/)).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('checkbox', { name: 'Wednesday' }));
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save weekly off days' }));
    await waitFor(() =>
      expect(posted(calls, `PUT /api/staff/${STAFF_ID}/roster/weekly-off`)[0]).toEqual({
        weeklyOffDays: [],
        rowVersion: 4,
      }),
    );
    await userEvent.click(
      within(dialog).getByRole('button', { name: 'Use the company’s weekly off' }),
    );
    await waitFor(() =>
      expect(posted(calls, `PUT /api/staff/${STAFF_ID}/roster/weekly-off`)[1]).toEqual({
        weeklyOffDays: null,
        rowVersion: 4,
      }),
    );
  });

  it('adds and removes a day off for this person, and lists the company holidays', async () => {
    const withDay = roster({ daysOff: [{ id: 'd-1', date: `${YEAR}-03-04`, name: 'Wedding' }] });
    const { dialog, calls } = await openRoster({
      [`GET /api/staff/${STAFF_ID}/roster?*`]: () => jsonResponse(withDay),
      [`POST /api/staff/${STAFF_ID}/roster/days-off`]: () => jsonResponse(withDay, 201),
      [`DELETE /api/staff/${STAFF_ID}/roster/days-off/d-1`]: () => jsonResponse(roster()),
    });
    const days = await within(dialog).findByRole('table', { name: 'Days off' });
    expect(within(days).getByText('Wedding')).toBeInTheDocument();
    expect(within(dialog).getByText(`${YEAR}-08-15 · Independence Day`)).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Date'), `${YEAR}-04-10`);
    await userEvent.type(within(dialog).getByLabelText('Reason (optional)'), 'Fever');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add day off' }));
    await waitFor(() =>
      expect(posted(calls, `POST /api/staff/${STAFF_ID}/roster/days-off`)[0]).toEqual({
        date: `${YEAR}-04-10`,
        name: 'Fever',
      }),
    );
    await userEvent.click(
      within(dialog).getByRole('button', { name: `Remove day off ${YEAR}-03-04` }),
    );
    await waitFor(() =>
      expect(calls.map((call) => call.key)).toContain(
        `DELETE /api/staff/${STAFF_ID}/roster/days-off/d-1`,
      ),
    );
  });

  it('checks the date and shows what the server refused, such as a month that is already paid', async () => {
    const { dialog } = await openRoster({
      [`POST /api/staff/${STAFF_ID}/roster/days-off`]: () =>
        jsonResponse(
          {
            code: 'BUSINESS_RULE_VIOLATION',
            message: 'That month is already paid',
            details: [
              { field: 'date', message: 'The payroll for 2026-02 is final and cannot change' },
            ],
            requestId: 'r',
          },
          422,
        ),
    });
    await within(dialog).findByRole('button', { name: 'Add day off' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add day off' }));
    expect(await within(dialog).findByText('Enter a real date')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Date'), '2026-02-12');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add day off' }));
    expect(
      (await within(dialog).findAllByText(/payroll for 2026-02 is final/)).length,
    ).toBeGreaterThan(0);
  });
});

describe('my day on an off day', () => {
  const withOff = (offDay: unknown) =>
    open(
      handlers(SELF, {
        'GET /api/attendance/me': () =>
          jsonResponse({ staffId: STAFF_ID, today: '2026-10-10', current: null, offDay }),
      }),
    );

  it('says when today is a holiday, a weekly off or a day off of their own, and still lets them punch in', async () => {
    withOff({ kind: 'HOLIDAY', name: 'Diwali' });
    expect(await screen.findByText(/Today is a holiday: Diwali\./)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Punch in' })).toBeInTheDocument();
  });

  it('words a weekly off and a day off of their own', async () => {
    withOff({ kind: 'WEEKLY_OFF', name: null });
    expect(await screen.findByText(/Today is your weekly off\./)).toBeInTheDocument();
  });

  it('says nothing on a working day', async () => {
    withOff(null);
    await screen.findByRole('button', { name: 'Punch in' });
    expect(screen.queryByText(/Today is/)).not.toBeInTheDocument();
  });
});
