import { z } from 'zod';
import { DateOnlySchema } from './battery-dates.js';

export const WEEKDAYS = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'] as const;
export const WeekdaySchema = z.enum(WEEKDAYS);
export type Weekday = z.infer<typeof WeekdaySchema>;

const WEEKDAY_BY_INDEX: readonly Weekday[] = ['SUN', 'MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT'];

/** The weekday of a YYYY-MM-DD date. */
export function weekdayOf(date: string): Weekday {
  return WEEKDAY_BY_INDEX[new Date(`${date}T00:00:00.000Z`).getUTCDay()] ?? 'SUN';
}

/** The company's weekly off day until the Super Admin says otherwise. */
export const DEFAULT_WEEKLY_OFF = 'SUN';

/**
 * Weekly off days as they are stored: the three-letter days separated by commas (for example SAT,SUN), or NONE for no weekly
 * off. Spaces and lower case are tidied, and each day may appear once.
 */
export const WeeklyOffSettingSchema = z
  .string('Enter the weekly off days')
  .transform((value) => value.replace(/\s+/g, '').toUpperCase())
  .refine((value) => value === 'NONE' || /^[A-Z]{3}(,[A-Z]{3})*$/.test(value), {
    message: 'Use days such as SUN or SAT,SUN, or NONE for no weekly off',
  })
  .refine(
    (value) =>
      value === 'NONE' ||
      value.split(',').every((day) => (WEEKDAYS as readonly string[]).includes(day)),
    { message: 'Days are MON, TUE, WED, THU, FRI, SAT and SUN' },
  )
  .refine(
    (value) => value === 'NONE' || new Set(value.split(',')).size === value.split(',').length,
    {
      message: 'Each day can be listed once',
    },
  );

/** The days in a stored weekly off value, in week order. */
export function parseWeeklyOff(value: string | null | undefined): Weekday[] {
  if (!value || value === 'NONE') return [];
  const listed = new Set(value.split(','));
  return WEEKDAYS.filter((day) => listed.has(day));
}

/** The stored form of a list of days. */
export function formatWeeklyOff(days: readonly Weekday[]): string {
  const listed = new Set(days);
  const ordered = WEEKDAYS.filter((day) => listed.has(day));
  return ordered.length === 0 ? 'NONE' : ordered.join(',');
}

/** Whether staff paid by the day are paid for weekly offs and holidays they do not work. */
export const PayOffDaysSettingSchema = z.enum(['YES', 'NO']);

export const OFF_DAY_KINDS = ['WEEKLY_OFF', 'HOLIDAY', 'DAY_OFF'] as const;
export const OffDayKindSchema = z.enum(OFF_DAY_KINDS);
export type OffDayKind = z.infer<typeof OffDayKindSchema>;
/** A day on which a person is not expected to work, and why. */
export const OffDaySchema = z.object({ kind: OffDayKindSchema, name: z.string().nullable() });
export type OffDay = z.infer<typeof OffDaySchema>;

export const HolidaySchema = z.object({
  id: z.string(),
  date: z.string(),
  name: z.string(),
});
export type Holiday = z.infer<typeof HolidaySchema>;

export const HolidayListQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});
export type HolidayListQuery = z.input<typeof HolidayListQuerySchema>;

export const HolidayListResponseSchema = z.object({
  year: z.number().int(),
  /** The company's weekly off days. */
  weeklyOffDays: z.array(WeekdaySchema),
  /** Whether staff paid by the day are paid for off days they do not work. */
  paidForDailyStaff: z.boolean(),
  items: z.array(HolidaySchema),
});
export type HolidayListResponse = z.infer<typeof HolidayListResponseSchema>;

const OffDayNameSchema = z
  .string('Enter a name')
  .trim()
  .min(1, 'Enter a name')
  .max(80, 'Use at most 80 characters');

export const CreateHolidayRequestSchema = z.object({
  date: DateOnlySchema,
  name: OffDayNameSchema,
});
export type CreateHolidayRequest = z.input<typeof CreateHolidayRequestSchema>;

// ---------- the roster of one employee ----------

export const DayOffSchema = z.object({
  id: z.string(),
  date: z.string(),
  name: z.string().nullable(),
});
export type DayOff = z.infer<typeof DayOffSchema>;

export const RosterQuerySchema = z.object({
  year: z.coerce.number().int().min(2000).max(2100).optional(),
});
export type RosterQuery = z.input<typeof RosterQuerySchema>;

/** What the Super Admin sets for one employee, and what the company sets that also applies to them. */
export const RosterSchema = z.object({
  staffId: z.string(),
  staffName: z.string(),
  employeeCode: z.string(),
  year: z.number().int(),
  /** The weekly off days that apply to this person: their own, or the company's when they have none of their own. */
  weeklyOffDays: z.array(WeekdaySchema),
  /** Their own weekly off days; null when the company's apply. */
  ownWeeklyOff: z.array(WeekdaySchema).nullable(),
  companyWeeklyOffDays: z.array(WeekdaySchema),
  /** Days off for this person only. */
  daysOff: z.array(DayOffSchema),
  /** The company holidays, which apply to this person as well. */
  companyHolidays: z.array(HolidaySchema),
  rowVersion: z.number().int(),
});
export type Roster = z.infer<typeof RosterSchema>;

/** Their own weekly off days, or null to go back to the company's. */
export const SetWeeklyOffRequestSchema = z.object({
  weeklyOffDays: z.array(WeekdaySchema).max(7).nullable(),
  rowVersion: z.number().int().min(1),
});
export type SetWeeklyOffRequest = z.input<typeof SetWeeklyOffRequestSchema>;

export const CreateDayOffRequestSchema = z.object({
  date: DateOnlySchema,
  name: OffDayNameSchema.optional(),
});
export type CreateDayOffRequest = z.input<typeof CreateDayOffRequestSchema>;
