import { Inject, Injectable } from '@nestjs/common';
import {
  ApproveExchangeRequestSchema,
  CancelExchangeRequestSchema,
  EXCHANGE_SORT_FIELDS,
  ExchangeListQuerySchema,
  ExchangeOptionsQuerySchema,
  RecordPaymentRequestSchema,
  RejectExchangeRequestSchema,
  RequestExchangeRequestSchema,
  todayInIndia,
} from '@erp/contracts';
import type { ErrorDetail, Exchange, ExchangeListResponse, ExchangeOptions } from '@erp/contracts';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service.js';
import { BranchContextService } from '../../common/branch-context/branch-context.service.js';
import { SettingsService } from '../settings/settings.service.js';
import { DocumentNumberService } from '../../common/document-number/document-number.service.js';
import {
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
import { CommissionsService } from '../brokers/commissions.service.js';
import { balancesSql } from '../payments/balances.js';
import type { BalanceRow } from '../payments/balances.js';
import { PaymentsService } from '../payments/payments.service.js';
import { StockPostingService } from '../stock/stock-posting.service.js';
import { EXCHANGE_INCLUDE, toExchangeDto, toSummaryDto, userIdsOf } from './exchanges.mapper.js';
import type { ExchangeRow } from './exchanges.mapper.js';

const { Decimal } = Prisma;
const STALE = 'This exchange was changed by someone else. Reload it and try again';

@Injectable()
export class ExchangesService {
  constructor(
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(DocumentNumberService) private readonly documents: DocumentNumberService,
    @Inject(StockPostingService) private readonly posting: StockPostingService,
    @Inject(PaymentsService) private readonly payments: PaymentsService,
    @Inject(CommissionsService) private readonly commissions: CommissionsService,
    @Inject(BranchContextService) private readonly contexts: BranchContextService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  // ---------- reading ----------

  async list(rawQuery: unknown): Promise<ExchangeListResponse> {
    const query = ExchangeListQuerySchema.parse(rawQuery);
    const filters: Prisma.ExchangeWhereInput[] = [];
    if (query.status !== 'all') filters.push({ status: query.status });
    if (query.kind !== 'all') filters.push({ kind: query.kind });
    if (query.branchId) filters.push({ branchId: query.branchId });
    if (query.customerId) filters.push({ invoice: { customerId: query.customerId } });
    const search = query.search?.trim();
    if (search) {
      const like = { contains: escapeLike(search), mode: 'insensitive' as const };
      filters.push({
        OR: [
          { exchangeNo: like },
          { invoice: { customer: { name: like } } },
          { oldSerialUnit: { serialNo: like } },
          { newSerialUnit: { serialNo: like } },
        ],
      });
    }
    const where: Prisma.ExchangeWhereInput = { AND: filters };
    const orderBy = toOrderBy(EXCHANGE_SORT_FIELDS, query, { field: 'createdAt', order: 'desc' });
    return this.transactions.run(async (tx) => {
      const [rows, total] = await Promise.all([
        tx.exchange.findMany({ where, orderBy, include: EXCHANGE_INCLUDE, ...toSkipTake(query) }),
        tx.exchange.count({ where }),
      ]);
      return buildPage(rows.map(toSummaryDto), total, query);
    });
  }

  async get(id: string): Promise<Exchange> {
    return this.transactions.run((tx) => this.present(tx, id));
  }

  /** The vehicles a delivery invoice can exchange: its own, and the ones sold earlier to the same customer that can be taken back. */
  async options(rawQuery: unknown): Promise<ExchangeOptions> {
    const { invoiceId } = ExchangeOptionsQuerySchema.parse(rawQuery);
    return this.transactions.run(async (tx) => {
      const delivery = await this.issuedInvoice(tx, invoiceId);
      const newLines = await tx.invoiceLine.findMany({
        where: { invoiceId, serialUnitId: { not: null }, item: { isSerialized: true } },
        include: {
          item: { select: { itemCode: true, name: true } },
          serialUnit: { select: { serialNo: true } },
        },
        orderBy: { lineNo: 'asc' },
      });
      const open = await tx.exchange.findMany({
        where: {
          status: { in: ['PENDING', 'APPROVED'] },
          OR: [
            {
              newSerialUnitId: {
                in: newLines.flatMap((l) => (l.serialUnitId ? [l.serialUnitId] : [])),
              },
            },
          ],
        },
        select: { newSerialUnitId: true },
      });
      const taken = new Set(open.map((o) => o.newSerialUnitId));
      const oldLines = await tx.invoiceLine.findMany({
        where: {
          serialUnitId: { not: null },
          invoice: {
            customerId: delivery.customerId,
            branchId: delivery.branchId,
            status: 'ISSUED',
            id: { not: invoiceId },
          },
          serialUnit: { state: 'SOLD' },
        },
        include: {
          item: { select: { itemCode: true, name: true } },
          invoice: { select: { invoiceNo: true, issuedOn: true } },
          serialUnit: {
            select: {
              serialNo: true,
              chassisNo: true,
              motorNo: true,
              installedBatteries: {
                select: { serialUnit: { select: { id: true, serialNo: true } } },
                orderBy: { serialUnitId: 'asc' },
              },
            },
          },
        },
        orderBy: [{ invoice: { issuedOn: 'desc' } }, { createdAt: 'desc' }],
      });
      const unitIds = oldLines.flatMap((l) => (l.serialUnitId ? [l.serialUnitId] : []));
      const [openOld, credited] = await Promise.all([
        tx.exchange.findMany({
          where: { oldSerialUnitId: { in: unitIds }, status: { in: ['PENDING', 'APPROVED'] } },
          select: { oldSerialUnitId: true },
        }),
        tx.creditNoteLine.findMany({
          where: {
            serialUnitId: { in: unitIds },
            creditNote: { status: { in: ['PENDING', 'APPROVED'] } },
          },
          select: { serialUnitId: true },
        }),
      ]);
      const blocked = new Set([
        ...openOld.map((o) => o.oldSerialUnitId),
        ...credited.flatMap((c) => (c.serialUnitId ? [c.serialUnitId] : [])),
      ]);
      const seen = new Set<string>();
      const oldUnits = oldLines.flatMap((line) => {
        const unitId = line.serialUnitId;
        if (
          !unitId ||
          !line.serialUnit ||
          seen.has(unitId) ||
          blocked.has(unitId) ||
          line.amount.lte(0)
        )
          return [];
        seen.add(unitId);
        return [
          {
            unitId,
            serialNo: line.serialUnit.serialNo,
            itemCode: line.item.itemCode,
            itemName: line.item.name,
            chassisNo: line.serialUnit.chassisNo,
            motorNo: line.serialUnit.motorNo,
            originalInvoiceId: line.invoiceId,
            originalInvoiceNo: line.invoice.invoiceNo,
            soldOn: line.invoice.issuedOn ? line.invoice.issuedOn.toISOString().slice(0, 10) : null,
            lineAmount: line.amount.toFixed(2),
            batteries: line.serialUnit.installedBatteries.map((b) => ({
              id: b.serialUnit.id,
              serialNo: b.serialUnit.serialNo,
            })),
          },
        ];
      });
      const customer = await tx.customer.findUniqueOrThrow({
        where: { id: delivery.customerId },
        select: { name: true },
      });
      return {
        invoiceId,
        invoiceNo: delivery.invoiceNo,
        customerName: customer.name,
        newUnits: newLines.flatMap((line) =>
          line.serialUnitId && line.serialUnit && !taken.has(line.serialUnitId)
            ? [
                {
                  unitId: line.serialUnitId,
                  serialNo: line.serialUnit.serialNo,
                  itemCode: line.item.itemCode,
                  itemName: line.item.name,
                  lineAmount: line.amount.toFixed(2),
                },
              ]
            : [],
        ),
        oldUnits,
      };
    });
  }

  // ---------- asking ----------

  /**
   * Asks to take back a vehicle the customer was sold, against a vehicle on an issued delivery invoice. A new-for-new
   * exchange takes the old vehicle back at exactly what was paid for it; an old-for-new one at a valuation of up to that.
   */
  async request(auth: AuthContext, body: unknown): Promise<Exchange> {
    const input = RequestExchangeRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const delivery = await this.issuedInvoice(tx, input.invoiceId);
      // One request at a time per vehicle, so two cannot both pass the checks that follow.
      for (const unitId of [input.oldSerialUnitId, input.newSerialUnitId].sort())
        await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended(${`exchange-unit:${unitId}`}, 0))`;

      const problems: ErrorDetail[] = [];
      const newLine = await tx.invoiceLine.findFirst({
        where: { invoiceId: delivery.id, serialUnitId: input.newSerialUnitId },
        include: { item: { select: { itemCode: true } } },
      });
      if (!newLine)
        problems.push({
          field: 'newSerialUnitId',
          message: 'This vehicle is not on the delivery invoice',
        });
      const oldLine = await tx.invoiceLine.findFirst({
        where: {
          serialUnitId: input.oldSerialUnitId,
          invoice: { status: 'ISSUED', id: { not: delivery.id } },
        },
        include: { invoice: true, serialUnit: true },
        orderBy: [{ invoice: { issuedOn: 'desc' } }, { createdAt: 'desc' }],
      });
      if (!oldLine)
        problems.push({
          field: 'oldSerialUnitId',
          message: 'This vehicle was not sold on an issued invoice',
        });
      else {
        if (oldLine.invoice.customerId !== delivery.customerId)
          problems.push({
            field: 'oldSerialUnitId',
            message: 'This vehicle was sold to another customer',
          });
        if (
          oldLine.invoice.branchId !== delivery.branchId ||
          oldLine.serialUnit?.branchId !== delivery.branchId
        )
          problems.push({
            field: 'oldSerialUnitId',
            message: 'This vehicle was sold from another branch',
          });
        if (oldLine.serialUnit?.state !== 'SOLD')
          problems.push({
            field: 'oldSerialUnitId',
            message: `This vehicle is ${oldLine.serialUnit?.state.toLowerCase() ?? 'not sold'}, so it cannot be taken back`,
          });
        if (oldLine.amount.lte(0))
          problems.push({
            field: 'oldSerialUnitId',
            message: 'This vehicle was given free, so it has no value to take back',
          });
      }
      if (problems.length > 0)
        throw new ValidationFailedError('This exchange cannot be made', problems);
      if (!newLine || !oldLine) throw new NotFoundError('Invoice line', input.invoiceId);

      for (const [unitId, field, role] of [
        [input.oldSerialUnitId, 'oldSerialUnitId', 'old'],
        [input.newSerialUnitId, 'newSerialUnitId', 'new'],
      ] as const) {
        const open = await tx.exchange.findFirst({
          where: {
            status: { in: ['PENDING', 'APPROVED'] },
            ...(role === 'old' ? { oldSerialUnitId: unitId } : { newSerialUnitId: unitId }),
          },
          select: { exchangeNo: true },
        });
        if (open)
          throw new ConflictError('This vehicle is already in an exchange', [
            { field, message: `It is part of exchange ${open.exchangeNo}` },
          ]);
      }
      const credit = await tx.creditNoteLine.findFirst({
        where: {
          serialUnitId: input.oldSerialUnitId,
          creditNote: { status: { in: ['PENDING', 'APPROVED'] } },
        },
        select: { id: true },
      });
      if (credit)
        throw new BusinessRuleError('A credit note covers this vehicle', [
          {
            field: 'oldSerialUnitId',
            message: 'A vehicle with a credit note cannot also be exchanged',
          },
        ]);

      const returned = oldLine.amount;
      let valuation = returned;
      if (input.kind === 'OLD_FOR_NEW') {
        valuation = new Decimal(input.valuationAmount ?? '0');
        if (valuation.gt(returned))
          throw new ValidationFailedError('The valuation is more than was paid', [
            {
              field: 'valuationAmount',
              message: `The most it can be valued at is ${returned.toFixed(2)}, what the customer paid for it`,
            },
          ]);
      }
      const exchangeNo = await this.documents.next(tx, {
        branchId: delivery.branchId,
        docType: 'EXCHANGE',
      });
      const created = await tx.exchange.create({
        data: {
          branchId: delivery.branchId,
          exchangeNo,
          kind: input.kind,
          status: 'PENDING',
          invoiceId: delivery.id,
          originalInvoiceId: oldLine.invoiceId,
          oldSerialUnitId: input.oldSerialUnitId,
          newSerialUnitId: input.newSerialUnitId,
          returnedAmount: returned,
          returnedTaxable: oldLine.taxableAmount,
          valuationAmount: valuation,
          newAmount: newLine.amount,
          differenceAmount: newLine.amount.minus(valuation),
          disposition: input.disposition,
          reason: input.reason,
          createdBy: auth.userId,
          updatedBy: auth.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'EXCHANGE_REQUESTED',
        entityType: 'Exchange',
        entityId: created.id,
        branchId: delivery.branchId,
        newValue: {
          exchangeNo,
          kind: input.kind,
          deliveryInvoiceId: delivery.id,
          originalInvoiceId: oldLine.invoiceId,
          oldSerialNo: oldLine.serialUnit?.serialNo,
          valuation: valuation.toFixed(2),
          difference: created.differenceAmount.toFixed(2),
          disposition: input.disposition,
          reason: input.reason,
        },
      });
      await this.outbox.enqueue(tx, {
        eventType: 'exchange.requested',
        branchId: delivery.branchId,
        payload: {
          exchangeId: created.id,
          exchangeNo,
          customerId: delivery.customerId,
          requestedBy: auth.userId,
        },
      });
      return this.present(tx, created.id);
    });
  }

  /** The person who asked withdraws a request that is still waiting. */
  async cancel(auth: AuthContext, id: string, body: unknown): Promise<Exchange> {
    const input = CancelExchangeRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const current = await this.lock(tx, id, input.rowVersion);
      if (current.status !== 'PENDING')
        throw new InvalidStateError('The exchange', current.status, 'CANCELLED');
      if (current.createdBy !== auth.userId)
        throw new ForbiddenError(
          'Only the person who asked for an exchange can withdraw it. A manager can reject it instead',
        );
      await tx.exchange.update({
        where: { id },
        data: { status: 'CANCELLED', updatedBy: auth.userId },
      });
      await this.audit.record(tx, {
        action: 'EXCHANGE_CANCELLED',
        entityType: 'Exchange',
        entityId: id,
        branchId: current.branchId,
        oldValue: { status: 'PENDING' },
        newValue: { status: 'CANCELLED', exchangeNo: current.exchangeNo },
      });
      return this.present(tx, id);
    });
  }

  // ---------- deciding ----------

  async reject(auth: AuthContext, id: string, body: unknown): Promise<Exchange> {
    const input = RejectExchangeRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const current = await this.lock(tx, id, input.rowVersion);
      if (current.status !== 'PENDING')
        throw new InvalidStateError('The exchange', current.status, 'REJECTED');
      await tx.exchange.update({
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
        action: 'EXCHANGE_REJECTED',
        entityType: 'Exchange',
        entityId: id,
        branchId: current.branchId,
        oldValue: { status: 'PENDING' },
        newValue: { status: 'REJECTED', exchangeNo: current.exchangeNo, note: input.note },
      });
      await this.outbox.enqueue(tx, {
        eventType: 'exchange.rejected',
        branchId: current.branchId,
        payload: { exchangeId: id, exchangeNo: current.exchangeNo, rejectedBy: auth.userId },
      });
      return this.present(tx, id);
    });
  }

  /**
   * Approves an exchange, and in one transaction: the old vehicle (and the batteries fitted in it) goes back into stock as
   * returned goods or is scrapped; its valuation is paid in as a trade-in credit and applied to the delivery invoice; and
   * the commission on the old sale is lowered by the vehicle's share. Nothing is half done.
   */
  async approve(auth: AuthContext, id: string, body: unknown): Promise<Exchange> {
    const input = ApproveExchangeRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const peek = await tx.exchange.findUnique({
        where: { id },
        include: { invoice: { select: { customerId: true } } },
      });
      if (!peek) throw new NotFoundError('Exchange', id);
      // Customer first, then the exchange: the order every path that takes money for this customer uses.
      await tx.$queryRaw`SELECT id FROM customers WHERE id = ${peek.invoice.customerId}::uuid FOR UPDATE`;
      const current = await this.lock(tx, id, input.rowVersion);
      if (current.status !== 'PENDING')
        throw new InvalidStateError('The exchange', current.status, 'APPROVED');
      if (current.createdBy === auth.userId && !auth.isSuperAdmin)
        throw new ForbiddenError(
          'You cannot approve an exchange you asked for. Ask another approver to approve it',
        );

      const limit = (await this.settings.exchangeLimit(tx)) ?? undefined;
      if (
        limit !== undefined &&
        !auth.isSuperAdmin &&
        current.valuationAmount.gt(new Decimal(limit))
      )
        throw new ForbiddenError(
          `An exchange valued above ${limit} needs a Super Admin to approve it. This one is valued at ${current.valuationAmount.toFixed(2)}`,
        );
      const [delivery, original] = await Promise.all([
        tx.invoice.findUniqueOrThrow({
          where: { id: current.invoiceId },
          select: { status: true, invoiceNo: true },
        }),
        tx.invoice.findUniqueOrThrow({
          where: { id: current.originalInvoiceId },
          select: { status: true, invoiceNo: true },
        }),
      ]);
      if (delivery.status !== 'ISSUED' || original.status !== 'ISSUED')
        throw new BusinessRuleError('An invoice of this exchange is no longer issued', [
          { field: 'invoiceId', message: 'Both invoices must still be issued' },
        ]);
      const old = await tx.serialUnit.findUniqueOrThrow({
        where: { id: current.oldSerialUnitId },
        select: { itemId: true, serialNo: true, state: true },
      });
      if (old.state !== 'SOLD')
        throw new BusinessRuleError('The old vehicle is no longer sold to the customer', [
          {
            field: 'oldSerialUnitId',
            message: `Serial number ${old.serialNo} is ${old.state.toLowerCase()}`,
          },
        ]);

      await this.takeBackVehicle(tx, current, old.itemId);

      const balance = await tx.$queryRaw<BalanceRow[]>(
        balancesSql(Prisma.sql`i.id = ${current.invoiceId}::uuid`),
      );
      const outstanding = new Decimal(balance[0]?.outstanding ?? '0');
      const applied = Decimal.min(current.valuationAmount, outstanding);
      const request = RecordPaymentRequestSchema.parse({
        customerId: peek.invoice.customerId,
        branchId: current.branchId,
        mode: 'EXCHANGE',
        amount: current.valuationAmount.toFixed(2),
        paidOn: todayInIndia(),
        reference: current.exchangeNo,
        note: `Old vehicle ${old.serialNo} taken back`,
        idempotencyKey: `exchange-${id}`,
        allocations: applied.gt(0)
          ? [{ invoiceId: current.invoiceId, amount: applied.toFixed(2) }]
          : [],
      });
      const payment = await this.payments.recordInTx(tx, auth, request, current.branchId, null, {
        allowReservedMode: true,
      });

      await tx.exchange.update({
        where: { id },
        data: {
          status: 'APPROVED',
          decidedBy: auth.userId,
          decidedAt: new Date(),
          decisionNote: input.note ?? null,
          tradeInPaymentId: payment.id,
          updatedBy: auth.userId,
        },
      });
      await this.commissions.reduceForExchange(tx, auth, {
        id,
        originalInvoiceId: current.originalInvoiceId,
      });

      await this.audit.record(tx, {
        action: 'EXCHANGE_APPROVED',
        entityType: 'Exchange',
        entityId: id,
        branchId: current.branchId,
        oldValue: { status: 'PENDING' },
        newValue: {
          status: 'APPROVED',
          exchangeNo: current.exchangeNo,
          disposition: current.disposition,
          valuation: current.valuationAmount.toFixed(2),
          difference: current.differenceAmount.toFixed(2),
          tradeInReceipt: payment.receiptNo,
          appliedToInvoice: applied.toFixed(2),
        },
      });
      await this.outbox.enqueue(tx, {
        eventType: 'exchange.approved',
        branchId: current.branchId,
        payload: {
          exchangeId: id,
          exchangeNo: current.exchangeNo,
          customerId: peek.invoice.customerId,
          approvedBy: auth.userId,
        },
      });
      return this.present(tx, id);
    });
  }

  // ---------- stock ----------

  /**
   * The old vehicle comes back into stock as returned goods (to be looked over and moved by a stock adjustment), or, when
   * it is to be scrapped, comes in and is written off at once, so the ledger shows both. The batteries fitted in it come
   * back as returned goods either way, with their warranty cleared as on any other return.
   */
  private async takeBackVehicle(
    tx: TxClient,
    exchange: { id: string; branchId: string; oldSerialUnitId: string; disposition: string },
    itemId: string,
  ): Promise<void> {
    const base = {
      branchId: exchange.branchId,
      sourceDocId: exchange.id,
      sourceDocType: 'EXCHANGE' as const,
    };
    const scrap = exchange.disposition === 'SCRAP';
    const batteries = await tx.battery.findMany({
      where: { installedInSerialUnitId: exchange.oldSerialUnitId, serialUnit: { state: 'SOLD' } },
      select: { serialUnitId: true, serialUnit: { select: { itemId: true } } },
      orderBy: { serialUnitId: 'asc' },
    });
    for (const battery of batteries) {
      await this.posting.moveSerialUnit(tx, {
        unitId: battery.serialUnitId,
        branchId: exchange.branchId,
        from: ['SOLD'],
        to: 'RETURNED',
      });
      await this.posting.post(tx, {
        ...base,
        itemId: battery.serialUnit.itemId,
        state: 'RETURNED',
        qtyDelta: 1,
        movementType: 'EXCHANGE_IN',
        serialUnitId: battery.serialUnitId,
      });
      await tx.battery.update({
        where: { serialUnitId: battery.serialUnitId },
        data: {
          warrantyEnd: null,
          ...(scrap ? { installedInSerialUnitId: null, installedOn: null } : {}),
        },
      });
    }
    if (!scrap) {
      await this.posting.moveSerialUnit(tx, {
        unitId: exchange.oldSerialUnitId,
        branchId: exchange.branchId,
        from: ['SOLD'],
        to: 'RETURNED',
      });
      await this.posting.post(tx, {
        ...base,
        itemId,
        state: 'RETURNED',
        qtyDelta: 1,
        movementType: 'EXCHANGE_IN',
        serialUnitId: exchange.oldSerialUnitId,
      });
      return;
    }
    await this.posting.moveSerialUnit(tx, {
      unitId: exchange.oldSerialUnitId,
      branchId: exchange.branchId,
      from: ['SOLD'],
      to: 'DAMAGED',
    });
    await this.posting.post(tx, {
      ...base,
      itemId,
      state: 'DAMAGED',
      qtyDelta: 1,
      movementType: 'EXCHANGE_IN',
      serialUnitId: exchange.oldSerialUnitId,
    });
    await this.posting.moveSerialUnit(tx, {
      unitId: exchange.oldSerialUnitId,
      branchId: exchange.branchId,
      from: ['DAMAGED'],
      to: 'SCRAPPED',
    });
    await this.posting.post(tx, {
      ...base,
      itemId,
      state: 'DAMAGED',
      qtyDelta: -1,
      movementType: 'WRITE_OFF',
      serialUnitId: exchange.oldSerialUnitId,
    });
  }

  // ---------- helpers ----------

  private async issuedInvoice(tx: TxClient, id: string) {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM invoices WHERE id = ${id}::uuid FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundError('Invoice', id);
    const invoice = await tx.invoice.findUniqueOrThrow({ where: { id } });
    if (invoice.status !== 'ISSUED')
      throw new BusinessRuleError('Only an issued invoice can take part in an exchange', [
        { field: 'invoiceId', message: `This invoice is ${invoice.status.toLowerCase()}` },
      ]);
    return invoice;
  }

  private async lock(tx: TxClient, id: string, rowVersion: number) {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM exchanges WHERE id = ${id}::uuid FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundError('Exchange', id);
    const row = await tx.exchange.findUniqueOrThrow({ where: { id } });
    if (row.rowVersion !== rowVersion) throw new ConflictError(STALE);
    return row;
  }

  private async present(tx: TxClient, id: string): Promise<Exchange> {
    const row: ExchangeRow | null = await tx.exchange.findUnique({
      where: { id },
      include: EXCHANGE_INCLUDE,
    });
    if (!row) throw new NotFoundError('Exchange', id);
    const users = await tx.user.findMany({
      where: { id: { in: userIdsOf(row) } },
      select: { id: true, fullName: true },
    });
    return toExchangeDto(row, new Map(users.map((u) => [u.id, u.fullName])));
  }
}
