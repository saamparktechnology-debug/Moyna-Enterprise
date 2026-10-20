import { z } from 'zod';

const DAY_MS = 86_400_000;
const IST_OFFSET_MS = 330 * 60_000;
export const MAX_WARRANTY_MONTHS = 120;
export const DEFAULT_EXPIRY_WINDOW_DAYS = 30;

function toUtc(date: string): number {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  return Date.UTC(year, month - 1, day);
}

function isRealDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  return new Date(toUtc(value)).toISOString().slice(0, 10) === value;
}

/** A calendar date as YYYY-MM-DD, with no time and no time zone. */
export const DateOnlySchema = z
  .string()
  .trim()
  .refine(isRealDate, { message: 'Enter a real date' });

/** Today's date in India, which is what expiry and warranty are judged against. */
export function todayInIndia(now: Date = new Date()): string {
  return new Date(now.getTime() + IST_OFFSET_MS).toISOString().slice(0, 10);
}

export function daysBetween(from: string, to: string): number {
  return Math.round((toUtc(to) - toUtc(from)) / DAY_MS);
}

/** Adds calendar months, keeping the day where it exists and otherwise using the last day (31 Jan + 1 month = 28 or 29 Feb). */
export function addMonths(date: string, months: number): string {
  const [year = 0, month = 1, day = 1] = date.split('-').map(Number);
  const index = year * 12 + (month - 1) + months;
  const targetYear = Math.floor(index / 12);
  const targetMonth = index - targetYear * 12;
  const lastDay = new Date(Date.UTC(targetYear, targetMonth + 1, 0)).getUTCDate();
  const result = new Date(Date.UTC(targetYear, targetMonth, Math.min(day, lastDay)));
  return result.toISOString().slice(0, 10);
}

export const EXPIRY_STATUSES = ['NONE', 'EXPIRED', 'EXPIRING', 'OK'] as const;
export const ExpiryStatusSchema = z.enum(EXPIRY_STATUSES);
export type ExpiryStatus = z.infer<typeof ExpiryStatusSchema>;

/** A battery is good through its expiry date; it is expired from the day after. */
export function expiryStatus(
  expiryOn: string | null,
  today: string,
  withinDays: number = DEFAULT_EXPIRY_WINDOW_DAYS,
): ExpiryStatus {
  if (!expiryOn) return 'NONE';
  const left = daysBetween(today, expiryOn);
  if (left < 0) return 'EXPIRED';
  return left <= withinDays ? 'EXPIRING' : 'OK';
}

export const WARRANTY_STATUSES = ['NONE', 'ACTIVE', 'ENDED'] as const;
export const WarrantyStatusSchema = z.enum(WARRANTY_STATUSES);
export type WarrantyStatus = z.infer<typeof WarrantyStatusSchema>;

/** The warranty covers the last day it names. */
export function warrantyStatus(warrantyEnd: string | null, today: string): WarrantyStatus {
  if (!warrantyEnd) return 'NONE';
  return daysBetween(today, warrantyEnd) >= 0 ? 'ACTIVE' : 'ENDED';
}

const MonthsSchema = z
  .number('Enter a whole number of months')
  .int('Enter a whole number of months')
  .min(0, 'Cannot be negative')
  .max(MAX_WARRANTY_MONTHS, `At most ${MAX_WARRANTY_MONTHS} months`);

interface Dates {
  manufacturedOn?: string | null | undefined;
  expiryOn?: string | null | undefined;
  warrantyEnd?: string | null | undefined;
}

/** Shared by every request that carries battery dates. */
export function checkBatteryDates(
  value: Dates,
  issue: (path: string, message: string) => void,
): void {
  if (value.manufacturedOn && value.expiryOn && value.expiryOn <= value.manufacturedOn)
    issue('expiryOn', 'The expiry date must be after the manufacture date');
  if (value.manufacturedOn && value.warrantyEnd && value.warrantyEnd < value.manufacturedOn)
    issue('warrantyEnd', 'The warranty cannot end before the battery was made');
}

export const BatteryMonthsSchema = MonthsSchema;
