import { REFUND_SORT_FIELDS } from '@erp/contracts';
import { Inject, Injectable } from '@nestjs/common';
import {
  CreateRefundRequestSchema,
  CustomerCreditQuerySchema,
  RESERVED_PAYMENT_MODES,
  RefundListQuerySchema,
  toPaise,
  todayInIndia,
} from '@erp/contracts';
import type { CustomerCredit, Refund, RefundListResponse } from '@erp/contracts';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service.js';
import { BranchContextService } from '../../common/branch-context/branch-context.service.js';
import { DocumentNumberService } from '../../common/document-number/document-number.service.js';
import {
  BranchAccessError,
  ConflictError,
  NotFoundError,
  ValidationFailedError,
} from '../../common/errors/domain-errors.js';
import { OutboxService } from '../../common/outbox/outbox.service.js';
import { buildPage, toOrderBy, toSkipTake } from '../../common/pagination/pagination.js';
import type { TxClient } from '../../common/prisma/scoped-prisma.service.js';
import { TransactionService } from '../../common/prisma/transaction.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { balancesSql } from './balances.js';

const { Decimal } = Prisma;
const INCLUDE = {
  branch: { select: { code: true } },
  customer: { select: { name: true } },
  paymentMode: { select: { name: true } },
} satisfies Prisma.CustomerRefundInclude;
type Row = Prisma.CustomerRefundGetPayload<{ include: typeof INCLUDE }>;

function toDto(row: Row, creator: string | null): Refund {
  return {
    id: row.id,
    refundNo: row.refundNo,
    branchId: row.branchId,
    branchCode: row.branch.code,
    customerId: row.customerId,
    customerName: row.customer.name,
    amount: row.amount.toFixed(2),
    mode: row.mode,
    modeName: row.paymentMode.name,
    paidOn: row.paidOn.toISOString().slice(0, 10),
    reference: row.reference,
    reason: row.reason,
    createdByName: creator,
    createdAt: row.createdAt.toISOString(),
  };
}

@Injectable()
export class RefundsService {
  constructor(
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(DocumentNumberService) private readonly documents: DocumentNumberService,
    @Inject(BranchContextService) private readonly contexts: BranchContextService,
  ) {}

  /** What a customer holds in a branch, and how much of it can be paid back. */
  async credit(rawQuery: unknown): Promise<CustomerCredit> {
    const query = CustomerCreditQuerySchema.parse(rawQuery);
    const branchId = this.resolveBranch(query.branchId);
    return this.transactions.run(async (tx) => {
      await this.assertCustomer(tx, query.customerId);
      return this.creditOf(tx, query.customerId, branchId);
    });
  }

  async list(rawQuery: unknown): Promise<RefundListResponse> {
    const query = RefundListQuerySchema.parse(rawQuery);
    const where: Prisma.CustomerRefundWhereInput = {
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {}),
    };
    return this.transactions.run(async (tx) => {
      const [rows, total] = await Promise.all([
        tx.customerRefund.findMany({
          where,
          include: INCLUDE,
          orderBy: toOrderBy(REFUND_SORT_FIELDS, query, { field: 'paidOn', order: 'desc' }),
          ...toSkipTake(query),
        }),
        tx.customerRefund.count({ where }),
      ]);
      const names = await this.names(
        tx,
        rows.map((row) => row.createdBy),
      );
      return buildPage(
        rows.map((row) => toDto(row, row.createdBy ? (names.get(row.createdBy) ?? null) : null)),
        total,
        query,
      );
    });
  }

  /**
   * Pays back credit. It cannot be more than the customer can be refunded in that branch: their credit, less what is held for
   * an accepted quotation. A retried request with the same key returns the refund already made.
   */
  async create(auth: AuthContext, body: unknown): Promise<Refund> {
    const input = CreateRefundRequestSchema.parse(body);
    const branchId = this.resolveBranch(input.branchId);
    if (input.paidOn > todayInIndia())
      throw new ValidationFailedError('The date is in the future', [
        { field: 'paidOn', message: 'The refund date cannot be after today' },
      ]);
    return this.transactions.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`refund-key:${branchId}:${input.idempotencyKey}`}, 0))`;
      const existing = await tx.customerRefund.findUnique({
        where: { branchId_idempotencyKey: { branchId, idempotencyKey: input.idempotencyKey } },
        include: INCLUDE,
      });
      if (existing) {
        const same =
          existing.customerId === input.customerId &&
          existing.mode === input.mode &&
          toPaise(existing.amount.toFixed(2)) === toPaise(input.amount) &&
          existing.paidOn.toISOString().slice(0, 10) === input.paidOn;
        if (!same)
          throw new ConflictError('That retry key was used for a different refund', [
            { field: 'idempotencyKey', message: 'Use a new key for a new refund' },
          ]);
        return toDto(existing, await this.creatorName(tx, existing.createdBy));
      }
      // The customer is locked first, as on every path that takes or gives money for them.
      await this.assertCustomer(tx, input.customerId);
      await tx.$queryRaw`SELECT id FROM customers WHERE id = ${input.customerId}::uuid FOR UPDATE`;
      if (RESERVED_PAYMENT_MODES.includes(input.mode))
        throw new ValidationFailedError('That mode is for the system', [
          { field: 'mode', message: 'Choose a mode people use to pay back' },
        ]);
      const mode = await tx.paymentMode.findFirst({ where: { code: input.mode, isActive: true } });
      if (!mode)
        throw new ValidationFailedError('Unknown payment mode', [
          { field: 'mode', message: 'Choose a payment mode from the list' },
        ]);
      const credit = await this.creditOf(tx, input.customerId, branchId);
      if (new Decimal(input.amount).gt(new Decimal(credit.refundable)))
        throw new ValidationFailedError('That is more than can be refunded', [
          {
            field: 'amount',
            message:
              Number(credit.heldForOrders) > 0
                ? `Only ${credit.refundable} can be refunded: ${credit.heldForOrders} is held for an accepted order`
                : `Only ${credit.refundable} can be refunded`,
          },
        ]);
      const refundNo = await this.documents.next(tx, { branchId, docType: 'REFUND' });
      const created = await tx.customerRefund.create({
        data: {
          branchId,
          customerId: input.customerId,
          refundNo,
          amount: input.amount,
          mode: input.mode,
          paidOn: new Date(`${input.paidOn}T00:00:00.000Z`),
          reference: input.reference ?? null,
          reason: input.reason,
          idempotencyKey: input.idempotencyKey,
          createdBy: auth.userId,
          updatedBy: auth.userId,
        },
        include: INCLUDE,
      });
      await this.audit.record(tx, {
        action: 'CUSTOMER_REFUND_PAID',
        entityType: 'CustomerRefund',
        entityId: created.id,
        branchId,
        newValue: {
          refundNo,
          customerId: input.customerId,
          amount: input.amount,
          mode: input.mode,
          reason: input.reason,
          creditBefore: credit.credit,
        },
      });
      await this.outbox.enqueue(tx, {
        eventType: 'customer.refund_paid',
        branchId,
        payload: {
          refundId: created.id,
          refundNo,
          customerId: input.customerId,
          paidBy: auth.userId,
        },
      });
      return toDto(created, await this.creatorName(tx, auth.userId));
    });
  }

  // ---------- helpers ----------

  private async creditOf(
    tx: TxClient,
    customerId: string,
    branchId: string,
  ): Promise<CustomerCredit> {
    const [surplus, unapplied, held, refunded] = await Promise.all([
      tx.$queryRaw<{ v: Prisma.Decimal | null }[]>(
        Prisma.sql`SELECT SUM(b.surplus_value) AS v FROM (${balancesSql(
          Prisma.sql`i.customer_id = ${customerId}::uuid AND i.branch_id = ${branchId}::uuid`,
        )}) b`,
      ),
      tx.$queryRaw<{ v: Prisma.Decimal | null }[]>(Prisma.sql`
        SELECT SUM(p.amount - COALESCE((SELECT SUM(a.amount) FROM payment_allocations a WHERE a.payment_id = p.id), 0)) AS v
        FROM payments p
        WHERE p.customer_id = ${customerId}::uuid AND p.branch_id = ${branchId}::uuid
          AND NOT EXISTS (SELECT 1 FROM payment_reversals r WHERE r.payment_id = p.id)`),
      tx.$queryRaw<{ v: Prisma.Decimal | null }[]>(Prisma.sql`
        SELECT SUM(p.amount - COALESCE((SELECT SUM(a.amount) FROM payment_allocations a WHERE a.payment_id = p.id), 0)) AS v
        FROM payments p JOIN quotations q ON q.id = p.quotation_id
        WHERE p.customer_id = ${customerId}::uuid AND p.branch_id = ${branchId}::uuid AND q.status = 'ACCEPTED'
          AND NOT EXISTS (SELECT 1 FROM payment_reversals r WHERE r.payment_id = p.id)`),
      tx.customerRefund.aggregate({ where: { customerId, branchId }, _sum: { amount: true } }),
    ]);
    const money = (value: Prisma.Decimal | null | undefined): Prisma.Decimal =>
      new Decimal(value ?? 0);
    const refundedTotal = money(refunded._sum.amount);
    const credit = Decimal.max(
      money(surplus[0]?.v).plus(money(unapplied[0]?.v)).minus(refundedTotal),
      new Decimal(0),
    );
    const heldTotal = Decimal.min(money(held[0]?.v), credit);
    return {
      customerId,
      branchId,
      credit: credit.toFixed(2),
      heldForOrders: heldTotal.toFixed(2),
      refunded: refundedTotal.toFixed(2),
      refundable: credit.minus(heldTotal).toFixed(2),
    };
  }

  private async assertCustomer(tx: TxClient, id: string): Promise<void> {
    const found = await tx.customer.findUnique({ where: { id }, select: { id: true } });
    if (!found) throw new NotFoundError('Customer', id);
  }

  private async names(tx: TxClient, ids: (string | null)[]): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (wanted.length === 0) return new Map();
    const users = await tx.user.findMany({
      where: { id: { in: wanted } },
      select: { id: true, fullName: true },
    });
    return new Map(users.map((user) => [user.id, user.fullName]));
  }

  private async creatorName(tx: TxClient, id: string | null): Promise<string | null> {
    return id ? ((await this.names(tx, [id])).get(id) ?? null) : null;
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
