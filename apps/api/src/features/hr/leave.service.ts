import { Inject, Injectable } from '@nestjs/common';
import {
  ApproveLeaveRequestSchema,
  CancelLeaveRequestSchema,
  CreateLeaveRequestSchema,
  LEAVE_SORT_FIELDS,
  LeaveListQuerySchema,
  RejectLeaveRequestSchema,
  inclusiveDays,
  monthBounds,
  todayInIndia,
} from '@erp/contracts';
import type { Leave, LeaveListResponse } from '@erp/contracts';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service.js';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  InvalidStateError,
  NotFoundError,
  ValidationFailedError,
} from '../../common/errors/domain-errors.js';
import { OutboxService } from '../../common/outbox/outbox.service.js';
import { buildPage, toOrderBy, toSkipTake } from '../../common/pagination/pagination.js';
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

const STALE = 'This leave request was changed by someone else. Reload it and try again';
const INCLUDE = {
  staff: {
    select: {
      employeeCode: true,
      userId: true,
      branchId: true,
      user: { select: { fullName: true } },
      branch: { select: { code: true } },
    },
  },
} satisfies Prisma.LeaveRequestInclude;
type Row = Prisma.LeaveRequestGetPayload<{ include: typeof INCLUDE }>;

function toDto(row: Row, names: ReadonlyMap<string, string>): Leave {
  const from = isoDate(row.fromDate);
  const to = isoDate(row.toDate);
  return {
    id: row.id,
    staffId: row.staffId,
    staffName: row.staff.user.fullName,
    employeeCode: row.staff.employeeCode,
    branchCode: row.staff.branch.code,
    fromDate: from,
    toDate: to,
    days: inclusiveDays(from, to),
    kind: row.kind as Leave['kind'],
    reason: row.reason,
    status: row.status,
    decidedByName: row.decidedBy ? (names.get(row.decidedBy) ?? null) : null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decisionNote: row.decisionNote,
    createdByName: row.createdBy ? (names.get(row.createdBy) ?? null) : null,
    createdAt: row.createdAt.toISOString(),
    rowVersion: row.rowVersion,
  };
}

@Injectable()
export class LeaveService {
  constructor(
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  // ---------- reading ----------

  async list(auth: AuthContext, rawQuery: unknown): Promise<LeaveListResponse> {
    const query = LeaveListQuerySchema.parse(rawQuery);
    return this.transactions.run(async (tx) => {
      const mine = isManager(auth) ? null : await ownStaffId(tx, auth);
      if (!isManager(auth) && !mine) return buildPage<Leave>([], 0, query);
      const filters: Prisma.LeaveRequestWhereInput[] = [];
      if (mine) filters.push({ staffId: mine });
      else if (query.staffId) filters.push({ staffId: query.staffId });
      if (query.status !== 'all') filters.push({ status: query.status });
      if (query.branchId) filters.push({ branchId: query.branchId });
      if (query.month) {
        const { first, last } = monthBounds(query.month);
        filters.push({
          fromDate: { lte: parseIsoDate(last) },
          toDate: { gte: parseIsoDate(first) },
        });
      }
      const where: Prisma.LeaveRequestWhereInput = { AND: filters };
      const orderBy = toOrderBy(LEAVE_SORT_FIELDS, query, { field: 'fromDate', order: 'desc' });
      const [rows, total] = await Promise.all([
        tx.leaveRequest.findMany({ where, orderBy, include: INCLUDE, ...toSkipTake(query) }),
        tx.leaveRequest.count({ where }),
      ]);
      const names = await userNames(
        tx,
        rows.flatMap((row) => [row.decidedBy, row.createdBy]),
      );
      return buildPage(
        rows.map((row) => toDto(row, names)),
        total,
        query,
      );
    });
  }

  async get(auth: AuthContext, id: string): Promise<Leave> {
    return this.transactions.run((tx) => this.present(tx, auth, id));
  }

  // ---------- asking ----------

  async request(auth: AuthContext, body: unknown): Promise<Leave> {
    const input = CreateLeaveRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const own = await ownStaffId(tx, auth);
      const onBehalf = input.staffId !== undefined && input.staffId !== own;
      if (onBehalf && !isManager(auth))
        throw new ForbiddenError('You can ask for leave only for yourself');
      const staffId = input.staffId ?? own;
      if (!staffId)
        throw new BusinessRuleError('You have no staff profile', [
          { field: 'staffId', message: 'Ask a manager to add you as staff' },
        ]);
      const staff = await tx.staff.findUnique({ where: { id: staffId } });
      if (!staff) throw new NotFoundError('Staff profile', staffId);
      if (staff.status !== 'ACTIVE')
        throw new BusinessRuleError('This staff member has left', [
          {
            field: 'staffId',
            message: staff.leftOn ? `They left on ${isoDate(staff.leftOn)}` : 'They have left',
          },
        ]);
      const problems = [];
      if (input.fromDate < isoDate(staff.joinDate))
        problems.push({ field: 'fromDate', message: `They joined on ${isoDate(staff.joinDate)}` });
      if (!isManager(auth) && input.fromDate < todayInIndia())
        problems.push({
          field: 'fromDate',
          message: 'Leave cannot start in the past. Ask a manager to record it',
        });
      if (problems.length > 0)
        throw new ValidationFailedError('That leave cannot be asked for', problems);
      const final = await finalMonthIn(tx, staffId, input.fromDate, input.toDate);
      if (final)
        throw new BusinessRuleError('The payroll for one of these months is final', [
          { field: 'fromDate', message: `The payroll for ${final} cannot be reopened` },
        ]);
      // The same lock the database takes, so two requests arriving together are checked one after the other.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`leave:${staffId}`}, 0))`;
      const clash = await tx.leaveRequest.findFirst({
        where: {
          staffId,
          status: { in: ['PENDING', 'APPROVED'] },
          fromDate: { lte: parseIsoDate(input.toDate) },
          toDate: { gte: parseIsoDate(input.fromDate) },
        },
        orderBy: { fromDate: 'asc' },
      });
      if (clash)
        throw new ConflictError('These dates overlap other leave', [
          {
            field: 'fromDate',
            message: `Leave from ${isoDate(clash.fromDate)} to ${isoDate(clash.toDate)} is already ${clash.status.toLowerCase()}`,
          },
        ]);
      const row = await tx.leaveRequest.create({
        data: {
          branchId: staff.branchId,
          staffId,
          fromDate: parseIsoDate(input.fromDate),
          toDate: parseIsoDate(input.toDate),
          kind: input.kind,
          reason: input.reason ?? null,
          status: 'PENDING',
          createdBy: auth.userId,
          updatedBy: auth.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'LEAVE_REQUESTED',
        entityType: 'LeaveRequest',
        entityId: row.id,
        branchId: staff.branchId,
        newValue: {
          staffId,
          fromDate: input.fromDate,
          toDate: input.toDate,
          kind: input.kind,
          onBehalf,
        },
      });
      await this.outbox.enqueue(tx, {
        eventType: 'leave.requested',
        branchId: staff.branchId,
        payload: {
          leaveId: row.id,
          staffId,
          fromDate: input.fromDate,
          toDate: input.toDate,
          requestedBy: auth.userId,
        },
      });
      return this.present(tx, auth, row.id);
    });
  }

  // ---------- deciding ----------

  async approve(auth: AuthContext, id: string, body: unknown): Promise<Leave> {
    const input = ApproveLeaveRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const current = await this.lock(tx, id, input.rowVersion);
      if (current.status !== 'PENDING')
        throw new InvalidStateError('The leave request', current.status, 'APPROVED');
      this.assertNotOwn(current.staff.userId, auth, 'approve');
      const from = isoDate(current.fromDate);
      const to = isoDate(current.toDate);
      const final = await finalMonthIn(tx, current.staffId, from, to);
      if (final)
        throw new BusinessRuleError('The payroll for one of these months is final', [
          { field: 'fromDate', message: `The payroll for ${final} cannot be reopened` },
        ]);
      const worked = await tx.attendance.findMany({
        where: {
          staffId: current.staffId,
          checkIn: { not: null },
          workDate: { gte: current.fromDate, lte: current.toDate },
        },
        select: { workDate: true },
        orderBy: { workDate: 'asc' },
        take: 5,
      });
      if (worked.length > 0)
        throw new BusinessRuleError('Attendance has been recorded on some of these days', [
          {
            field: 'fromDate',
            message: `Worked on ${worked.map((w) => isoDate(w.workDate)).join(', ')}. Change the dates, or reject this request`,
          },
        ]);
      await tx.leaveRequest.update({
        where: { id },
        data: {
          status: 'APPROVED',
          decidedBy: auth.userId,
          decidedAt: new Date(),
          decisionNote: input.note ?? null,
          updatedBy: auth.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'LEAVE_APPROVED',
        entityType: 'LeaveRequest',
        entityId: id,
        branchId: current.branchId,
        oldValue: { status: 'PENDING' },
        newValue: {
          status: 'APPROVED',
          staffId: current.staffId,
          fromDate: from,
          toDate: to,
          kind: current.kind,
        },
      });
      await this.outbox.enqueue(tx, {
        eventType: 'leave.approved',
        branchId: current.branchId,
        payload: {
          leaveId: id,
          staffId: current.staffId,
          fromDate: from,
          toDate: to,
          approvedBy: auth.userId,
        },
      });
      return this.present(tx, auth, id);
    });
  }

  async reject(auth: AuthContext, id: string, body: unknown): Promise<Leave> {
    const input = RejectLeaveRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const current = await this.lock(tx, id, input.rowVersion);
      if (current.status !== 'PENDING')
        throw new InvalidStateError('The leave request', current.status, 'REJECTED');
      this.assertNotOwn(current.staff.userId, auth, 'reject');
      await tx.leaveRequest.update({
        where: { id },
        data: {
          status: 'REJECTED',
          decidedBy: auth.userId,
          decidedAt: new Date(),
          decisionNote: input.note,
          updatedBy: auth.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'LEAVE_REJECTED',
        entityType: 'LeaveRequest',
        entityId: id,
        branchId: current.branchId,
        oldValue: { status: 'PENDING' },
        newValue: { status: 'REJECTED', note: input.note },
      });
      await this.outbox.enqueue(tx, {
        eventType: 'leave.rejected',
        branchId: current.branchId,
        payload: { leaveId: id, staffId: current.staffId, rejectedBy: auth.userId },
      });
      return this.present(tx, auth, id);
    });
  }

  /**
   * The person who asked, or a manager, withdraws leave. Leave that has not started can be withdrawn by either; leave that has
   * started or passed only by a manager. Never in a month whose payroll is final.
   */
  async cancel(auth: AuthContext, id: string, body: unknown): Promise<Leave> {
    const input = CancelLeaveRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const current = await this.lock(tx, id, input.rowVersion);
      if (current.status !== 'PENDING' && current.status !== 'APPROVED')
        throw new InvalidStateError('The leave request', current.status, 'CANCELLED');
      const own = current.staff.userId === auth.userId;
      if (!own && !isManager(auth)) throw new NotFoundError('Leave request', id);
      const from = isoDate(current.fromDate);
      const to = isoDate(current.toDate);
      if (current.status === 'APPROVED' && from <= todayInIndia() && !isManager(auth))
        throw new ForbiddenError('This leave has already started. Ask a manager to cancel it');
      const final = await finalMonthIn(tx, current.staffId, from, to);
      if (final)
        throw new BusinessRuleError('The payroll for one of these months is final', [
          { field: 'fromDate', message: `The payroll for ${final} cannot be reopened` },
        ]);
      await tx.leaveRequest.update({
        where: { id },
        data: { status: 'CANCELLED', decisionNote: input.note ?? null, updatedBy: auth.userId },
      });
      await this.audit.record(tx, {
        action: 'LEAVE_CANCELLED',
        entityType: 'LeaveRequest',
        entityId: id,
        branchId: current.branchId,
        oldValue: { status: current.status },
        newValue: { status: 'CANCELLED', fromDate: from, toDate: to, note: input.note ?? null },
      });
      return this.present(tx, auth, id);
    });
  }

  // ---------- helpers ----------

  /** Nobody decides their own leave, except a Super Admin. */
  private assertNotOwn(staffUserId: string, auth: AuthContext, verb: string): void {
    if (staffUserId === auth.userId && !auth.isSuperAdmin)
      throw new ForbiddenError(`You cannot ${verb} your own leave. Ask another manager`);
  }

  private async lock(tx: TxClient, id: string, rowVersion: number) {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM leave_requests WHERE id = ${id}::uuid FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundError('Leave request', id);
    const row = await tx.leaveRequest.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    if (row.rowVersion !== rowVersion) throw new ConflictError(STALE);
    return row;
  }

  private async present(tx: TxClient, auth: AuthContext, id: string): Promise<Leave> {
    const row = await tx.leaveRequest.findUnique({ where: { id }, include: INCLUDE });
    if (!row || (!isManager(auth) && row.staff.userId !== auth.userId))
      throw new NotFoundError('Leave request', id);
    return toDto(row, await userNames(tx, [row.decidedBy, row.createdBy]));
  }
}
