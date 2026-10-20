import { describe, expect, it } from 'vitest';
import {
  BatteryMonthsSchema,
  DateOnlySchema,
  addMonths,
  checkBatteryDates,
  daysBetween,
  expiryStatus,
  todayInIndia,
  warrantyStatus,
} from './battery-dates.js';

describe('today in India', () => {
  it('moves to the next calendar day at 18:30 UTC', () => {
    expect(todayInIndia(new Date('2026-10-07T18:29:59.000Z'))).toBe('2026-10-07');
    expect(todayInIndia(new Date('2026-10-07T18:30:00.000Z'))).toBe('2026-10-08');
  });

  it('crosses a month and a year end the same way', () => {
    expect(todayInIndia(new Date('2026-12-31T19:00:00.000Z'))).toBe('2027-01-01');
    expect(todayInIndia(new Date('2028-02-28T20:00:00.000Z'))).toBe('2028-02-29');
  });
});

describe('days between dates', () => {
  it('counts whole calendar days, forwards and backwards', () => {
    expect(daysBetween('2026-10-08', '2026-10-08')).toBe(0);
    expect(daysBetween('2026-10-08', '2026-10-09')).toBe(1);
    expect(daysBetween('2026-10-08', '2026-10-07')).toBe(-1);
    expect(daysBetween('2026-02-28', '2026-03-01')).toBe(1);
    expect(daysBetween('2028-02-28', '2028-03-01')).toBe(2);
    expect(daysBetween('2026-01-01', '2027-01-01')).toBe(365);
  });
});

describe('adding months', () => {
  it('keeps the day when it exists', () => {
    expect(addMonths('2026-03-15', 12)).toBe('2027-03-15');
    expect(addMonths('2026-10-08', 6)).toBe('2027-04-08');
    expect(addMonths('2026-10-08', 0)).toBe('2026-10-08');
  });

  it('uses the last day of a shorter month, including leap years', () => {
    expect(addMonths('2026-01-31', 1)).toBe('2026-02-28');
    expect(addMonths('2028-01-31', 1)).toBe('2028-02-29');
    expect(addMonths('2026-08-31', 6)).toBe('2027-02-28');
    expect(addMonths('2026-03-31', 1)).toBe('2026-04-30');
  });

  it('crosses year ends and long spans', () => {
    expect(addMonths('2026-11-30', 3)).toBe('2027-02-28');
    expect(addMonths('2026-12-15', 1)).toBe('2027-01-15');
    expect(addMonths('2026-02-28', 120)).toBe('2036-02-28');
    expect(addMonths('2024-02-29', 12)).toBe('2025-02-28');
  });
});

describe('expiry status', () => {
  const today = '2026-10-08';
  it('is none without a date and good through the expiry date itself', () => {
    expect(expiryStatus(null, today)).toBe('NONE');
    expect(expiryStatus('2026-10-07', today)).toBe('EXPIRED');
    expect(expiryStatus('2026-10-08', today)).toBe('EXPIRING');
  });

  it('is expiring up to the window and fine after it', () => {
    expect(expiryStatus('2026-11-07', today)).toBe('EXPIRING');
    expect(expiryStatus('2026-11-08', today)).toBe('OK');
    expect(expiryStatus('2026-10-20', today, 7)).toBe('OK');
    expect(expiryStatus('2026-10-15', today, 7)).toBe('EXPIRING');
  });
});

describe('warranty status', () => {
  it('covers the last day it names', () => {
    expect(warrantyStatus(null, '2026-10-08')).toBe('NONE');
    expect(warrantyStatus('2026-10-08', '2026-10-08')).toBe('ACTIVE');
    expect(warrantyStatus('2026-10-07', '2026-10-08')).toBe('ENDED');
    expect(warrantyStatus('2027-10-07', '2026-10-08')).toBe('ACTIVE');
  });
});

describe('date and month values', () => {
  it('accepts real calendar dates only', () => {
    expect(DateOnlySchema.safeParse('2026-02-28').success).toBe(true);
    expect(DateOnlySchema.safeParse('2028-02-29').success).toBe(true);
    expect(DateOnlySchema.safeParse('2026-02-29').success).toBe(false);
    expect(DateOnlySchema.safeParse('2026-13-01').success).toBe(false);
    expect(DateOnlySchema.safeParse('2026-1-1').success).toBe(false);
    expect(DateOnlySchema.safeParse('08/10/2026').success).toBe(false);
    expect(DateOnlySchema.safeParse(' 2026-10-08 ').success).toBe(true);
  });

  it('keeps warranty months between 0 and 120 and whole', () => {
    expect(BatteryMonthsSchema.safeParse(0).success).toBe(true);
    expect(BatteryMonthsSchema.safeParse(120).success).toBe(true);
    expect(BatteryMonthsSchema.safeParse(121).success).toBe(false);
    expect(BatteryMonthsSchema.safeParse(-1).success).toBe(false);
    expect(BatteryMonthsSchema.safeParse(1.5).success).toBe(false);
  });

  it('reports dates that contradict each other', () => {
    const issues: string[] = [];
    const issue = (path: string) => issues.push(path);
    checkBatteryDates({ manufacturedOn: '2026-05-01', expiryOn: '2026-05-01' }, issue);
    checkBatteryDates({ manufacturedOn: '2026-05-01', warrantyEnd: '2026-04-30' }, issue);
    checkBatteryDates(
      { manufacturedOn: '2026-05-01', expiryOn: '2026-05-02', warrantyEnd: '2026-05-01' },
      issue,
    );
    checkBatteryDates({ expiryOn: '2026-01-01' }, issue);
    expect(issues).toEqual(['expiryOn', 'warrantyEnd']);
  });
});
