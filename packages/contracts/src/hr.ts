import { z } from 'zod';
import { DateOnlySchema, daysBetween, todayInIndia } from './battery-dates.js';
import { MoneyAmountSchema } from './billing.js';
import { paginatedSchema, PaginationQuerySchema } from './pagination.js';
import { toPaise } from './payments.js';

// ---------- dates and months (all in India's calendar) ----------

export const MonthSchema = z
  .string()
  .regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Choose a month, such as 2026-10');

const DAY_MS = 86_400_000;
const toUtc = (date: string): number => Date.parse(`${date}T00:00:00Z`);
const fromUtc = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

export function addDays(date: string, days: number): string {
  return fromUtc(toUtc(date) + days * DAY_MS);
}

/** First day, last day and length of a month. February has 29 days in a leap year. */
export function monthBounds(month: string): { first: string; last: string; days: number } {
  const first = `${month}-01`;
  const [year, number] = month.split('-').map(Number) as [number, number];
  const days = new Date(Date.UTC(year, number, 0)).getUTCDate();
  return { first, last: `${month}-${String(days).padStart(2, '0')}`, days };
}

export function monthOf(date: string): string {
  return date.slice(0, 7);
}

/** How many days two date ranges share, counting both ends. Zero when they do not meet. */
export function overlapDays(aFrom: string, aTo: string, bFrom: string, bTo: string): number {
  const from = aFrom > bFrom ? aFrom : bFrom;
  const to = aTo < bTo ? aTo : bTo;
  return from > to ? 0 : daysBetween(from, to) + 1;
}

/** The number of days, counting both ends. */
export function inclusiveDays(from: string, to: string): number {
  return daysBetween(from, to) + 1;
}

/** The days of a month a person was employed: from the day they joined to the day they left, inside the month. */
export function employedDays(month: string, joinDate: string, leftOn: string | null): number {
  const { first, last } = monthBounds(month);
  return overlapDays(first, last, joinDate, leftOn ?? last);
}

function fromPaise(paise: number): string {
  return `${Math.floor(paise / 100)}.${String(paise % 100).padStart(2, '0')}`;
}

/** A share of a monthly amount, `days` out of `daysInMonth`, to the paisa with halves rounded up. */
export function proRata(monthly: string, days: number, daysInMonth: number): string {
  const paise = toPaise(monthly);
  return fromPaise(Math.floor((paise * days * 2 + daysInMonth) / (2 * daysInMonth)));
}

/** The longest a shift may run, so a forgotten check-out cannot swallow the next day. */
export const MAX_SHIFT_HOURS = 24;
/** A check-out is accepted for a shift still open this many hours after it started, even past midnight. */
export const MAX_OPEN_SHIFT_HOURS = 16;

/** The working day a check-in belongs to: its date in India. A night shift that ends after midnight stays on the day it began. */
export function workDateOf(checkIn: Date): string {
  return todayInIndia(checkIn);
}

export function hoursBetween(checkIn: Date, checkOut: Date): string {
  const minutes = Math.round((checkOut.getTime() - checkIn.getTime()) / 60_000);
  return (minutes / 60).toFixed(2);
}

// ---------- staff ----------

export const STAFF_STATUSES = ['ACTIVE', 'INACTIVE'] as const;
export const StaffStatusSchema = z.enum(STAFF_STATUSES);
export type StaffStatusName = z.infer<typeof StaffStatusSchema>;

const EmployeeCodeSchema = z
  .string()
  .trim()
  .min(3, 'Use at least 3 characters')
  .max(20, 'Use at most 20 characters')
  .regex(/^[A-Za-z0-9][A-Za-z0-9-]*$/, 'Use letters, digits and - only');
const DesignationSchema = z.string().trim().min(1).max(80, 'Use at most 80 characters');
const ReasonSchema = z.string().trim().min(3, 'Give a reason of at least 3 characters').max(300);

export const CreateStaffRequestSchema = z.object({
  userId: z.uuid('Choose the person'),
  branchId: z.uuid().optional(),
  employeeCode: EmployeeCodeSchema,
  department: z.string().trim().min(1).max(30).nullable().default(null),
  designation: DesignationSchema.nullable().default(null),
  joinDate: DateOnlySchema,
  monthlySalary: MoneyAmountSchema,
});
export type CreateStaffRequest = z.input<typeof CreateStaffRequestSchema>;

export const UpdateStaffRequestSchema = z
  .object({
    employeeCode: EmployeeCodeSchema.optional(),
    department: z.string().trim().min(1).max(30).nullable().optional(),
    designation: DesignationSchema.nullable().optional(),
    monthlySalary: MoneyAmountSchema.optional(),
    rowVersion: z.number().int().min(1),
  })
  .refine((value) => Object.keys(value).some((key) => key !== 'rowVersion'), {
    message: 'Change at least one field',
  });
export type UpdateStaffRequest = z.input<typeof UpdateStaffRequestSchema>;

export const DeactivateStaffRequestSchema = z.object({
  leftOn: DateOnlySchema,
  rowVersion: z.number().int().min(1),
});
export type DeactivateStaffRequest = z.input<typeof DeactivateStaffRequestSchema>;

/** A returning person starts again on a new join date, which must be after the day they left. */
export const ReactivateStaffRequestSchema = z.object({
  joinDate: DateOnlySchema,
  rowVersion: z.number().int().min(1),
});
export type ReactivateStaffRequest = z.input<typeof ReactivateStaffRequestSchema>;

export const StaffSummarySchema = z.object({
  id: z.string(),
  userId: z.string(),
  fullName: z.string(),
  username: z.string(),
  branchId: z.string(),
  branchCode: z.string(),
  employeeCode: z.string(),
  department: z.string().nullable(),
  departmentName: z.string().nullable(),
  designation: z.string().nullable(),
  joinDate: z.string(),
  leftOn: z.string().nullable(),
  status: StaffStatusSchema,
  monthlySalary: z.string(),
  createdAt: z.string(),
});
export type StaffSummary = z.infer<typeof StaffSummarySchema>;

export const StaffSchema = StaffSummarySchema.extend({ rowVersion: z.number().int() });
export type Staff = z.infer<typeof StaffSchema>;

export const STAFF_SORT_FIELDS = ['employeeCode', 'joinDate', 'createdAt'] as const;
export const StaffListQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['all', ...STAFF_STATUSES]).default('all'),
  department: z.string().trim().max(30).optional(),
  branchId: z.uuid().optional(),
});
export type StaffListQuery = z.input<typeof StaffListQuerySchema>;
export const StaffListResponseSchema = paginatedSchema(StaffSchema);
export type StaffListResponse = z.infer<typeof StaffListResponseSchema>;

export const StaffCandidateSchema = z.object({
  userId: z.string(),
  fullName: z.string(),
  username: z.string(),
});
export const StaffCandidateListResponseSchema = z.array(StaffCandidateSchema);
export type StaffCandidate = z.infer<typeof StaffCandidateSchema>;

export const DepartmentSchema = z.object({ code: z.string(), name: z.string() });
export const DepartmentListResponseSchema = z.array(DepartmentSchema);
export type DepartmentOption = z.infer<typeof DepartmentSchema>;

// ---------- attendance ----------

const InstantSchema = z.iso.datetime({ offset: true, message: 'Choose the date and time' });

/**
 * A manager sets or corrects the attendance of a person for a day. The check-in must fall on that working day in India; the
 * check-out may follow after midnight, within a day of the check-in. Every correction needs a reason and is audited.
 */
export const CorrectAttendanceRequestSchema = z
  .object({
    staffId: z.uuid('Choose the person'),
    workDate: DateOnlySchema,
    checkIn: InstantSchema,
    checkOut: InstantSchema.nullable().default(null),
    reason: ReasonSchema,
  })
  .superRefine((value, context) => {
    const checkIn = new Date(value.checkIn);
    // A field that is not a real time is reported on its own; the checks that compare times need real ones.
    if (Number.isNaN(checkIn.getTime())) return;
    if (workDateOf(checkIn) !== value.workDate)
      context.addIssue({
        code: 'custom',
        path: ['checkIn'],
        message: 'The check-in must be on the working day',
      });
    if (value.checkOut) {
      const out = new Date(value.checkOut);
      if (Number.isNaN(out.getTime())) return;
      if (out.getTime() < checkIn.getTime())
        context.addIssue({
          code: 'custom',
          path: ['checkOut'],
          message: 'The check-out cannot be before the check-in',
        });
      else if (out.getTime() - checkIn.getTime() > MAX_SHIFT_HOURS * 3_600_000)
        context.addIssue({
          code: 'custom',
          path: ['checkOut'],
          message: `A shift cannot be longer than ${MAX_SHIFT_HOURS} hours`,
        });
    }
  });
export type CorrectAttendanceRequest = z.input<typeof CorrectAttendanceRequestSchema>;

export const AttendanceSchema = z.object({
  id: z.string(),
  staffId: z.string(),
  staffName: z.string(),
  employeeCode: z.string(),
  workDate: z.string(),
  checkIn: z.string().nullable(),
  checkOut: z.string().nullable(),
  /** Hours between check-in and check-out, once both are there. */
  hoursWorked: z.string().nullable(),
  state: z.enum(['OPEN', 'COMPLETE']),
  correctedByName: z.string().nullable(),
  correctionReason: z.string().nullable(),
});
export type Attendance = z.infer<typeof AttendanceSchema>;

export const AttendanceListQuerySchema = PaginationQuerySchema.extend({
  month: MonthSchema,
  staffId: z.uuid().optional(),
  branchId: z.uuid().optional(),
});
export type AttendanceListQuery = z.input<typeof AttendanceListQuerySchema>;
export const AttendanceListResponseSchema = paginatedSchema(AttendanceSchema).extend({
  /** Days in the month with a record, across every record that matches, not only this page. */
  daysPresent: z.number().int(),
});
export type AttendanceListResponse = z.infer<typeof AttendanceListResponseSchema>;

export const MyAttendanceSchema = z.object({
  staffId: z.string(),
  today: z.string(),
  /** Today's record, or one still open from before midnight. */
  current: AttendanceSchema.nullable(),
});
export type MyAttendance = z.infer<typeof MyAttendanceSchema>;

// ---------- leave ----------

export const LEAVE_KINDS = ['PAID', 'UNPAID'] as const;
export const LeaveKindSchema = z.enum(LEAVE_KINDS);
export type LeaveKindName = z.infer<typeof LeaveKindSchema>;

export const LEAVE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export const LeaveStatusSchema = z.enum(LEAVE_STATUSES);
export type LeaveStatusName = z.infer<typeof LeaveStatusSchema>;

export const MAX_LEAVE_DAYS = 366;

/**
 * Asks for leave from one day to another, both included. Leave for oneself needs only `leave.request`; a manager may
 * ask for it for someone else with `staffId`. Two live requests of one person never share a day.
 */
export const CreateLeaveRequestSchema = z
  .object({
    staffId: z.uuid().optional(),
    fromDate: DateOnlySchema,
    toDate: DateOnlySchema,
    kind: LeaveKindSchema.default('PAID'),
    reason: z.string().trim().min(1).max(300).optional(),
  })
  .superRefine((value, context) => {
    if (value.toDate < value.fromDate)
      context.addIssue({
        code: 'custom',
        path: ['toDate'],
        message: 'The last day cannot be before the first',
      });
    else if (inclusiveDays(value.fromDate, value.toDate) > MAX_LEAVE_DAYS)
      context.addIssue({
        code: 'custom',
        path: ['toDate'],
        message: `Leave cannot be longer than ${MAX_LEAVE_DAYS} days`,
      });
  });
export type CreateLeaveRequest = z.input<typeof CreateLeaveRequestSchema>;

export const ApproveLeaveRequestSchema = z.object({
  rowVersion: z.number().int().min(1),
  note: z.string().trim().min(1).max(300).optional(),
});
export type ApproveLeaveRequest = z.input<typeof ApproveLeaveRequestSchema>;

export const RejectLeaveRequestSchema = z.object({
  rowVersion: z.number().int().min(1),
  note: ReasonSchema,
});
export type RejectLeaveRequest = z.input<typeof RejectLeaveRequestSchema>;

export const CancelLeaveRequestSchema = z.object({
  rowVersion: z.number().int().min(1),
  note: z.string().trim().min(1).max(300).optional(),
});
export type CancelLeaveRequest = z.input<typeof CancelLeaveRequestSchema>;

export const LeaveSchema = z.object({
  id: z.string(),
  staffId: z.string(),
  staffName: z.string(),
  employeeCode: z.string(),
  branchCode: z.string(),
  fromDate: z.string(),
  toDate: z.string(),
  /** Days asked for, both ends counted. */
  days: z.number().int(),
  kind: LeaveKindSchema,
  reason: z.string().nullable(),
  status: LeaveStatusSchema,
  decidedByName: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decisionNote: z.string().nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
  rowVersion: z.number().int(),
});
export type Leave = z.infer<typeof LeaveSchema>;

export const LEAVE_SORT_FIELDS = ['fromDate', 'createdAt'] as const;
export const LeaveListQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(['all', ...LEAVE_STATUSES]).default('all'),
  staffId: z.uuid().optional(),
  branchId: z.uuid().optional(),
  /** Only leave that has a day in this month, even if it starts or ends in another. */
  month: MonthSchema.optional(),
});
export type LeaveListQuery = z.input<typeof LeaveListQuerySchema>;
export const LeaveListResponseSchema = paginatedSchema(LeaveSchema);
export type LeaveListResponse = z.infer<typeof LeaveListResponseSchema>;

// ---------- payroll ----------

export const PAYROLL_STATUSES = ['DRAFT', 'FINALIZED'] as const;
export const PayrollStatusSchema = z.enum(PAYROLL_STATUSES);
export type PayrollStatusName = z.infer<typeof PayrollStatusSchema>;

/** Makes a draft payroll record for every person employed in a month who does not have one yet. Only a month that has ended. */
export const GeneratePayrollRequestSchema = z.object({
  month: MonthSchema,
  branchId: z.uuid().optional(),
});
export type GeneratePayrollRequest = z.input<typeof GeneratePayrollRequestSchema>;

export const UpdatePayrollRequestSchema = z.object({
  deductions: MoneyAmountSchema,
  deductionNote: z.string().trim().min(1).max(300).optional(),
  rowVersion: z.number().int().min(1),
});
export type UpdatePayrollRequest = z.input<typeof UpdatePayrollRequestSchema>;

export const FinalizePayrollRequestSchema = z.object({ rowVersion: z.number().int().min(1) });
export type FinalizePayrollRequest = z.input<typeof FinalizePayrollRequestSchema>;

export const PayrollSchema = z.object({
  id: z.string(),
  staffId: z.string(),
  staffName: z.string(),
  employeeCode: z.string(),
  branchId: z.string(),
  branchCode: z.string(),
  month: z.string(),
  status: PayrollStatusSchema,
  /** The salary the record was worked out on. A later raise does not change it. */
  monthlySalary: z.string(),
  daysInMonth: z.number().int(),
  daysEmployed: z.number().int(),
  daysPresent: z.number().int(),
  paidLeaveDays: z.number().int(),
  unpaidLeaveDays: z.number().int(),
  /** The salary for the days employed. */
  gross: z.string(),
  deductions: z.string(),
  deductionNote: z.string().nullable(),
  net: z.string(),
  finalizedByName: z.string().nullable(),
  finalizedAt: z.string().nullable(),
  rowVersion: z.number().int(),
});
export type Payroll = z.infer<typeof PayrollSchema>;

export const PAYROLL_SORT_FIELDS = ['month', 'net'] as const;
export const PayrollListQuerySchema = PaginationQuerySchema.extend({
  month: MonthSchema.optional(),
  staffId: z.uuid().optional(),
  branchId: z.uuid().optional(),
  status: z.enum(['all', ...PAYROLL_STATUSES]).default('all'),
});
export type PayrollListQuery = z.input<typeof PayrollListQuerySchema>;
export const PayrollListResponseSchema = paginatedSchema(PayrollSchema).extend({
  /** Over every record that matches, not only this page. */
  totals: z.object({ gross: z.string(), deductions: z.string(), net: z.string() }),
});
export type PayrollListResponse = z.infer<typeof PayrollListResponseSchema>;

export const GeneratePayrollResponseSchema = z.object({
  month: z.string(),
  created: z.number().int(),
  /** People who were employed in the month and already had a record. */
  alreadyHad: z.number().int(),
});
export type GeneratePayrollResponse = z.infer<typeof GeneratePayrollResponseSchema>;
