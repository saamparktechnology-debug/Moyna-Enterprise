import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Attendance, Leave, Payroll, Staff } from '@erp/contracts';
import { jsonResponse, routeFetch } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';
import { billingHandlers, pageOf } from '../billing/test-data';
import { lastMonth, thisMonth } from './hr-shared';

const STAFF_ID = '7b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59';
const OTHER_ID = '8b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59';
const USER_ID = '9b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59';
const LEAVE_ID = 'ab6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59';
const PAYROLL_ID = 'bb6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59';

const SELF = ['hr.view', 'attendance.mark', 'leave.request'];
const MANAGER = [...SELF, 'hr.manage'];
const VIEWER = ['hr.view'];

const staff = (over: Partial<Staff> = {}): Staff => ({
  id: STAFF_ID,
  userId: USER_ID,
  fullName: 'Asha Rao',
  username: 'asha',
  branchId: 'branch-1',
  branchCode: 'HQ',
  employeeCode: 'EMP-0001',
  department: 'SALES',
  departmentName: 'Sales',
  designation: 'Fitter',
  joinDate: '2026-01-01',
  leftOn: null,
  status: 'ACTIVE',
  monthlySalary: '31000.00',
  createdAt: '2026-01-01T05:00:00.000Z',
  rowVersion: 4,
  ...over,
});
const attendance = (over: Partial<Attendance> = {}): Attendance => ({
  id: 'att-1',
  staffId: STAFF_ID,
  staffName: 'Asha Rao',
  employeeCode: 'EMP-0001',
  workDate: '2026-10-09',
  checkIn: '2026-10-09T04:00:00.000Z',
  checkOut: '2026-10-09T12:30:00.000Z',
  hoursWorked: '8.50',
  state: 'COMPLETE',
  correctedByName: null,
  correctionReason: null,
  ...over,
});
const leave = (over: Partial<Leave> = {}): Leave => ({
  id: LEAVE_ID,
  staffId: STAFF_ID,
  staffName: 'Asha Rao',
  employeeCode: 'EMP-0001',
  branchCode: 'HQ',
  fromDate: '2026-11-02',
  toDate: '2026-11-04',
  days: 3,
  kind: 'PAID',
  reason: 'Family function',
  status: 'PENDING',
  decidedByName: null,
  decidedAt: null,
  decisionNote: null,
  createdByName: 'Asha Rao',
  createdAt: '2026-10-10T05:00:00.000Z',
  rowVersion: 2,
  ...over,
});
const payroll = (over: Partial<Payroll> = {}): Payroll => ({
  id: PAYROLL_ID,
  staffId: STAFF_ID,
  staffName: 'Asha Rao',
  employeeCode: 'EMP-0001',
  branchId: 'branch-1',
  branchCode: 'HQ',
  month: lastMonth(),
  status: 'DRAFT',
  monthlySalary: '31000.00',
  daysInMonth: 31,
  daysEmployed: 31,
  daysPresent: 22,
  paidLeaveDays: 1,
  unpaidLeaveDays: 2,
  gross: '31000.00',
  deductions: '2000.00',
  deductionNote: 'Unpaid leave: 2 days',
  net: '29000.00',
  finalizedByName: null,
  finalizedAt: null,
  rowVersion: 3,
  ...over,
});
const myDay = (current: Attendance | null = null) => ({
  staffId: STAFF_ID,
  today: '2026-10-10',
  current,
});
const refusal = (
  message: string,
  status: number,
  details: { field: string; message: string }[] = [],
) => jsonResponse({ code: 'BUSINESS_RULE_VIOLATION', message, details, requestId: 'r' }, status);

const handlers = (
  permissions: string[] = SELF,
  extra: Record<string, RouteHandler> = {},
): Record<string, RouteHandler> => ({
  ...billingHandlers(permissions, []),
  'GET /api/staff/me': () => jsonResponse(staff()),
  'GET /api/attendance/me': () => jsonResponse(myDay()),
  'GET /api/staff?*': () => jsonResponse(pageOf([staff()])),
  'GET /api/staff/departments': () =>
    jsonResponse([
      { code: 'SALES', name: 'Sales' },
      { code: 'WORKSHOP', name: 'Workshop and assembly' },
    ]),
  'GET /api/staff/candidates*': () =>
    jsonResponse([{ userId: USER_ID, fullName: 'Ravi Kumar', username: 'ravi' }]),
  'GET /api/attendance?*': () => jsonResponse({ ...pageOf([attendance()]), daysPresent: 1 }),
  'GET /api/leave?*': () => jsonResponse(pageOf([leave()])),
  'GET /api/payroll?*': () =>
    jsonResponse({
      ...pageOf([payroll()]),
      totals: { gross: '31000.00', deductions: '2000.00', net: '29000.00' },
    }),
  ...extra,
});
const open = (h: Record<string, RouteHandler> = handlers()) => {
  const state = routeFetch(h);
  const view = renderApp('/hr');
  return { ...state, ...view };
};
const sent = (calls: { key: string; body: unknown }[], key: string) =>
  calls.filter((c) => c.key === key);
const lastCall = (calls: { key: string }[], prefix: string) =>
  calls.filter((c) => c.key.startsWith(prefix)).at(-1)?.key ?? '';
const tab = async (name: string) => {
  await userEvent.click(await screen.findByRole('tab', { name }));
};

describe('the HR page and who sees what', () => {
  it('gives a staff member their day, leave, attendance, pay and own profile, and starts on their day', async () => {
    open();
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([
      'My day',
      'Leave',
      'Attendance',
      'Payroll',
      'Staff',
    ]);
    expect(screen.getByRole('tab', { name: 'My day' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('button', { name: 'Add staff' })).not.toBeInTheDocument();
  });

  it('starts on leave for someone who cannot mark attendance', async () => {
    open(handlers(VIEWER));
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual(['Leave', 'Attendance', 'Payroll', 'Staff']);
    expect(await screen.findByRole('table', { name: 'Leave' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Ask for leave' })).not.toBeInTheDocument();
  });

  it('keeps people without hr.view away, and lists HR in the menu for those who may', async () => {
    open(handlers(['stock.view']));
    expect(await screen.findByText('You do not have access')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'HR' })).not.toBeInTheDocument();
  });

  it('lists HR in the menu for people who may view it', async () => {
    open(handlers(VIEWER));
    expect(await screen.findByRole('link', { name: 'HR' })).toBeInTheDocument();
  });
});

describe('my day', () => {
  it('says so when there is no staff profile', async () => {
    open(
      handlers(SELF, {
        'GET /api/staff/me': () =>
          jsonResponse({ code: 'NOT_FOUND', message: 'x', details: [], requestId: 'r' }, 404),
      }),
    );
    expect(await screen.findByText(/You have no staff profile yet/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check in' })).not.toBeInTheDocument();
  });

  it('checks in, and shows the result', async () => {
    const { calls } = open(
      handlers(SELF, {
        'POST /api/attendance/check-in': () =>
          jsonResponse(attendance({ state: 'OPEN', checkOut: null, hoursWorked: null }), 201),
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Check in' }));
    expect(await screen.findByText('Checked in')).toBeInTheDocument();
    expect(sent(calls, 'POST /api/attendance/check-in')).toHaveLength(1);
  });

  it('offers check out for an open shift, even one from before midnight', async () => {
    const { calls } = open(
      handlers(SELF, {
        'GET /api/attendance/me': () =>
          jsonResponse(
            myDay(
              attendance({
                state: 'OPEN',
                checkOut: null,
                hoursWorked: null,
                workDate: '2026-10-09',
              }),
            ),
          ),
        'POST /api/attendance/check-out': () => jsonResponse(attendance()),
      }),
    );
    expect(
      await screen.findByText(/Checked in at \d{2}:\d{2}.* on 2026-10-09/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check in' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Check out' }));
    expect(await screen.findByText('Checked out')).toBeInTheDocument();
    expect(sent(calls, 'POST /api/attendance/check-out')).toHaveLength(1);
  });

  it('shows a finished day with its hours, and nothing more to do', async () => {
    open(handlers(SELF, { 'GET /api/attendance/me': () => jsonResponse(myDay(attendance())) }));
    expect(await screen.findByText(/Done for today.*8.50 hours/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check in' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check out' })).not.toBeInTheDocument();
  });

  it('does not offer attendance to someone who has left', async () => {
    open(
      handlers(SELF, {
        'GET /api/staff/me': () =>
          jsonResponse(staff({ status: 'INACTIVE', leftOn: '2026-09-30' })),
      }),
    );
    expect(await screen.findByText(/You left on 2026-09-30/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Check in' })).not.toBeInTheDocument();
  });

  it('shows why the server refused, such as being on leave', async () => {
    open(
      handlers(SELF, {
        'POST /api/attendance/check-in': () =>
          refusal('You are on approved leave today', 422, [
            { field: 'checkIn', message: 'Cancel the leave first if you are working' },
          ]),
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Check in' }));
    expect(await screen.findByText('You are on approved leave today')).toBeInTheDocument();
    expect(screen.getByText('Cancel the leave first if you are working')).toBeInTheDocument();
  });

  it('lists the month so far', async () => {
    open();
    const row = within(await screen.findByRole('table', { name: 'My attendance' })).getAllByRole(
      'row',
    )[1] as HTMLElement;
    expect(row).toHaveTextContent('2026-10-09');
    expect(row).toHaveTextContent('8.50');
  });
});

describe('leave', () => {
  it('lists leave with its days, kind, status and reason', async () => {
    open(handlers(VIEWER));
    const row = within(await screen.findByRole('table', { name: 'Leave' })).getAllByRole(
      'row',
    )[1] as HTMLElement;
    expect(row).toHaveTextContent('Asha Rao');
    expect(row).toHaveTextContent('2026-11-02 to 2026-11-04');
    expect(row).toHaveTextContent('3 days');
    expect(row).toHaveTextContent('Paid leave');
    expect(row).toHaveTextContent('Waiting for a decision');
    expect(row).toHaveTextContent('Family function');
  });

  it('asks the server for the status and month the user chose', async () => {
    const { calls } = open(handlers(VIEWER));
    await screen.findByRole('table', { name: 'Leave' });
    await userEvent.selectOptions(screen.getByLabelText('Leave status'), 'APPROVED');
    await userEvent.type(screen.getByLabelText('Leave in month'), '2026-11');
    await waitFor(() => {
      const last = lastCall(calls, 'GET /api/leave?');
      expect(last).toContain('status=APPROVED');
      expect(last).toContain('month=2026-11');
    });
  });

  it('refuses a last day before the first and sends nothing', async () => {
    const { calls } = open(handlers(SELF));
    await tab('Leave');
    await userEvent.click(await screen.findByRole('button', { name: 'Ask for leave' }));
    const dialog = await screen.findByRole('dialog');
    const from = within(dialog).getByLabelText('First day');
    const to = within(dialog).getByLabelText('Last day');
    await userEvent.clear(from);
    await userEvent.type(from, '2026-11-10');
    await userEvent.clear(to);
    await userEvent.type(to, '2026-11-09');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ask for leave' }));
    expect(
      await within(dialog).findByText('The last day cannot be before the first'),
    ).toBeInTheDocument();
    expect(sent(calls, 'POST /api/leave')).toHaveLength(0);
  });

  it('sends a request for oneself, without a person chosen', async () => {
    const { calls } = open(handlers(SELF, { 'POST /api/leave': () => jsonResponse(leave(), 201) }));
    await tab('Leave');
    await userEvent.click(await screen.findByRole('button', { name: 'Ask for leave' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText('For')).not.toBeInTheDocument();
    const from = within(dialog).getByLabelText('First day');
    const to = within(dialog).getByLabelText('Last day');
    await userEvent.clear(from);
    await userEvent.type(from, '2026-11-02');
    await userEvent.clear(to);
    await userEvent.type(to, '2026-11-04');
    await userEvent.selectOptions(within(dialog).getByLabelText('Kind of leave'), 'UNPAID');
    await userEvent.type(within(dialog).getByLabelText('Reason'), ' Family function ');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ask for leave' }));
    expect(
      await screen.findByText('Leave from 2026-11-02 to 2026-11-04 is waiting for a decision'),
    ).toBeInTheDocument();
    expect(sent(calls, 'POST /api/leave')[0]?.body).toEqual({
      fromDate: '2026-11-02',
      toDate: '2026-11-04',
      kind: 'UNPAID',
      reason: 'Family function',
    });
  });

  it('lets a manager ask for someone else, and sends who', async () => {
    const { calls } = open(
      handlers(MANAGER, { 'POST /api/leave': () => jsonResponse(leave(), 201) }),
    );
    await tab('Leave');
    await userEvent.click(await screen.findByRole('button', { name: 'Ask for leave' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(await within(dialog).findByLabelText('For'), STAFF_ID);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ask for leave' }));
    await screen.findByText(/is waiting for a decision/);
    expect(sent(calls, 'POST /api/leave')[0]?.body).toMatchObject({ staffId: STAFF_ID });
  });

  it('shows what the server refused, such as overlapping leave', async () => {
    open(
      handlers(SELF, {
        'POST /api/leave': () =>
          refusal('These dates overlap other leave', 409, [
            {
              field: 'fromDate',
              message: 'Leave from 2026-11-01 to 2026-11-03 is already approved',
            },
          ]),
      }),
    );
    await tab('Leave');
    await userEvent.click(await screen.findByRole('button', { name: 'Ask for leave' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Ask for leave' }));
    expect(await within(dialog).findByText('These dates overlap other leave')).toBeInTheDocument();
    expect(within(dialog).getAllByText(/already approved/).length).toBeGreaterThan(0);
  });

  it('lets a manager approve with the version that was read', async () => {
    const { calls } = open(
      handlers(MANAGER, {
        [`POST /api/leave/${LEAVE_ID}/approve`]: () => jsonResponse(leave({ status: 'APPROVED' })),
      }),
    );
    await tab('Leave');
    await userEvent.click(await screen.findByRole('button', { name: 'Approve leave of Asha Rao' }));
    expect(await screen.findByText('Leave of Asha Rao approved')).toBeInTheDocument();
    expect(sent(calls, `POST /api/leave/${LEAVE_ID}/approve`)[0]?.body).toEqual({ rowVersion: 2 });
  });

  it('needs a reason to reject, and sends it', async () => {
    const { calls } = open(
      handlers(MANAGER, {
        [`POST /api/leave/${LEAVE_ID}/reject`]: () => jsonResponse(leave({ status: 'REJECTED' })),
      }),
    );
    await tab('Leave');
    await userEvent.click(await screen.findByRole('button', { name: 'Reject leave of Asha Rao' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject leave' }));
    expect(
      await within(dialog).findByText('Give a reason of at least 3 characters'),
    ).toBeInTheDocument();
    expect(sent(calls, `POST /api/leave/${LEAVE_ID}/reject`)).toHaveLength(0);
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Busy season');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Reject leave' }));
    expect(await screen.findByText('Leave of Asha Rao rejected')).toBeInTheDocument();
    expect(sent(calls, `POST /api/leave/${LEAVE_ID}/reject`)[0]?.body).toEqual({
      rowVersion: 2,
      note: 'Busy season',
    });
  });

  it("lets someone withdraw their leave, and shows the server's reason when it refuses", async () => {
    open(
      handlers(SELF, {
        [`POST /api/leave/${LEAVE_ID}/cancel`]: () =>
          jsonResponse(
            {
              code: 'FORBIDDEN',
              message: 'This leave has already started. Ask a manager to cancel it',
              details: [],
              requestId: 'r',
            },
            403,
          ),
      }),
    );
    await tab('Leave');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Withdraw leave of Asha Rao' }),
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Withdraw leave' }));
    expect(await screen.findByText(/already started/)).toBeInTheDocument();
  });

  it('shows no approving to someone who is not a manager', async () => {
    open(handlers(SELF));
    await tab('Leave');
    await screen.findByRole('table', { name: 'Leave' });
    expect(screen.queryByRole('button', { name: /Approve leave/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Reject leave of/ })).not.toBeInTheDocument();
  });
});

describe('attendance', () => {
  it('lists the month with who, when and any correction, and says how many days were present', async () => {
    open(
      handlers(VIEWER, {
        'GET /api/attendance?*': () =>
          jsonResponse({
            ...pageOf([
              attendance({ correctionReason: 'Forgot to mark', correctedByName: 'Meera Nair' }),
              attendance({
                id: 'att-2',
                workDate: '2026-10-08',
                state: 'OPEN',
                checkOut: null,
                hoursWorked: null,
              }),
            ]),
            daysPresent: 2,
          }),
      }),
    );
    await tab('Attendance');
    expect(await screen.findByText(`2 days present in ${thisMonth()}`)).toBeInTheDocument();
    const rows = within(screen.getByRole('table', { name: 'Attendance' })).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('Forgot to mark (Meera Nair)');
    expect(rows[2]).toHaveTextContent('Still open');
  });

  it('asks for the month the user chose', async () => {
    const { calls } = open(handlers(VIEWER));
    await tab('Attendance');
    await screen.findByRole('table', { name: 'Attendance' });
    const month = screen.getByLabelText('Attendance month');
    fireEvent.change(month, { target: { value: '2026-09' } });
    await waitFor(() => expect(lastCall(calls, 'GET /api/attendance?')).toContain('month=2026-09'));
  });

  it('offers corrections only to managers', async () => {
    open(handlers(SELF));
    await tab('Attendance');
    await screen.findByRole('table', { name: 'Attendance' });
    expect(screen.queryByRole('button', { name: 'Correct attendance' })).not.toBeInTheDocument();
  });

  it('names what is missing in a correction and sends nothing', async () => {
    const { calls } = open(handlers(MANAGER));
    await tab('Attendance');
    await userEvent.click(await screen.findByRole('button', { name: 'Correct attendance' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save attendance' }));
    expect(await within(dialog).findByText('Choose the person')).toBeInTheDocument();
    expect(sent(calls, 'PUT /api/attendance/correct')).toHaveLength(0);
  });

  it('sends a correction with times the server understands, and shows what it refused', async () => {
    let refuse = true;
    const { calls } = open(
      handlers(MANAGER, {
        'PUT /api/attendance/correct': () =>
          refuse
            ? refusal('That day cannot be recorded', 400, [
                { field: 'workDate', message: 'They joined on 2026-01-01' },
              ])
            : jsonResponse(attendance()),
      }),
    );
    await tab('Attendance');
    await userEvent.click(await screen.findByRole('button', { name: 'Correct attendance' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(await within(dialog).findByLabelText('Person'), STAFF_ID);
    await userEvent.type(within(dialog).getByLabelText('Working day'), '2026-10-09');
    await userEvent.type(within(dialog).getByLabelText('Check-in'), '2026-10-09T09:30');
    await userEvent.type(within(dialog).getByLabelText('Check-out'), '2026-10-09T18:00');
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Forgot to mark');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save attendance' }));
    expect(await within(dialog).findByText('That day cannot be recorded')).toBeInTheDocument();
    refuse = false;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save attendance' }));
    expect(await screen.findByText('Attendance for 2026-10-09 saved')).toBeInTheDocument();
    const body = sent(calls, 'PUT /api/attendance/correct').at(-1)?.body as Record<string, unknown>;
    expect(body).toMatchObject({
      staffId: STAFF_ID,
      workDate: '2026-10-09',
      reason: 'Forgot to mark',
    });
    expect(String(body['checkIn'])).toMatch(/^2026-10-09T\d{2}:\d{2}:00\.000Z$/);
    expect(String(body['checkOut'])).toMatch(/Z$/);
  });
});

describe('payroll', () => {
  it('shows last month by default, with the days, leave, pay and the totals', async () => {
    const { calls } = open(handlers(VIEWER));
    await tab('Payroll');
    const row = within(await screen.findByRole('table', { name: 'Payroll' })).getAllByRole(
      'row',
    )[1] as HTMLElement;
    expect(lastCall(calls, 'GET /api/payroll?')).toContain(`month=${lastMonth()}`);
    expect(row).toHaveTextContent('31 of 31');
    expect(row).toHaveTextContent('22 present');
    expect(row).toHaveTextContent('1 paid, 2 unpaid');
    expect(row).toHaveTextContent('31000.00');
    expect(row).toHaveTextContent('Unpaid leave: 2 days');
    expect(row).toHaveTextContent('29000.00');
    expect(row).toHaveTextContent('Draft');
    expect(
      screen.getByText('Pay 31000.00 · deductions 2000.00 · net 29000.00'),
    ).toBeInTheDocument();
  });

  it('shows no actions to someone who is not a manager', async () => {
    open(handlers(SELF));
    await tab('Payroll');
    await screen.findByRole('table', { name: 'Payroll' });
    expect(
      screen.queryByRole('button', { name: 'Make payroll for the month' }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Finalize pay of/ })).not.toBeInTheDocument();
  });

  it('makes payroll for the month and says what happened', async () => {
    let created = 3;
    const { calls } = open(
      handlers(MANAGER, {
        'POST /api/payroll/generate': () =>
          jsonResponse({ month: lastMonth(), created, alreadyHad: created === 0 ? 5 : 0 }),
      }),
    );
    await tab('Payroll');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Make payroll for the month' }),
    );
    expect(await screen.findByText(`Made 3 draft records for ${lastMonth()}`)).toBeInTheDocument();
    expect(sent(calls, 'POST /api/payroll/generate')[0]?.body).toEqual({ month: lastMonth() });
    created = 0;
    await userEvent.click(screen.getByRole('button', { name: 'Make payroll for the month' }));
    expect(
      await screen.findByText(`Nothing new to make for ${lastMonth()}. 5 already had a record`),
    ).toBeInTheDocument();
  });

  it('shows why payroll could not be made, such as a month that has not ended', async () => {
    open(
      handlers(MANAGER, {
        'POST /api/payroll/generate': () =>
          refusal('That month has not ended', 422, [
            { field: 'month', message: 'Payroll can be made once 2026-10 is over' },
          ]),
      }),
    );
    await tab('Payroll');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Make payroll for the month' }),
    );
    expect(await screen.findByText('That month has not ended')).toBeInTheDocument();
    expect(screen.getByText('Payroll can be made once 2026-10 is over')).toBeInTheDocument();
  });

  it('changes the deductions of a draft with the version read, and refuses a bad amount without sending', async () => {
    const { calls } = open(
      handlers(MANAGER, {
        [`PATCH /api/payroll/${PAYROLL_ID}`]: () => jsonResponse(payroll({ deductions: '500.50' })),
      }),
    );
    await tab('Payroll');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Change deductions of Asha Rao' }),
    );
    const dialog = await screen.findByRole('dialog');
    const field = within(dialog).getByLabelText('Deductions');
    await userEvent.clear(field);
    await userEvent.type(field, 'lots');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save deductions' }));
    expect(await within(dialog).findByText(/Enter an amount in rupees/)).toBeInTheDocument();
    expect(sent(calls, `PATCH /api/payroll/${PAYROLL_ID}`)).toHaveLength(0);
    await userEvent.clear(field);
    await userEvent.type(field, '500.50');
    await userEvent.clear(within(dialog).getByLabelText('Note'));
    await userEvent.type(within(dialog).getByLabelText('Note'), 'Advance recovered');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save deductions' }));
    expect(await screen.findByText('Deductions for Asha Rao saved')).toBeInTheDocument();
    expect(sent(calls, `PATCH /api/payroll/${PAYROLL_ID}`)[0]?.body).toEqual({
      deductions: '500.50',
      deductionNote: 'Advance recovered',
      rowVersion: 3,
    });
  });

  it('finalizes, and shows nothing more to do on a final record', async () => {
    const { calls } = open(
      handlers(MANAGER, {
        [`POST /api/payroll/${PAYROLL_ID}/finalize`]: () =>
          jsonResponse(payroll({ status: 'FINALIZED' })),
      }),
    );
    await tab('Payroll');
    await userEvent.click(await screen.findByRole('button', { name: 'Finalize pay of Asha Rao' }));
    expect(
      await screen.findByText(`Pay of Asha Rao for ${lastMonth()} is final`),
    ).toBeInTheDocument();
    expect(sent(calls, `POST /api/payroll/${PAYROLL_ID}/finalize`)[0]?.body).toEqual({
      rowVersion: 3,
    });
  });

  it('shows no actions on a final record, and who finalized it', async () => {
    open(
      handlers(MANAGER, {
        'GET /api/payroll?*': () =>
          jsonResponse({
            ...pageOf([payroll({ status: 'FINALIZED', finalizedByName: 'Meera Nair' })]),
            totals: { gross: '31000.00', deductions: '2000.00', net: '29000.00' },
          }),
      }),
    );
    await tab('Payroll');
    const row = within(await screen.findByRole('table', { name: 'Payroll' })).getAllByRole(
      'row',
    )[1] as HTMLElement;
    expect(row).toHaveTextContent('Final');
    expect(row).toHaveTextContent('by Meera Nair');
    expect(screen.queryByRole('button', { name: /Finalize pay of/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Change deductions of/ })).not.toBeInTheDocument();
  });

  it('shows why a finalization was refused, such as leave still waiting', async () => {
    open(
      handlers(MANAGER, {
        [`POST /api/payroll/${PAYROLL_ID}/finalize`]: () =>
          refusal('Leave in this month is still waiting for a decision', 422, [
            { field: 'status', message: 'Decide the leave from 2026-09-26 to 2026-09-27 first' },
          ]),
      }),
    );
    await tab('Payroll');
    await userEvent.click(await screen.findByRole('button', { name: 'Finalize pay of Asha Rao' }));
    expect(
      await screen.findByText('Leave in this month is still waiting for a decision'),
    ).toBeInTheDocument();
  });
});

describe('staff', () => {
  it('lists people with their department, join date, salary and status, to a manager', async () => {
    open(handlers(MANAGER));
    await tab('Staff');
    const row = within(await screen.findByRole('table', { name: 'Staff' })).getAllByRole(
      'row',
    )[1] as HTMLElement;
    expect(row).toHaveTextContent('Asha Rao');
    expect(row).toHaveTextContent('EMP-0001 · Fitter');
    expect(row).toHaveTextContent('Sales');
    expect(row).toHaveTextContent('2026-01-01');
    expect(row).toHaveTextContent('31000.00');
    expect(row).toHaveTextContent('Working here');
  });

  it('shows a staff member only their own line and nothing to change', async () => {
    open(handlers(SELF));
    await tab('Staff');
    await screen.findByRole('table', { name: 'Staff' });
    expect(screen.queryByLabelText('Search staff')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Add staff' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit Asha Rao/ })).not.toBeInTheDocument();
  });

  it('asks the server for the search, status and department the manager chose', async () => {
    const { calls } = open(handlers(MANAGER));
    await tab('Staff');
    await screen.findByRole('table', { name: 'Staff' });
    await userEvent.type(screen.getByLabelText('Search staff'), 'asha');
    await userEvent.selectOptions(screen.getByLabelText('Staff status'), 'INACTIVE');
    await userEvent.selectOptions(await screen.findByLabelText('Department'), 'WORKSHOP');
    await waitFor(() => {
      const last = lastCall(calls, 'GET /api/staff?');
      expect(last).toContain('search=asha');
      expect(last).toContain('status=INACTIVE');
      expect(last).toContain('department=WORKSHOP');
    });
  });

  it('names what is missing when adding someone, and sends nothing', async () => {
    const { calls } = open(handlers(MANAGER));
    await tab('Staff');
    await userEvent.click(await screen.findByRole('button', { name: 'Add staff' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add staff' }));
    expect(await within(dialog).findByText('Choose the person')).toBeInTheDocument();
    expect(sent(calls, 'POST /api/staff')).toHaveLength(0);
  });

  it('adds a person from the candidates, and shows what the server refused', async () => {
    let refuse = true;
    const { calls } = open(
      handlers(MANAGER, {
        'POST /api/staff': () =>
          refuse
            ? refusal('This employee code is already used', 409, [
                { field: 'employeeCode', message: 'Choose a code no one else has' },
              ])
            : jsonResponse(staff({ employeeCode: 'EMP-0002' }), 201),
      }),
    );
    await tab('Staff');
    await userEvent.click(await screen.findByRole('button', { name: 'Add staff' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(await within(dialog).findByLabelText('Person'), USER_ID);
    await userEvent.type(within(dialog).getByLabelText('Employee code'), 'EMP-0002');
    await userEvent.selectOptions(within(dialog).getByLabelText('Department'), 'WORKSHOP');
    await userEvent.type(within(dialog).getByLabelText('Designation'), 'Welder');
    const joined = within(dialog).getByLabelText('Join date');
    await userEvent.clear(joined);
    await userEvent.type(joined, '2026-10-01');
    await userEvent.type(within(dialog).getByLabelText('Monthly salary'), '25000');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add staff' }));
    expect(
      await within(dialog).findByText('This employee code is already used'),
    ).toBeInTheDocument();
    refuse = false;
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add staff' }));
    expect(await screen.findByText('EMP-0002 added as staff')).toBeInTheDocument();
    expect(sent(calls, 'POST /api/staff').at(-1)?.body).toEqual({
      userId: USER_ID,
      employeeCode: 'EMP-0002',
      department: 'WORKSHOP',
      designation: 'Welder',
      joinDate: '2026-10-01',
      monthlySalary: '25000',
    });
  });

  it('edits a person with the version that was read', async () => {
    const { calls } = open(
      handlers(MANAGER, {
        [`PATCH /api/staff/${STAFF_ID}`]: () => jsonResponse(staff({ monthlySalary: '33000.00' })),
      }),
    );
    await tab('Staff');
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Asha Rao' }));
    const dialog = await screen.findByRole('dialog');
    const salary = within(dialog).getByLabelText('Monthly salary');
    await userEvent.clear(salary);
    await userEvent.type(salary, '33000.00');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Asha Rao updated')).toBeInTheDocument();
    expect(sent(calls, `PATCH /api/staff/${STAFF_ID}`)[0]?.body).toMatchObject({
      monthlySalary: '33000.00',
      employeeCode: 'EMP-0001',
      rowVersion: 4,
    });
  });

  it('marks someone as having left on a day, and shows what the server refused', async () => {
    let refuse = true;
    const { calls } = open(
      handlers(MANAGER, {
        [`POST /api/staff/${STAFF_ID}/deactivate`]: () =>
          refuse
            ? refusal('Attendance has been recorded after that day', 422, [
                { field: 'leftOn', message: '2 attendance records follow 2026-09-30' },
              ])
            : jsonResponse(staff({ status: 'INACTIVE', leftOn: '2026-10-31' })),
      }),
    );
    await tab('Staff');
    await userEvent.click(await screen.findByRole('button', { name: 'Mark as left Asha Rao' }));
    const dialog = await screen.findByRole('dialog');
    const day = within(dialog).getByLabelText('Last working day');
    await userEvent.clear(day);
    await userEvent.type(day, '2026-09-30');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark as left' }));
    expect(
      await within(dialog).findByText('Attendance has been recorded after that day'),
    ).toBeInTheDocument();
    refuse = false;
    await userEvent.clear(day);
    await userEvent.type(day, '2026-10-31');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Mark as left' }));
    expect(
      await screen.findByText('Asha Rao marked as having left on 2026-10-31'),
    ).toBeInTheDocument();
    expect(sent(calls, `POST /api/staff/${STAFF_ID}/deactivate`).at(-1)?.body).toEqual({
      leftOn: '2026-10-31',
      rowVersion: 4,
    });
  });

  it('brings someone back from a date, for a person who has left', async () => {
    const left = staff({ status: 'INACTIVE', leftOn: '2026-09-30', rowVersion: 7 });
    const { calls } = open(
      handlers(MANAGER, {
        'GET /api/staff?*': () => jsonResponse(pageOf([left])),
        [`POST /api/staff/${STAFF_ID}/reactivate`]: () => jsonResponse(staff()),
      }),
    );
    await tab('Staff');
    const row = within(await screen.findByRole('table', { name: 'Staff' })).getAllByRole(
      'row',
    )[1] as HTMLElement;
    expect(row).toHaveTextContent('Left');
    expect(row).toHaveTextContent('on 2026-09-30');
    await userEvent.click(screen.getByRole('button', { name: 'Bring back Asha Rao' }));
    const dialog = await screen.findByRole('dialog');
    const day = within(dialog).getByLabelText('Date they rejoin');
    await userEvent.clear(day);
    await userEvent.type(day, '2026-10-15');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Bring back' }));
    expect(await screen.findByText('Asha Rao is back from 2026-10-15')).toBeInTheDocument();
    expect(sent(calls, `POST /api/staff/${STAFF_ID}/reactivate`)[0]?.body).toEqual({
      joinDate: '2026-10-15',
      rowVersion: 7,
    });
    void OTHER_ID;
  });
});
