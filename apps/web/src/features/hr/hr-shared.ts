import type {
  LeaveKindName,
  LeaveStatusName,
  PayrollStatusName,
  StaffStatusName,
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

/** A `datetime-local` value (the person's own time) as a time with its offset that the server accepts. */
export function localToIso(value: string): string {
  return new Date(value).toISOString();
}
