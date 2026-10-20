import { Inject, Injectable } from '@nestjs/common';
import {
  AddLeadNoteRequestSchema,
  AssignLeadRequestSchema,
  ChangeStageRequestSchema,
  ConvertLeadRequestSchema,
  CreateLeadRequestSchema,
  LEAD_SORT_FIELDS,
  LeadListQuerySchema,
  UpdateLeadRequestSchema,
  allowedNextStages,
  isOpenStage,
} from '@erp/contracts';
import type {
  ConvertLeadResponse,
  Lead,
  LeadAssignee,
  LeadListResponse,
  LeadNote,
  LeadStageName,
} from '@erp/contracts';
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
import {
  buildPage,
  escapeLike,
  toOrderBy,
  toSkipTake,
} from '../../common/pagination/pagination.js';
import type { TxClient } from '../../common/prisma/scoped-prisma.service.js';
import { TransactionService } from '../../common/prisma/transaction.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import {
  DETAIL_INCLUDE,
  SUMMARY_INCLUDE,
  leadSnapshot,
  toLeadDto,
  toNoteDto,
  toSummaryDto,
  userIdsOf,
} from './leads.mapper.js';
import type { LeadDetailRow } from './leads.mapper.js';

const STALE = 'This lead was changed by someone else. Reload it and try again';
const STAGE_TEXT: Record<LeadStageName, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  QUALIFIED: 'Qualified',
  QUOTED: 'Quoted',
  NEGOTIATION: 'In negotiation',
  WON: 'Won',
  LOST: 'Lost',
};

@Injectable()
export class LeadsService {
  constructor(
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(BranchContextService) private readonly contexts: BranchContextService,
  ) {}

  // ---------- reading ----------

  async list(auth: AuthContext, rawQuery: unknown): Promise<LeadListResponse> {
    const query = LeadListQuerySchema.parse(rawQuery);
    const now = new Date();
    const filters: Prisma.LeadWhereInput[] = [];
    if (query.stage === 'open')
      filters.push({ stage: { in: ['NEW', 'CONTACTED', 'QUALIFIED', 'QUOTED', 'NEGOTIATION'] } });
    else if (query.stage !== 'all') filters.push({ stage: query.stage });
    if (query.source) filters.push({ source: query.source });
    if (query.branchId) filters.push({ branchId: query.branchId });
    if (query.assignedTo === 'me') filters.push({ assignedTo: auth.userId });
    else if (query.assignedTo === 'unassigned') filters.push({ assignedTo: null });
    else if (query.assignedTo) filters.push({ assignedTo: query.assignedTo });
    if (query.overdue)
      filters.push({ leadFollowups: { some: { completedAt: null, dueAt: { lt: now } } } });
    const search = query.search?.trim();
    if (search) {
      const like = { contains: escapeLike(search), mode: 'insensitive' as const };
      filters.push({ OR: [{ name: like }, { phone: like }, { interest: like }] });
    }
    const where: Prisma.LeadWhereInput = { AND: filters };
    const orderBy = toOrderBy(LEAD_SORT_FIELDS, query, { field: 'createdAt', order: 'desc' });
    return this.transactions.run(async (tx) => {
      const [rows, total] = await Promise.all([
        tx.lead.findMany({ where, orderBy, include: SUMMARY_INCLUDE, ...toSkipTake(query) }),
        tx.lead.count({ where }),
      ]);
      return buildPage(
        rows.map((row) => toSummaryDto(row, now)),
        total,
        query,
      );
    });
  }

  async get(id: string): Promise<Lead> {
    return this.transactions.run((tx) => this.present(tx, id));
  }

  /** The people a lead in this branch can be given to: active users who work in the branch, and Super Admins. */
  async assignees(rawBranchId: unknown): Promise<LeadAssignee[]> {
    const branchId =
      typeof rawBranchId === 'string' && rawBranchId ? rawBranchId : this.resolveBranch(undefined);
    return this.transactions.run(async (tx) => {
      const users = await tx.user.findMany({
        where: {
          status: 'ACTIVE',
          OR: [
            { userBranches: { some: { branchId } } },
            { userRoles: { some: { role: { tier: 'SUPER_ADMIN' } } } },
          ],
        },
        orderBy: [{ fullName: 'asc' }, { id: 'asc' }],
        select: { id: true, fullName: true },
        take: 200,
      });
      return users;
    });
  }

  // ---------- working a lead ----------

  async create(auth: AuthContext, body: unknown): Promise<Lead> {
    const input = CreateLeadRequestSchema.parse(body);
    const branchId = this.resolveBranch(input.branchId);
    return this.transactions.run(async (tx) => {
      await this.assertSource(tx, input.source);
      if (input.assignedTo) await this.assertAssignable(tx, input.assignedTo, branchId);
      await this.assertNoOpenLead(tx, branchId, input.phone, null);
      const row = await tx.lead.create({
        data: {
          branchId,
          name: input.name,
          phone: input.phone,
          source: input.source,
          interest: input.interest,
          assignedTo: input.assignedTo,
          createdBy: auth.userId,
          updatedBy: auth.userId,
        },
      });
      if (input.note)
        await tx.leadNote.create({
          data: {
            branchId,
            leadId: row.id,
            body: input.note,
            createdBy: auth.userId,
            updatedBy: auth.userId,
          },
        });
      await this.audit.record(tx, {
        action: 'LEAD_CREATED',
        entityType: 'Lead',
        entityId: row.id,
        branchId,
        newValue: leadSnapshot(row),
      });
      await this.outbox.enqueue(tx, {
        eventType: 'lead.created',
        branchId,
        payload: {
          leadId: row.id,
          source: row.source,
          assignedTo: row.assignedTo,
          createdBy: auth.userId,
        },
      });
      return this.present(tx, row.id);
    });
  }

  async update(auth: AuthContext, id: string, body: unknown): Promise<Lead> {
    const input = UpdateLeadRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const current = await this.lock(tx, id, input.rowVersion);
      this.assertOpen(current.stage, 'edited');
      if (input.source && input.source !== current.source)
        await this.assertSource(tx, input.source);
      if (input.phone && input.phone !== current.phone)
        await this.assertNoOpenLead(tx, current.branchId, input.phone, id);
      const next = await tx.lead.update({
        where: { id },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.phone !== undefined ? { phone: input.phone } : {}),
          ...(input.source !== undefined ? { source: input.source } : {}),
          ...(input.interest !== undefined ? { interest: input.interest } : {}),
          updatedBy: auth.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'LEAD_UPDATED',
        entityType: 'Lead',
        entityId: id,
        branchId: current.branchId,
        oldValue: leadSnapshot(current),
        newValue: leadSnapshot(next),
      });
      return this.present(tx, id);
    });
  }

  async changeStage(auth: AuthContext, id: string, body: unknown): Promise<Lead> {
    const input = ChangeStageRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const current = await this.lock(tx, id, input.rowVersion);
      if (current.stage === 'WON')
        throw new InvalidStateError('A converted lead', current.stage, input.stage);
      if (!allowedNextStages(current.stage).includes(input.stage))
        throw new InvalidStateError('The lead', current.stage, input.stage);
      if (current.stage === 'LOST' && (input.note?.length ?? 0) < 3)
        throw new ValidationFailedError('Say why the lead is being reopened', [
          { field: 'note', message: 'Say why the lead is being reopened' },
        ]);
      await tx.lead.update({ where: { id }, data: { stage: input.stage, updatedBy: auth.userId } });
      await this.addNote(tx, auth, current.branchId, id, {
        body: input.note ?? `Moved from ${STAGE_TEXT[current.stage]} to ${STAGE_TEXT[input.stage]}`,
        stages: [current.stage, input.stage],
      });
      if (input.stage === 'LOST') await this.closeFollowups(tx, auth, id, 'The lead was lost');
      await this.audit.record(tx, {
        action: 'LEAD_STAGE_CHANGED',
        entityType: 'Lead',
        entityId: id,
        branchId: current.branchId,
        oldValue: { stage: current.stage },
        newValue: { stage: input.stage, note: input.note ?? null },
      });
      await this.outbox.enqueue(tx, {
        eventType: 'lead.stage_changed',
        branchId: current.branchId,
        payload: { leadId: id, from: current.stage, to: input.stage, changedBy: auth.userId },
      });
      return this.present(tx, id);
    });
  }

  async assign(auth: AuthContext, id: string, body: unknown): Promise<Lead> {
    const input = AssignLeadRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const current = await this.lock(tx, id, input.rowVersion);
      this.assertOpen(current.stage, 'assigned');
      let text = 'Unassigned';
      if (input.assignedTo) {
        const person = await this.assertAssignable(tx, input.assignedTo, current.branchId);
        text = `Assigned to ${person.fullName}`;
      }
      if ((input.assignedTo ?? null) === current.assignedTo)
        throw new BusinessRuleError('The lead is already assigned that way', [
          { field: 'assignedTo', message: 'Choose someone else, or leave it as it is' },
        ]);
      await tx.lead.update({
        where: { id },
        data: { assignedTo: input.assignedTo, updatedBy: auth.userId },
      });
      await this.addNote(tx, auth, current.branchId, id, { body: text });
      await this.audit.record(tx, {
        action: 'LEAD_ASSIGNED',
        entityType: 'Lead',
        entityId: id,
        branchId: current.branchId,
        oldValue: { assignedTo: current.assignedTo },
        newValue: { assignedTo: input.assignedTo },
      });
      await this.outbox.enqueue(tx, {
        eventType: 'lead.assigned',
        branchId: current.branchId,
        payload: { leadId: id, assignedTo: input.assignedTo, assignedBy: auth.userId },
      });
      return this.present(tx, id);
    });
  }

  async note(auth: AuthContext, id: string, body: unknown): Promise<LeadNote> {
    const input = AddLeadNoteRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const lead = await tx.lead.findUnique({
        where: { id },
        select: { id: true, branchId: true },
      });
      if (!lead) throw new NotFoundError('Lead', id);
      const created = await this.addNote(tx, auth, lead.branchId, id, { body: input.body });
      await this.audit.record(tx, {
        action: 'LEAD_NOTE_ADDED',
        entityType: 'Lead',
        entityId: id,
        branchId: lead.branchId,
        newValue: { noteId: created.id },
      });
      return toNoteDto(created, new Map([[auth.userId, auth.fullName]]));
    });
  }

  /**
   * Turns a lead into a customer and marks it won. A customer who already has the lead's phone number is linked, never
   * created a second time; the phone lock makes two leads with the same number converted together agree on one customer.
   */
  async convert(auth: AuthContext, id: string, body: unknown): Promise<ConvertLeadResponse> {
    const input = ConvertLeadRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const lead = await this.lock(tx, id, input.rowVersion);
      if (lead.stage === 'WON')
        throw new InvalidStateError('A converted lead', lead.stage, 'converted');
      if (lead.stage === 'LOST')
        throw new BusinessRuleError('A lost lead cannot be converted', [
          { field: 'stage', message: 'Reopen the lead first' },
        ]);

      let customer: { id: string; name: string };
      let created = false;
      if (input.customerId) {
        const found = await tx.customer.findUnique({
          where: { id: input.customerId },
          select: { id: true, name: true },
        });
        if (!found)
          throw new ValidationFailedError('That customer was not found', [
            { field: 'customerId', message: 'Choose a customer from the list' },
          ]);
        customer = found;
      } else {
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`customer-phone:${lead.phone}`}, 0))`;
        const byPhone = await tx.customer.findFirst({
          where: { phone: lead.phone },
          select: { id: true, name: true },
        });
        if (byPhone) customer = byPhone;
        else {
          if (!auth.permissions.includes('customers.manage'))
            throw new ForbiddenError('You may not create customers');
          customer = await this.createCustomer(tx, auth, lead, input);
          created = true;
        }
      }

      await tx.lead.update({
        where: { id },
        data: { stage: 'WON', customerId: customer.id, updatedBy: auth.userId },
      });
      await this.addNote(tx, auth, lead.branchId, id, {
        body: created
          ? `Converted: customer ${customer.name} created`
          : `Converted: linked to existing customer ${customer.name}`,
        stages: [lead.stage, 'WON'],
      });
      await this.closeFollowups(tx, auth, id, 'The lead was converted');
      await this.audit.record(tx, {
        action: 'LEAD_CONVERTED',
        entityType: 'Lead',
        entityId: id,
        branchId: lead.branchId,
        oldValue: { stage: lead.stage },
        newValue: { stage: 'WON', customerId: customer.id, customerCreated: created },
      });
      await this.outbox.enqueue(tx, {
        eventType: 'lead.converted',
        branchId: lead.branchId,
        payload: {
          leadId: id,
          customerId: customer.id,
          customerCreated: created,
          convertedBy: auth.userId,
        },
      });
      return {
        lead: await this.present(tx, id),
        customerId: customer.id,
        customerName: customer.name,
        customerCreated: created,
      };
    });
  }

  // ---------- helpers ----------

  private async createCustomer(
    tx: TxClient,
    auth: AuthContext,
    lead: { name: string; phone: string },
    input: ReturnType<typeof ConvertLeadRequestSchema.parse>,
  ): Promise<{ id: string; name: string }> {
    if (input.stateCode) {
      const state = await tx.state.findUnique({ where: { code: input.stateCode } });
      if (!state)
        throw new ValidationFailedError('Unknown state', [
          { field: 'stateCode', message: 'Choose a state from the list' },
        ]);
    }
    if (input.gstin) {
      const owner = await tx.customer.findFirst({
        where: { gstin: input.gstin },
        select: { name: true },
      });
      if (owner)
        throw new ConflictError('A customer with this GSTIN already exists', [
          { field: 'gstin', message: `Already used by ${owner.name}` },
        ]);
    }
    const row = await tx.customer.create({
      data: {
        name: lead.name,
        phone: lead.phone,
        email: input.email ?? null,
        address: input.address ?? null,
        stateCode: input.stateCode ?? null,
        gstin: input.gstin ?? null,
        createdBy: auth.userId,
        updatedBy: auth.userId,
      },
      select: { id: true, name: true, phone: true },
    });
    await this.audit.record(tx, {
      action: 'CUSTOMER_CREATED',
      entityType: 'Customer',
      entityId: row.id,
      newValue: { name: row.name, phone: row.phone, source: 'lead conversion' },
    });
    return { id: row.id, name: row.name };
  }

  /** Follow-ups still waiting on a lead that has been won or lost are closed, so nobody is reminded about it. */
  private async closeFollowups(
    tx: TxClient,
    auth: AuthContext,
    leadId: string,
    why: string,
  ): Promise<void> {
    await tx.leadFollowup.updateMany({
      where: { leadId, completedAt: null },
      data: {
        completedAt: new Date(),
        completedBy: auth.userId,
        completionNote: why,
        updatedBy: auth.userId,
      },
    });
  }

  private async addNote(
    tx: TxClient,
    auth: AuthContext,
    branchId: string,
    leadId: string,
    input: { body: string; stages?: [LeadStageName, LeadStageName] },
  ) {
    return tx.leadNote.create({
      data: {
        branchId,
        leadId,
        body: input.body,
        fromStage: input.stages?.[0] ?? null,
        toStage: input.stages?.[1] ?? null,
        createdBy: auth.userId,
        updatedBy: auth.userId,
      },
    });
  }

  private assertOpen(stage: LeadStageName, verb: string): void {
    if (!isOpenStage(stage))
      throw new BusinessRuleError(
        `A ${stage === 'WON' ? 'converted' : 'lost'} lead cannot be ${verb}`,
        [
          {
            field: 'stage',
            message: stage === 'WON' ? 'The lead has become a customer' : 'Reopen the lead first',
          },
        ],
      );
  }

  private async assertSource(tx: TxClient, code: string): Promise<void> {
    const source = await tx.leadSource.findFirst({ where: { code, isActive: true } });
    if (!source)
      throw new ValidationFailedError('Unknown lead source', [
        { field: 'source', message: 'Choose where the lead came from, from the list' },
      ]);
  }

  private async assertAssignable(
    tx: TxClient,
    userId: string,
    branchId: string,
  ): Promise<{ id: string; fullName: string }> {
    const user = await tx.user.findFirst({
      where: {
        id: userId,
        status: 'ACTIVE',
        OR: [
          { userBranches: { some: { branchId } } },
          { userRoles: { some: { role: { tier: 'SUPER_ADMIN' } } } },
        ],
      },
      select: { id: true, fullName: true },
    });
    if (!user)
      throw new ValidationFailedError('That person cannot take this lead', [
        { field: 'assignedTo', message: 'Choose an active person who works in this branch' },
      ]);
    return user;
  }

  /** Two open leads for one phone number in a branch are almost always the same enquiry twice. */
  private async assertNoOpenLead(
    tx: TxClient,
    branchId: string,
    phone: string,
    ownId: string | null,
  ): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`lead-phone:${branchId}:${phone}`}, 0))`;
    const same = await tx.lead.findFirst({
      where: {
        branchId,
        phone,
        stage: { in: ['NEW', 'CONTACTED', 'QUALIFIED', 'QUOTED', 'NEGOTIATION'] },
        ...(ownId ? { id: { not: ownId } } : {}),
      },
      select: { name: true },
    });
    if (same)
      throw new ConflictError('An open lead already has this phone number', [
        {
          field: 'phone',
          message: `${same.name} is already being followed up. Add a note to that lead instead.`,
        },
      ]);
  }

  private async lock(tx: TxClient, id: string, rowVersion: number) {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM leads WHERE id = ${id}::uuid FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundError('Lead', id);
    const row = await tx.lead.findUniqueOrThrow({ where: { id } });
    if (row.rowVersion !== rowVersion) throw new ConflictError(STALE);
    return row;
  }

  private async present(tx: TxClient, id: string): Promise<Lead> {
    const row: LeadDetailRow | null = await tx.lead.findUnique({
      where: { id },
      include: DETAIL_INCLUDE,
    });
    if (!row) throw new NotFoundError('Lead', id);
    const users = await tx.user.findMany({
      where: { id: { in: userIdsOf(row) } },
      select: { id: true, fullName: true },
    });
    return toLeadDto(row, new Map(users.map((u) => [u.id, u.fullName])), new Date());
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
    throw new ValidationFailedError('Choose the branch for this lead', [
      { field: 'branchId', message: 'Choose a branch' },
    ]);
  }
}
