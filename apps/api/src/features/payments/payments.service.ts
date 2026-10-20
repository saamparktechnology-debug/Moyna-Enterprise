import { Inject, Injectable } from '@nestjs/common';
import {
  ApplyPaymentRequestSchema,
  PAYMENT_SORT_FIELDS,
  RESERVED_PAYMENT_MODES,
  PaymentListQuerySchema,
  RecordPaymentRequestSchema,
  ReversePaymentRequestSchema,
  toPaise,
  todayInIndia,
} from '@erp/contracts';
import type { ErrorDetail, Payment, PaymentListResponse } from '@erp/contracts';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service.js';
import { BranchContextService } from '../../common/branch-context/branch-context.service.js';
import { DocumentNumberService } from '../../common/document-number/document-number.service.js';
import {
  BranchAccessError,
  BusinessRuleError,
  ConflictError,
  InvalidStateError,
  NotFoundError,
  ValidationFailedError,
} from '../../common/errors/domain-errors.js';
import { OutboxService } from '../../common/outbox/outbox.service.js';
import {
  buildPage,
  dateRange,
  escapeLike,
  toOrderBy,
  toSkipTake,
} from '../../common/pagination/pagination.js';
import type { TxClient } from '../../common/prisma/scoped-prisma.service.js';
import { TransactionService } from '../../common/prisma/transaction.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { planAutomaticAllocation } from './allocation.js';
import type { PlannedAllocation } from './allocation.js';
import { balancesSql } from './balances.js';
import type { BalanceRow } from './balances.js';
import {
  PAYMENT_INCLUDE,
  toPaymentDto,
  toSummaryDto,
  unallocatedOf,
  userIdsOf,
} from './payments.mapper.js';
import type { PaymentRow } from './payments.mapper.js';

type RecordInput = ReturnType<typeof RecordPaymentRequestSchema.parse>;

const parseIsoDate = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
const money = (value: { toFixed: (places: number) => string }): string => value.toFixed(2);

@Injectable()
export class PaymentsService {
  constructor(
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(DocumentNumberService) private readonly documents: DocumentNumberService,
    @Inject(BranchContextService) private readonly contexts: BranchContextService,
  ) {}

  // ---------- reading ----------

  async list(rawQuery: unknown): Promise<PaymentListResponse> {
    const query = PaymentListQuerySchema.parse(rawQuery);
    const filters: Prisma.PaymentWhereInput[] = [];
    if (query.status === 'ACTIVE') filters.push({ reversal: null });
    if (query.status === 'REVERSED') filters.push({ reversal: { isNot: null } });
    if (query.customerId) filters.push({ customerId: query.customerId });
    if (query.branchId) filters.push({ branchId: query.branchId });
    if (query.mode) filters.push({ mode: query.mode });
    const range = dateRange('paidOn', {
      from: query.from ? parseIsoDate(query.from) : undefined,
      to: query.to ? parseIsoDate(query.to) : undefined,
    });
    if (range) filters.push(range);
    const search = query.search?.trim();
    if (search) {
      const like = { contains: escapeLike(search), mode: 'insensitive' as const };
      filters.push({
        OR: [{ receiptNo: like }, { reference: like }, { customer: { name: like } }],
      });
    }
    const orderBy = toOrderBy(PAYMENT_SORT_FIELDS, query, { field: 'paidOn', order: 'desc' });
    return this.transactions.run(async (tx) => {
      if (query.withCredit && query.customerId)
        filters.push({ id: { in: await this.idsWithCredit(tx, query.customerId) } });
      const where: Prisma.PaymentWhereInput = { AND: filters };
      const [rows, total] = await Promise.all([
        tx.payment.findMany({ where, orderBy, include: PAYMENT_INCLUDE, ...toSkipTake(query) }),
        tx.payment.count({ where }),
      ]);
      const names = await this.userNames(tx, userIdsOf(rows));
      return buildPage(
        rows.map((row) => toSummaryDto(row, names)),
        total,
        query,
      );
    });
  }

  async get(id: string): Promise<Payment> {
    return this.transactions.run(async (tx) => {
      const row = await this.load(tx, id);
      return toPaymentDto(row, await this.userNames(tx, userIdsOf([row])));
    });
  }

  // ---------- recording ----------

  async record(auth: AuthContext, body: unknown): Promise<Payment> {
    const input = RecordPaymentRequestSchema.parse(body);
    const branchId = this.resolveBranch(input.branchId);
    if (input.paidOn > todayInIndia())
      throw new ValidationFailedError('The payment date is in the future', [
        { field: 'paidOn', message: 'The payment date cannot be after today' },
      ]);

    return this.transactions.run((tx) => this.recordInTx(tx, auth, input, branchId, null));
  }

  /**
   * Records a payment inside a transaction the caller already has, so it can be taken together with other changes. A payment
   * that names a quotation is an advance for it (the database checks the customer, the branch and that it is accepted).
   */
  async recordInTx(
    tx: TxClient,
    auth: AuthContext,
    input: RecordInput,
    branchId: string,
    quotationId: string | null,
    options: { allowReservedMode?: boolean } = {},
  ): Promise<Payment> {
    // One request at a time per retry key and per reference, so two identical requests cannot both pass the checks.
    await this.advisoryLock(tx, `payment-key:${branchId}:${input.idempotencyKey}`);
    const replay = await this.findReplay(tx, branchId, input);
    if (replay) return toPaymentDto(replay, await this.userNames(tx, userIdsOf([replay])));

    if (input.reference)
      await this.advisoryLock(
        tx,
        `payment-ref:${branchId}:${input.mode}:${input.reference.toLowerCase()}`,
      );
    await this.lockCustomer(tx, input.customerId);
    if (RESERVED_PAYMENT_MODES.includes(input.mode) && !options.allowReservedMode)
      throw new ValidationFailedError('That payment mode is for the system', [
        {
          field: 'mode',
          message: 'This mode is used only for the value of an old unit in an exchange',
        },
      ]);
    await this.assertMode(tx, input.mode);
    if (input.reference) await this.assertReferenceUnused(tx, branchId, input);

    const plan = await this.planAllocations(tx, {
      branchId,
      customerId: input.customerId,
      available: input.amount,
      automatic: input.allocateAutomatically,
      requested: input.allocations,
      alreadyApplied: new Set(),
    });

    const receiptNo = await this.documents.next(tx, { branchId, docType: 'PAYMENT_RECEIPT' });
    const created = await tx.payment.create({
      data: {
        branchId,
        receiptNo,
        customerId: input.customerId,
        mode: input.mode,
        amount: input.amount,
        paidOn: parseIsoDate(input.paidOn),
        reference: input.reference ?? null,
        note: input.note ?? null,
        idempotencyKey: input.idempotencyKey,
        quotationId,
        createdBy: auth.userId,
        updatedBy: auth.userId,
      },
    });
    await this.insertAllocations(tx, created.id, branchId, plan);

    await this.audit.record(tx, {
      action: 'PAYMENT_RECORDED',
      entityType: 'Payment',
      entityId: created.id,
      branchId,
      newValue: {
        receiptNo,
        customerId: input.customerId,
        mode: input.mode,
        amount: input.amount,
        paidOn: input.paidOn,
        reference: input.reference ?? null,
        allocations: plan.map((a) => ({ invoiceId: a.invoiceId, amount: a.amount })),
      },
    });
    await this.outbox.enqueue(tx, {
      eventType: 'payment.recorded',
      branchId,
      payload: {
        paymentId: created.id,
        receiptNo,
        customerId: input.customerId,
        amount: input.amount,
        mode: input.mode,
        invoices: plan.map((a) => a.invoiceId),
        recordedBy: auth.userId,
      },
    });
    const row = await this.load(tx, created.id);
    return toPaymentDto(row, await this.userNames(tx, userIdsOf([row])));
  }

  /** Applies what is left of a payment to more invoices. */
  async apply(auth: AuthContext, id: string, body: unknown): Promise<Payment> {
    const input = ApplyPaymentRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const peek = await this.load(tx, id);
      await this.lockCustomer(tx, peek.customerId);
      await this.lockPayment(tx, id);
      const current = await this.load(tx, id);
      if (current.reversal) throw new InvalidStateError('The payment', 'REVERSED', 'applied');
      const available = unallocatedOf(current);
      if (available.lte(0))
        throw new BusinessRuleError('Nothing is left of this payment to apply', [
          { field: 'payment', message: 'Every rupee of this payment is already applied' },
        ]);

      const plan = await this.planAllocations(tx, {
        branchId: current.branchId,
        customerId: current.customerId,
        available: money(available),
        automatic: input.allocateAutomatically,
        requested: input.allocations,
        alreadyApplied: new Set(current.paymentAllocations.map((a) => a.invoiceId)),
      });
      if (plan.length === 0)
        throw new BusinessRuleError('There is nothing to apply this payment to', [
          { field: 'allocations', message: 'The customer has no invoice with a balance due' },
        ]);
      await this.insertAllocations(tx, id, current.branchId, plan);

      await this.audit.record(tx, {
        action: 'PAYMENT_APPLIED',
        entityType: 'Payment',
        entityId: id,
        branchId: current.branchId,
        newValue: {
          receiptNo: current.receiptNo,
          allocations: plan.map((a) => ({ invoiceId: a.invoiceId, amount: a.amount })),
        },
      });
      await this.outbox.enqueue(tx, {
        eventType: 'payment.applied',
        branchId: current.branchId,
        payload: {
          paymentId: id,
          receiptNo: current.receiptNo,
          customerId: current.customerId,
          invoices: plan.map((a) => a.invoiceId),
          appliedBy: auth.userId,
        },
      });
      const row = await this.load(tx, id);
      return toPaymentDto(row, await this.userNames(tx, userIdsOf([row])));
    });
  }

  /**
   * Undoes a payment, for example a bounced cheque or a wrong entry. The payment and its allocations stay as they
   * were; a reversal row cancels them, so the invoices owe the money again and the history is complete.
   */
  async reverse(auth: AuthContext, id: string, body: unknown): Promise<Payment> {
    const input = ReversePaymentRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      await this.load(tx, id);
      await this.lockPayment(tx, id);
      const current = await this.load(tx, id);
      if (current.reversal) throw new InvalidStateError('The payment', 'REVERSED', 'REVERSED');

      await tx.paymentReversal.create({
        data: {
          branchId: current.branchId,
          paymentId: id,
          reason: input.reason,
          reversedOn: parseIsoDate(todayInIndia()),
          createdBy: auth.userId,
          updatedBy: auth.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'PAYMENT_REVERSED',
        entityType: 'Payment',
        entityId: id,
        branchId: current.branchId,
        oldValue: { status: 'ACTIVE' },
        newValue: {
          status: 'REVERSED',
          receiptNo: current.receiptNo,
          amount: money(current.amount),
          reason: input.reason,
          invoices: current.paymentAllocations.map((a) => a.invoiceId),
        },
      });
      await this.outbox.enqueue(tx, {
        eventType: 'payment.reversed',
        branchId: current.branchId,
        payload: {
          paymentId: id,
          receiptNo: current.receiptNo,
          customerId: current.customerId,
          amount: money(current.amount),
          reversedBy: auth.userId,
        },
      });
      const row = await this.load(tx, id);
      return toPaymentDto(row, await this.userNames(tx, userIdsOf([row])));
    });
  }

  // ---------- allocation ----------

  /**
   * Works out which invoices take the money and checks each one: it must exist in this branch, belong to this customer,
   * be issued, not already be settled by this payment, and not take more than it still owes. The invoices are locked
   * first so a credit note, a cancellation or another payment cannot change them underneath.
   */
  private async planAllocations(
    tx: TxClient,
    args: {
      branchId: string;
      customerId: string;
      available: string;
      automatic: boolean;
      requested: readonly { invoiceId: string; amount: string }[];
      alreadyApplied: ReadonlySet<string>;
    },
  ): Promise<PlannedAllocation[]> {
    if (args.automatic) {
      const candidates = await tx.$queryRaw<{ invoice_id: string }[]>(Prisma.sql`
        SELECT b.invoice_id FROM (${balancesSql(
          Prisma.sql`i.branch_id = ${args.branchId}::uuid AND i.customer_id = ${args.customerId}::uuid`,
        )}) b
        WHERE b.outstanding_value > 0
        ORDER BY b.due_date_value ASC NULLS LAST, b.issued_on_value ASC NULLS LAST, b.invoice_no ASC, b.invoice_id ASC`);
      const ids = candidates
        .map((c) => c.invoice_id)
        .filter((invoiceId) => !args.alreadyApplied.has(invoiceId));
      await this.lockInvoices(tx, ids);
      const fresh = await this.balancesOf(tx, ids);
      const order = new Map(ids.map((invoiceId, index) => [invoiceId, index]));
      const dues = fresh
        .filter((row) => Number(row.outstanding) > 0)
        .sort((a, b) => (order.get(a.invoice_id) ?? 0) - (order.get(b.invoice_id) ?? 0))
        .map((row) => ({ invoiceId: row.invoice_id, outstanding: row.outstanding }));
      return planAutomaticAllocation(dues, args.available).allocations;
    }

    if (args.requested.length === 0) return [];
    const ids = args.requested.map((r) => r.invoiceId);
    await this.lockInvoices(tx, ids);
    const invoices = await tx.invoice.findMany({
      where: { id: { in: ids } },
      select: { id: true, status: true, branchId: true, customerId: true },
    });
    const byId = new Map(invoices.map((invoice) => [invoice.id, invoice]));
    const balances = new Map((await this.balancesOf(tx, ids)).map((row) => [row.invoice_id, row]));

    const problems: ErrorDetail[] = [];
    let total = 0;
    args.requested.forEach((request, index) => {
      const field = `allocations.${index}`;
      const invoice = byId.get(request.invoiceId);
      const balance = balances.get(request.invoiceId);
      if (!invoice || invoice.branchId !== args.branchId) {
        problems.push({
          field: `${field}.invoiceId`,
          message: 'This invoice was not found in the branch',
        });
      } else if (invoice.customerId !== args.customerId) {
        problems.push({
          field: `${field}.invoiceId`,
          message: 'This invoice belongs to another customer',
        });
      } else if (invoice.status !== 'ISSUED' || !balance) {
        problems.push({
          field: `${field}.invoiceId`,
          message: 'Only an issued invoice can take a payment',
        });
      } else if (args.alreadyApplied.has(request.invoiceId)) {
        problems.push({
          field: `${field}.invoiceId`,
          message: 'This payment has already been applied to this invoice',
        });
      } else if (toPaise(request.amount) > toPaise(balance.outstanding)) {
        problems.push({
          field: `${field}.amount`,
          message: `The invoice only has ${balance.outstanding} left to pay`,
        });
      }
      total += toPaise(request.amount);
    });
    if (total > toPaise(args.available))
      problems.push({
        field: 'allocations',
        message: `Only ${args.available} is available to apply`,
      });
    if (problems.length > 0) throw new ValidationFailedError('Check the invoices chosen', problems);
    return args.requested.map((r) => ({ invoiceId: r.invoiceId, amount: r.amount }));
  }

  private async insertAllocations(
    tx: TxClient,
    paymentId: string,
    branchId: string,
    plan: readonly PlannedAllocation[],
  ): Promise<void> {
    for (const allocation of [...plan].sort((a, b) => a.invoiceId.localeCompare(b.invoiceId)))
      await tx.paymentAllocation.create({
        data: { paymentId, invoiceId: allocation.invoiceId, branchId, amount: allocation.amount },
      });
  }

  // ---------- checks and locks ----------

  private async findReplay(
    tx: TxClient,
    branchId: string,
    input: RecordInput,
  ): Promise<PaymentRow | null> {
    const existing = await tx.payment.findUnique({
      where: { branchId_idempotencyKey: { branchId, idempotencyKey: input.idempotencyKey } },
      include: PAYMENT_INCLUDE,
    });
    if (!existing) return null;
    const same =
      existing.customerId === input.customerId &&
      existing.mode === input.mode &&
      toPaise(money(existing.amount)) === toPaise(input.amount) &&
      existing.paidOn.toISOString().slice(0, 10) === input.paidOn &&
      (existing.reference ?? null) === (input.reference ?? null);
    if (!same)
      throw new ConflictError('This retry key was already used for a different payment', [
        { field: 'idempotencyKey', message: 'Start a new payment form to record another payment' },
      ]);
    return existing;
  }

  private async assertMode(tx: TxClient, code: string): Promise<void> {
    const mode = await tx.paymentMode.findFirst({ where: { code, isActive: true } });
    if (!mode)
      throw new ValidationFailedError('Unknown payment mode', [
        { field: 'mode', message: 'Choose how it was paid from the list' },
      ]);
  }

  private async assertReferenceUnused(
    tx: TxClient,
    branchId: string,
    input: RecordInput,
  ): Promise<void> {
    const reference = input.reference;
    if (!reference) return;
    const same = await tx.payment.findFirst({
      where: {
        branchId,
        mode: input.mode,
        reference: { equals: reference, mode: 'insensitive' },
        reversal: null,
      },
      select: { receiptNo: true },
    });
    if (same)
      throw new ConflictError('This reference was already used for a payment', [
        {
          field: 'reference',
          message: `Receipt ${same.receiptNo} already has this reference. Check it is not a repeat.`,
        },
      ]);
  }

  private async idsWithCredit(tx: TxClient, customerId: string): Promise<string[]> {
    const rows = await tx.$queryRaw<{ id: string }[]>`
      SELECT p.id FROM payments p
      WHERE p.customer_id = ${customerId}::uuid
        AND NOT EXISTS (SELECT 1 FROM payment_reversals r WHERE r.payment_id = p.id)
        AND p.amount > COALESCE((SELECT SUM(a.amount) FROM payment_allocations a WHERE a.payment_id = p.id), 0)`;
    return rows.map((row) => row.id);
  }

  private async balancesOf(tx: TxClient, ids: readonly string[]): Promise<BalanceRow[]> {
    if (ids.length === 0) return [];
    return tx.$queryRaw<BalanceRow[]>(
      balancesSql(Prisma.sql`i.id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})`),
    );
  }

  private async lockInvoices(tx: TxClient, ids: readonly string[]): Promise<void> {
    if (ids.length === 0) return;
    await tx.$queryRaw(Prisma.sql`
      SELECT id FROM invoices
      WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
      ORDER BY id FOR UPDATE`);
  }

  private async lockCustomer(tx: TxClient, customerId: string): Promise<void> {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM customers WHERE id = ${customerId}::uuid FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundError('Customer', customerId);
  }

  private async lockPayment(tx: TxClient, id: string): Promise<void> {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM payments WHERE id = ${id}::uuid FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundError('Payment', id);
  }

  private async advisoryLock(tx: TxClient, key: string): Promise<void> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${key}, 0))`;
  }

  private async load(tx: TxClient, id: string): Promise<PaymentRow> {
    const row = await tx.payment.findUnique({ where: { id }, include: PAYMENT_INCLUDE });
    if (!row) throw new NotFoundError('Payment', id);
    return row;
  }

  private async userNames(tx: TxClient, ids: readonly string[]): Promise<Map<string, string>> {
    if (ids.length === 0) return new Map();
    const users = await tx.user.findMany({
      where: { id: { in: [...ids] } },
      select: { id: true, fullName: true },
    });
    return new Map(users.map((user) => [user.id, user.fullName]));
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
    throw new ValidationFailedError('Choose the branch for this payment', [
      { field: 'branchId', message: 'Choose a branch' },
    ]);
  }
}
