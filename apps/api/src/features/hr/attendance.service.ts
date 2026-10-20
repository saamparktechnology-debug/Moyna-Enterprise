import { Inject, Injectable } from '@nestjs/common';
import {
  AttendanceListQuerySchema,
  CorrectAttendanceRequestSchema,
  MAX_OPEN_SHIFT_HOURS,
  hoursBetween,
  monthBounds,
  todayInIndia,
  workDateOf,
} from '@erp/contracts';
import type { Attendance, AttendanceListResponse, MyAttendance } from '@erp/contracts';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service.js';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationFailedError,
} from '../../common/errors/domain-errors.js';
import { buildPage, toSkipTake } from '../../common/pagination/pagination.js';
import type { TxClient } from '../../common/prisma/scoped-prisma.service.js';
import { TransactionService } from '../../common/prisma/transaction.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import {
  finalMonthIn,
  isManager,
  isoDate,
  ownStaffId,
  parseIsoDate,
  userNames,
} from './hr.shared.js';

const INCLUDE = {
  staff: { select: { employeeCode: true, userId: true, user: { select: { fullName: true } } } },
} satisfies Prisma.AttendanceInclude;
type Row = Prisma.AttendanceGetPayload<{ include: typeof INCLUDE }>;

function toDto(row: Row, names: ReadonlyMap<string, string>): Attendance {
  return {
    id: row.id,
    staffId: row.staffId,
    staffName: row.staff.user.fullName,
    employeeCode: row.staff.employeeCode,
    workDate: isoDate(row.workDate),
    checkIn: row.checkIn?.toISOString() ?? null,
    checkOut: row.checkOut?.toISOString() ?? null,
    hoursWorked: row.checkIn && row.checkOut ? hoursBetween(row.checkIn, row.checkOut) : null,
    state: row.checkOut ? 'COMPLETE' : 'OPEN',
    correctedByName: row.correctedBy ? (names.get(row.correctedBy) ?? null) : null,
    correctionReason: row.correctionReason,
  };
}

@Injectable()
export class AttendanceService {
  constructor(
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  // ---------- the person's own day ----------

  async mine(auth: AuthContext): Promise<MyAttendance> {
    return this.transactions.run(async (tx) => {
      const staff = await this.ownStaff(tx, auth);
      const now = new Date();
      const current =
        (await this.openShift(tx, staff.id, now)) ?? (await this.todayRow(tx, staff.id, now));
      return {
        staffId: staff.id,
        today: todayInIndia(now),
        current: current ? await this.present(tx, current.id) : null,
      };
    });
  }

  async checkIn(auth: AuthContext): Promise<Attendance> {
    return this.transactions.run(async (tx) => {
      const staff = await this.ownStaff(tx, auth);
      this.assertEmployed(staff);
      const now = new Date();
      const day = workDateOf(now);
      if (day < isoDate(staff.joinDate))
        throw new BusinessRuleError('You have not joined yet', [
          { field: 'staff', message: `You join on ${isoDate(staff.joinDate)}` },
        ]);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`attendance:${staff.id}`}, 0))`;
      const open = await this.openShift(tx, staff.id, now);
      if (open)
        throw new ConflictError(
          isoDate(open.workDate) === day
            ? 'You are already checked in today'
            : 'Your last shift is still open',
          [
            {
              field: 'checkIn',
              message:
                isoDate(open.workDate) === day
                  ? 'Check out when you finish'
                  : `Check out of the shift that began on ${isoDate(open.workDate)} first`,
            },
          ],
        );
      if (await this.todayRow(tx, staff.id, now))
        throw new ConflictError('Your attendance for today is already recorded', [
          { field: 'checkIn', message: 'Ask a manager if it needs correcting' },
        ]);
      const leave = await tx.leaveRequest.findFirst({
        where: {
          staffId: staff.id,
          status: 'APPROVED',
          fromDate: { lte: parseIsoDate(day) },
          toDate: { gte: parseIsoDate(day) },
        },
        select: { id: true },
      });
      if (leave)
        throw new BusinessRuleError('You are on approved leave today', [
          { field: 'checkIn', message: 'Cancel the leave first if you are working' },
        ]);
      const final = await finalMonthIn(tx, staff.id, day, day);
      if (final)
        throw new BusinessRuleError('The payroll for this month is final', [
          { field: 'checkIn', message: 'Ask a manager' },
        ]);
      const row = await tx.attendance.create({
        data: {
          branchId: staff.branchId,
          staffId: staff.id,
          workDate: parseIsoDate(day),
          checkIn: now,
          createdBy: auth.userId,
          updatedBy: auth.userId,
        },
      });
      return this.present(tx, row.id);
    });
  }

  /**
   * Ends the open shift, whether it began today or before midnight, so a night shift stays on the day it began. A shift
   * left open for more than a working day is not closed here: a manager corrects it.
   */
  async checkOut(auth: AuthContext): Promise<Attendance> {
    return this.transactions.run(async (tx) => {
      const staff = await this.ownStaff(tx, auth);
      this.assertEmployed(staff);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`attendance:${staff.id}`}, 0))`;
      const now = new Date();
      const open = await this.openShift(tx, staff.id, now);
      if (!open)
        throw new BusinessRuleError('You have not checked in', [
          {
            field: 'checkOut',
            message:
              'Check in first. If you forgot to check out yesterday, ask a manager to correct it',
          },
        ]);
      await tx.attendance.update({
        where: { id: open.id },
        data: { checkOut: now, updatedBy: auth.userId },
      });
      return this.present(tx, open.id);
    });
  }

  // ---------- reading ----------

  async list(auth: AuthContext, rawQuery: unknown): Promise<AttendanceListResponse> {
    const query = AttendanceListQuerySchema.parse(rawQuery);
    const { first, last } = monthBounds(query.month);
    return this.transactions.run(async (tx) => {
      const mine = isManager(auth) ? null : await ownStaffId(tx, auth);
      if (!isManager(auth) && !mine)
        return { ...buildPage<Attendance>([], 0, query), daysPresent: 0 };
      const where: Prisma.AttendanceWhereInput = {
        workDate: { gte: parseIsoDate(first), lte: parseIsoDate(last) },
        ...(mine ? { staffId: mine } : query.staffId ? { staffId: query.staffId } : {}),
        ...(query.branchId ? { branchId: query.branchId } : {}),
      };
      const [rows, total, present] = await Promise.all([
        tx.attendance.findMany({
          where,
          include: INCLUDE,
          orderBy: [{ workDate: 'desc' }, { staff: { employeeCode: 'asc' } }, { id: 'asc' }],
          ...toSkipTake(query),
        }),
        tx.attendance.count({ where }),
        tx.attendance.count({ where: { ...where, checkIn: { not: null } } }),
      ]);
      const names = await userNames(
        tx,
        rows.map((row) => row.correctedBy),
      );
      return {
        ...buildPage(
          rows.map((row) => toDto(row, names)),
          total,
          query,
        ),
        daysPresent: present,
      };
    });
  }

  // ---------- correcting ----------

  /**
   * A manager sets or corrects a day's attendance. It must be a day the person worked here (not before they joined or
   * after they left, not in the future, not on approved leave, not in a month whose payroll is final), and a manager does
   * not correct their own record. The old and new times are audited with the reason.
   */
  async correct(auth: AuthContext, body: unknown): Promise<Attendance> {
    const input = CorrectAttendanceRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const staff = await tx.staff.findUnique({ where: { id: input.staffId } });
      if (!staff) throw new NotFoundError('Staff profile', input.staffId);
      if (staff.userId === auth.userId && !auth.isSuperAdmin)
        throw new ForbiddenError('You cannot correct your own attendance. Ask another manager');
      const problems = [];
      if (input.workDate > todayInIndia())
        problems.push({
          field: 'workDate',
          message: 'Attendance cannot be recorded for a day that has not come',
        });
      if (input.workDate < isoDate(staff.joinDate))
        problems.push({ field: 'workDate', message: `They joined on ${isoDate(staff.joinDate)}` });
      if (staff.leftOn && input.workDate > isoDate(staff.leftOn))
        problems.push({ field: 'workDate', message: `They left on ${isoDate(staff.leftOn)}` });
      if (problems.length > 0)
        throw new ValidationFailedError('That day cannot be recorded', problems);
      const final = await finalMonthIn(tx, staff.id, input.workDate, input.workDate);
      if (final)
        throw new BusinessRuleError('The payroll for this month is final', [
          { field: 'workDate', message: `The payroll for ${final} cannot be reopened` },
        ]);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`attendance:${staff.id}`}, 0))`;
      const workDate = parseIsoDate(input.workDate);
      const existing = await tx.attendance.findUnique({
        where: { staffId_workDate: { staffId: staff.id, workDate } },
      });
      if (!existing) {
        const leave = await tx.leaveRequest.findFirst({
          where: {
            staffId: staff.id,
            status: 'APPROVED',
            fromDate: { lte: workDate },
            toDate: { gte: workDate },
          },
          select: { fromDate: true, toDate: true },
        });
        if (leave)
          throw new BusinessRuleError('The staff member is on approved leave that day', [
            {
              field: 'workDate',
              message: `Leave from ${isoDate(leave.fromDate)} to ${isoDate(leave.toDate)}. Cancel it first if they worked`,
            },
          ]);
      }
      const data = {
        checkIn: new Date(input.checkIn),
        checkOut: input.checkOut ? new Date(input.checkOut) : null,
        correctedBy: auth.userId,
        correctionReason: input.reason,
        updatedBy: auth.userId,
      };
      const row = existing
        ? await tx.attendance.update({ where: { id: existing.id }, data })
        : await tx.attendance.create({
            data: {
              ...data,
              branchId: staff.branchId,
              staffId: staff.id,
              workDate,
              createdBy: auth.userId,
            },
          });
      await this.audit.record(tx, {
        action: 'ATTENDANCE_CORRECTED',
        entityType: 'Attendance',
        entityId: row.id,
        branchId: staff.branchId,
        oldValue: existing
          ? {
              checkIn: existing.checkIn?.toISOString() ?? null,
              checkOut: existing.checkOut?.toISOString() ?? null,
            }
          : null,
        newValue: {
          staffId: staff.id,
          workDate: input.workDate,
          checkIn: input.checkIn,
          checkOut: input.checkOut,
          reason: input.reason,
        },
      });
      return this.present(tx, row.id);
    });
  }

  // ---------- helpers ----------

  private async ownStaff(tx: TxClient, auth: AuthContext) {
    const staff = await tx.staff.findUnique({ where: { userId: auth.userId } });
    if (!staff)
      throw new BusinessRuleError('You have no staff profile', [
        { field: 'staff', message: 'Ask a manager to add you as staff' },
      ]);
    return staff;
  }

  private assertEmployed(staff: { status: string; leftOn: Date | null }): void {
    if (staff.status !== 'ACTIVE')
      throw new BusinessRuleError('Your staff profile is no longer active', [
        {
          field: 'staff',
          message: staff.leftOn ? `You left on ${isoDate(staff.leftOn)}` : 'You have left',
        },
      ]);
  }

  /** The shift still open from today, or from before midnight (up to the longest a shift may stay open). */
  private openShift(tx: TxClient, staffId: string, now: Date) {
    return tx.attendance.findFirst({
      where: {
        staffId,
        checkOut: null,
        checkIn: { gte: new Date(now.getTime() - MAX_OPEN_SHIFT_HOURS * 3_600_000) },
      },
      orderBy: { checkIn: 'desc' },
    });
  }

  private todayRow(tx: TxClient, staffId: string, now: Date) {
    return tx.attendance.findUnique({
      where: { staffId_workDate: { staffId, workDate: parseIsoDate(workDateOf(now)) } },
    });
  }

  private async present(tx: TxClient, id: string): Promise<Attendance> {
    const row = await tx.attendance.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    return toDto(row, await userNames(tx, [row.correctedBy]));
  }
}
