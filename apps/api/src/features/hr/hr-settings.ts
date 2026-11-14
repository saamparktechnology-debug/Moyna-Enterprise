import { DEFAULT_WEEKLY_OFF, parseWeeklyOff, weekdayOf } from '@erp/contracts';
import type { OffDay, Weekday } from '@erp/contracts';
import type { TxClient } from '../../common/prisma/scoped-prisma.service.js';
import { isoDate, parseIsoDate } from './hr.shared.js';

/** Eight hours make a full day until the owner says otherwise in the settings. */
export const DEFAULT_DUTY_HOURS = 8;

export interface HrSettings {
  /** The minutes that make one full duty day (Full duty, in hours). */
  dutyMinutes: number;
  /** The company's weekly off days. */
  weeklyOff: Weekday[];
  /** Whether staff paid by the day are paid for weekly offs and holidays they do not work. */
  payOffDaysDaily: boolean;
}

/** The company settings that shape attendance and pay. */
export async function loadHrSettings(tx: TxClient): Promise<HrSettings> {
  const rows = await tx.appSetting.findMany({
    where: {
      key: {
        in: ['company.full_duty_hours', 'company.weekly_off_days', 'company.pay_off_days_daily'],
      },
    },
  });
  const value = (key: string): unknown => rows.find((row) => row.key === key)?.value;
  const hours = Number(value('company.full_duty_hours'));
  const weekly = value('company.weekly_off_days');
  return {
    dutyMinutes:
      (Number.isInteger(hours) && hours >= 1 && hours <= 24 ? hours : DEFAULT_DUTY_HOURS) * 60,
    weeklyOff: parseWeeklyOff(typeof weekly === 'string' ? weekly : DEFAULT_WEEKLY_OFF),
    payOffDaysDaily: value('company.pay_off_days_daily') === 'YES',
  };
}

/** The weekly off days of one person: their own when the Super Admin set them, otherwise the company's. */
export function weeklyOffFor(own: string | null | undefined, company: Weekday[]): Weekday[] {
  return own === null || own === undefined ? company : parseWeeklyOff(own);
}

/**
 * The days from `from` to `to` (inclusive, YYYY-MM-DD) on which a person is not expected to work. Their own day off wins over
 * a company holiday, which wins over a weekly off, so each day is named once.
 */
export async function loadOffDays(
  tx: TxClient,
  hr: HrSettings,
  person: { id: string; weeklyOffDays: string | null },
  from: string,
  to: string,
): Promise<Map<string, OffDay>> {
  const [holidays, own] = await Promise.all([
    tx.holiday.findMany({
      where: { holidayDate: { gte: parseIsoDate(from), lte: parseIsoDate(to) } },
    }),
    tx.staffDayOff.findMany({
      where: { staffId: person.id, offDate: { gte: parseIsoDate(from), lte: parseIsoDate(to) } },
    }),
  ]);
  const holidayNames = new Map(holidays.map((row) => [isoDate(row.holidayDate), row.name]));
  const ownNames = new Map(own.map((row) => [isoDate(row.offDate), row.name]));
  const weekly = new Set<Weekday>(weeklyOffFor(person.weeklyOffDays, hr.weeklyOff));
  const days = new Map<string, OffDay>();
  for (
    let cursor = parseIsoDate(from);
    isoDate(cursor) <= to;
    cursor = new Date(cursor.getTime() + 86_400_000)
  ) {
    const date = isoDate(cursor);
    if (ownNames.has(date)) days.set(date, { kind: 'DAY_OFF', name: ownNames.get(date) ?? null });
    else if (holidayNames.has(date))
      days.set(date, { kind: 'HOLIDAY', name: holidayNames.get(date) ?? null });
    else if (weekly.has(weekdayOf(date))) days.set(date, { kind: 'WEEKLY_OFF', name: null });
  }
  return days;
}
