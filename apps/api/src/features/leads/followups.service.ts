import { Inject, Injectable } from '@nestjs/common';
import {
  CompleteFollowupRequestSchema,
  RescheduleFollowupRequestSchema,
  CreateFollowupRequestSchema,
  FOLLOWUP_SORT_FIELDS,
  FollowupListQuerySchema,
  isOpenStage,
  todayInIndia,
} from '@erp/contracts';
import type { Followup, FollowupCounts, FollowupListResponse } from '@erp/contracts';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service.js';
import {
  BusinessRuleError,
  ConflictError,
  InvalidStateError,
  NotFoundError,
  ValidationFailedError,
} from '../../common/errors/domain-errors.js';
import { OutboxService } from '../../common/outbox/outbox.service.js';
import { buildPage, toOrderBy, toSkipTake } from '../../common/pagination/pagination.js';
import type { TxClient } from '../../common/prisma/scoped-prisma.service.js';
import { TransactionService } from '../../common/prisma/transaction.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { FOLLOWUP_INCLUDE, toFollowupDto } from './leads.mapper.js';

const GRACE_MS = 5 * 60_000;
const IST_OFFSET = '+05:30';
const DAY_MS = 86_400_000;

/** The start of tomorrow in India: follow-ups before it and not yet late are due today. */
function tomorrowStart(now: Date): Date {
  const today = new Date(`${todayInIndia(now)}T00:00:00.000${IST_OFFSET}`);
  return new Date(today.getTime() + DAY_MS);
}

@Injectable()
export class FollowupsService {
  constructor(
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  async list(auth: AuthContext, rawQuery: unknown): Promise<FollowupListResponse> {
    const query = FollowupListQuerySchema.parse(rawQuery);
    const now = new Date();
    const filters: Prisma.LeadFollowupWhereInput[] = [this.scope(query.scope, now)];
    if (query.mine) filters.push({ lead: { assignedTo: auth.userId } });
    if (query.leadId) filters.push({ leadId: query.leadId });
    if (query.branchId) filters.push({ branchId: query.branchId });
    const where: Prisma.LeadFollowupWhereInput = { AND: filters };
    const orderBy = toOrderBy(FOLLOWUP_SORT_FIELDS, query, {
      field: 'dueAt',
      order: query.scope === 'done' ? 'desc' : 'asc',
    });
    return this.transactions.run(async (tx) => {
      const [rows, total] = await Promise.all([
        tx.leadFollowup.findMany({
          where,
          orderBy,
          include: FOLLOWUP_INCLUDE,
          ...toSkipTake(query),
        }),
        tx.leadFollowup.count({ where }),
      ]);
      const names = await this.userNames(
        tx,
        rows.flatMap((r) => [r.createdBy, r.completedBy]),
      );
      return buildPage(
        rows.map((row) => toFollowupDto(row, names, now)),
        total,
        query,
      );
    });
  }

  /** How many follow-ups are late, due today and still to come. The three never overlap. */
  async counts(auth: AuthContext, rawQuery: unknown): Promise<FollowupCounts> {
    const query = FollowupListQuerySchema.pick({ mine: true, branchId: true }).parse(rawQuery);
    const now = new Date();
    const base: Prisma.LeadFollowupWhereInput[] = [];
    if (query.mine) base.push({ lead: { assignedTo: auth.userId } });
    if (query.branchId) base.push({ branchId: query.branchId });
    return this.transactions.run(async (tx) => {
      const count = (scope: 'overdue' | 'today' | 'upcoming') =>
        tx.leadFollowup.count({ where: { AND: [...base, this.scope(scope, now)] } });
      const [overdue, today, upcoming] = await Promise.all([
        count('overdue'),
        count('today'),
        count('upcoming'),
      ]);
      return { overdue, today, upcoming };
    });
  }

  async create(auth: AuthContext, leadId: string, body: unknown): Promise<Followup> {
    const input = CreateFollowupRequestSchema.parse(body);
    const dueAt = new Date(input.dueAt);
    if (dueAt.getTime() < Date.now() - GRACE_MS)
      throw new ValidationFailedError('The follow-up time has already passed', [
        { field: 'dueAt', message: 'Choose a time from now on' },
      ]);
    return this.transactions.run(async (tx) => {
      const rows = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM leads WHERE id = ${leadId}::uuid FOR UPDATE`;
      if (rows.length === 0) throw new NotFoundError('Lead', leadId);
      const lead = await tx.lead.findUniqueOrThrow({ where: { id: leadId } });
      if (!isOpenStage(lead.stage))
        throw new BusinessRuleError('This lead is closed, so it needs no follow-up', [
          {
            field: 'leadId',
            message:
              lead.stage === 'WON' ? 'The lead has become a customer' : 'Reopen the lead first',
          },
        ]);
      const row = await tx.leadFollowup.create({
        data: {
          branchId: lead.branchId,
          leadId,
          dueAt,
          note: input.note ?? null,
          createdBy: auth.userId,
          updatedBy: auth.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'FOLLOWUP_SCHEDULED',
        entityType: 'LeadFollowup',
        entityId: row.id,
        branchId: lead.branchId,
        newValue: { leadId, dueAt: dueAt.toISOString(), note: input.note ?? null },
      });
      await this.outbox.enqueue(tx, {
        eventType: 'lead.followup_scheduled',
        branchId: lead.branchId,
        payload: {
          followupId: row.id,
          leadId,
          dueAt: dueAt.toISOString(),
          assignedTo: lead.assignedTo,
        },
      });
      return this.present(tx, row.id);
    });
  }

  async complete(auth: AuthContext, id: string, body: unknown): Promise<Followup> {
    const input = CompleteFollowupRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const rows = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM lead_followups WHERE id = ${id}::uuid FOR UPDATE`;
      if (rows.length === 0) throw new NotFoundError('Follow-up', id);
      const current = await tx.leadFollowup.findUniqueOrThrow({ where: { id } });
      if (current.completedAt)
        throw new InvalidStateError('The follow-up', 'COMPLETED', 'COMPLETED');
      await tx.leadFollowup.update({
        where: { id },
        data: {
          completedAt: new Date(),
          completedBy: auth.userId,
          completionNote: input.note ?? null,
          updatedBy: auth.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'FOLLOWUP_COMPLETED',
        entityType: 'LeadFollowup',
        entityId: id,
        branchId: current.branchId,
        newValue: { leadId: current.leadId, note: input.note ?? null },
      });
      return this.present(tx, id);
    });
  }

  /**
   * Moves a follow-up that is still waiting to another time. The lead must still be open; the new time must not be in the
   * past; the version read must still be current; and the old and new times are audited with the reason.
   */
  async reschedule(auth: AuthContext, id: string, body: unknown): Promise<Followup> {
    const input = RescheduleFollowupRequestSchema.parse(body);
    const dueAt = new Date(input.dueAt);
    if (dueAt.getTime() < Date.now() - GRACE_MS)
      throw new ValidationFailedError('The follow-up time has already passed', [
        { field: 'dueAt', message: 'Choose a time from now on' },
      ]);
    return this.transactions.run(async (tx) => {
      const rows = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM lead_followups WHERE id = ${id}::uuid FOR UPDATE`;
      if (rows.length === 0) throw new NotFoundError('Follow-up', id);
      const current = await tx.leadFollowup.findUniqueOrThrow({
        where: { id },
        include: { lead: { select: { stage: true } } },
      });
      if (current.rowVersion !== input.rowVersion)
        throw new ConflictError(
          'This follow-up was changed by someone else. Reload it and try again',
        );
      if (current.completedAt) throw new InvalidStateError('The follow-up', 'COMPLETED', 'MOVED');
      if (!isOpenStage(current.lead.stage))
        throw new BusinessRuleError('This lead is closed, so its follow-up cannot be moved', [
          {
            field: 'leadId',
            message:
              current.lead.stage === 'WON'
                ? 'The lead has become a customer'
                : 'Reopen the lead first',
          },
        ]);
      if (dueAt.getTime() === current.dueAt.getTime())
        throw new ValidationFailedError('That is the time it is already set for', [
          { field: 'dueAt', message: 'Choose a different time' },
        ]);
      await tx.leadFollowup.update({
        where: { id },
        data: { dueAt, rescheduledCount: { increment: 1 }, updatedBy: auth.userId },
      });
      await this.audit.record(tx, {
        action: 'FOLLOWUP_RESCHEDULED',
        entityType: 'LeadFollowup',
        entityId: id,
        branchId: current.branchId,
        oldValue: { dueAt: current.dueAt.toISOString() },
        newValue: {
          leadId: current.leadId,
          dueAt: dueAt.toISOString(),
          reason: input.reason,
          moves: current.rescheduledCount + 1,
        },
      });
      return this.present(tx, id);
    });
  }

  private scope(scope: string, now: Date): Prisma.LeadFollowupWhereInput {
    const tomorrow = tomorrowStart(now);
    switch (scope) {
      case 'open':
        return { completedAt: null };
      case 'overdue':
        return { completedAt: null, dueAt: { lt: now } };
      case 'today':
        return { completedAt: null, dueAt: { gte: now, lt: tomorrow } };
      case 'upcoming':
        return { completedAt: null, dueAt: { gte: tomorrow } };
      case 'done':
        return { completedAt: { not: null } };
      default:
        return {};
    }
  }

  private async present(tx: TxClient, id: string): Promise<Followup> {
    const row = await tx.leadFollowup.findUnique({ where: { id }, include: FOLLOWUP_INCLUDE });
    if (!row) throw new NotFoundError('Follow-up', id);
    return toFollowupDto(
      row,
      await this.userNames(tx, [row.createdBy, row.completedBy]),
      new Date(),
    );
  }

  private async userNames(
    tx: TxClient,
    ids: readonly (string | null)[],
  ): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => id !== null))];
    if (wanted.length === 0) return new Map();
    const users = await tx.user.findMany({
      where: { id: { in: wanted } },
      select: { id: true, fullName: true },
    });
    return new Map(users.map((user) => [user.id, user.fullName]));
  }
}
