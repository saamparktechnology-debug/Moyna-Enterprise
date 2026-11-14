//apps/web/src/features/hr/hr.test.tsx
import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  Agreement,
  AgreementTemplate,
  Attendance,
  Leave,
  Payroll,
  Punch,
  Staff,
} from '@erp/contracts';
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
      'Holidays',
      'Payroll',
      'Staff',
    ]);
    expect(screen.getByRole('tab', { name: 'My day' })).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByRole('button', { name: 'Add staff' })).not.toBeInTheDocument();
  });

  it('starts on leave for someone who cannot mark attendance', async () => {
    open(handlers(VIEWER));
    const tabs = await screen.findAllByRole('tab');
    expect(tabs.map((t) => t.textContent)).toEqual([
      'Leave',
      'Attendance',
      'Holidays',
      'Payroll',
      'Staff',
    ]);
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
    expect(screen.queryByRole('button', { name: 'Punch in' })).not.toBeInTheDocument();
  });

  it('checks in, and shows the result', async () => {
    const { calls } = open(
      handlers(SELF, {
        'POST /api/attendance/check-in': () =>
          jsonResponse(attendance({ state: 'OPEN', checkOut: null, hoursWorked: null }), 201),
      }),
    );
    await userEvent.click(await screen.findByRole('button', { name: 'Punch in' }));
    expect(await screen.findByText('Punched in')).toBeInTheDocument();
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
      await screen.findByText(/Punched in at \d{2}:\d{2}.* on 2026-10-09/),
    ).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Punch in' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Punch out' }));
    expect(await screen.findByText('Punched out')).toBeInTheDocument();
    expect(sent(calls, 'POST /api/attendance/check-out')).toHaveLength(1);
  });

  it('shows a finished day with its hours, and lets the person punch in again', async () => {
    open(handlers(SELF, { 'GET /api/attendance/me': () => jsonResponse(myDay(attendance())) }));
    expect(await screen.findByText(/\(8\.50 hours\)/)).toBeInTheDocument();
    expect(screen.getByText('You are punched out.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Punch in' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Punch out' })).not.toBeInTheDocument();
  });

  it('does not offer attendance to someone who has left', async () => {
    open(
      handlers(SELF, {
        'GET /api/staff/me': () =>
          jsonResponse(staff({ status: 'INACTIVE', leftOn: '2026-09-30' })),
      }),
    );
    expect(await screen.findByText(/You left on 2026-09-30/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Punch in' })).not.toBeInTheDocument();
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
    await userEvent.click(await screen.findByRole('button', { name: 'Punch in' }));
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
      salaryType: 'FIXED',
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

const punch = (over: Partial<Punch> = {}): Punch => ({
  id: 'pn-1',
  staffId: STAFF_ID,
  staffName: 'Asha Rao',
  employeeCode: 'EMP-0001',
  workDate: '2026-10-10',
  punchedInAt: '2026-10-10T03:30:00.000Z',
  punchedOutAt: '2026-10-10T07:30:00.000Z',
  minutes: 240,
  source: 'SELF',
  editedByName: null,
  editReason: null,
  rowVersion: 2,
  ...over,
});
const PUNCH_EDITOR = [...MANAGER, 'attendance.edit_punches'];
const punchList = (items: Punch[]) => ({ date: '2026-10-10', dutyMinutes: 480, items });

describe('my day with several punches', () => {
  it('lists today’s punches and the hours worked against a full day, and offers another punch in', async () => {
    open(
      handlers(SELF, {
        'GET /api/attendance/me': () =>
          jsonResponse({
            ...myDay(attendance({ state: 'COMPLETE' })),
            punches: [
              punch(),
              punch({
                id: 'pn-2',
                punchedInAt: '2026-10-10T08:30:00.000Z',
                punchedOutAt: '2026-10-10T10:00:00.000Z',
                minutes: 90,
              }),
            ],
            workedMinutesToday: 330,
            dutyMinutes: 480,
          }),
      }),
    );
    const table = await screen.findByRole('table', { name: 'Today’s punches' });
    expect(within(table).getAllByRole('row')).toHaveLength(3);
    expect(within(table).getByText('4 h')).toBeInTheDocument();
    expect(within(table).getByText('1 h 30 m')).toBeInTheDocument();
    expect(screen.getByText(/Worked today: 5 h 30 m of 8 h/)).toBeInTheDocument();
    expect(screen.getByText('You are punched out.')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Punch in' })).toBeInTheDocument();
  });

  it('shows the open punch and offers punch out', async () => {
    open(
      handlers(SELF, {
        'GET /api/attendance/me': () =>
          jsonResponse({
            ...myDay(attendance({ state: 'OPEN', checkOut: null, hoursWorked: null })),
            punches: [punch({ punchedOutAt: null, minutes: null })],
            workedMinutesToday: 0,
            dutyMinutes: 480,
          }),
      }),
    );
    expect(await screen.findByText(/Punched in at \d{2}:\d{2}/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Punch out' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Punch in' })).not.toBeInTheDocument();
    expect(screen.getByText('Still in')).toBeInTheDocument();
  });
});

describe('punches, for managers', () => {
  const day = (items: Punch[] = [punch()]): Record<string, RouteHandler> => ({
    'GET /api/attendance/punches?*': () => jsonResponse(punchList(items)),
  });

  it('is a tab only for managers', async () => {
    open(handlers(SELF));
    await screen.findByRole('tab', { name: 'My day' });
    expect(screen.queryByRole('tab', { name: 'Punches' })).not.toBeInTheDocument();
  });

  it('lists a day’s punches with who, when, how long and any change, and asks for the day and person chosen', async () => {
    const { calls } = open(
      handlers(MANAGER, {
        ...day([punch({ editReason: 'Left later', editedByName: 'Meena', source: 'MANAGER' })]),
      }),
    );
    await tab('Punches');
    const table = await screen.findByRole('table', { name: 'Punches' });
    expect(within(table).getByText('Asha Rao')).toBeInTheDocument();
    expect(within(table).getByText('4 h')).toBeInTheDocument();
    expect(within(table).getByText('Left later (Meena)')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Day'), { target: { value: '2026-10-09' } });
    await waitFor(() =>
      expect(lastCall(calls, 'GET /api/attendance/punches?')).toContain('date=2026-10-09'),
    );
    await userEvent.selectOptions(await screen.findByLabelText('Person'), STAFF_ID);
    await waitFor(() =>
      expect(lastCall(calls, 'GET /api/attendance/punches?')).toContain(`staffId=${STAFF_ID}`),
    );
  });

  it('says so when no one punched in', async () => {
    open(handlers(MANAGER, day([])));
    await tab('Punches');
    expect(await screen.findByText('No one punched in on this day.')).toBeInTheDocument();
  });

  it('shows no adding, changing or removing to a manager who may not edit punch times', async () => {
    open(handlers(MANAGER, day()));
    await tab('Punches');
    await screen.findByRole('table', { name: 'Punches' });
    expect(screen.queryByRole('button', { name: 'Add a punch' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Change punch/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^Remove punch/ })).not.toBeInTheDocument();
  });

  it('adds a punch with a person, times and a reason, and says what is missing first', async () => {
    const { calls } = open(
      handlers(PUNCH_EDITOR, {
        ...day(),
        'POST /api/attendance/punches': () => jsonResponse(punch({ id: 'pn-9' }), 201),
      }),
    );
    await tab('Punches');
    await userEvent.click(await screen.findByRole('button', { name: 'Add a punch' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save punch' }));
    expect(await within(dialog).findByText('Choose the person')).toBeInTheDocument();
    expect(sent(calls, 'POST /api/attendance/punches')).toHaveLength(0);
    await userEvent.selectOptions(await within(dialog).findByLabelText('Person'), STAFF_ID);
    fireEvent.change(within(dialog).getByLabelText('Punch in'), {
      target: { value: '2026-10-10T09:00' },
    });
    fireEvent.change(within(dialog).getByLabelText('Punch out'), {
      target: { value: '2026-10-10T13:00' },
    });
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Forgot to punch');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save punch' }));
    expect(await screen.findByText('Punch added')).toBeInTheDocument();
    expect(sent(calls, 'POST /api/attendance/punches')[0]?.body).toMatchObject({
      staffId: STAFF_ID,
      reason: 'Forgot to punch',
    });
    expect(
      (sent(calls, 'POST /api/attendance/punches')[0]?.body as { punchedOutAt: string })
        .punchedOutAt,
    ).toBeTruthy();
  });

  it('changes a punch with the version that was read and a reason', async () => {
    const { calls } = open(
      handlers(PUNCH_EDITOR, {
        ...day(),
        'PATCH /api/attendance/punches/pn-1': () => jsonResponse(punch({ minutes: 270 })),
      }),
    );
    await tab('Punches');
    await userEvent.click(await screen.findByRole('button', { name: /^Change punch of Asha Rao/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText('Punch out'), {
      target: { value: '2026-10-10T13:30' },
    });
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Left later');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save punch' }));
    expect(await screen.findByText('Punch saved')).toBeInTheDocument();
    expect(sent(calls, 'PATCH /api/attendance/punches/pn-1')[0]?.body).toMatchObject({
      reason: 'Left later',
      rowVersion: 2,
    });
  });

  it('removes a punch only with a reason, and sends the version', async () => {
    const { calls } = open(
      handlers(PUNCH_EDITOR, {
        ...day(),
        'POST /api/attendance/punches/pn-1/remove': () => new Response(null, { status: 204 }),
      }),
    );
    await tab('Punches');
    await userEvent.click(await screen.findByRole('button', { name: /^Remove punch of Asha Rao/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove punch' }));
    expect(await within(dialog).findByText('Enter the reason')).toBeInTheDocument();
    expect(sent(calls, 'POST /api/attendance/punches/pn-1/remove')).toHaveLength(0);
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Punched by mistake');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Remove punch' }));
    expect(await screen.findByText('Punch removed')).toBeInTheDocument();
    expect(sent(calls, 'POST /api/attendance/punches/pn-1/remove')[0]?.body).toEqual({
      reason: 'Punched by mistake',
      rowVersion: 2,
    });
  });

  it('shows what the server refused, such as an overlap', async () => {
    open(
      handlers(PUNCH_EDITOR, {
        ...day(),
        'PATCH /api/attendance/punches/pn-1': () =>
          refusal('That overlaps another punch of the same person', 409, [
            { field: 'punchedInAt', message: 'They have a punch from 09:00 to 13:00' },
          ]),
      }),
    );
    await tab('Punches');
    await userEvent.click(await screen.findByRole('button', { name: /^Change punch of Asha Rao/ }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Worked on');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save punch' }));
    expect(
      await within(dialog).findByText('That overlaps another punch of the same person'),
    ).toBeInTheDocument();
  });
});

describe('payroll by hours', () => {
  it('shows the hours worked and the days they pay for', async () => {
    open(
      handlers(MANAGER, {
        'GET /api/payroll?*': () =>
          jsonResponse({
            ...pageOf([
              payroll({ payBasis: 'HOURS', hoursWorked: '174.00', creditedDays: '21.50' }),
            ]),
            totals: { gross: '31000.00', deductions: '2000.00', net: '29000.00' },
          }),
      }),
    );
    await tab('Payroll');
    const table = await screen.findByRole('table', { name: 'Payroll' });
    expect(within(table).getByText('174.00')).toBeInTheDocument();
    expect(within(table).getByText('21.50 paid days')).toBeInTheDocument();
  });
});

describe('the two kinds of salary', () => {
  it('offers a fixed monthly salary or pay by the day, each with its own amount', async () => {
    open(handlers(MANAGER));
    await tab('Staff');
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Asha Rao' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByLabelText('Kind of salary')).toHaveValue('FIXED');
    expect(within(dialog).getByLabelText('Monthly salary')).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Daily rate')).not.toBeInTheDocument();
    await userEvent.selectOptions(within(dialog).getByLabelText('Kind of salary'), 'DAILY');
    expect(within(dialog).getByLabelText('Daily rate')).toBeInTheDocument();
    expect(within(dialog).queryByLabelText('Monthly salary')).not.toBeInTheDocument();
  });

  it('changes a person to pay by the day, sending the daily rate and no monthly salary', async () => {
    const { calls } = open(
      handlers(MANAGER, {
        [`PATCH /api/staff/${STAFF_ID}`]: () =>
          jsonResponse(staff({ salaryType: 'DAILY', dailyRate: '400.00', monthlySalary: '0.00' })),
      }),
    );
    await tab('Staff');
    await userEvent.click(await screen.findByRole('button', { name: 'Edit Asha Rao' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(within(dialog).getByLabelText('Kind of salary'), 'DAILY');
    await userEvent.type(within(dialog).getByLabelText('Daily rate'), '400');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('Asha Rao updated')).toBeInTheDocument();
    const body = sent(calls, `PATCH /api/staff/${STAFF_ID}`)[0]?.body as Record<string, unknown>;
    expect(body).toMatchObject({ salaryType: 'DAILY', dailyRate: '400', rowVersion: 4 });
    expect(body).not.toHaveProperty('monthlySalary');
  });

  it('shows a person paid by the day with the daily rate, and a fixed salary with the month', async () => {
    open(
      handlers(MANAGER, {
        'GET /api/staff?*': () =>
          jsonResponse(
            pageOf([
              staff(),
              staff({
                id: 's-2',
                fullName: 'Ravi Das',
                employeeCode: 'EMP-0002',
                salaryType: 'DAILY',
                dailyRate: '400.00',
                monthlySalary: '0.00',
              }),
            ]),
          ),
      }),
    );
    await tab('Staff');
    const table = await screen.findByRole('table', { name: /staff/i });
    const rows = within(table).getAllByRole('row');
    expect(rows[1]).toHaveTextContent('31000.00');
    expect(rows[1]).toHaveTextContent('a month');
    expect(rows[2]).toHaveTextContent('400.00');
    expect(rows[2]).toHaveTextContent('a day');
  });

  it('asks for the daily rate when adding someone paid by the day, and sends it', async () => {
    const { calls } = open(
      handlers(MANAGER, {
        'POST /api/staff': () =>
          jsonResponse(staff({ salaryType: 'DAILY', dailyRate: '400.00' }), 201),
      }),
    );
    await tab('Staff');
    await userEvent.click(await screen.findByRole('button', { name: 'Add staff' }));
    const dialog = await screen.findByRole('dialog');
    await userEvent.selectOptions(await within(dialog).findByLabelText('Person'), USER_ID);
    await userEvent.type(within(dialog).getByLabelText('Employee code'), 'EMP-0003');
    await userEvent.selectOptions(within(dialog).getByLabelText('Kind of salary'), 'DAILY');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add staff' }));
    expect(await within(dialog).findByText('Enter the daily rate')).toBeInTheDocument();
    expect(sent(calls, 'POST /api/staff')).toHaveLength(0);
    await userEvent.type(within(dialog).getByLabelText('Daily rate'), '400');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Add staff' }));
    await screen.findByText('EMP-0003 added as staff');
    const body = sent(calls, 'POST /api/staff').at(-1)?.body as Record<string, unknown>;
    expect(body).toMatchObject({ salaryType: 'DAILY', dailyRate: '400' });
    expect(body).not.toHaveProperty('monthlySalary');
  });
});

const AG_ID = 'cb6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59';
const TEMPLATE_ID = 'db6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59';
const agreement = (over: Partial<Agreement> = {}): Agreement => ({
  id: AG_ID,
  agreementNo: 'AG-111120261123',
  staffId: STAFF_ID,
  staffName: 'Asha Rao',
  employeeCode: 'EMP-0001',
  branchCode: 'HQ',
  templateId: TEMPLATE_ID,
  templateName: 'Standard terms',
  title: 'Employment agreement',
  body: 'Asha Rao works as Fitter. The Employee will keep the shop safe.',
  effectiveFrom: '2026-11-01',
  status: 'DRAFT',
  signedOn: null,
  hasSignedCopy: false,
  signedFileName: null,
  employeeSigned: false,
  adminSigned: false,
  recordedByName: null,
  endedOn: null,
  endReason: null,
  createdAt: '2026-11-11T05:53:00.000Z',
  rowVersion: 1,
  ...over,
});
const template = (over: Partial<AgreementTemplate> = {}): AgreementTemplate => ({
  id: TEMPLATE_ID,
  name: 'Standard terms',
  body: 'Terms for {{employee_name}}, who works as {{designation}} in the shop.',
  isActive: true,
  agreementCount: 2,
  updatedAt: '2026-11-10T05:00:00.000Z',
  rowVersion: 1,
  ...over,
});
const agHandlers = (
  items: Agreement[] = [agreement()],
  extra: Record<string, RouteHandler> = {},
): Record<string, RouteHandler> =>
  handlers(MANAGER, {
    'GET /api/agreements?*': () => jsonResponse({ items }),
    'GET /api/agreement-templates': () => jsonResponse({ items: [template()] }),
    ...extra,
  });
const pdf = () =>
  new Response('%PDF-1.4', { status: 200, headers: { 'content-type': 'application/pdf' } });
const rowOf = (table: HTMLElement, no: string) =>
  within(table)
    .getAllByRole('row')
    .find((row) => row.textContent?.includes(no)) as HTMLElement;

describe('employee agreements', () => {
  beforeEach(() => {
    vi.stubGlobal(
      'URL',
      Object.assign(URL, {
        createObjectURL: vi.fn(() => 'blob:agreement'),
        revokeObjectURL: vi.fn(),
      }),
    );
  });
  afterEach(() => vi.restoreAllMocks());

  it('is a tab only for those who manage HR', async () => {
    open(handlers(SELF));
    await screen.findByRole('tab', { name: 'My day' });
    expect(screen.queryByRole('tab', { name: 'Agreements' })).not.toBeInTheDocument();
  });

  it('lists agreements with their state, and offers what each state allows', async () => {
    open(
      agHandlers([
        agreement({ id: 'a1', agreementNo: 'AG-1', status: 'DRAFT' }),
        agreement({
          id: 'a2',
          agreementNo: 'AG-2',
          status: 'SIGNED',
          signedOn: '2026-11-02',
          hasSignedCopy: true,
        }),
        agreement({
          id: 'a3',
          agreementNo: 'AG-3',
          status: 'ENDED',
          endedOn: '2026-12-31',
          endReason: 'Resigned',
          hasSignedCopy: true,
        }),
        agreement({
          id: 'a4',
          agreementNo: 'AG-4',
          status: 'DISCARDED',
          endReason: 'Wrong person',
        }),
      ]),
    );
    await tab('Agreements');
    const table = await screen.findByRole('table', { name: 'Agreements' });
    const names = (no: string) =>
      within(rowOf(table, no))
        .queryAllByRole('button')
        .map((button) => button.getAttribute('aria-label'));
    expect(names('AG-1')).toEqual([
      'Print AG-1',
      'Edit AG-1',
      'Upload the signed copy of AG-1',
      'Throw away AG-1',
    ]);
    expect(names('AG-2')).toEqual(['Read AG-2', 'View the signed copy of AG-2', 'End AG-2']);
    expect(names('AG-3')).toEqual(['Read AG-3', 'View the signed copy of AG-3']);
    expect(names('AG-4')).toEqual([]);
    expect(rowOf(table, 'AG-3')).toHaveTextContent('ended 2026-12-31: Resigned');
    expect(rowOf(table, 'AG-4')).toHaveTextContent('Wrong person');
  });

  it('prints a draft: the PDF opens in the page, ready to print', async () => {
    const { calls } = open(agHandlers(undefined, { [`GET /api/agreements/${AG_ID}/pdf`]: pdf }));
    await tab('Agreements');
    await userEvent.click(await screen.findByRole('button', { name: 'Print AG-111120261123' }));
    const preview = await screen.findByRole('region', { name: 'Document preview' });
    expect(within(preview).getByTitle('Agreement AG-111120261123')).toHaveAttribute(
      'src',
      'blob:agreement',
    );
    expect(calls.some((call) => call.key === `GET /api/agreements/${AG_ID}/pdf`)).toBe(true);
  });

  it('makes an agreement from a template, filling the terms in so they can be edited first', async () => {
    const { calls } = open(
      agHandlers(undefined, {
        'POST /api/agreements': () => jsonResponse(agreement({ id: 'new' }), 201),
      }),
    );
    await tab('Agreements');
    await userEvent.click(await screen.findByRole('button', { name: 'New agreement' }));
    const dialog = await screen.findByRole('dialog', { name: 'New agreement' });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Make agreement' }));
    expect(await within(dialog).findAllByText('Choose the employee')).toHaveLength(2);
    expect(sent(calls, 'POST /api/agreements')).toHaveLength(0);
    await userEvent.selectOptions(await within(dialog).findByLabelText('Employee'), STAFF_ID);
    await userEvent.selectOptions(await within(dialog).findByLabelText('Template'), TEMPLATE_ID);
    const terms = within(dialog).getByLabelText('Terms and rules');
    expect(terms).toHaveValue(
      'Terms for {{employee_name}}, who works as {{designation}} in the shop.',
    );
    expect(within(dialog).getByLabelText('Title')).toHaveValue('Standard terms');
    await userEvent.type(terms, ' Extra rule.');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Make agreement' }));
    expect(await screen.findByText(/made. Print it for signing/)).toBeInTheDocument();
    expect(sent(calls, 'POST /api/agreements')[0]?.body).toMatchObject({
      staffId: STAFF_ID,
      templateId: TEMPLATE_ID,
      title: 'Standard terms',
      body: 'Terms for {{employee_name}}, who works as {{designation}} in the shop. Extra rule.',
    });
  });

  it('adds a detail to the terms with a button, and asks for a template or the terms', async () => {
    const { calls } = open(agHandlers());
    await tab('Agreements');
    await userEvent.click(await screen.findByRole('button', { name: 'New agreement' }));
    const dialog = await screen.findByRole('dialog', { name: 'New agreement' });
    await userEvent.selectOptions(await within(dialog).findByLabelText('Employee'), STAFF_ID);
    await userEvent.click(within(dialog).getByRole('button', { name: 'Make agreement' }));
    expect(
      await within(dialog).findByText('Choose a template or write the terms'),
    ).toBeInTheDocument();
    expect(sent(calls, 'POST /api/agreements')).toHaveLength(0);
    const group = within(dialog).getByRole('group', { name: 'Add a detail' });
    await userEvent.click(within(group).getByRole('button', { name: 'Employee name' }));
    expect(within(dialog).getByLabelText('Terms and rules')).toHaveValue('{{employee_name}}');
  });

  it('edits a draft with the version that was read', async () => {
    const { calls } = open(
      agHandlers(undefined, {
        [`PATCH /api/agreements/${AG_ID}`]: () => jsonResponse(agreement({ rowVersion: 2 })),
      }),
    );
    await tab('Agreements');
    await userEvent.click(await screen.findByRole('button', { name: 'Edit AG-111120261123' }));
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).queryByLabelText('Employee')).not.toBeInTheDocument();
    const title = within(dialog).getByLabelText('Title');
    await userEvent.clear(title);
    await userEvent.type(title, 'Revised agreement');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Save changes' }));
    expect(await screen.findByText('AG-111120261123 saved')).toBeInTheDocument();
    expect(sent(calls, `PATCH /api/agreements/${AG_ID}`)[0]?.body).toMatchObject({
      title: 'Revised agreement',
      rowVersion: 1,
    });
  });

  it('uploads the signed copy as the acceptance, only with both signatures confirmed', async () => {
    const { calls } = open(
      agHandlers(undefined, {
        [`POST /api/agreements/${AG_ID}/signed-copy*`]: () =>
          jsonResponse(
            agreement({
              status: 'SIGNED',
              signedOn: '2026-11-02',
              hasSignedCopy: true,
              rowVersion: 2,
            }),
          ),
      }),
    );
    await tab('Agreements');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Upload the signed copy of AG-111120261123' }),
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Upload signed copy' }));
    expect(await within(dialog).findByText(/Choose the scan or photo/)).toBeInTheDocument();
    expect(
      within(dialog).getByText(/The employee must have signed it, on the left/),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(/The Super Admin must have signed it, on the right/),
    ).toBeInTheDocument();
    const file = new File(['%PDF-1.4'], 'signed.pdf', { type: 'application/pdf' });
    await userEvent.upload(within(dialog).getByLabelText('Signed copy'), file);
    await userEvent.click(
      within(dialog).getByRole('checkbox', { name: /The employee has signed it/ }),
    );
    await userEvent.click(
      within(dialog).getByRole('checkbox', { name: /The Super Admin has signed it/ }),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Upload signed copy' }));
    expect(await screen.findByText('AG-111120261123 is signed')).toBeInTheDocument();
    const call = calls.find((c) => c.key.startsWith(`POST /api/agreements/${AG_ID}/signed-copy`));
    expect(call?.key).toContain('fileName=signed.pdf');
    expect(call?.key).toContain('employeeSigned=true');
    expect(call?.key).toContain('adminSigned=true');
    expect(call?.key).toContain('rowVersion=1');
  });

  it('refuses a signed copy over 5 MB before sending it', async () => {
    const { calls } = open(agHandlers());
    await tab('Agreements');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Upload the signed copy of AG-111120261123' }),
    );
    const dialog = await screen.findByRole('dialog');
    const big = new File([new Uint8Array(5 * 1024 * 1024 + 1)], 'scan.pdf', {
      type: 'application/pdf',
    });
    await userEvent.upload(within(dialog).getByLabelText('Signed copy'), big);
    await userEvent.click(
      within(dialog).getByRole('checkbox', { name: /The employee has signed it/ }),
    );
    await userEvent.click(
      within(dialog).getByRole('checkbox', { name: /The Super Admin has signed it/ }),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Upload signed copy' }));
    expect(await within(dialog).findByText('The file is larger than 5 MB')).toBeInTheDocument();
    expect(calls.some((c) => c.key.startsWith(`POST /api/agreements/${AG_ID}/signed-copy`))).toBe(
      false,
    );
  });

  it('shows what the server refused when the signed copy is uploaded', async () => {
    open(
      agHandlers(undefined, {
        [`POST /api/agreements/${AG_ID}/signed-copy*`]: () =>
          refusal('This agreement was changed by someone else. Reload it and try again', 409),
      }),
    );
    await tab('Agreements');
    await userEvent.click(
      await screen.findByRole('button', { name: 'Upload the signed copy of AG-111120261123' }),
    );
    const dialog = await screen.findByRole('dialog');
    await userEvent.upload(
      within(dialog).getByLabelText('Signed copy'),
      new File(['%PDF-1.4'], 'signed.pdf', { type: 'application/pdf' }),
    );
    await userEvent.click(
      within(dialog).getByRole('checkbox', { name: /The employee has signed it/ }),
    );
    await userEvent.click(
      within(dialog).getByRole('checkbox', { name: /The Super Admin has signed it/ }),
    );
    await userEvent.click(within(dialog).getByRole('button', { name: 'Upload signed copy' }));
    expect(await within(dialog).findByText(/changed by someone else/)).toBeInTheDocument();
  });

  it('ends a signed agreement with a day and a reason, and throws away a draft with a reason', async () => {
    const { calls } = open(
      agHandlers(
        [
          agreement({ id: 'd1', agreementNo: 'AG-D', status: 'DRAFT' }),
          agreement({
            id: 's1',
            agreementNo: 'AG-S',
            status: 'SIGNED',
            signedOn: '2026-11-02',
            hasSignedCopy: true,
          }),
        ],
        {
          'POST /api/agreements/s1/end': () =>
            jsonResponse(agreement({ id: 's1', status: 'ENDED' })),
          'POST /api/agreements/d1/discard': () =>
            jsonResponse(agreement({ id: 'd1', status: 'DISCARDED' })),
        },
      ),
    );
    await tab('Agreements');
    await userEvent.click(await screen.findByRole('button', { name: 'End AG-S' }));
    let dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'End agreement' }));
    expect(await within(dialog).findByText('Enter the reason')).toBeInTheDocument();
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Resigned');
    await userEvent.click(within(dialog).getByRole('button', { name: 'End agreement' }));
    expect(await screen.findByText('AG-S ended')).toBeInTheDocument();
    expect(sent(calls, 'POST /api/agreements/s1/end')[0]?.body).toMatchObject({
      reason: 'Resigned',
      rowVersion: 1,
    });
    await userEvent.click(await screen.findByRole('button', { name: 'Throw away AG-D' }));
    dialog = await screen.findByRole('dialog');
    await userEvent.type(within(dialog).getByLabelText('Reason'), 'Wrong person');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Throw away' }));
    expect(await screen.findByText('AG-D thrown away')).toBeInTheDocument();
    expect(sent(calls, 'POST /api/agreements/d1/discard')[0]?.body).toEqual({
      reason: 'Wrong person',
      rowVersion: 1,
    });
  });

  it('keeps templates: lists them, adds one from example terms, and switches one off', async () => {
    const { calls } = open(
      agHandlers(undefined, {
        'POST /api/agreement-templates': () =>
          jsonResponse(template({ id: 't2', name: 'Casual staff' }), 201),
        [`PATCH /api/agreement-templates/${TEMPLATE_ID}`]: () =>
          jsonResponse(template({ isActive: false })),
      }),
    );
    await tab('Agreements');
    await userEvent.click(await screen.findByRole('button', { name: 'Templates' }));
    const list = await screen.findByRole('dialog', { name: 'Agreement templates' });
    const table = await within(list).findByRole('table', { name: 'Templates' });
    expect(within(table).getByText('Standard terms')).toBeInTheDocument();
    await userEvent.click(
      within(list).getByRole('button', { name: 'Switch off template Standard terms' }),
    );
    expect(await screen.findByText('Template Standard terms switched off')).toBeInTheDocument();
    expect(sent(calls, `PATCH /api/agreement-templates/${TEMPLATE_ID}`)[0]?.body).toEqual({
      isActive: false,
      rowVersion: 1,
    });
    await userEvent.click(within(list).getByRole('button', { name: 'New template' }));
    const form = await screen.findByRole('dialog', { name: 'New template' });
    await userEvent.type(within(form).getByLabelText('Name of the template'), 'Casual staff');
    await userEvent.click(within(form).getByRole('button', { name: 'Start from example terms' }));
    expect((within(form).getByLabelText('Terms and rules') as HTMLTextAreaElement).value).toContain(
      '{{employee_name}}',
    );
    await userEvent.click(within(form).getByRole('button', { name: 'Save template' }));
    expect(await screen.findByText('Template Casual staff added')).toBeInTheDocument();
    expect(sent(calls, 'POST /api/agreement-templates')[0]?.body).toMatchObject({
      name: 'Casual staff',
    });
  });

  it('lets an employee read and print their own signed agreement from their page', async () => {
    const { calls } = open(
      handlers(SELF, {
        'GET /api/agreements/mine': () =>
          jsonResponse({
            items: [agreement({ status: 'SIGNED', signedOn: '2026-11-02', hasSignedCopy: true })],
          }),
        [`GET /api/agreements/${AG_ID}/pdf`]: pdf,
      }),
    );
    const section = await screen.findByRole('region', { name: 'My agreement' });
    expect(
      within(section).getByText(/Employment agreement \(AG-111120261123\)/),
    ).toBeInTheDocument();
    await userEvent.click(within(section).getByRole('button', { name: 'Read AG-111120261123' }));
    expect(await screen.findByRole('region', { name: 'Document preview' })).toBeInTheDocument();
    expect(calls.some((call) => call.key === `GET /api/agreements/${AG_ID}/pdf`)).toBe(true);
  });

  it('shows an employee with no signed agreement nothing about agreements', async () => {
    open(handlers(SELF, { 'GET /api/agreements/mine': () => jsonResponse({ items: [] }) }));
    await screen.findByRole('tab', { name: 'My day' });
    expect(screen.queryByRole('region', { name: 'My agreement' })).not.toBeInTheDocument();
  });
});
