import { describe, expect, it } from 'vitest';
import {
  CreateDayOffRequestSchema,
  CreateHolidayRequestSchema,
  SetWeeklyOffRequestSchema,
  WeeklyOffSettingSchema,
  formatWeeklyOff,
  parseWeeklyOff,
  weekdayOf,
} from './holidays.js';
import { SETTING_BY_KEY } from './settings.js';

describe('weekdayOf', () => {
  it('gives the weekday of a date', () => {
    expect(weekdayOf('2026-02-01')).toBe('SUN');
    expect(weekdayOf('2026-02-02')).toBe('MON');
    expect(weekdayOf('2026-02-28')).toBe('SAT');
    expect(weekdayOf('2028-02-29')).toBe('TUE');
  });
});

describe('weekly off days', () => {
  it('tidies spaces and case, and accepts NONE', () => {
    expect(WeeklyOffSettingSchema.parse(' sat , sun ')).toBe('SAT,SUN');
    expect(WeeklyOffSettingSchema.parse('none')).toBe('NONE');
    expect(WeeklyOffSettingSchema.parse('SUN')).toBe('SUN');
  });
  it('refuses unknown days, repeats and stray commas', () => {
    for (const bad of ['', 'FUNDAY', 'SUN,SUN', 'SUN,', ',SUN', 'SUNDAY', 'NONE,SUN'])
      expect(WeeklyOffSettingSchema.safeParse(bad).success, bad).toBe(false);
  });
  it('reads and writes the stored form in week order', () => {
    expect(parseWeeklyOff('SAT,MON')).toEqual(['MON', 'SAT']);
    expect(parseWeeklyOff('NONE')).toEqual([]);
    expect(parseWeeklyOff(null)).toEqual([]);
    expect(formatWeeklyOff(['SUN', 'MON'])).toBe('MON,SUN');
    expect(formatWeeklyOff([])).toBe('NONE');
    expect(formatWeeklyOff(['SAT', 'SAT'])).toBe('SAT');
  });
  it('are company settings the Super Admin can save, with a yes or no for paying daily staff', () => {
    expect(SETTING_BY_KEY.get('company.weekly_off_days')?.schema.safeParse('SAT,SUN').success).toBe(
      true,
    );
    expect(SETTING_BY_KEY.get('company.weekly_off_days')?.schema.safeParse('xyz').success).toBe(
      false,
    );
    expect(SETTING_BY_KEY.get('company.pay_off_days_daily')?.schema.safeParse('YES').success).toBe(
      true,
    );
    expect(
      SETTING_BY_KEY.get('company.pay_off_days_daily')?.schema.safeParse('maybe').success,
    ).toBe(false);
  });
});

describe('holiday and roster requests', () => {
  it('need a real date and a name', () => {
    expect(
      CreateHolidayRequestSchema.safeParse({ date: '2026-08-15', name: 'Independence Day' })
        .success,
    ).toBe(true);
    expect(CreateHolidayRequestSchema.safeParse({ date: '2026-02-30', name: 'x' }).success).toBe(
      false,
    );
    expect(CreateHolidayRequestSchema.safeParse({ date: '2026-08-15', name: '  ' }).success).toBe(
      false,
    );
    expect(
      CreateHolidayRequestSchema.safeParse({ date: '2026-08-15', name: 'x'.repeat(81) }).success,
    ).toBe(false);
  });
  it('take a day off with or without a name', () => {
    expect(CreateDayOffRequestSchema.safeParse({ date: '2026-02-11' }).success).toBe(true);
    expect(
      CreateDayOffRequestSchema.safeParse({ date: '2026-02-11', name: 'Wedding' }).success,
    ).toBe(true);
    expect(CreateDayOffRequestSchema.safeParse({ date: 'tomorrow' }).success).toBe(false);
  });
  it('set weekly off days, or null for the company’s, with the version read', () => {
    expect(
      SetWeeklyOffRequestSchema.safeParse({ weeklyOffDays: ['SAT'], rowVersion: 1 }).success,
    ).toBe(true);
    expect(
      SetWeeklyOffRequestSchema.safeParse({ weeklyOffDays: null, rowVersion: 2 }).success,
    ).toBe(true);
    expect(SetWeeklyOffRequestSchema.safeParse({ weeklyOffDays: [], rowVersion: 1 }).success).toBe(
      true,
    );
    expect(
      SetWeeklyOffRequestSchema.safeParse({ weeklyOffDays: ['XXX'], rowVersion: 1 }).success,
    ).toBe(false);
    expect(SetWeeklyOffRequestSchema.safeParse({ weeklyOffDays: ['SAT'] }).success).toBe(false);
  });
});
