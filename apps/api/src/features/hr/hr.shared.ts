import type { TxClient } from '../../common/prisma/scoped-prisma.service.js';
import type { AuthContext } from '../auth/auth.types.js';

export const parseIsoDate = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
export const isoDate = (value: Date): string => value.toISOString().slice(0, 10);

/** A manager sees everyone in the branches they may use; anyone else sees only their own HR records. */
export const isManager = (auth: AuthContext): boolean => auth.permissions.includes('hr.manage');

export async function ownStaffId(tx: TxClient, auth: AuthContext): Promise<string | null> {
  const row = await tx.staff.findUnique({ where: { userId: auth.userId }, select: { id: true } });
  return row?.id ?? null;
}

export async function userNames(
  tx: TxClient,
  ids: readonly (string | null | undefined)[],
): Promise<Map<string, string>> {
  const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
  if (wanted.length === 0) return new Map();
  const users = await tx.user.findMany({
    where: { id: { in: wanted } },
    select: { id: true, fullName: true },
  });
  return new Map(users.map((user) => [user.id, user.fullName]));
}

/** The months (YYYY-MM) a date range touches. */
export function monthsTouched(from: string, to: string): string[] {
  const months: string[] = [];
  let [year, month] = from.slice(0, 7).split('-').map(Number) as [number, number];
  const last = to.slice(0, 7);
  for (;;) {
    const label = `${year}-${String(month).padStart(2, '0')}`;
    months.push(label);
    if (label >= last) break;
    month += 1;
    if (month > 12) {
      month = 1;
      year += 1;
    }
  }
  return months;
}

/** Whether payroll is final for any of the months a range touches, for one person. */
export async function finalMonthIn(
  tx: TxClient,
  staffId: string,
  from: string,
  to: string,
): Promise<string | null> {
  const record = await tx.payrollRecord.findFirst({
    where: { staffId, status: 'FINALIZED', month: { in: monthsTouched(from, to) } },
    select: { month: true },
    orderBy: { month: 'asc' },
  });
  return record?.month ?? null;
}
