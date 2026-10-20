import { Inject, Injectable } from '@nestjs/common';
import {
  AssignUnitRequestSchema,
  BuildUpdateRequestSchema,
  CancelQuotationRequestSchema,
  CreateQuotationRequestSchema,
  QUOTATION_SORT_FIELDS,
  QuotationListQuerySchema,
  QuotationVersionRequestSchema,
  RecordPaymentRequestSchema,
  TakeAdvanceRequestSchema,
  UpdateQuotationRequestSchema,
  allowedNextBuildStages,
  todayInIndia,
} from '@erp/contracts';
import type {
  ErrorDetail,
  Quotation,
  QuotationListResponse,
  QuotationStatusName,
} from '@erp/contracts';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service.js';
import { BranchContextService } from '../../common/branch-context/branch-context.service.js';
import { DocumentNumberService } from '../../common/document-number/document-number.service.js';
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
import { calculateInvoice, discountNeedsApproval, isInterState } from '../billing/invoice-calc.js';
import { CommissionsService } from '../brokers/commissions.service.js';
import { PaymentsService } from '../payments/payments.service.js';
import {
  DETAIL_INCLUDE,
  SUMMARY_INCLUDE,
  liveAdvanceTotal,
  toQuotationDto,
  toSummaryDto,
  userIdsOf,
} from './quotations.mapper.js';

type Body = ReturnType<typeof CreateQuotationRequestSchema.parse>;
type BodyLines = Body['lines'];
const parseIsoDate = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
const STALE = 'This quotation was changed by someone else. Reload it and try again';

@Injectable()
export class QuotationsService {
  constructor(
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(DocumentNumberService) private readonly documents: DocumentNumberService,
    @Inject(BranchContextService) private readonly contexts: BranchContextService,
    @Inject(CommissionsService) private readonly commissions: CommissionsService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
  ) {}

  // ---------- reading ----------

  async list(rawQuery: unknown): Promise<QuotationListResponse> {
    const query = QuotationListQuerySchema.parse(rawQuery);
    const filters: Prisma.QuotationWhereInput[] = [];
    if (query.status === 'open') filters.push({ status: { in: ['DRAFT', 'SENT', 'ACCEPTED'] } });
    else if (query.status !== 'all') filters.push({ status: query.status });
    if (query.customerId) filters.push({ customerId: query.customerId });
    if (query.branchId) filters.push({ branchId: query.branchId });
    if (query.customOnly) filters.push({ isCustomBuild: true });
    const search = query.search?.trim();
    if (search) {
      const like = { contains: escapeLike(search), mode: 'insensitive' as const };
      filters.push({ OR: [{ quotationNo: like }, { customer: { name: like } }] });
    }
    const where: Prisma.QuotationWhereInput = { AND: filters };
    const orderBy = toOrderBy(QUOTATION_SORT_FIELDS, query, { field: 'createdAt', order: 'desc' });
    return this.transactions.run(async (tx) => {
      await this.expireOverdue(tx);
      const [rows, total] = await Promise.all([
        tx.quotation.findMany({ where, orderBy, include: SUMMARY_INCLUDE, ...toSkipTake(query) }),
        tx.quotation.count({ where }),
      ]);
      const paid = await this.advanceTotals(
        tx,
        rows.map((row) => row.id),
      );
      return buildPage(
        rows.map((row) => toSummaryDto(row, paid.get(row.id) ?? new Prisma.Decimal(0))),
        total,
        query,
      );
    });
  }

  async get(id: string): Promise<Quotation> {
    return this.transactions.run(async (tx) => {
      await this.expireOverdue(tx);
      return this.present(tx, id);
    });
  }

  // ---------- writing a quotation ----------

  async create(auth: AuthContext, body: unknown): Promise<Quotation> {
    const input = CreateQuotationRequestSchema.parse(body);
    const branchId = this.resolveBranch(input.branchId);
    return this.transactions.run(async (tx) => {
      this.assertValidUntil(input.validUntil);
      await this.commissions.assertUsable(tx, input.brokerId);
      const prepared = await this.prepare(tx, branchId, input);
      const quotationNo = await this.documents.next(tx, { branchId, docType: 'QUOTATION' });
      const created = await tx.quotation.create({
        data: {
          branchId,
          quotationNo,
          customerId: input.customerId,
          status: 'DRAFT',
          type: input.type,
          validUntil: parseIsoDate(input.validUntil),
          brokerId: input.brokerId,
          isCustomBuild: input.isCustomBuild,
          specification: input.specification,
          ...this.headerData(prepared),
          createdBy: auth.userId,
          updatedBy: auth.userId,
        },
      });
      await tx.quotationLine.createMany({
        data: this.lineRows(prepared, created.id, branchId, auth.userId),
      });
      await this.audit.record(tx, {
        action: 'QUOTATION_CREATED',
        entityType: 'Quotation',
        entityId: created.id,
        branchId,
        newValue: this.snapshot(created, prepared.lines.length),
      });
      return this.present(tx, created.id);
    });
  }

  async update(auth: AuthContext, id: string, body: unknown): Promise<Quotation> {
    const input = UpdateQuotationRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const current = await this.lock(tx, id, input.rowVersion);
      this.assertStatus(current.status, ['DRAFT'], 'edited');
      this.assertValidUntil(input.validUntil);
      await this.commissions.assertUsable(tx, input.brokerId);
      const prepared = await this.prepare(tx, current.branchId, input);
      const cleared = await tx.$queryRaw<
        { ok: boolean }[]
      >`SELECT clear_quotation_draft_lines(${id}::uuid) AS ok`;
      if (!cleared[0]?.ok) throw new NotFoundError('Quotation', id);
      await tx.quotationLine.createMany({
        data: this.lineRows(prepared, id, current.branchId, auth.userId),
      });
      const next = await tx.quotation.update({
        where: { id },
        data: {
          customerId: input.customerId,
          type: input.type,
          validUntil: parseIsoDate(input.validUntil),
          brokerId: input.brokerId,
          isCustomBuild: input.isCustomBuild,
          specification: input.specification,
          ...this.headerData(prepared),
          updatedBy: auth.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'QUOTATION_UPDATED',
        entityType: 'Quotation',
        entityId: id,
        branchId: current.branchId,
        oldValue: this.snapshot(current, null),
        newValue: this.snapshot(next, prepared.lines.length),
      });
      return this.present(tx, id);
    });
  }

  /** Sends the quotation to the customer. From now on its prices and lines cannot change. */
  async send(auth: AuthContext, id: string, body: unknown): Promise<Quotation> {
    const input = QuotationVersionRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      await this.expireOverdue(tx);
      const current = await this.lock(tx, id, input.rowVersion);
      this.assertStatus(current.status, ['DRAFT'], 'sent');
      if (todayInIndia() > current.validUntil.toISOString().slice(0, 10))
        throw new ValidationFailedError('The quotation is already out of date', [
          { field: 'validUntil', message: 'Choose a validity date from today' },
        ]);
      const lines = await tx.quotationLine.findMany({ where: { quotationId: id } });
      const flagged = lines.filter((line) =>
        discountNeedsApproval(line.unitPrice.mul(line.qty), line.discountAmount),
      );
      if (flagged.length > 0 && !auth.permissions.includes('discounts.approve'))
        throw new ForbiddenError(
          'A discount is above what staff may give. Ask a manager to send this quotation, or lower the discount',
        );
      await tx.quotation.update({
        where: { id },
        data: { status: 'SENT', sentAt: new Date(), updatedBy: auth.userId },
      });
      await this.audit.record(tx, {
        action: 'QUOTATION_SENT',
        entityType: 'Quotation',
        entityId: id,
        branchId: current.branchId,
        oldValue: { status: 'DRAFT' },
        newValue: {
          status: 'SENT',
          quotationNo: current.quotationNo,
          total: current.total.toFixed(2),
        },
      });
      await this.outbox.enqueue(tx, {
        eventType: 'quotation.sent',
        branchId: current.branchId,
        payload: {
          quotationId: id,
          quotationNo: current.quotationNo,
          customerId: current.customerId,
          sentBy: auth.userId,
        },
      });
      return this.present(tx, id);
    });
  }

  /** Records that the customer accepted the quotation at its quoted prices. */
  async accept(auth: AuthContext, id: string, body: unknown): Promise<Quotation> {
    const input = QuotationVersionRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      await this.expireOverdue(tx);
      const current = await this.lock(tx, id, input.rowVersion);
      this.assertStatus(current.status, ['SENT'], 'accepted');
      await tx.quotation.update({
        where: { id },
        data: { status: 'ACCEPTED', acceptedAt: new Date(), updatedBy: auth.userId },
      });
      await this.audit.record(tx, {
        action: 'QUOTATION_ACCEPTED',
        entityType: 'Quotation',
        entityId: id,
        branchId: current.branchId,
        oldValue: { status: 'SENT' },
        newValue: { status: 'ACCEPTED', quotationNo: current.quotationNo },
      });
      await this.outbox.enqueue(tx, {
        eventType: 'quotation.accepted',
        branchId: current.branchId,
        payload: {
          quotationId: id,
          quotationNo: current.quotationNo,
          customerId: current.customerId,
          acceptedBy: auth.userId,
        },
      });
      return this.present(tx, id);
    });
  }

  async cancel(auth: AuthContext, id: string, body: unknown): Promise<Quotation> {
    const input = CancelQuotationRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const current = await this.lock(tx, id, input.rowVersion);
      this.assertStatus(current.status, ['DRAFT', 'SENT', 'ACCEPTED'], 'cancelled');
      const advances = await tx.payment.count({ where: { quotationId: id, reversal: null } });
      if (advances > 0)
        throw new BusinessRuleError('An advance has been paid against this quotation', [
          {
            field: 'advances',
            message: 'Reverse the advance payments before cancelling the quotation',
          },
        ]);
      const standing = await this.standingInvoice(tx, id);
      if (standing)
        throw new BusinessRuleError('An invoice has been made from this quotation', [
          { field: 'invoice', message: 'Discard or cancel the invoice first' },
        ]);
      await tx.quotation.update({
        where: { id },
        data: {
          status: 'CANCELLED',
          cancelledAt: new Date(),
          cancelReason: input.reason,
          updatedBy: auth.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'QUOTATION_CANCELLED',
        entityType: 'Quotation',
        entityId: id,
        branchId: current.branchId,
        oldValue: { status: current.status },
        newValue: { status: 'CANCELLED', reason: input.reason },
      });
      return this.present(tx, id);
    });
  }

  // ---------- advances, build and vehicles ----------

  /**
   * Takes money for an accepted quotation before the invoice. It can be paid in parts, never more than the quotation is
   * worth in all. When the invoice is issued, the advances are applied to it.
   */
  async takeAdvance(auth: AuthContext, id: string, body: unknown): Promise<Quotation> {
    const input = TakeAdvanceRequestSchema.parse(body);
    if (input.paidOn > todayInIndia())
      throw new ValidationFailedError('The payment date is in the future', [
        { field: 'paidOn', message: 'The payment date cannot be after today' },
      ]);
    return this.transactions.run(async (tx) => {
      const peek = await tx.quotation.findUnique({
        where: { id },
        select: { customerId: true, branchId: true },
      });
      if (!peek) throw new NotFoundError('Quotation', id);
      // Customer first, then the quotation: every path takes them in this order, so none can wait on another.
      await tx.$queryRaw`SELECT id FROM customers WHERE id = ${peek.customerId}::uuid FOR UPDATE`;
      await this.expireOverdue(tx);
      const rows = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM quotations WHERE id = ${id}::uuid FOR UPDATE`;
      if (rows.length === 0) throw new NotFoundError('Quotation', id);
      const current = await tx.quotation.findUniqueOrThrow({
        where: { id },
        include: {
          advances: {
            where: { reversal: null },
            select: { id: true, amount: true, idempotencyKey: true },
          },
        },
      });
      const replay = current.advances.some((a) => a.idempotencyKey === input.idempotencyKey);
      if (replay) return this.present(tx, id);
      this.assertStatus(current.status, ['ACCEPTED'], 'paid in advance');
      const remaining = current.total.minus(
        liveAdvanceTotal(current.advances.map((a) => ({ ...a, reversal: null }))),
      );
      if (remaining.lte(0))
        throw new BusinessRuleError('This quotation is already fully paid', [
          { field: 'amount', message: 'The advances already cover the whole quotation' },
        ]);
      if (new Prisma.Decimal(input.amount).gt(remaining))
        throw new ValidationFailedError('That is more than is left to pay', [
          {
            field: 'amount',
            message: `Only ${remaining.toFixed(2)} is left to pay on this quotation`,
          },
        ]);
      const request = RecordPaymentRequestSchema.parse({
        customerId: current.customerId,
        branchId: current.branchId,
        mode: input.mode,
        amount: input.amount,
        paidOn: input.paidOn,
        reference: input.reference,
        note: input.note,
        idempotencyKey: input.idempotencyKey,
      });
      const payment = await this.payments.recordInTx(tx, auth, request, current.branchId, id);
      await this.audit.record(tx, {
        action: 'QUOTATION_ADVANCE_TAKEN',
        entityType: 'Quotation',
        entityId: id,
        branchId: current.branchId,
        newValue: { paymentId: payment.id, receiptNo: payment.receiptNo, amount: input.amount },
      });
      await this.outbox.enqueue(tx, {
        eventType: 'quotation.advance_taken',
        branchId: current.branchId,
        payload: {
          quotationId: id,
          paymentId: payment.id,
          amount: input.amount,
          takenBy: auth.userId,
        },
      });
      return this.present(tx, id);
    });
  }

  /** Moves the build of a custom order along. It is READY only when every vehicle on it has its chassis and motor numbers. */
  async updateBuild(auth: AuthContext, id: string, body: unknown): Promise<Quotation> {
    const input = BuildUpdateRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      await this.expireOverdue(tx);
      const current = await this.lock(tx, id, input.rowVersion);
      this.assertStatus(current.status, ['ACCEPTED'], 'built');
      if (!current.isCustomBuild)
        throw new BusinessRuleError('This is not a custom order', [
          { field: 'stage', message: 'Only a customized build has stages to track' },
        ]);
      const from = current.buildStage as Parameters<typeof allowedNextBuildStages>[0];
      if (!allowedNextBuildStages(from).includes(input.stage))
        throw new InvalidStateError('The build', current.buildStage, input.stage);
      if (input.stage === 'READY') {
        const lines = await tx.quotationLine.findMany({
          where: { quotationId: id, item: { isSerialized: true } },
          include: {
            item: { select: { itemCode: true } },
            serialUnit: { select: { chassisNo: true, motorNo: true } },
          },
          orderBy: { lineNo: 'asc' },
        });
        const problems: ErrorDetail[] = lines.flatMap((line) =>
          !line.serialUnit
            ? [
                {
                  field: 'stage',
                  message: `Choose the vehicle for ${line.item.itemCode} (line ${line.lineNo})`,
                },
              ]
            : !line.serialUnit.chassisNo || !line.serialUnit.motorNo
              ? [
                  {
                    field: 'stage',
                    message: `Record the chassis and motor numbers of ${line.item.itemCode} (line ${line.lineNo})`,
                  },
                ]
              : [],
        );
        if (problems.length > 0)
          throw new BusinessRuleError('The build is not ready to be marked ready', problems);
      }
      await tx.quotation.update({
        where: { id },
        data: { buildStage: input.stage, updatedBy: auth.userId },
      });
      await tx.quotationBuildUpdate.create({
        data: {
          branchId: current.branchId,
          quotationId: id,
          stage: input.stage,
          note: input.note ?? null,
          createdBy: auth.userId,
          updatedBy: auth.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'QUOTATION_BUILD_UPDATED',
        entityType: 'Quotation',
        entityId: id,
        branchId: current.branchId,
        oldValue: { stage: current.buildStage },
        newValue: { stage: input.stage, note: input.note ?? null },
      });
      await this.outbox.enqueue(tx, {
        eventType: 'quotation.build_updated',
        branchId: current.branchId,
        payload: {
          quotationId: id,
          from: current.buildStage,
          to: input.stage,
          updatedBy: auth.userId,
        },
      });
      return this.present(tx, id);
    });
  }

  /** Sets aside the vehicle for a line and records its chassis and motor numbers. A number already on the vehicle is never replaced. */
  async assignUnit(
    auth: AuthContext,
    id: string,
    lineId: string,
    body: unknown,
  ): Promise<Quotation> {
    const input = AssignUnitRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const current = await this.lock(tx, id, input.rowVersion);
      this.assertStatus(current.status, ['SENT', 'ACCEPTED'], 'given a vehicle');
      const line = await tx.quotationLine.findFirst({
        where: { id: lineId, quotationId: id },
        include: { item: { select: { itemCode: true, isSerialized: true } } },
      });
      if (!line) throw new NotFoundError('Quotation line', lineId);
      if (!line.item.isSerialized)
        throw new BusinessRuleError('This line has no vehicle to choose', [
          {
            field: 'serialUnitId',
            message: `${line.item.itemCode} is not tracked by serial number`,
          },
        ]);
      const unit = await tx.serialUnit.findUnique({ where: { id: input.serialUnitId } });
      if (!unit || unit.itemId !== line.itemId || unit.branchId !== current.branchId)
        throw new ValidationFailedError('That vehicle cannot be used', [
          {
            field: 'serialUnitId',
            message: 'Choose a unit of this item that is in stock in this branch',
          },
        ]);
      if (unit.state !== 'AVAILABLE')
        throw new BusinessRuleError('That vehicle is not available', [
          {
            field: 'serialUnitId',
            message: `Serial number ${unit.serialNo} is ${unit.state.toLowerCase()}`,
          },
        ]);
      const promised = await tx.quotationLine.findFirst({
        where: {
          serialUnitId: unit.id,
          id: { not: lineId },
          quotation: { status: { in: ['DRAFT', 'SENT', 'ACCEPTED'] } },
        },
        select: { quotation: { select: { quotationNo: true } } },
      });
      if (promised)
        throw new ConflictError('That vehicle is already promised', [
          {
            field: 'serialUnitId',
            message: `Serial number ${unit.serialNo} is set aside for ${promised.quotation.quotationNo}`,
          },
        ]);
      const data: Prisma.SerialUnitUpdateInput = {};
      const problems: ErrorDetail[] = [];
      const identify = async (
        field: 'chassisNo' | 'motorNo',
        label: string,
        given: string | undefined,
      ) => {
        if (given === undefined) return;
        const existing = unit[field];
        if (existing !== null && existing !== given)
          problems.push({
            field,
            message: `This vehicle's ${label} number is already recorded as ${existing}`,
          });
        else if (existing === null) {
          const other = await tx.serialUnit.findFirst({
            where: { [field]: given, id: { not: unit.id } },
            select: { serialNo: true },
          });
          if (other)
            problems.push({
              field,
              message: `That ${label} number is already on vehicle ${other.serialNo}`,
            });
          else data[field] = given;
        }
      };
      await identify('chassisNo', 'chassis', input.chassisNo);
      await identify('motorNo', 'motor', input.motorNo);
      if (problems.length > 0) throw new ConflictError('A number cannot be recorded', problems);
      if (Object.keys(data).length > 0)
        await tx.serialUnit.update({
          where: { id: unit.id },
          data: { ...data, updatedBy: auth.userId },
        });
      await tx.quotationLine.update({
        where: { id: lineId },
        data: { serialUnitId: unit.id, updatedBy: auth.userId },
      });
      await tx.quotation.update({ where: { id }, data: { updatedBy: auth.userId } });
      await this.audit.record(tx, {
        action: 'QUOTATION_VEHICLE_ASSIGNED',
        entityType: 'Quotation',
        entityId: id,
        branchId: current.branchId,
        newValue: {
          lineNo: line.lineNo,
          serialNo: unit.serialNo,
          chassisNo: input.chassisNo ?? unit.chassisNo,
          motorNo: input.motorNo ?? unit.motorNo,
        },
      });
      return this.present(tx, id);
    });
  }

  // ---------- used while billing ----------

  /**
   * Checks an accepted quotation can be delivered and returns it with its lines and the vehicles set aside, ready to be
   * made into a draft invoice at the quoted prices. Takes the customer, then the quotation, in the order every path uses.
   */
  async loadForConversion(tx: TxClient, quotationId: string, rowVersion: number) {
    const peek = await tx.quotation.findUnique({
      where: { id: quotationId },
      select: { customerId: true },
    });
    if (!peek) throw new NotFoundError('Quotation', quotationId);
    await tx.$queryRaw`SELECT id FROM customers WHERE id = ${peek.customerId}::uuid FOR UPDATE`;
    await this.expireOverdue(tx);
    const current = await this.lock(tx, quotationId, rowVersion);
    this.assertStatus(current.status, ['ACCEPTED'], 'turned into an invoice');
    if (await this.standingInvoice(tx, quotationId))
      throw new ConflictError('An invoice has already been made from this quotation', [
        { field: 'quotationId', message: 'Open that invoice, or discard it first' },
      ]);
    const lines = await tx.quotationLine.findMany({
      where: { quotationId },
      include: { item: { select: { itemCode: true, isSerialized: true } } },
      orderBy: { lineNo: 'asc' },
    });
    const problems: ErrorDetail[] = [];
    if (current.isCustomBuild && current.buildStage !== 'READY')
      problems.push({ field: 'stage', message: 'The build is not marked ready yet' });
    for (const line of lines)
      if (line.item.isSerialized && !line.serialUnitId)
        problems.push({
          field: 'serialUnitId',
          message: `Choose the vehicle for ${line.item.itemCode} (line ${line.lineNo})`,
        });
    if (problems.length > 0)
      throw new BusinessRuleError('This quotation is not ready to deliver', problems);
    await this.commissions.assertUsable(tx, current.brokerId);
    return { quotation: current, lines };
  }

  /** An invoice made from a quotation keeps its customer, type, broker, quantities and prices; only the vehicle may be swapped for another of the same item. */
  async assertInvoiceMatches(
    tx: TxClient,
    quotationId: string,
    next: {
      customerId: string;
      type: string;
      brokerId: string | null;
      lines: {
        itemId: string;
        qty: number;
        unitPrice: string;
        discountAmount?: string | undefined;
      }[];
    },
  ): Promise<void> {
    const quote = await tx.quotation.findUniqueOrThrow({ where: { id: quotationId } });
    const lines = await tx.quotationLine.findMany({
      where: { quotationId },
      orderBy: { lineNo: 'asc' },
    });
    const same =
      quote.customerId === next.customerId &&
      quote.type === next.type &&
      quote.brokerId === next.brokerId &&
      lines.length === next.lines.length &&
      lines.every((line, index) => {
        const given = next.lines[index];
        return (
          given !== undefined &&
          given.itemId === line.itemId &&
          given.qty === line.qty &&
          new Prisma.Decimal(given.unitPrice).eq(line.unitPrice) &&
          new Prisma.Decimal(given.discountAmount ?? '0').eq(line.discountAmount)
        );
      });
    if (!same)
      throw new BusinessRuleError('This invoice follows a quotation, so its prices are fixed', [
        {
          field: 'quotationId',
          message: `The customer, type, broker, items, quantities, prices and discounts must stay as quoted in ${quote.quotationNo}`,
        },
      ]);
  }

  /**
   * Called inside the transaction that issues an invoice made from a quotation. The order must be paid for, or delivered
   * on credit by someone who may; the advances are applied to the invoice and the quotation is marked converted.
   */
  async onInvoiceIssued(
    tx: TxClient,
    auth: AuthContext,
    invoice: { id: string; branchId: string; quotationId: string | null; total: Prisma.Decimal },
    input: { unpaidDeliveryReason?: string | undefined },
  ): Promise<void> {
    if (!invoice.quotationId) return;
    await this.expireOverdue(tx);
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM quotations WHERE id = ${invoice.quotationId}::uuid FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundError('Quotation', invoice.quotationId);
    const quote = await tx.quotation.findUniqueOrThrow({
      where: { id: invoice.quotationId },
      include: {
        advances: {
          where: { reversal: null },
          include: { paymentAllocations: { select: { amount: true } } },
          orderBy: [{ paidOn: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
        },
      },
    });
    if (quote.status !== 'ACCEPTED')
      throw new BusinessRuleError(
        `The quotation ${quote.quotationNo} is ${quote.status.toLowerCase()}`,
        [
          {
            field: 'quotationId',
            message:
              quote.status === 'EXPIRED'
                ? 'It passed its validity date with nothing paid. Make a new quotation'
                : 'It can no longer be delivered',
          },
        ],
      );
    const paid = quote.advances.reduce((sum, a) => sum.plus(a.amount), new Prisma.Decimal(0));
    const shortfall = invoice.total.minus(paid);
    if (shortfall.gt(0)) {
      if (!auth.permissions.includes('quotations.deliver_unpaid'))
        throw new BusinessRuleError('This order is not fully paid', [
          {
            field: 'payment',
            message: `${paid.toFixed(2)} of ${invoice.total.toFixed(2)} has been paid. Take the rest as an advance on ${quote.quotationNo} first, or ask a manager to deliver it on credit`,
          },
        ]);
      if (!input.unpaidDeliveryReason)
        throw new ValidationFailedError('Say why it is being delivered before it is paid for', [
          {
            field: 'unpaidDeliveryReason',
            message: `${shortfall.toFixed(2)} is still unpaid. Give a reason to deliver anyway`,
          },
        ]);
      await this.audit.record(tx, {
        action: 'QUOTATION_DELIVERED_UNPAID',
        entityType: 'Quotation',
        entityId: quote.id,
        branchId: quote.branchId,
        newValue: {
          invoiceId: invoice.id,
          invoiceTotal: invoice.total.toFixed(2),
          paid: paid.toFixed(2),
          unpaid: shortfall.toFixed(2),
          reason: input.unpaidDeliveryReason,
        },
      });
    }
    let room = invoice.total;
    const applied: { paymentId: string; amount: string }[] = [];
    for (const payment of quote.advances) {
      if (room.lte(0)) break;
      const free = payment.amount.minus(
        payment.paymentAllocations.reduce((sum, a) => sum.plus(a.amount), new Prisma.Decimal(0)),
      );
      const take = Prisma.Decimal.min(free, room);
      if (take.lte(0)) continue;
      await tx.paymentAllocation.create({
        data: {
          paymentId: payment.id,
          invoiceId: invoice.id,
          branchId: invoice.branchId,
          amount: take,
        },
      });
      applied.push({ paymentId: payment.id, amount: take.toFixed(2) });
      room = room.minus(take);
    }
    await tx.quotation.update({
      where: { id: quote.id },
      data: { status: 'CONVERTED', updatedBy: auth.userId },
    });
    await this.audit.record(tx, {
      action: 'QUOTATION_CONVERTED',
      entityType: 'Quotation',
      entityId: quote.id,
      branchId: quote.branchId,
      oldValue: { status: 'ACCEPTED' },
      newValue: { status: 'CONVERTED', invoiceId: invoice.id, advancesApplied: applied },
    });
    await this.outbox.enqueue(tx, {
      eventType: 'quotation.converted',
      branchId: quote.branchId,
      payload: {
        quotationId: quote.id,
        invoiceId: invoice.id,
        customerId: quote.customerId,
        issuedBy: auth.userId,
      },
    });
  }

  /** Cancelling the invoice a quotation was delivered on reopens the quotation. */
  async onInvoiceCancelled(
    tx: TxClient,
    auth: AuthContext,
    invoice: { id: string; branchId: string; quotationId: string | null },
  ): Promise<void> {
    if (!invoice.quotationId) return;
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM quotations WHERE id = ${invoice.quotationId}::uuid FOR UPDATE`;
    if (rows.length === 0) return;
    const quote = await tx.quotation.findUniqueOrThrow({ where: { id: invoice.quotationId } });
    if (quote.status !== 'CONVERTED') return;
    await tx.quotation.update({
      where: { id: quote.id },
      data: { status: 'ACCEPTED', updatedBy: auth.userId },
    });
    await this.audit.record(tx, {
      action: 'QUOTATION_REOPENED',
      entityType: 'Quotation',
      entityId: quote.id,
      branchId: quote.branchId,
      oldValue: { status: 'CONVERTED' },
      newValue: { status: 'ACCEPTED', cancelledInvoiceId: invoice.id },
    });
  }

  // ---------- helpers ----------

  /**
   * A quotation not accepted by its last day lapses; one with an advance paid against it does not, because the customer
   * has paid for the quoted price. Done as it is looked at, so no one has to run a job for it.
   */
  private async expireOverdue(tx: TxClient): Promise<void> {
    await tx.$executeRaw`
      UPDATE quotations q SET status = 'EXPIRED'
      WHERE q.status IN ('SENT', 'ACCEPTED') AND q.valid_until < ${todayInIndia()}::date
        AND NOT EXISTS (
          SELECT 1 FROM payments p
          WHERE p.quotation_id = q.id AND NOT EXISTS (SELECT 1 FROM payment_reversals r WHERE r.payment_id = p.id)
        )`;
  }

  private assertStatus(
    status: QuotationStatusName,
    allowed: QuotationStatusName[],
    verb: string,
  ): void {
    if (allowed.includes(status)) return;
    throw new ConflictError(`A ${status.toLowerCase()} quotation cannot be ${verb}`, [
      { field: 'status', message: `This quotation is ${status.toLowerCase()}` },
    ]);
  }

  private assertValidUntil(validUntil: string): void {
    if (validUntil < todayInIndia())
      throw new ValidationFailedError('The validity date has passed', [
        { field: 'validUntil', message: 'Choose a date from today' },
      ]);
  }

  private async standingInvoice(tx: TxClient, quotationId: string) {
    const invoice = await tx.invoice.findFirst({
      where: { quotationId, status: { in: ['DRAFT', 'ISSUED'] } },
      orderBy: { createdAt: 'desc' },
      select: { id: true, invoiceNo: true, status: true },
    });
    return invoice && (invoice.status === 'DRAFT' || invoice.status === 'ISSUED')
      ? { id: invoice.id, invoiceNo: invoice.invoiceNo, status: invoice.status }
      : null;
  }

  private async advanceTotals(
    tx: TxClient,
    ids: readonly string[],
  ): Promise<Map<string, Prisma.Decimal>> {
    const paid = new Map<string, Prisma.Decimal>();
    if (ids.length === 0) return paid;
    const rows = await tx.payment.findMany({
      where: { quotationId: { in: [...ids] }, reversal: null },
      select: { quotationId: true, amount: true },
    });
    for (const row of rows)
      if (row.quotationId)
        paid.set(
          row.quotationId,
          (paid.get(row.quotationId) ?? new Prisma.Decimal(0)).plus(row.amount),
        );
    return paid;
  }

  private async prepare(
    tx: TxClient,
    branchId: string,
    input: Pick<Body, 'customerId' | 'type' | 'lines'>,
  ) {
    const branch = await tx.branch.findUnique({ where: { id: branchId } });
    if (!branch) throw new NotFoundError('Branch', branchId);
    if (!branch.isActive) throw new BusinessRuleError('This branch is not active');
    const customer = await tx.customer.findUnique({ where: { id: input.customerId } });
    if (!customer)
      throw new ValidationFailedError('Unknown customer', [
        { field: 'customerId', message: 'Choose a customer from the list' },
      ]);
    const items = await tx.item.findMany({
      where: { id: { in: input.lines.map((line) => line.itemId) } },
    });
    const byId = new Map(items.map((item) => [item.id, item]));
    const problems: ErrorDetail[] = [];
    const lines = input.lines.map((line: BodyLines[number], index) => {
      const item = byId.get(line.itemId);
      if (!item || !item.isActive) {
        problems.push({ field: `lines.${index}.itemId`, message: 'Choose an active item' });
        return null;
      }
      if (input.type === 'GST' && item.taxRate === null)
        problems.push({
          field: `lines.${index}.itemId`,
          message: `${item.itemCode} has no GST rate`,
        });
      if (
        new Prisma.Decimal(line.discountAmount).gt(new Prisma.Decimal(line.unitPrice).mul(line.qty))
      )
        problems.push({
          field: `lines.${index}.discountAmount`,
          message: 'The discount is more than the line is worth',
        });
      return { input: line, item };
    });
    if (problems.length > 0)
      throw new ValidationFailedError('The quotation has problems', problems);
    const prepared = lines.flatMap((line) => (line ? [line] : []));
    const placeOfSupply = input.type === 'GST' ? (customer.stateCode ?? branch.stateCode) : null;
    const interState = placeOfSupply ? isInterState(branch.stateCode, placeOfSupply) : false;
    const calc = calculateInvoice(
      prepared.map((line) => ({
        qty: line.input.qty,
        unitPrice: line.input.unitPrice,
        discountAmount: line.input.discountAmount,
        taxRate: line.item.taxRate,
      })),
      { type: input.type, interState },
    );
    return { type: input.type, placeOfSupply, lines: prepared, calc };
  }

  private headerData(prepared: Awaited<ReturnType<QuotationsService['prepare']>>) {
    return {
      subtotal: prepared.calc.subtotal,
      discountTotal: prepared.calc.discountTotal,
      taxableValue: prepared.calc.taxableValue,
      cgstAmount: prepared.calc.cgst,
      sgstAmount: prepared.calc.sgst,
      igstAmount: prepared.calc.igst,
      roundOff: prepared.calc.roundOff,
      total: prepared.calc.total,
      placeOfSupply: prepared.placeOfSupply,
    };
  }

  private lineRows(
    prepared: Awaited<ReturnType<QuotationsService['prepare']>>,
    quotationId: string,
    branchId: string,
    userId: string,
  ): Prisma.QuotationLineCreateManyInput[] {
    const gst = prepared.type === 'GST';
    return prepared.lines.map((line, index) => {
      const calc = prepared.calc.lines[index];
      if (!calc) throw new Error('A line was not calculated');
      return {
        branchId,
        quotationId,
        lineNo: index + 1,
        itemId: line.item.id,
        qty: line.input.qty,
        hsnCode: gst ? line.item.hsnCode : null,
        taxRate: gst ? line.item.taxRate : null,
        unitPrice: line.input.unitPrice,
        discountAmount: calc.discount,
        taxableAmount: calc.taxable,
        cgstAmount: calc.cgst,
        sgstAmount: calc.sgst,
        igstAmount: calc.igst,
        amount: calc.amount,
        createdBy: userId,
        updatedBy: userId,
      };
    });
  }

  private snapshot(
    row: {
      quotationNo: string;
      customerId: string;
      status: string;
      type: string;
      total: Prisma.Decimal;
      brokerId: string | null;
      isCustomBuild: boolean;
    },
    lines: number | null,
  ) {
    return {
      quotationNo: row.quotationNo,
      customerId: row.customerId,
      status: row.status,
      type: row.type,
      total: row.total.toFixed(2),
      brokerId: row.brokerId,
      isCustomBuild: row.isCustomBuild,
      ...(lines === null ? {} : { lines }),
    };
  }

  private async lock(tx: TxClient, id: string, rowVersion: number) {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM quotations WHERE id = ${id}::uuid FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundError('Quotation', id);
    const row = await tx.quotation.findUniqueOrThrow({ where: { id } });
    if (row.rowVersion !== rowVersion) throw new ConflictError(STALE);
    return row;
  }

  private async present(tx: TxClient, id: string): Promise<Quotation> {
    const row = await tx.quotation.findUnique({ where: { id }, include: DETAIL_INCLUDE });
    if (!row) throw new NotFoundError('Quotation', id);
    const users = await tx.user.findMany({
      where: { id: { in: userIdsOf(row) } },
      select: { id: true, fullName: true },
    });
    return toQuotationDto(
      row,
      new Map(users.map((u) => [u.id, u.fullName])),
      await this.standingInvoice(tx, id),
    );
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
    throw new ValidationFailedError('Choose the branch for this quotation', [
      { field: 'branchId', message: 'Choose a branch' },
    ]);
  }
}
