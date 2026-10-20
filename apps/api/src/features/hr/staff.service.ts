import { Inject, Injectable } from '@nestjs/common';
import {
  CreateStaffRequestSchema,
  DeactivateStaffRequestSchema,
  ReactivateStaffRequestSchema,
  STAFF_SORT_FIELDS,
  StaffListQuerySchema,
  UpdateStaffRequestSchema,
} from '@erp/contracts';
import type { DepartmentOption, Staff, StaffCandidate, StaffListResponse } from '@erp/contracts';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service.js';
import { BranchContextService } from '../../common/branch-context/branch-context.service.js';
import {
  BranchAccessError,
  BusinessRuleError,
  ConflictError,
  InvalidStateError,
  NotFoundError,
  ValidationFailedError,
} from '../../common/errors/domain-errors.js';
import {
  buildPage,
  escapeLike,
  toOrderBy,
  toSkipTake,
} from '../../common/pagination/pagination.js';
import type { TxClient } from '../../common/prisma/scoped-prisma.service.js';
import { TransactionService } from '../../common/prisma/transaction.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { isManager, isoDate, ownStaffId, parseIsoDate } from './hr.shared.js';

const STALE = 'This staff profile was changed by someone else. Reload it and try again';

const INCLUDE = {
  user: { select: { fullName: true, username: true } },
  branch: { select: { code: true } },
  departmentRef: { select: { name: true } },
} satisfies Prisma.StaffInclude;
type Row = Prisma.StaffGetPayload<{ include: typeof INCLUDE }>;

function toDto(row: Row): Staff {
  return {
    id: row.id,
    userId: row.userId,
    fullName: row.user.fullName,
    username: row.user.username,
    branchId: row.branchId,
    branchCode: row.branch.code,
    employeeCode: row.employeeCode,
    department: row.department,
    departmentName: row.departmentRef?.name ?? null,
    designation: row.designation,
    joinDate: isoDate(row.joinDate),
    leftOn: row.leftOn ? isoDate(row.leftOn) : null,
    status: row.status,
    monthlySalary: row.monthlySalary.toFixed(2),
    createdAt: row.createdAt.toISOString(),
    rowVersion: row.rowVersion,
  };
}

@Injectable()
export class StaffService {
  constructor(
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(BranchContextService) private readonly contexts: BranchContextService,
  ) {}

  // ---------- reading ----------

  async list(auth: AuthContext, rawQuery: unknown): Promise<StaffListResponse> {
    const query = StaffListQuerySchema.parse(rawQuery);
    return this.transactions.run(async (tx) => {
      const filters: Prisma.StaffWhereInput[] = [];
      if (!isManager(auth)) filters.push({ userId: auth.userId });
      if (query.status !== 'all') filters.push({ status: query.status });
      if (query.department) filters.push({ department: query.department });
      if (query.branchId) filters.push({ branchId: query.branchId });
      const search = query.search?.trim();
      if (search) {
        const like = { contains: escapeLike(search), mode: 'insensitive' as const };
        filters.push({
          OR: [
            { employeeCode: like },
            { designation: like },
            { user: { fullName: like } },
            { user: { username: like } },
          ],
        });
      }
      const where: Prisma.StaffWhereInput = { AND: filters };
      const orderBy = toOrderBy(STAFF_SORT_FIELDS, query, { field: 'employeeCode', order: 'asc' });
      const [rows, total] = await Promise.all([
        tx.staff.findMany({ where, orderBy, include: INCLUDE, ...toSkipTake(query) }),
        tx.staff.count({ where }),
      ]);
      return buildPage(rows.map(toDto), total, query);
    });
  }

  async get(auth: AuthContext, id: string): Promise<Staff> {
    return this.transactions.run((tx) => this.present(tx, auth, id));
  }

  /** The signed-in person's own staff profile. A person with none gets a 404. */
  async mine(auth: AuthContext): Promise<Staff> {
    return this.transactions.run(async (tx) => {
      const id = await ownStaffId(tx, auth);
      if (!id) throw new NotFoundError('Staff profile', auth.userId);
      return this.present(tx, auth, id);
    });
  }

  async departments(): Promise<DepartmentOption[]> {
    return this.transactions.run(async (tx) => {
      const rows = await tx.department.findMany({
        where: { isActive: true },
        orderBy: { name: 'asc' },
      });
      return rows.map((row) => ({ code: row.code, name: row.name }));
    });
  }

  /** Active people who work in the branch and have no staff profile yet. */
  async candidates(rawBranchId: unknown): Promise<StaffCandidate[]> {
    const branchId =
      typeof rawBranchId === 'string' && rawBranchId ? rawBranchId : this.resolveBranch(undefined);
    this.assertBranch(branchId);
    return this.transactions.run(async (tx) => {
      const users = await tx.user.findMany({
        where: { status: 'ACTIVE', staff: null, userBranches: { some: { branchId } } },
        orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
        select: { id: true, fullName: true, username: true },
        take: 200,
      });
      return users.map((user) => ({
        userId: user.id,
        fullName: user.fullName,
        username: user.username,
      }));
    });
  }

  // ---------- managing ----------

  async create(auth: AuthContext, body: unknown): Promise<Staff> {
    const input = CreateStaffRequestSchema.parse(body);
    const branchId = this.resolveBranch(input.branchId);
    return this.transactions.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`staff-code:${input.employeeCode.toLowerCase()}`}, 0))`;
      const user = await tx.user.findFirst({
        where: { id: input.userId, status: 'ACTIVE', userBranches: { some: { branchId } } },
        include: { staff: { select: { id: true } } },
      });
      if (!user)
        throw new ValidationFailedError('That person cannot be made staff here', [
          { field: 'userId', message: 'Choose an active person who works in this branch' },
        ]);
      if (user.staff)
        throw new ConflictError('This person already has a staff profile', [
          { field: 'userId', message: 'Open their existing profile instead' },
        ]);
      await this.assertCodeFree(tx, input.employeeCode, null);
      await this.assertDepartment(tx, input.department);
      const row = await tx.staff.create({
        data: {
          branchId,
          userId: input.userId,
          employeeCode: input.employeeCode,
          department: input.department,
          designation: input.designation,
          joinDate: parseIsoDate(input.joinDate),
          monthlySalary: input.monthlySalary,
          status: 'ACTIVE',
          createdBy: auth.userId,
          updatedBy: auth.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'STAFF_CREATED',
        entityType: 'Staff',
        entityId: row.id,
        branchId,
        newValue: {
          userId: input.userId,
          employeeCode: input.employeeCode,
          department: input.department,
          joinDate: input.joinDate,
          monthlySalary: input.monthlySalary,
        },
      });
      return this.present(tx, auth, row.id);
    });
  }

  async update(auth: AuthContext, id: string, body: unknown): Promise<Staff> {
    const input = UpdateStaffRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const current = await this.lock(tx, id, input.rowVersion);
      if (input.employeeCode && input.employeeCode !== current.employeeCode) {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`staff-code:${input.employeeCode.toLowerCase()}`}, 0))`;
        await this.assertCodeFree(tx, input.employeeCode, id);
      }
      if (input.department !== undefined) await this.assertDepartment(tx, input.department);
      const next = await tx.staff.update({
        where: { id },
        data: {
          ...(input.employeeCode !== undefined ? { employeeCode: input.employeeCode } : {}),
          ...(input.department !== undefined ? { department: input.department } : {}),
          ...(input.designation !== undefined ? { designation: input.designation } : {}),
          ...(input.monthlySalary !== undefined ? { monthlySalary: input.monthlySalary } : {}),
          updatedBy: auth.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'STAFF_UPDATED',
        entityType: 'Staff',
        entityId: id,
        branchId: current.branchId,
        oldValue: {
          employeeCode: current.employeeCode,
          department: current.department,
          designation: current.designation,
          monthlySalary: current.monthlySalary.toFixed(2),
        },
        newValue: {
          employeeCode: next.employeeCode,
          department: next.department,
          designation: next.designation,
          monthlySalary: next.monthlySalary.toFixed(2),
        },
      });
      return this.present(tx, auth, id);
    });
  }

  /**
   * Marks a person as having left on a day. Nothing is deleted: their attendance, leave and payroll stay. Attendance cannot
   * follow after that day, waiting leave is withdrawn, and leave that starts after it is cancelled.
   */
  async deactivate(auth: AuthContext, id: string, body: unknown): Promise<Staff> {
    const input = DeactivateStaffRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const current = await this.lock(tx, id, input.rowVersion);
      if (current.status !== 'ACTIVE')
        throw new InvalidStateError('The staff profile', current.status, 'INACTIVE');
      if (input.leftOn < isoDate(current.joinDate))
        throw new ValidationFailedError('The day they left is before they joined', [
          { field: 'leftOn', message: `They joined on ${isoDate(current.joinDate)}` },
        ]);
      const later = await tx.attendance.count({
        where: { staffId: id, workDate: { gt: parseIsoDate(input.leftOn) } },
      });
      if (later > 0)
        throw new BusinessRuleError('Attendance has been recorded after that day', [
          {
            field: 'leftOn',
            message: `${later} attendance ${later === 1 ? 'record follows' : 'records follow'} ${input.leftOn}`,
          },
        ]);
      const final = await tx.payrollRecord.findFirst({
        where: { staffId: id, status: 'FINALIZED', month: { gt: input.leftOn.slice(0, 7) } },
        select: { month: true },
      });
      if (final)
        throw new BusinessRuleError('Payroll is already final after that day', [
          { field: 'leftOn', message: `The payroll for ${final.month} is final` },
        ]);
      const withdrawn = await tx.leaveRequest.updateMany({
        where: {
          staffId: id,
          OR: [
            { status: 'PENDING' },
            { status: 'APPROVED', fromDate: { gt: parseIsoDate(input.leftOn) } },
          ],
        },
        data: {
          status: 'CANCELLED',
          decidedBy: auth.userId,
          decisionNote: 'The staff member left',
          updatedBy: auth.userId,
        },
      });
      await tx.staff.update({
        where: { id },
        data: { status: 'INACTIVE', leftOn: parseIsoDate(input.leftOn), updatedBy: auth.userId },
      });
      await this.audit.record(tx, {
        action: 'STAFF_DEACTIVATED',
        entityType: 'Staff',
        entityId: id,
        branchId: current.branchId,
        oldValue: { status: 'ACTIVE' },
        newValue: { status: 'INACTIVE', leftOn: input.leftOn, leaveWithdrawn: withdrawn.count },
      });
      return this.present(tx, auth, id);
    });
  }

  /** A returning person starts again on a new join date, after the day they left. Their earlier records stay as they were. */
  async reactivate(auth: AuthContext, id: string, body: unknown): Promise<Staff> {
    const input = ReactivateStaffRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const current = await this.lock(tx, id, input.rowVersion);
      if (current.status !== 'INACTIVE')
        throw new InvalidStateError('The staff profile', current.status, 'ACTIVE');
      const left = current.leftOn ? isoDate(current.leftOn) : null;
      if (left && input.joinDate <= left)
        throw new ValidationFailedError('They must rejoin after the day they left', [
          { field: 'joinDate', message: `They left on ${left}, so choose a later date` },
        ]);
      await tx.staff.update({
        where: { id },
        data: {
          status: 'ACTIVE',
          leftOn: null,
          joinDate: parseIsoDate(input.joinDate),
          updatedBy: auth.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'STAFF_REACTIVATED',
        entityType: 'Staff',
        entityId: id,
        branchId: current.branchId,
        oldValue: { status: 'INACTIVE', joinDate: isoDate(current.joinDate), leftOn: left },
        newValue: { status: 'ACTIVE', joinDate: input.joinDate },
      });
      return this.present(tx, auth, id);
    });
  }

  // ---------- helpers ----------

  private async assertCodeFree(tx: TxClient, code: string, ownId: string | null): Promise<void> {
    const other = await tx.staff.findFirst({
      where: {
        employeeCode: { equals: code, mode: 'insensitive' },
        ...(ownId ? { id: { not: ownId } } : {}),
      },
      select: { id: true },
    });
    if (other)
      throw new ConflictError('This employee code is already used', [
        { field: 'employeeCode', message: 'Choose a code no one else has' },
      ]);
  }

  private async assertDepartment(tx: TxClient, code: string | null): Promise<void> {
    if (code === null) return;
    const found = await tx.department.findFirst({ where: { code, isActive: true } });
    if (!found)
      throw new ValidationFailedError('Unknown department', [
        { field: 'department', message: 'Choose a department from the list' },
      ]);
  }

  private async lock(tx: TxClient, id: string, rowVersion: number) {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM staff WHERE id = ${id}::uuid FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundError('Staff profile', id);
    const row = await tx.staff.findUniqueOrThrow({ where: { id } });
    if (row.rowVersion !== rowVersion) throw new ConflictError(STALE);
    return row;
  }

  private async present(tx: TxClient, auth: AuthContext, id: string): Promise<Staff> {
    const row = await tx.staff.findUnique({ where: { id }, include: INCLUDE });
    if (!row || (!isManager(auth) && row.userId !== auth.userId))
      throw new NotFoundError('Staff profile', id);
    return toDto(row);
  }

  private assertBranch(branchId: string): void {
    const context = this.contexts.require();
    if (!context.isSuperAdmin && !context.branchIds.includes(branchId))
      throw new BranchAccessError();
  }

  private resolveBranch(requested: string | undefined): string {
    const context = this.contexts.require();
    if (requested) {
      this.assertBranch(requested);
      return requested;
    }
    const only = context.branchIds[0];
    if (!context.isSuperAdmin && context.branchIds.length === 1 && only) return only;
    throw new ValidationFailedError('Choose the branch', [
      { field: 'branchId', message: 'Choose a branch' },
    ]);
  }
}
