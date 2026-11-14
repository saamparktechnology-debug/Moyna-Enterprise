//apps\api\src\features\hr\attendance.service.ts
import { Inject, Injectable } from '@nestjs/common';
import {
  AttendanceListQuerySchema,
  CorrectAttendanceRequestSchema,
  CreatePunchRequestSchema,
  MAX_OPEN_SHIFT_HOURS,
  PunchListQuerySchema,
  RemovePunchRequestSchema,
  UpdatePunchRequestSchema,
  hoursBetween,
  monthBounds,
  todayInIndia,
  workDateOf,
} from '@erp/contracts';
import type {
  Attendance,
  AttendanceListResponse,
  MyAttendance,
  Punch,
  PunchListResponse,
} from '@erp/contracts';
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
import { loadHrSettings, loadOffDays } from './hr-settings.js';
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
    hoursWorked:
      row.checkIn && row.checkOut
        ? row.workedMinutes > 0
          ? (row.workedMinutes / 60).toFixed(2)
          : hoursBetween(row.checkIn, row.checkOut)
        : null,
    state: row.checkOut ? 'COMPLETE' : 'OPEN',
    workedMinutes: row.workedMinutes,
    correctedByName: row.correctedBy ? (names.get(row.correctedBy) ?? null) : null,
    correctionReason: row.correctionReason,
  };
}

const PUNCH_INCLUDE = {
  staff: { select: { employeeCode: true, user: { select: { fullName: true } } } },
} satisfies Prisma.AttendancePunchInclude;
type PunchRow = Prisma.AttendancePunchGetPayload<{ include: typeof PUNCH_INCLUDE }>;

function toPunchDto(row: PunchRow, names: ReadonlyMap<string, string>): Punch {
  return {
    id: row.id,
    staffId: row.staffId,
    staffName: row.staff.user.fullName,
    employeeCode: row.staff.employeeCode,
    workDate: isoDate(row.workDate),
    punchedInAt: row.punchedInAt.toISOString(),
    punchedOutAt: row.punchedOutAt?.toISOString() ?? null,
    minutes: row.punchedOutAt
      ? Math.round((row.punchedOutAt.getTime() - row.punchedInAt.getTime()) / 60_000)
      : null,
    source: row.source === 'MANAGER' ? 'MANAGER' : 'SELF',
    editedByName: row.editedBy ? (names.get(row.editedBy) ?? null) : null,
    editReason: row.editReason,
    rowVersion: row.rowVersion,
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
      const open = await this.openPunch(tx, staff.id, now);
      const day = open ? isoDate(open.workDate) : workDateOf(now);
      const current = await tx.attendance.findUnique({
        where: { staffId_workDate: { staffId: staff.id, workDate: parseIsoDate(day) } },
      });
      const punches = await tx.attendancePunch.findMany({
        where: { staffId: staff.id, workDate: parseIsoDate(day) },
        include: PUNCH_INCLUDE,
        orderBy: { punchedInAt: 'asc' },
      });
      const names = await userNames(
        tx,
        punches.map((punch) => punch.editedBy),
      );
      const hr = await loadHrSettings(tx);
      const { dutyMinutes } = hr;
      const today = todayInIndia(now);
      const offToday = (await loadOffDays(tx, hr, staff, today, today)).get(today) ?? null;
      return {
        staffId: staff.id,
        today,
        offDay: offToday,
        current: current ? await this.present(tx, current.id) : null,
        punches: punches.map((punch) => toPunchDto(punch, names)),
        workedMinutesToday: this.minutesOf(punches, now),
        dutyMinutes,
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
      const open = await this.openPunch(tx, staff.id, now);
      if (open)
        throw new ConflictError(
          isoDate(open.workDate) === day
            ? 'You are already punched in'
            : 'Your last shift is still open',
          [
            {
              field: 'checkIn',
              message:
                isoDate(open.workDate) === day
                  ? 'Punch out when you finish'
                  : `Punch out of the shift that began on ${isoDate(open.workDate)} first`,
            },
          ],
        );
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
      await tx.attendancePunch.create({
        data: {
          branchId: staff.branchId,
          staffId: staff.id,
          workDate: parseIsoDate(day),
          punchedInAt: now,
          source: 'SELF',
          createdBy: auth.userId,
          updatedBy: auth.userId,
        },
      });
      const dayRow = await this.syncDay(tx, staff, parseIsoDate(day), auth.userId);
      return this.present(tx, dayRow.id);
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
      const open = await this.openPunch(tx, staff.id, now);
      if (!open)
        throw new BusinessRuleError('You have not punched in', [
          {
            field: 'checkOut',
            message:
              'Punch in first. If you forgot to punch out yesterday, ask a manager to correct it',
          },
        ]);
      await tx.attendancePunch.update({
        where: { id: open.id },
        data: { punchedOutAt: now, updatedBy: auth.userId },
      });
      const dayRow = await this.syncDay(tx, staff, open.workDate, auth.userId);
      return this.present(tx, dayRow.id);
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
      // The day's punches are replaced by the one the manager gives. What they were is kept in the audit trail.
      const oldPunches = await tx.attendancePunch.findMany({
        where: { staffId: staff.id, workDate },
        orderBy: { punchedInAt: 'asc' },
      });
      await tx.attendancePunch.deleteMany({ where: { staffId: staff.id, workDate } });
      await tx.attendancePunch.create({
        data: {
          branchId: staff.branchId,
          staffId: staff.id,
          workDate,
          punchedInAt: new Date(input.checkIn),
          punchedOutAt: input.checkOut ? new Date(input.checkOut) : null,
          source: 'MANAGER',
          editedBy: auth.userId,
          editReason: input.reason,
          createdBy: auth.userId,
          updatedBy: auth.userId,
        },
      });
      const row = await this.syncDay(tx, staff, workDate, auth.userId, {
        by: auth.userId,
        reason: input.reason,
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
              punches: oldPunches.map((punch) => ({
                in: punch.punchedInAt.toISOString(),
                out: punch.punchedOutAt?.toISOString() ?? null,
              })),
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

  // ---------- punches: a manager looks at them and changes them ----------

  /** The punches of one day: everyone's for a manager, one's own for anyone else. */
  async listPunches(auth: AuthContext, rawQuery: unknown): Promise<PunchListResponse> {
    const query = PunchListQuerySchema.parse(rawQuery);
    return this.transactions.run(async (tx) => {
      const { dutyMinutes } = await loadHrSettings(tx);
      const mine = isManager(auth) ? null : await ownStaffId(tx, auth);
      if (!isManager(auth) && !mine) return { date: query.date, dutyMinutes, items: [] };
      const rows = await tx.attendancePunch.findMany({
        where: {
          workDate: parseIsoDate(query.date),
          ...(mine ? { staffId: mine } : query.staffId ? { staffId: query.staffId } : {}),
          ...(query.branchId ? { branchId: query.branchId } : {}),
        },
        include: PUNCH_INCLUDE,
        orderBy: [{ staff: { employeeCode: 'asc' } }, { punchedInAt: 'asc' }, { id: 'asc' }],
      });
      const names = await userNames(
        tx,
        rows.map((row) => row.editedBy),
      );
      return { date: query.date, dutyMinutes, items: rows.map((row) => toPunchDto(row, names)) };
    });
  }

  /** Adds a punch for someone, for a day they worked here. Needs a reason; audited. */
  async createPunch(auth: AuthContext, body: unknown): Promise<Punch> {
    const input = CreatePunchRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const staff = await tx.staff.findUnique({ where: { id: input.staffId } });
      if (!staff) throw new NotFoundError('Staff profile', input.staffId);
      const inAt = new Date(input.punchedInAt);
      const outAt = input.punchedOutAt ? new Date(input.punchedOutAt) : null;
      const day = workDateOf(inAt);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`attendance:${staff.id}`}, 0))`;
      await this.assertPunchAllowed(tx, auth, staff, [day], inAt, outAt);
      await this.assertNoClash(tx, staff.id, null, inAt, outAt);
      const row = await tx.attendancePunch.create({
        data: {
          branchId: staff.branchId,
          staffId: staff.id,
          workDate: parseIsoDate(day),
          punchedInAt: inAt,
          punchedOutAt: outAt,
          source: 'MANAGER',
          editedBy: auth.userId,
          editReason: input.reason,
          createdBy: auth.userId,
          updatedBy: auth.userId,
        },
        include: PUNCH_INCLUDE,
      });
      await this.syncDay(tx, staff, parseIsoDate(day), auth.userId);
      await this.audit.record(tx, {
        action: 'PUNCH_ADDED',
        entityType: 'AttendancePunch',
        entityId: row.id,
        branchId: staff.branchId,
        newValue: {
          staffId: staff.id,
          workDate: day,
          punchedInAt: inAt.toISOString(),
          punchedOutAt: outAt?.toISOString() ?? null,
          reason: input.reason,
        },
      });
      return toPunchDto(row, await userNames(tx, [auth.userId]));
    });
  }

  /** Changes the times of a punch. Needs a reason; the old and new times are audited. */
  async updatePunch(auth: AuthContext, id: string, body: unknown): Promise<Punch> {
    const input = UpdatePunchRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const current = await this.lockPunch(tx, id, input.rowVersion);
      const staff = await tx.staff.findUniqueOrThrow({ where: { id: current.staffId } });
      const inAt = input.punchedInAt ? new Date(input.punchedInAt) : current.punchedInAt;
      const outAt =
        input.punchedOutAt === undefined
          ? current.punchedOutAt
          : input.punchedOutAt === null
            ? null
            : new Date(input.punchedOutAt);
      if (outAt && outAt.getTime() <= inAt.getTime())
        throw new ValidationFailedError('The punch out must be after the punch in', [
          { field: 'punchedOutAt', message: 'The punch out must be after the punch in' },
        ]);
      if (outAt && outAt.getTime() - inAt.getTime() > 24 * 3_600_000)
        throw new ValidationFailedError('One punch cannot be longer than 24 hours', [
          { field: 'punchedOutAt', message: 'One punch cannot be longer than 24 hours' },
        ]);
      const oldDay = isoDate(current.workDate);
      const newDay = workDateOf(inAt);
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`attendance:${staff.id}`}, 0))`;
      await this.assertPunchAllowed(tx, auth, staff, [...new Set([oldDay, newDay])], inAt, outAt);
      await this.assertNoClash(tx, staff.id, current.id, inAt, outAt);
      const row = await tx.attendancePunch.update({
        where: { id },
        data: {
          punchedInAt: inAt,
          punchedOutAt: outAt,
          workDate: parseIsoDate(newDay),
          source: 'MANAGER',
          editedBy: auth.userId,
          editReason: input.reason,
          updatedBy: auth.userId,
        },
        include: PUNCH_INCLUDE,
      });
      await this.syncDay(tx, staff, parseIsoDate(newDay), auth.userId);
      if (oldDay !== newDay) await this.syncDay(tx, staff, parseIsoDate(oldDay), auth.userId);
      await this.audit.record(tx, {
        action: 'PUNCH_EDITED',
        entityType: 'AttendancePunch',
        entityId: id,
        branchId: staff.branchId,
        oldValue: {
          workDate: oldDay,
          punchedInAt: current.punchedInAt.toISOString(),
          punchedOutAt: current.punchedOutAt?.toISOString() ?? null,
        },
        newValue: {
          workDate: newDay,
          punchedInAt: inAt.toISOString(),
          punchedOutAt: outAt?.toISOString() ?? null,
          reason: input.reason,
        },
      });
      return toPunchDto(row, await userNames(tx, [auth.userId]));
    });
  }

  /** Takes a wrong punch away. Needs a reason; what it was is audited. */
  async removePunch(auth: AuthContext, id: string, body: unknown): Promise<void> {
    const input = RemovePunchRequestSchema.parse(body);
    await this.transactions.run(async (tx) => {
      const current = await this.lockPunch(tx, id, input.rowVersion);
      const staff = await tx.staff.findUniqueOrThrow({ where: { id: current.staffId } });
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`attendance:${staff.id}`}, 0))`;
      const day = isoDate(current.workDate);
      await this.assertPunchAllowed(tx, auth, staff, [day], null, null);
      await tx.attendancePunch.delete({ where: { id } });
      await this.syncDay(tx, staff, current.workDate, auth.userId);
      await this.audit.record(tx, {
        action: 'PUNCH_REMOVED',
        entityType: 'AttendancePunch',
        entityId: id,
        branchId: staff.branchId,
        oldValue: {
          staffId: staff.id,
          workDate: day,
          punchedInAt: current.punchedInAt.toISOString(),
          punchedOutAt: current.punchedOutAt?.toISOString() ?? null,
        },
        newValue: { reason: input.reason },
      });
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

  /** The punch still open from today, or from before midnight (up to the longest a shift may stay open). */
  private openPunch(tx: TxClient, staffId: string, now: Date) {
    return tx.attendancePunch.findFirst({
      where: {
        staffId,
        punchedOutAt: null,
        punchedInAt: { gte: new Date(now.getTime() - MAX_OPEN_SHIFT_HOURS * 3_600_000) },
      },
      orderBy: { punchedInAt: 'desc' },
    });
  }

  /** Whole minutes worked: every closed punch, and the open one up to now. */
  private minutesOf(
    punches: readonly { punchedInAt: Date; punchedOutAt: Date | null }[],
    now: Date,
  ): number {
    const ms = punches.reduce(
      (sum, punch) => sum + ((punch.punchedOutAt ?? now).getTime() - punch.punchedInAt.getTime()),
      0,
    );
    return Math.max(0, Math.round(ms / 60_000));
  }

  /**
   * Keeps the day's attendance row in step with its punches: the first punch in, the last punch out (empty while one is
   * open) and the minutes worked in the closed punches.
   */
  private async syncDay(
    tx: TxClient,
    staff: { id: string; branchId: string },
    workDate: Date,
    userId: string,
    correction?: { by: string; reason: string },
  ) {
    const punches = await tx.attendancePunch.findMany({
      where: { staffId: staff.id, workDate },
      orderBy: { punchedInAt: 'asc' },
    });
    const closed = punches.filter((punch) => punch.punchedOutAt !== null);
    const open = punches.length > closed.length;
    const lastOut = closed.reduce<Date | null>(
      (latest, punch) =>
        punch.punchedOutAt && (!latest || punch.punchedOutAt > latest)
          ? punch.punchedOutAt
          : latest,
      null,
    );
    const data = {
      checkIn: punches[0]?.punchedInAt ?? null,
      checkOut: open ? null : lastOut,
      workedMinutes: this.minutesOf(closed, new Date()),
      updatedBy: userId,
      ...(correction ? { correctedBy: correction.by, correctionReason: correction.reason } : {}),
    };
    const existing = await tx.attendance.findUnique({
      where: { staffId_workDate: { staffId: staff.id, workDate } },
    });
    return existing
      ? tx.attendance.update({ where: { id: existing.id }, data })
      : tx.attendance.create({
          data: {
            ...data,
            branchId: staff.branchId,
            staffId: staff.id,
            workDate,
            createdBy: userId,
          },
        });
  }

  private async lockPunch(tx: TxClient, id: string, rowVersion: number) {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM attendance_punches WHERE id = ${id}::uuid FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundError('Punch', id);
    const row = await tx.attendancePunch.findUniqueOrThrow({ where: { id } });
    if (row.rowVersion !== rowVersion)
      throw new ConflictError('This punch was changed by someone else. Reload it and try again');
    return row;
  }

  /**
   * The rules for a manager changing punches: a day the person worked here (not before they joined, after they left, in the
   * future, on approved leave, or in a month whose payroll is final), and never their own punches unless a Super Admin.
   */
  private async assertPunchAllowed(
    tx: TxClient,
    auth: AuthContext,
    staff: { id: string; userId: string; joinDate: Date; leftOn: Date | null },
    days: readonly string[],
    inAt: Date | null,
    outAt: Date | null,
  ): Promise<void> {
    if (staff.userId === auth.userId && !auth.isSuperAdmin)
      throw new ForbiddenError('You cannot change your own punches. Ask another manager');
    const now = new Date();
    const problems = [];
    if (inAt && inAt.getTime() > now.getTime())
      problems.push({ field: 'punchedInAt', message: 'A punch cannot be in the future' });
    if (outAt && outAt.getTime() > now.getTime())
      problems.push({ field: 'punchedOutAt', message: 'A punch cannot be in the future' });
    for (const day of days) {
      if (inAt && day < isoDate(staff.joinDate))
        problems.push({
          field: 'punchedInAt',
          message: `They joined on ${isoDate(staff.joinDate)}`,
        });
      if (inAt && staff.leftOn && day > isoDate(staff.leftOn))
        problems.push({ field: 'punchedInAt', message: `They left on ${isoDate(staff.leftOn)}` });
    }
    if (problems.length > 0)
      throw new ValidationFailedError('That punch cannot be recorded', problems);
    for (const day of days) {
      const final = await finalMonthIn(tx, staff.id, day, day);
      if (final)
        throw new BusinessRuleError('The payroll for this month is final', [
          { field: 'punchedInAt', message: `The payroll for ${final} cannot be reopened` },
        ]);
    }
    if (inAt) {
      const leave = await tx.leaveRequest.findFirst({
        where: {
          staffId: staff.id,
          status: 'APPROVED',
          fromDate: { lte: parseIsoDate(workDateOf(inAt)) },
          toDate: { gte: parseIsoDate(workDateOf(inAt)) },
        },
        select: { fromDate: true, toDate: true },
      });
      if (leave)
        throw new BusinessRuleError('The staff member is on approved leave that day', [
          {
            field: 'punchedInAt',
            message: `Leave from ${isoDate(leave.fromDate)} to ${isoDate(leave.toDate)}. Cancel it first if they worked`,
          },
        ]);
    }
  }

  /** A person's punches never overlap, and only one can be open. */
  private async assertNoClash(
    tx: TxClient,
    staffId: string,
    ownId: string | null,
    inAt: Date,
    outAt: Date | null,
  ): Promise<void> {
    const clash = await tx.attendancePunch.findFirst({
      where: {
        staffId,
        ...(ownId ? { id: { not: ownId } } : {}),
        punchedInAt: { lt: outAt ?? new Date('9999-12-31T00:00:00.000Z') },
        OR: [{ punchedOutAt: null }, { punchedOutAt: { gt: inAt } }],
      },
    });
    if (clash)
      throw new ConflictError('That overlaps another punch of the same person', [
        {
          field: 'punchedInAt',
          message: clash.punchedOutAt
            ? `They have a punch from ${clash.punchedInAt.toISOString()} to ${clash.punchedOutAt.toISOString()}`
            : `They have a punch from ${clash.punchedInAt.toISOString()} that is still open`,
        },
      ]);
    if (!outAt) {
      const open = await tx.attendancePunch.findFirst({
        where: { staffId, punchedOutAt: null, ...(ownId ? { id: { not: ownId } } : {}) },
      });
      if (open)
        throw new ConflictError('They already have a punch that is still open', [
          { field: 'punchedOutAt', message: 'Close the open punch first' },
        ]);
    }
  }

  private async present(tx: TxClient, id: string): Promise<Attendance> {
    const row = await tx.attendance.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    return toDto(row, await userNames(tx, [row.correctedBy]));
  }
}
