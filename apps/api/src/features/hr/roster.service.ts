import { Inject, Injectable } from '@nestjs/common';
import {
  CreateDayOffRequestSchema,
  CreateHolidayRequestSchema,
  HolidayListQuerySchema,
  RosterQuerySchema,
  SetWeeklyOffRequestSchema,
  formatWeeklyOff,
  parseWeeklyOff,
  todayInIndia,
} from '@erp/contracts';
import type { Holiday, HolidayListResponse, Roster } from '@erp/contracts';
import { AuditService } from '../../common/audit/audit.service.js';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationFailedError,
} from '../../common/errors/domain-errors.js';
import type { TxClient } from '../../common/prisma/scoped-prisma.service.js';
import { TransactionService } from '../../common/prisma/transaction.service.js';
import { loadHrSettings } from './hr-settings.js';
import { finalMonthIn, isoDate, parseIsoDate } from './hr.shared.js';

const yearBounds = (year: number) => ({
  from: parseIsoDate(`${year}-01-01`),
  to: parseIsoDate(`${year}-12-31`),
});
const holidayDto = (row: { id: string; holidayDate: Date; name: string }): Holiday => ({
  id: row.id,
  date: isoDate(row.holidayDate),
  name: row.name,
});

/**
 * The company's holidays and the roster of each employee. Only the Super Admin changes them (the controller asks for the
 * settings permission); anyone who may see HR can read them. The weekly off days of the company are a setting. Changes
 * count from the next payroll that is made: a payroll already made keeps what it had, and the days off of a person whose pay
 * for that month is final cannot be changed.
 */
@Injectable()
export class RosterService {
  constructor(
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ---------- company holidays ----------

  async listHolidays(rawQuery: unknown): Promise<HolidayListResponse> {
    const query = HolidayListQuerySchema.parse(rawQuery);
    const year = query.year ?? Number(todayInIndia().slice(0, 4));
    return this.transactions.run(async (tx) => {
      const hr = await loadHrSettings(tx);
      const { from, to } = yearBounds(year);
      const rows = await tx.holiday.findMany({
        where: { holidayDate: { gte: from, lte: to } },
        orderBy: { holidayDate: 'asc' },
      });
      return {
        year,
        weeklyOffDays: hr.weeklyOff,
        paidForDailyStaff: hr.payOffDaysDaily,
        items: rows.map(holidayDto),
      };
    });
  }

  async addHoliday(body: unknown): Promise<Holiday> {
    const input = CreateHolidayRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const taken = await tx.holiday.findUnique({
        where: { holidayDate: parseIsoDate(input.date) },
      });
      if (taken)
        throw new ConflictError('That day is already a holiday', [
          { field: 'date', message: `It is already marked as ${taken.name}` },
        ]);
      const row = await tx.holiday.create({
        data: { holidayDate: parseIsoDate(input.date), name: input.name },
      });
      await this.audit.record(tx, {
        action: 'HOLIDAY_ADDED',
        entityType: 'Holiday',
        entityId: row.id,
        newValue: { date: input.date, name: input.name },
      });
      return holidayDto(row);
    });
  }

  /** Removes a holiday and returns that year's holidays. */
  async removeHoliday(id: string): Promise<HolidayListResponse> {
    const year = await this.transactions.run(async (tx) => {
      const row = await tx.holiday.findUnique({ where: { id } });
      if (!row) throw new NotFoundError('Holiday', id);
      await tx.holiday.delete({ where: { id } });
      await this.audit.record(tx, {
        action: 'HOLIDAY_REMOVED',
        entityType: 'Holiday',
        entityId: id,
        oldValue: { date: isoDate(row.holidayDate), name: row.name },
      });
      return row.holidayDate.getUTCFullYear();
    });
    return this.listHolidays({ year });
  }

  // ---------- the roster of one employee ----------

  async roster(staffId: string, rawQuery: unknown): Promise<Roster> {
    const query = RosterQuerySchema.parse(rawQuery);
    return this.transactions.run((tx) => this.present(tx, staffId, query.year));
  }

  /** Sets the weekly off days of one employee, or (with null) hands them back to the company's weekly off days. */
  async setWeeklyOff(staffId: string, body: unknown): Promise<Roster> {
    const input = SetWeeklyOffRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const current = await this.staff(tx, staffId);
      if (current.rowVersion !== input.rowVersion)
        throw new ConflictError('This person was changed by someone else. Reload and try again');
      const next = input.weeklyOffDays === null ? null : formatWeeklyOff(input.weeklyOffDays);
      await tx.staff.update({ where: { id: staffId }, data: { weeklyOffDays: next } });
      await this.audit.record(tx, {
        action: 'STAFF_WEEKLY_OFF_SET',
        entityType: 'Staff',
        entityId: staffId,
        branchId: current.branchId,
        oldValue: { weeklyOffDays: current.weeklyOffDays },
        newValue: { weeklyOffDays: next },
      });
      return this.present(tx, staffId, undefined);
    });
  }

  async addDayOff(staffId: string, body: unknown): Promise<Roster> {
    const input = CreateDayOffRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const person = await this.staff(tx, staffId);
      if (input.date < isoDate(person.joinDate))
        throw new ValidationFailedError('That is before they joined', [
          { field: 'date', message: `They joined on ${isoDate(person.joinDate)}` },
        ]);
      if (person.leftOn && input.date > isoDate(person.leftOn))
        throw new ValidationFailedError('That is after they left', [
          { field: 'date', message: `They left on ${isoDate(person.leftOn)}` },
        ]);
      await this.assertNotFinal(tx, staffId, input.date);
      const taken = await tx.staffDayOff.findUnique({
        where: { staffId_offDate: { staffId, offDate: parseIsoDate(input.date) } },
      });
      if (taken)
        throw new ConflictError('That day is already a day off for this person', [
          { field: 'date', message: 'It is already in their days off' },
        ]);
      const row = await tx.staffDayOff.create({
        data: {
          branchId: person.branchId,
          staffId,
          offDate: parseIsoDate(input.date),
          name: input.name ?? null,
        },
      });
      await this.audit.record(tx, {
        action: 'STAFF_DAY_OFF_ADDED',
        entityType: 'Staff',
        entityId: staffId,
        branchId: person.branchId,
        newValue: { date: input.date, name: input.name ?? null, dayOffId: row.id },
      });
      return this.present(tx, staffId, Number(input.date.slice(0, 4)));
    });
  }

  async removeDayOff(staffId: string, dayOffId: string): Promise<Roster> {
    return this.transactions.run(async (tx) => {
      const person = await this.staff(tx, staffId);
      const row = await tx.staffDayOff.findUnique({ where: { id: dayOffId } });
      if (!row || row.staffId !== staffId) throw new NotFoundError('Day off', dayOffId);
      await this.assertNotFinal(tx, staffId, isoDate(row.offDate));
      await tx.staffDayOff.delete({ where: { id: dayOffId } });
      await this.audit.record(tx, {
        action: 'STAFF_DAY_OFF_REMOVED',
        entityType: 'Staff',
        entityId: staffId,
        branchId: person.branchId,
        oldValue: { date: isoDate(row.offDate), name: row.name },
      });
      return this.present(tx, staffId, Number(isoDate(row.offDate).slice(0, 4)));
    });
  }

  // ---------- helpers ----------

  private async staff(tx: TxClient, staffId: string) {
    const row = await tx.staff.findUnique({ where: { id: staffId } });
    if (!row) throw new NotFoundError('Staff member', staffId);
    return row;
  }

  private async assertNotFinal(tx: TxClient, staffId: string, date: string): Promise<void> {
    const final = await finalMonthIn(tx, staffId, date, date);
    if (final)
      throw new BusinessRuleError('That month is already paid', [
        { field: 'date', message: `The payroll for ${final} is final and cannot change` },
      ]);
  }

  private async present(tx: TxClient, staffId: string, year: number | undefined): Promise<Roster> {
    const person = await tx.staff.findUnique({
      where: { id: staffId },
      include: { user: { select: { fullName: true } } },
    });
    if (!person) throw new NotFoundError('Staff member', staffId);
    const shown = year ?? Number(todayInIndia().slice(0, 4));
    const { from, to } = yearBounds(shown);
    const [hr, daysOff, holidays] = await Promise.all([
      loadHrSettings(tx),
      tx.staffDayOff.findMany({
        where: { staffId, offDate: { gte: from, lte: to } },
        orderBy: { offDate: 'asc' },
      }),
      tx.holiday.findMany({
        where: { holidayDate: { gte: from, lte: to } },
        orderBy: { holidayDate: 'asc' },
      }),
    ]);
    const own = person.weeklyOffDays === null ? null : parseWeeklyOff(person.weeklyOffDays);
    return {
      staffId,
      staffName: person.user.fullName,
      employeeCode: person.employeeCode,
      year: shown,
      weeklyOffDays: own ?? hr.weeklyOff,
      ownWeeklyOff: own,
      companyWeeklyOffDays: hr.weeklyOff,
      daysOff: daysOff.map((row) => ({
        id: row.id,
        date: isoDate(row.offDate),
        name: row.name,
      })),
      companyHolidays: holidays.map(holidayDto),
      rowVersion: person.rowVersion,
    };
  }
}
