import { Inject, Injectable } from '@nestjs/common';
import {
  FinalizePayrollRequestSchema,
  GeneratePayrollRequestSchema,
  PAYROLL_SORT_FIELDS,
  PayrollListQuerySchema,
  UpdatePayrollRequestSchema,
  employedDays,
  monthBounds,
  overlapDays,
  proRata,
  todayInIndia,
} from '@erp/contracts';
import type { GeneratePayrollResponse, Payroll, PayrollListResponse } from '@erp/contracts';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service.js';
import { BranchContextService } from '../../common/branch-context/branch-context.service.js';
import {
  BranchAccessError,
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
import { isManager, isoDate, ownStaffId, parseIsoDate, userNames } from './hr.shared.js';

const { Decimal } = Prisma;
const STALE = 'This payroll record was changed by someone else. Reload it and try again';
const INCLUDE = {
  staff: { select: { employeeCode: true, userId: true, user: { select: { fullName: true } } } },
  branch: { select: { code: true } },
} satisfies Prisma.PayrollRecordInclude;
type Row = Prisma.PayrollRecordGetPayload<{ include: typeof INCLUDE }>;

function toDto(row: Row, names: ReadonlyMap<string, string>): Payroll {
  return {
    id: row.id,
    staffId: row.staffId,
    staffName: row.staff.user.fullName,
    employeeCode: row.staff.employeeCode,
    branchId: row.branchId,
    branchCode: row.branch.code,
    month: row.month,
    status: row.status as Payroll['status'],
    monthlySalary: row.monthlySalary.toFixed(2),
    daysInMonth: row.daysInMonth,
    daysEmployed: row.daysEmployed,
    daysPresent: row.daysPresent,
    paidLeaveDays: row.paidLeaveDays,
    unpaidLeaveDays: row.unpaidLeaveDays,
    gross: row.gross.toFixed(2),
    deductions: row.deductions.toFixed(2),
    deductionNote: row.deductionNote,
    net: row.net.toFixed(2),
    finalizedByName: row.finalizedBy ? (names.get(row.finalizedBy) ?? null) : null,
    finalizedAt: row.finalizedAt?.toISOString() ?? null,
    rowVersion: row.rowVersion,
  };
}

@Injectable()
export class PayrollService {
  constructor(
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(BranchContextService) private readonly contexts: BranchContextService,
  ) {}

  // ---------- reading ----------

  async list(auth: AuthContext, rawQuery: unknown): Promise<PayrollListResponse> {
    const query = PayrollListQuerySchema.parse(rawQuery);
    return this.transactions.run(async (tx) => {
      const mine = isManager(auth) ? null : await ownStaffId(tx, auth);
      const empty = { gross: '0.00', deductions: '0.00', net: '0.00' };
      if (!isManager(auth) && !mine) return { ...buildPage<Payroll>([], 0, query), totals: empty };
      const filters: Prisma.PayrollRecordWhereInput[] = [];
      if (mine) filters.push({ staffId: mine });
      else if (query.staffId) filters.push({ staffId: query.staffId });
      if (query.month) filters.push({ month: query.month });
      if (query.status !== 'all') filters.push({ status: query.status });
      if (query.branchId) filters.push({ branchId: query.branchId });
      const where: Prisma.PayrollRecordWhereInput = { AND: filters };
      const orderBy = toOrderBy(PAYROLL_SORT_FIELDS, query, { field: 'month', order: 'desc' });
      const [rows, total, sums] = await Promise.all([
        tx.payrollRecord.findMany({
          where,
          include: INCLUDE,
          orderBy: [...orderBy, { staff: { employeeCode: 'asc' as const } }],
          ...toSkipTake(query),
        }),
        tx.payrollRecord.count({ where }),
        tx.payrollRecord.aggregate({ where, _sum: { gross: true, deductions: true, net: true } }),
      ]);
      const names = await userNames(
        tx,
        rows.map((row) => row.finalizedBy),
      );
      return {
        ...buildPage(
          rows.map((row) => toDto(row, names)),
          total,
          query,
        ),
        totals: {
          gross: new Decimal(sums._sum.gross ?? 0).toFixed(2),
          deductions: new Decimal(sums._sum.deductions ?? 0).toFixed(2),
          net: new Decimal(sums._sum.net ?? 0).toFixed(2),
        },
      };
    });
  }

  async get(auth: AuthContext, id: string): Promise<Payroll> {
    return this.transactions.run((tx) => this.present(tx, auth, id));
  }

  // ---------- making and settling ----------

  /**
   * Makes a draft record for everyone in the branch who was employed in a month that has ended and has none yet. The salary
   * is shared by the days employed in the month (joining or leaving part-way pays for those days only), and the deductions
   * start as the share for approved unpaid leave, which a manager can change until the record is final.
   */
  async generate(auth: AuthContext, body: unknown): Promise<GeneratePayrollResponse> {
    const input = GeneratePayrollRequestSchema.parse(body);
    const branchId = this.resolveBranch(input.branchId);
    const { first, last, days } = monthBounds(input.month);
    if (last >= todayInIndia())
      throw new BusinessRuleError('That month has not ended', [
        { field: 'month', message: `Payroll can be made once ${input.month} is over` },
      ]);
    return this.transactions.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`payroll:${branchId}:${input.month}`}, 0))`;
      const people = await tx.staff.findMany({
        where: {
          branchId,
          joinDate: { lte: parseIsoDate(last) },
          OR: [{ leftOn: null }, { leftOn: { gte: parseIsoDate(first) } }],
        },
        orderBy: { employeeCode: 'asc' },
      });
      const had = new Set(
        (
          await tx.payrollRecord.findMany({
            where: { month: input.month, staffId: { in: people.map((p) => p.id) } },
            select: { staffId: true },
          })
        ).map((r) => r.staffId),
      );
      const fresh = people.filter((p) => !had.has(p.id));
      const leave = await tx.leaveRequest.findMany({
        where: {
          staffId: { in: fresh.map((p) => p.id) },
          status: 'APPROVED',
          fromDate: { lte: parseIsoDate(last) },
          toDate: { gte: parseIsoDate(first) },
        },
      });
      let created = 0;
      for (const person of fresh) {
        const joined = isoDate(person.joinDate);
        const left = person.leftOn ? isoDate(person.leftOn) : null;
        const employed = employedDays(input.month, joined, left);
        const windowFrom = joined > first ? joined : first;
        const windowTo = left && left < last ? left : last;
        let paid = 0;
        let unpaid = 0;
        for (const item of leave.filter((l) => l.staffId === person.id)) {
          const shared = overlapDays(
            windowFrom,
            windowTo,
            isoDate(item.fromDate),
            isoDate(item.toDate),
          );
          if (item.kind === 'UNPAID') unpaid += shared;
          else paid += shared;
        }
        const present = await tx.attendance.count({
          where: {
            staffId: person.id,
            checkIn: { not: null },
            workDate: { gte: parseIsoDate(first), lte: parseIsoDate(last) },
          },
        });
        const salary = person.monthlySalary.toFixed(2);
        const gross = new Decimal(proRata(salary, employed, days));
        const suggested = Decimal.min(new Decimal(proRata(salary, unpaid, days)), gross);
        await tx.payrollRecord.create({
          data: {
            branchId,
            staffId: person.id,
            month: input.month,
            status: 'DRAFT',
            monthlySalary: person.monthlySalary,
            daysInMonth: days,
            daysEmployed: employed,
            daysPresent: present,
            paidLeaveDays: paid,
            unpaidLeaveDays: unpaid,
            gross,
            deductions: suggested,
            deductionNote: suggested.gt(0)
              ? `Unpaid leave: ${unpaid} ${unpaid === 1 ? 'day' : 'days'}`
              : null,
            net: gross.minus(suggested),
            createdBy: auth.userId,
            updatedBy: auth.userId,
          },
        });
        created += 1;
      }
      await this.audit.record(tx, {
        action: 'PAYROLL_GENERATED',
        entityType: 'Branch',
        entityId: branchId,
        branchId,
        newValue: { month: input.month, created, alreadyHad: had.size },
      });
      return { month: input.month, created, alreadyHad: had.size };
    });
  }

  /** Changes the deductions of a draft. The net follows. */
  async update(auth: AuthContext, id: string, body: unknown): Promise<Payroll> {
    const input = UpdatePayrollRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const current = await this.lock(tx, id, input.rowVersion);
      if (current.status !== 'DRAFT')
        throw new InvalidStateError('The payroll record', current.status, 'changed');
      const deductions = new Decimal(input.deductions);
      if (deductions.gt(current.gross))
        throw new ValidationFailedError('The deductions are more than the pay', [
          { field: 'deductions', message: `They cannot be more than ${current.gross.toFixed(2)}` },
        ]);
      await tx.payrollRecord.update({
        where: { id },
        data: {
          deductions,
          deductionNote: input.deductionNote ?? null,
          net: current.gross.minus(deductions),
          updatedBy: auth.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'PAYROLL_UPDATED',
        entityType: 'PayrollRecord',
        entityId: id,
        branchId: current.branchId,
        oldValue: { deductions: current.deductions.toFixed(2), net: current.net.toFixed(2) },
        newValue: {
          deductions: deductions.toFixed(2),
          net: current.gross.minus(deductions).toFixed(2),
          note: input.deductionNote ?? null,
        },
      });
      return this.present(tx, auth, id);
    });
  }

  /**
   * Makes a draft final: from then on neither it, nor the attendance and leave of that person in that month, can change. Leave
   * still waiting for a decision in the month must be decided first, and nobody finalizes their own pay except a Super Admin.
   */
  async finalize(auth: AuthContext, id: string, body: unknown): Promise<Payroll> {
    const input = FinalizePayrollRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const current = await this.lock(tx, id, input.rowVersion);
      if (current.status !== 'DRAFT')
        throw new InvalidStateError('The payroll record', current.status, 'FINALIZED');
      const person = await tx.staff.findUniqueOrThrow({
        where: { id: current.staffId },
        select: { userId: true },
      });
      if (person.userId === auth.userId && !auth.isSuperAdmin)
        throw new ForbiddenError('You cannot finalize your own pay. Ask another manager');
      const { first, last } = monthBounds(current.month);
      const pending = await tx.leaveRequest.findFirst({
        where: {
          staffId: current.staffId,
          status: 'PENDING',
          fromDate: { lte: parseIsoDate(last) },
          toDate: { gte: parseIsoDate(first) },
        },
        select: { fromDate: true, toDate: true },
      });
      if (pending)
        throw new BusinessRuleError('Leave in this month is still waiting for a decision', [
          {
            field: 'status',
            message: `Decide the leave from ${isoDate(pending.fromDate)} to ${isoDate(pending.toDate)} first`,
          },
        ]);
      await tx.payrollRecord.update({
        where: { id },
        data: {
          status: 'FINALIZED',
          finalizedBy: auth.userId,
          finalizedAt: new Date(),
          updatedBy: auth.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'PAYROLL_FINALIZED',
        entityType: 'PayrollRecord',
        entityId: id,
        branchId: current.branchId,
        oldValue: { status: 'DRAFT' },
        newValue: { status: 'FINALIZED', month: current.month, net: current.net.toFixed(2) },
      });
      await this.outbox.enqueue(tx, {
        eventType: 'payroll.finalized',
        branchId: current.branchId,
        payload: {
          payrollId: id,
          staffId: current.staffId,
          month: current.month,
          finalizedBy: auth.userId,
        },
      });
      return this.present(tx, auth, id);
    });
  }

  // ---------- helpers ----------

  private async lock(tx: TxClient, id: string, rowVersion: number) {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM payroll_records WHERE id = ${id}::uuid FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundError('Payroll record', id);
    const row = await tx.payrollRecord.findUniqueOrThrow({ where: { id } });
    if (row.rowVersion !== rowVersion) throw new ConflictError(STALE);
    return row;
  }

  private async present(tx: TxClient, auth: AuthContext, id: string): Promise<Payroll> {
    const row = await tx.payrollRecord.findUnique({ where: { id }, include: INCLUDE });
    if (!row || (!isManager(auth) && row.staff.userId !== auth.userId))
      throw new NotFoundError('Payroll record', id);
    return toDto(row, await userNames(tx, [row.finalizedBy]));
  }

  private resolveBranch(requested: string | undefined): string {
    const context = this.contexts.require();
    if (requested) {
      if (!context.isSuperAdmin && !context.branchIds.includes(requested))
        throw new BranchAccessError();
      return requested;
    }
    const only = context.branchIds[0];
    if (!context.isSuperAdmin && context.branchIds.length === 1 && only) return only;
    throw new ValidationFailedError('Choose the branch', [
      { field: 'branchId', message: 'Choose a branch' },
    ]);
  }
}
