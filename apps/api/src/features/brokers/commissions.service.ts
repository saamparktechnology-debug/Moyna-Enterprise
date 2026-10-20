import { Inject, Injectable } from '@nestjs/common';
import {
  COMMISSION_SORT_FIELDS,
  CommissionListQuerySchema,
  PayoutRequestSchema,
} from '@erp/contracts';
import type { CommissionListResponse, PayoutResponse } from '@erp/contracts';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service.js';
import { NotFoundError, ValidationFailedError } from '../../common/errors/domain-errors.js';
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
import { commissionFor, totalReduction } from './commission-calc.js';
import { COMMISSION_INCLUDE, effectiveOf, toCommissionDto } from './commissions.mapper.js';

const { Decimal } = Prisma;

@Injectable()
export class CommissionsService {
  constructor(
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
  ) {}

  // ---------- used while billing ----------

  /** A broker can go on an invoice only while active and with a rule in force. Returns why not, or null. */
  async whyUnusable(tx: TxClient, brokerId: string): Promise<string | null> {
    const broker = await tx.broker.findUnique({
      where: { id: brokerId },
      select: {
        isActive: true,
        commissionRules: { where: { isActive: true }, select: { id: true } },
      },
    });
    if (!broker) return 'Choose a broker from the list';
    if (!broker.isActive) return 'This broker is no longer active';
    if (broker.commissionRules.length === 0)
      return 'This broker has no commission rule. Add one, or take the broker off the invoice';
    return null;
  }

  async assertUsable(tx: TxClient, brokerId: string | null): Promise<void> {
    if (!brokerId) return;
    const problem = await this.whyUnusable(tx, brokerId);
    if (problem)
      throw new ValidationFailedError('This broker cannot be used', [
        { field: 'brokerId', message: problem },
      ]);
  }

  /** The broker to carry onto a replacement draft, or none when they can no longer be used. */
  async usableOrNull(tx: TxClient, brokerId: string | null): Promise<string | null> {
    if (!brokerId) return null;
    return (await this.whyUnusable(tx, brokerId)) === null ? brokerId : null;
  }

  /**
   * Works out the commission when an invoice is issued, on the rule in force at that moment, and keeps it. A later change
   * of rule does not touch it. Called inside the issuing transaction, so the invoice and its commission stand or fall together.
   */
  async accrue(
    tx: TxClient,
    auth: AuthContext,
    invoice: {
      id: string;
      branchId: string;
      brokerId: string | null;
      taxableValue: Prisma.Decimal;
    },
  ): Promise<void> {
    if (!invoice.brokerId) return;
    await this.assertUsable(tx, invoice.brokerId);
    const rule = await tx.commissionRule.findFirstOrThrow({
      where: { brokerId: invoice.brokerId, isActive: true },
    });
    const amount = commissionFor(rule, invoice.taxableValue);
    if (amount.lte(0)) return;
    const created = await tx.commission.create({
      data: {
        branchId: invoice.branchId,
        brokerId: invoice.brokerId,
        invoiceId: invoice.id,
        ruleId: rule.id,
        amount,
        baseAmount: invoice.taxableValue,
        status: 'PAYABLE',
        createdBy: auth.userId,
        updatedBy: auth.userId,
      },
    });
    await this.audit.record(tx, {
      action: 'COMMISSION_ACCRUED',
      entityType: 'Commission',
      entityId: created.id,
      branchId: invoice.branchId,
      newValue: {
        invoiceId: invoice.id,
        brokerId: invoice.brokerId,
        ruleId: rule.id,
        ruleType: rule.type,
        ruleValue: rule.value.toFixed(2),
        base: invoice.taxableValue.toFixed(2),
        amount: amount.toFixed(2),
      },
    });
    await this.outbox.enqueue(tx, {
      eventType: 'commission.accrued',
      branchId: invoice.branchId,
      payload: {
        commissionId: created.id,
        brokerId: invoice.brokerId,
        invoiceId: invoice.id,
        amount: amount.toFixed(2),
      },
    });
  }

  /** An approved credit note takes back the credited share of the invoice's commission. */
  async reduceForCreditNote(
    tx: TxClient,
    auth: AuthContext,
    note: { id: string; invoiceId: string },
  ): Promise<void> {
    await this.reduceToShare(tx, auth, note.invoiceId, {
      kind: 'CREDIT_NOTE',
      creditNoteId: note.id,
      exchangeId: null,
    });
  }

  /**
   * An approved exchange undoes the sale of the old vehicle, so the commission on the invoice that sold it is lowered by that
   * vehicle's share. It is worked out together with the credit notes on the same invoice, so the paisa add up.
   */
  async reduceForExchange(
    tx: TxClient,
    auth: AuthContext,
    exchange: { id: string; originalInvoiceId: string },
  ): Promise<void> {
    await this.reduceToShare(tx, auth, exchange.originalInvoiceId, {
      kind: 'EXCHANGE',
      creditNoteId: null,
      exchangeId: exchange.id,
    });
  }

  private async reduceToShare(
    tx: TxClient,
    auth: AuthContext,
    invoiceId: string,
    link: {
      kind: 'CREDIT_NOTE' | 'EXCHANGE';
      creditNoteId: string | null;
      exchangeId: string | null;
    },
  ): Promise<void> {
    const commission = await this.lockByInvoice(tx, invoiceId);
    if (!commission) return;
    const [credited, exchanged] = await Promise.all([
      tx.creditNote.aggregate({
        where: { invoiceId, status: 'APPROVED' },
        _sum: { taxableValue: true },
      }),
      tx.exchange.aggregate({
        where: { originalInvoiceId: invoiceId, status: 'APPROVED' },
        _sum: { returnedTaxable: true },
      }),
    ]);
    const target = totalReduction(
      commission.amount,
      (credited._sum.taxableValue ?? new Decimal(0)).plus(
        exchanged._sum.returnedTaxable ?? new Decimal(0),
      ),
      commission.baseAmount,
    );
    const taken = commission.adjustments.reduce((sum, a) => sum.plus(a.amount), new Decimal(0));
    const delta = target.minus(taken);
    if (delta.lte(0)) return;
    await this.adjust(tx, auth, commission, { ...link, amount: delta, taken });
  }

  /** A cancelled invoice never happened, so its whole commission is taken back. */
  async reverseForCancellation(tx: TxClient, auth: AuthContext, invoiceId: string): Promise<void> {
    const commission = await this.lockByInvoice(tx, invoiceId);
    if (!commission || commission.status === 'REVERSED') return;
    const taken = commission.adjustments.reduce((sum, a) => sum.plus(a.amount), new Decimal(0));
    const remaining = commission.amount.minus(taken);
    if (remaining.lte(0)) return;
    await this.adjust(tx, auth, commission, {
      kind: 'INVOICE_CANCELLED',
      creditNoteId: null,
      exchangeId: null,
      amount: remaining,
      taken,
    });
  }

  private async adjust(
    tx: TxClient,
    auth: AuthContext,
    commission: {
      id: string;
      branchId: string;
      amount: Prisma.Decimal;
      status: string;
      brokerId: string;
    },
    change: {
      kind: string;
      creditNoteId: string | null;
      exchangeId: string | null;
      amount: Prisma.Decimal;
      taken: Prisma.Decimal;
    },
  ): Promise<void> {
    await tx.commissionAdjustment.create({
      data: {
        branchId: commission.branchId,
        commissionId: commission.id,
        kind: change.kind,
        creditNoteId: change.creditNoteId,
        exchangeId: change.exchangeId,
        amount: change.amount,
        createdBy: auth.userId,
        updatedBy: auth.userId,
      },
    });
    const effective = commission.amount.minus(change.taken).minus(change.amount);
    const reversed = effective.lte(0) && commission.status === 'PAYABLE';
    if (reversed)
      await tx.commission.update({
        where: { id: commission.id },
        data: { status: 'REVERSED', updatedBy: auth.userId },
      });
    await this.audit.record(tx, {
      action: 'COMMISSION_REDUCED',
      entityType: 'Commission',
      entityId: commission.id,
      branchId: commission.branchId,
      newValue: {
        kind: change.kind,
        creditNoteId: change.creditNoteId,
        reducedBy: change.amount.toFixed(2),
        worthNow: effective.toFixed(2),
        reversed,
      },
    });
    await this.outbox.enqueue(tx, {
      eventType: 'commission.reduced',
      branchId: commission.branchId,
      payload: {
        commissionId: commission.id,
        brokerId: commission.brokerId,
        reducedBy: change.amount.toFixed(2),
        reversed,
        paidAlready: commission.status === 'PAID',
      },
    });
  }

  private async lockByInvoice(tx: TxClient, invoiceId: string) {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM commissions WHERE invoice_id = ${invoiceId}::uuid FOR UPDATE`;
    if (rows.length === 0) return null;
    return tx.commission.findUniqueOrThrow({
      where: { invoiceId },
      include: { adjustments: { select: { amount: true } } },
    });
  }

  // ---------- reading and paying ----------

  async list(rawQuery: unknown): Promise<CommissionListResponse> {
    const query = CommissionListQuerySchema.parse(rawQuery);
    const filters: Prisma.CommissionWhereInput[] = [];
    if (query.status !== 'all') filters.push({ status: query.status });
    if (query.brokerId) filters.push({ brokerId: query.brokerId });
    if (query.branchId) filters.push({ branchId: query.branchId });
    const search = query.search?.trim();
    if (search) {
      const like = { contains: escapeLike(search), mode: 'insensitive' as const };
      filters.push({
        OR: [
          { invoice: { invoiceNo: like } },
          { broker: { name: like } },
          { invoice: { customer: { name: like } } },
        ],
      });
    }
    const where: Prisma.CommissionWhereInput = { AND: filters };
    const orderBy = toOrderBy(COMMISSION_SORT_FIELDS, query, { field: 'createdAt', order: 'desc' });
    return this.transactions.run(async (tx) => {
      const [rows, total] = await Promise.all([
        tx.commission.findMany({
          where,
          orderBy,
          include: COMMISSION_INCLUDE,
          ...toSkipTake(query),
        }),
        tx.commission.count({ where }),
      ]);
      return buildPage(rows.map(toCommissionDto), total, query);
    });
  }

  /**
   * Pays commissions to one broker. Each is paid at what it is worth now, so a credit note that arrived first is already
   * taken off. The rows are locked first, so a credit note or a second payout arriving together is dealt with one at a time.
   */
  async payout(auth: AuthContext, body: unknown): Promise<PayoutResponse> {
    const input = PayoutRequestSchema.parse(body);
    const ids = [...input.commissionIds].sort();
    return this.transactions.run(async (tx) => {
      await tx.$queryRaw(Prisma.sql`
        SELECT id FROM commissions
        WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
        ORDER BY id FOR UPDATE`);
      const rows = await tx.commission.findMany({
        where: { id: { in: ids } },
        include: COMMISSION_INCLUDE,
      });
      if (rows.length !== ids.length)
        throw new NotFoundError(
          'Commission',
          ids.find((id) => !rows.some((r) => r.id === id)) ?? ids[0] ?? '',
        );
      const problems = rows
        .filter((row) => row.status !== 'PAYABLE')
        .map((row) => ({
          field: 'commissionIds',
          message: `${row.invoice.invoiceNo ?? 'An invoice'} is ${row.status === 'PAID' ? 'already paid' : 'reversed'}`,
        }));
      const brokers = new Set(rows.map((row) => row.brokerId));
      if (brokers.size > 1)
        problems.push({ field: 'commissionIds', message: 'Pay one broker at a time' });
      if (problems.length > 0)
        throw new ValidationFailedError('These commissions cannot be paid', problems);

      const now = new Date();
      let total = new Decimal(0);
      for (const row of rows) {
        const worth = effectiveOf(row);
        total = total.plus(worth);
        await tx.commission.update({
          where: { id: row.id },
          data: {
            status: 'PAID',
            paidAt: now,
            paidBy: auth.userId,
            paidAmount: worth,
            payoutReference: input.reference ?? null,
            updatedBy: auth.userId,
          },
        });
        await this.audit.record(tx, {
          action: 'COMMISSION_PAID',
          entityType: 'Commission',
          entityId: row.id,
          branchId: row.branchId,
          oldValue: { status: 'PAYABLE' },
          newValue: {
            status: 'PAID',
            paidAmount: worth.toFixed(2),
            reference: input.reference ?? null,
          },
        });
        await this.outbox.enqueue(tx, {
          eventType: 'commission.paid',
          branchId: row.branchId,
          payload: {
            commissionId: row.id,
            brokerId: row.brokerId,
            amount: worth.toFixed(2),
            paidBy: auth.userId,
          },
        });
      }
      const paid = await tx.commission.findMany({
        where: { id: { in: ids } },
        include: COMMISSION_INCLUDE,
        orderBy: { createdAt: 'asc' },
      });
      const first = rows[0];
      return {
        brokerId: first?.brokerId ?? '',
        brokerName: first?.broker.name ?? '',
        total: total.toFixed(2),
        commissions: paid.map(toCommissionDto),
      };
    });
  }
}
