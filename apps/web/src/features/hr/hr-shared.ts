//apps/web/src/features/hr/hr-shared.ts
import type {
  LeaveKindName,
  LeaveStatusName,
  OffDay,
  PayrollStatusName,
  StaffStatusName,
  Weekday,
} from '@erp/contracts';
import { todayInIndia } from '@erp/contracts';

export const STAFF_STATUS_TEXT: Record<StaffStatusName, string> = {
  ACTIVE: 'Working here',
  INACTIVE: 'Left',
};
export const LEAVE_KIND_TEXT: Record<LeaveKindName, string> = {
  PAID: 'Paid leave',
  UNPAID: 'Unpaid leave',
};
export const LEAVE_STATUS_TEXT: Record<LeaveStatusName, string> = {
  PENDING: 'Waiting for a decision',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Withdrawn',
};
export const PAYROLL_STATUS_TEXT: Record<PayrollStatusName, string> = {
  DRAFT: 'Draft',
  FINALIZED: 'Final',
};

export const WEEKDAY_TEXT: Record<Weekday, string> = {
  MON: 'Monday',
  TUE: 'Tuesday',
  WED: 'Wednesday',
  THU: 'Thursday',
  FRI: 'Friday',
  SAT: 'Saturday',
  SUN: 'Sunday',
};

/** Days in words, such as "Saturday and Sunday", or "none" for no weekly off. */
export function weekdaysText(days: readonly Weekday[]): string {
  const names = days.map((day) => WEEKDAY_TEXT[day]);
  if (names.length === 0) return 'none';
  if (names.length === 1) return names[0] as string;
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
}

/** The line shown on a person's own day when it is not a working day. */
export function offDayText(off: OffDay): string {
  if (off.kind === 'HOLIDAY') return `Today is a holiday: ${off.name ?? 'the shop is closed'}.`;
  if (off.kind === 'DAY_OFF')
    return off.name ? `Today is your day off: ${off.name}.` : 'Today is your day off.';
  return 'Today is your weekly off.';
}

/** The current month in India, such as 2026-10. */
export const thisMonth = (): string => todayInIndia().slice(0, 7);

/** The month before the current one, which is the latest payroll can be made for. */
export function lastMonth(): string {
  const [year, month] = thisMonth().split('-').map(Number) as [number, number];
  return month === 1 ? `${year - 1}-12` : `${year}-${String(month - 1).padStart(2, '0')}`;
}

export function timeOf(iso: string | null): string {
  return iso
    ? new Date(iso).toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit' })
    : '—';
}

/** A moment as a `datetime-local` value in India time, to fill a form with the times a punch has. */
export function isoToLocal(iso: string): string {
  return new Date(new Date(iso).getTime() + 330 * 60_000).toISOString().slice(0, 16);
}

/** Whole minutes as hours and minutes: 3 h 20 m. */
export function minutesText(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return hours === 0 ? `${rest} m` : rest === 0 ? `${hours} h` : `${hours} h ${rest} m`;
}

/** A `datetime-local` value (the person's own time) as a time with its offset that the server accepts. */
export function localToIso(value: string): string {
  return new Date(value).toISOString();
}
