import { describe, expect, it } from 'vitest';
import {
  ApproveLeaveRequestSchema,
  AttendanceListQuerySchema,
  CorrectAttendanceRequestSchema,
  CreateLeaveRequestSchema,
  CreateStaffRequestSchema,
  DeactivateStaffRequestSchema,
  GeneratePayrollRequestSchema,
  LeaveListQuerySchema,
  RejectLeaveRequestSchema,
  UpdatePayrollRequestSchema,
  UpdateStaffRequestSchema,
  addDays,
  employedDays,
  hoursBetween,
  inclusiveDays,
  monthBounds,
  monthOf,
  overlapDays,
  proRata,
  workDateOf,
} from './hr.js';

const id = '0b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59';

describe('months', () => {
  it('knows how long each month is, including February in a leap year', () => {
    expect(monthBounds('2026-10')).toEqual({ first: '2026-10-01', last: '2026-10-31', days: 31 });
    expect(monthBounds('2026-11').days).toBe(30);
    expect(monthBounds('2026-02').days).toBe(28);
    expect(monthBounds('2028-02')).toEqual({ first: '2028-02-01', last: '2028-02-29', days: 29 });
    expect(monthBounds('2100-02').days).toBe(28);
    expect(monthBounds('2000-02').days).toBe(29);
  });

  it('steps over month and year ends', () => {
    expect(addDays('2026-10-31', 1)).toBe('2026-11-01');
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(monthOf('2026-10-31')).toBe('2026-10');
  });

  it('counts the days two ranges share, both ends included', () => {
    expect(overlapDays('2026-10-01', '2026-10-31', '2026-10-15', '2026-11-05')).toBe(17);
    expect(overlapDays('2026-10-01', '2026-10-31', '2026-09-20', '2026-10-01')).toBe(1);
    expect(overlapDays('2026-10-01', '2026-10-31', '2026-11-01', '2026-11-05')).toBe(0);
    expect(overlapDays('2026-10-01', '2026-10-31', '2026-09-25', '2026-09-30')).toBe(0);
    expect(overlapDays('2026-10-05', '2026-10-05', '2026-10-05', '2026-10-05')).toBe(1);
    expect(inclusiveDays('2026-10-31', '2026-11-02')).toBe(3);
  });
});

describe('employedDays', () => {
  it('counts a full month for someone who was there all of it', () => {
    expect(employedDays('2026-10', '2025-01-01', null)).toBe(31);
  });

  it('counts from the day someone joined, including that day', () => {
    expect(employedDays('2026-10', '2026-10-01', null)).toBe(31);
    expect(employedDays('2026-10', '2026-10-16', null)).toBe(16);
    expect(employedDays('2026-10', '2026-10-31', null)).toBe(1);
  });

  it('counts up to the day someone left, including that day', () => {
    expect(employedDays('2026-10', '2020-01-01', '2026-10-10')).toBe(10);
    expect(employedDays('2026-10', '2020-01-01', '2026-10-31')).toBe(31);
    expect(employedDays('2026-10', '2020-01-01', '2026-09-30')).toBe(0);
  });

  it('counts none for a month before joining, and a short stay inside one month', () => {
    expect(employedDays('2026-09', '2026-10-01', null)).toBe(0);
    expect(employedDays('2026-10', '2026-10-10', '2026-10-12')).toBe(3);
    expect(employedDays('2028-02', '2028-02-01', null)).toBe(29);
  });
});

describe('proRata', () => {
  it('pays the whole salary for the whole month', () => {
    expect(proRata('31000.00', 31, 31)).toBe('31000.00');
    expect(proRata('30000', 30, 30)).toBe('30000.00');
  });

  it('pays a share by days, to the paisa with halves up', () => {
    expect(proRata('31000.00', 16, 31)).toBe('16000.00');
    expect(proRata('30000.00', 10, 30)).toBe('10000.00');
    expect(proRata('10000.00', 1, 31)).toBe('322.58');
    expect(proRata('10000.00', 2, 31)).toBe('645.16');
    expect(proRata('100.00', 1, 3)).toBe('33.33');
    expect(proRata('100.00', 2, 3)).toBe('66.67');
    expect(proRata('0.01', 1, 2)).toBe('0.01');
    expect(proRata('0.00', 5, 31)).toBe('0.00');
  });

  it('works on a leap February', () => {
    expect(proRata('29000.00', 15, 29)).toBe('15000.00');
  });
});

describe('the working day', () => {
  it('belongs to the day of the check-in in India, so a night shift stays on the day it began', () => {
    expect(workDateOf(new Date('2026-10-31T17:30:00Z'))).toBe('2026-10-31');
    expect(workDateOf(new Date('2026-10-31T18:30:00Z'))).toBe('2026-11-01');
    expect(workDateOf(new Date('2026-12-31T18:29:59Z'))).toBe('2026-12-31');
    expect(workDateOf(new Date('2026-12-31T18:30:00Z'))).toBe('2027-01-01');
  });

  it('counts the hours between two instants', () => {
    expect(hoursBetween(new Date('2026-10-10T04:00:00Z'), new Date('2026-10-10T12:30:00Z'))).toBe(
      '8.50',
    );
    expect(hoursBetween(new Date('2026-10-31T17:00:00Z'), new Date('2026-10-31T20:20:00Z'))).toBe(
      '3.33',
    );
  });
});

describe('CreateStaffRequestSchema', () => {
  const create = (over: Record<string, unknown> = {}) =>
    CreateStaffRequestSchema.safeParse({
      userId: id,
      employeeCode: 'EMP-0001',
      joinDate: '2026-10-01',
      monthlySalary: '25000.00',
      ...over,
    });

  it('takes the basics and defaults the rest', () => {
    const result = create();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toMatchObject({ department: null, designation: null });
  });

  it.each(['ab', 'EMP 01', 'EMP/01', '-EMP', 'x'.repeat(21), ''])(
    'refuses the employee code %j',
    (employeeCode) => {
      expect(create({ employeeCode }).success).toBe(false);
    },
  );

  it('refuses a bad date, a bad salary and a missing person', () => {
    expect(create({ joinDate: '2026-02-30' }).success).toBe(false);
    for (const monthlySalary of ['-1', 'abc', '12.345', ''])
      expect(create({ monthlySalary }).success, monthlySalary).toBe(false);
    expect(create({ userId: 'x' }).success).toBe(false);
    expect(create({ monthlySalary: '0.00' }).success).toBe(true);
  });
});

describe('other staff requests', () => {
  it('needs a change and a row version to update', () => {
    expect(UpdateStaffRequestSchema.safeParse({ rowVersion: 1 }).success).toBe(false);
    expect(
      UpdateStaffRequestSchema.safeParse({ designation: 'Fitter', rowVersion: 1 }).success,
    ).toBe(true);
    expect(UpdateStaffRequestSchema.safeParse({ designation: 'Fitter' }).success).toBe(false);
    expect(
      DeactivateStaffRequestSchema.safeParse({ leftOn: '2026-10-31', rowVersion: 2 }).success,
    ).toBe(true);
    expect(DeactivateStaffRequestSchema.safeParse({ leftOn: 'soon', rowVersion: 2 }).success).toBe(
      false,
    );
  });
});

describe('CorrectAttendanceRequestSchema', () => {
  const correct = (over: Record<string, unknown> = {}) =>
    CorrectAttendanceRequestSchema.safeParse({
      staffId: id,
      workDate: '2026-10-10',
      checkIn: '2026-10-10T09:30:00+05:30',
      checkOut: '2026-10-10T18:00:00+05:30',
      reason: 'Forgot to check out',
      ...over,
    });

  it('takes a day with a check-in and a check-out', () => {
    expect(correct().success).toBe(true);
    expect(correct({ checkOut: null }).success).toBe(true);
  });

  it('needs the check-in to fall on the working day in India', () => {
    expect(correct({ checkIn: '2026-10-09T09:30:00+05:30', checkOut: null }).success).toBe(false);
    expect(correct({ checkIn: '2026-10-10T00:00:00+05:30', checkOut: null }).success).toBe(true);
    expect(correct({ checkIn: '2026-10-09T23:59:59+05:30', checkOut: null }).success).toBe(false);
    expect(correct({ checkIn: '2026-10-10T03:59:00Z', checkOut: null }).success).toBe(true);
  });

  it('lets a night shift end after midnight, but not before it began or after a day', () => {
    expect(
      correct({
        checkIn: '2026-10-31T22:00:00+05:30',
        workDate: '2026-10-31',
        checkOut: '2026-11-01T06:00:00+05:30',
      }).success,
    ).toBe(true);
    expect(correct({ checkOut: '2026-10-10T09:00:00+05:30' }).success).toBe(false);
    expect(correct({ checkOut: '2026-10-11T09:30:01+05:30' }).success).toBe(false);
    expect(correct({ checkOut: '2026-10-11T09:30:00+05:30' }).success).toBe(true);
  });

  it('answers garbage with a refusal, never an exception', () => {
    for (const checkIn of ['', 'abc', '2026-99-99T99:99:99Z', 12345 as unknown as string])
      expect(() => correct({ checkIn, checkOut: null })).not.toThrow();
    expect(correct({ checkIn: 'abc', checkOut: null }).success).toBe(false);
    expect(correct({ checkOut: 'abc' }).success).toBe(false);
    expect(correct({ staffId: '', workDate: '', checkIn: '', reason: '' }).success).toBe(false);
  });

  it('needs a reason, real instants and a real day', () => {
    expect(correct({ reason: 'no' }).success).toBe(false);
    expect(correct({ checkIn: '2026-10-10' }).success).toBe(false);
    expect(correct({ workDate: '2026-13-10' }).success).toBe(false);
  });
});

describe('leave', () => {
  const leave = (over: Record<string, unknown> = {}) =>
    CreateLeaveRequestSchema.safeParse({ fromDate: '2026-10-12', toDate: '2026-10-14', ...over });

  it('takes a range, one day included, and defaults to paid', () => {
    const result = leave();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.kind).toBe('PAID');
    expect(leave({ toDate: '2026-10-12' }).success).toBe(true);
  });

  it('refuses a range that ends before it starts, a real date that is not, and one longer than a year', () => {
    expect(leave({ toDate: '2026-10-11' }).success).toBe(false);
    expect(leave({ fromDate: '2026-02-30' }).success).toBe(false);
    expect(leave({ fromDate: '2026-01-01', toDate: '2026-12-31' }).success).toBe(true);
    expect(leave({ fromDate: '2026-01-01', toDate: '2027-01-02' }).success).toBe(false);
    expect(leave({ kind: 'SICK' }).success).toBe(false);
    expect(leave({ kind: 'UNPAID', reason: 'Family function', staffId: id }).success).toBe(true);
  });

  it('needs a reason to reject, and none to approve', () => {
    expect(ApproveLeaveRequestSchema.safeParse({ rowVersion: 1 }).success).toBe(true);
    expect(RejectLeaveRequestSchema.safeParse({ rowVersion: 1 }).success).toBe(false);
    expect(RejectLeaveRequestSchema.safeParse({ rowVersion: 1, note: 'Busy season' }).success).toBe(
      true,
    );
  });

  it('filters by month and refuses unknown values', () => {
    expect(LeaveListQuerySchema.parse({ month: '2026-10' }).month).toBe('2026-10');
    expect(LeaveListQuerySchema.safeParse({ month: '2026-13' }).success).toBe(false);
    expect(LeaveListQuerySchema.safeParse({ status: 'DONE' }).success).toBe(false);
  });
});

describe('attendance and payroll requests', () => {
  it('needs a month to list attendance', () => {
    expect(AttendanceListQuerySchema.safeParse({}).success).toBe(false);
    expect(AttendanceListQuerySchema.safeParse({ month: '2026-10' }).success).toBe(true);
    expect(AttendanceListQuerySchema.safeParse({ month: '2026-1' }).success).toBe(false);
  });

  it('generates for a month, and edits only the deductions of a draft', () => {
    expect(GeneratePayrollRequestSchema.safeParse({ month: '2026-10' }).success).toBe(true);
    expect(GeneratePayrollRequestSchema.safeParse({ month: '2026-00' }).success).toBe(false);
    expect(
      UpdatePayrollRequestSchema.safeParse({ deductions: '500.00', rowVersion: 1 }).success,
    ).toBe(true);
    expect(UpdatePayrollRequestSchema.safeParse({ deductions: '-1', rowVersion: 1 }).success).toBe(
      false,
    );
    expect(UpdatePayrollRequestSchema.safeParse({ deductions: '500.00' }).success).toBe(false);
  });
});
