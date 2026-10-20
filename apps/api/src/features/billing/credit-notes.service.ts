import { Inject, Injectable } from '@nestjs/common';
import {
  ApproveCreditNoteRequestSchema,
  CREDIT_NOTE_SORT_FIELDS,
  CreateCreditNoteRequestSchema,
  CreditNoteListQuerySchema,
  RejectCreditNoteRequestSchema,
} from '@erp/contracts';
import type {
  CreditNote,
  CreditNoteListResponse,
  CreditNoteStatusName,
  ErrorDetail,
  ReturnableLine,
} from '@erp/contracts';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service.js';
import { BranchContextService } from '../../common/branch-context/branch-context.service.js';
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
import { roundMoney, sumMoney, toMoney } from '../../common/money/money.js';
import type { Money } from '../../common/money/money.js';
import type { TxClient } from '../../common/prisma/scoped-prisma.service.js';
import { TransactionService } from '../../common/prisma/transaction.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { buildCreditNotePdf } from './credit-note-pdf.js';
import { CommissionsService } from '../brokers/commissions.service.js';
import { StockPostingService } from '../stock/stock-posting.service.js';

const NOTE_INCLUDE = {
  branch: true,
  decider: true,
  invoice: { include: { customer: true } },
  lines: {
    include: { item: true, serialUnit: true },
    orderBy: [{ lineNo: 'asc' }],
  },
} satisfies Prisma.CreditNoteInclude;
type NoteRow = Prisma.CreditNoteGetPayload<{ include: typeof NOTE_INCLUDE }>;

const money = (value: { toFixed: (places: number) => string }): string => value.toFixed(2);

interface Amounts {
  taxable: Money;
  cgst: Money;
  sgst: Money;
  igst: Money;
}

@Injectable()
export class CreditNotesService {
  constructor(
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(DocumentNumberService) private readonly documents: DocumentNumberService,
    @Inject(StockPostingService) private readonly posting: StockPostingService,
    @Inject(BranchContextService) private readonly contexts: BranchContextService,
    @Inject(CommissionsService) private readonly commissions: CommissionsService,
  ) {}

  // ---------- reading ----------

  async list(rawQuery: unknown): Promise<CreditNoteListResponse> {
    const query = CreditNoteListQuerySchema.parse(rawQuery);
    const filters: Prisma.CreditNoteWhereInput[] = [];
    if (query.status !== 'all') filters.push({ status: query.status });
    if (query.invoiceId) filters.push({ invoiceId: query.invoiceId });
    if (query.branchId) filters.push({ branchId: query.branchId });
    const search = query.search?.trim();
    if (search) {
      const like = { contains: escapeLike(search), mode: 'insensitive' as const };
      filters.push({
        OR: [
          { creditNoteNo: like },
          { invoice: { invoiceNo: like } },
          { invoice: { customer: { name: like } } },
        ],
      });
    }
    const where: Prisma.CreditNoteWhereInput = { AND: filters };
    const orderBy = toOrderBy(CREDIT_NOTE_SORT_FIELDS, query, {
      field: 'createdAt',
      order: 'desc',
    });
    return this.transactions.run(async (tx) => {
      const [rows, total] = await Promise.all([
        tx.creditNote.findMany({
          where,
          orderBy,
          include: {
            branch: true,
            invoice: { include: { customer: true } },
            _count: { select: { lines: true } },
          },
          ...toSkipTake(query),
        }),
        tx.creditNote.count({ where }),
      ]);
      const names = await this.userNames(
        tx,
        rows.map((row) => row.createdBy),
      );
      return buildPage(
        rows.map((row) => ({
          id: row.id,
          creditNoteNo: row.creditNoteNo,
          status: row.status as CreditNoteStatusName,
          branchCode: row.branch.code,
          invoiceId: row.invoiceId,
          invoiceNo: row.invoice.invoiceNo,
          customerName: row.invoice.customer.name,
          amount: money(row.amount),
          requestedByName: row.createdBy ? (names.get(row.createdBy) ?? null) : null,
          lineCount: row._count.lines,
          createdAt: row.createdAt.toISOString(),
        })),
        total,
        query,
      );
    });
  }

  async get(id: string): Promise<CreditNote> {
    return this.transactions.run(async (tx) => this.toDto(tx, await this.load(tx, id)));
  }

  /** The credit note as a PDF. Only an approved one is valid; a waiting or rejected one says so on the page. */
  async pdf(id: string): Promise<{ body: Buffer; fileName: string }> {
    return this.transactions.run(async (tx) => {
      const row = await this.load(tx, id);
      const note = await this.toDto(tx, row);
      const [invoice, branch] = await Promise.all([
        tx.invoice.findUniqueOrThrow({
          where: { id: row.invoiceId },
          select: { type: true, branchGstin: true, customerGstin: true, issuedOn: true },
        }),
        tx.branch.findUniqueOrThrow({ where: { id: row.branchId }, select: { name: true } }),
      ]);
      const body = buildCreditNotePdf(note, {
        branchName: branch.name,
        branchGstin: invoice.branchGstin,
        customerGstin: invoice.customerGstin,
        gst: invoice.type === 'GST',
        invoiceDate: invoice.issuedOn ? invoice.issuedOn.toISOString().slice(0, 10) : null,
      });
      const label = (note.creditNoteNo ?? `pending-${row.id.slice(0, 8)}`).replace(
        /[^A-Za-z0-9._-]/g,
        '-',
      );
      return { body, fileName: `${label}.pdf` };
    });
  }

  /** What can still be credited on each line of an invoice, counting credit notes that are waiting for a decision. */
  async returnable(invoiceId: string): Promise<ReturnableLine[]> {
    return this.transactions.run(async (tx) => {
      const invoice = await tx.invoice.findUnique({
        where: { id: invoiceId },
        include: {
          invoiceLines: { include: { item: true, serialUnit: true }, orderBy: [{ lineNo: 'asc' }] },
        },
      });
      if (!invoice) throw new NotFoundError('Invoice', invoiceId);
      const credited = await this.creditedByLine(
        tx,
        invoice.invoiceLines.map((line) => line.id),
      );
      const exchanging = await this.exchangeNumbers(
        tx,
        invoice.invoiceLines.flatMap((line) => (line.serialUnitId ? [line.serialUnitId] : [])),
      );
      return invoice.invoiceLines.map((line) => {
        const done = credited.get(line.id)?.qty ?? 0;
        return {
          invoiceLineId: line.id,
          itemCode: line.item.itemCode,
          itemName: line.item.name,
          serialNo: line.serialUnit?.serialNo ?? null,
          soldQty: line.qty,
          creditedQty: done,
          returnableQty:
            line.serialUnitId && exchanging.has(line.serialUnitId)
              ? 0
              : Math.max(0, line.qty - done),
        };
      });
    });
  }

  // ---------- asking ----------

  async request(auth: AuthContext, body: unknown): Promise<CreditNote> {
    const input = CreateCreditNoteRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      // Locking the invoice makes two requests for the same invoice take turns, so neither can over-credit it.
      const locked = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM invoices WHERE id = ${input.invoiceId}::uuid FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundError('Invoice', input.invoiceId);
      const invoice = await tx.invoice.findUniqueOrThrow({
        where: { id: input.invoiceId },
        include: { invoiceLines: true },
      });
      if (invoice.status !== 'ISSUED')
        throw new BusinessRuleError('Only an issued invoice can be credited', [
          { field: 'invoiceId', message: `This invoice is ${invoice.status.toLowerCase()}` },
        ]);

      const credited = await this.creditedByLine(
        tx,
        invoice.invoiceLines.map((line) => line.id),
      );
      const exchanging = await this.exchangeNumbers(
        tx,
        invoice.invoiceLines.flatMap((line) => (line.serialUnitId ? [line.serialUnitId] : [])),
      );
      const problems: ErrorDetail[] = [];
      const rows = input.lines.flatMap((requested, index) => {
        const line = invoice.invoiceLines.find(
          (candidate) => candidate.id === requested.invoiceLineId,
        );
        if (!line) {
          problems.push({
            field: `lines.${index}.invoiceLineId`,
            message: 'This line is not on the invoice',
          });
          return [];
        }
        const inExchange = line.serialUnitId ? exchanging.get(line.serialUnitId) : undefined;
        if (inExchange) {
          problems.push({
            field: `lines.${index}.invoiceLineId`,
            message: `This vehicle is part of exchange ${inExchange}, so it cannot also be credited`,
          });
          return [];
        }
        const done = credited.get(line.id) ?? this.noAmounts();
        const remaining = line.qty - done.qty;
        if (requested.qty > remaining) {
          problems.push({
            field: `lines.${index}.qty`,
            message:
              remaining === 0
                ? 'Everything on this line has already been credited'
                : `Only ${remaining} can still be credited`,
          });
          return [];
        }
        const amounts = this.amountsFor(line, requested.qty, remaining, done);
        return [{ line, qty: requested.qty, amounts }];
      });
      if (problems.length > 0)
        throw new ValidationFailedError('The credit note has problems', problems);

      const totals: Amounts = {
        taxable: sumMoney(rows.map((row) => row.amounts.taxable)),
        cgst: sumMoney(rows.map((row) => row.amounts.cgst)),
        sgst: sumMoney(rows.map((row) => row.amounts.sgst)),
        igst: sumMoney(rows.map((row) => row.amounts.igst)),
      };
      const amount = totals.taxable.plus(totals.cgst).plus(totals.sgst).plus(totals.igst);
      if (!amount.greaterThan(0))
        throw new BusinessRuleError('There is nothing to credit on these lines', [
          {
            field: 'lines',
            message: 'These lines were given free, so there is no amount to credit',
          },
        ]);

      const note = await tx.creditNote.create({
        data: {
          branchId: invoice.branchId,
          invoiceId: invoice.id,
          reason: input.reason,
          status: 'PENDING',
          taxableValue: totals.taxable,
          cgstAmount: totals.cgst,
          sgstAmount: totals.sgst,
          igstAmount: totals.igst,
          amount,
          createdBy: auth.userId,
          updatedBy: auth.userId,
        },
      });
      await tx.creditNoteLine.createMany({
        data: rows.map((row, index) => ({
          branchId: invoice.branchId,
          creditNoteId: note.id,
          invoiceLineId: row.line.id,
          itemId: row.line.itemId,
          serialUnitId: row.line.serialUnitId,
          lineNo: index + 1,
          qty: row.qty,
          taxableAmount: row.amounts.taxable,
          cgstAmount: row.amounts.cgst,
          sgstAmount: row.amounts.sgst,
          igstAmount: row.amounts.igst,
          amount: row.amounts.taxable
            .plus(row.amounts.cgst)
            .plus(row.amounts.sgst)
            .plus(row.amounts.igst),
          createdBy: auth.userId,
          updatedBy: auth.userId,
        })),
      });
      const row = await this.load(tx, note.id);
      await this.audit.record(tx, {
        action: 'CREDIT_NOTE_REQUESTED',
        entityType: 'CreditNote',
        entityId: note.id,
        branchId: invoice.branchId,
        newValue: {
          invoiceId: invoice.id,
          amount: money(amount),
          lines: rows.length,
          reason: input.reason,
        },
      });
      return this.toDto(tx, row);
    });
  }

  // ---------- deciding ----------

  async approve(auth: AuthContext, id: string, body: unknown): Promise<CreditNote> {
    const input = ApproveCreditNoteRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const current = await this.lock(tx, id);
      this.assertVersion(current, input.rowVersion);
      this.assertPending(current, 'APPROVED');
      if (current.createdBy === auth.userId && !auth.isSuperAdmin)
        throw new ForbiddenError(
          'You cannot approve a credit note you asked for. Ask another approver to approve it',
        );
      const invoice = await tx.invoice.findUniqueOrThrow({ where: { id: current.invoiceId } });
      if (invoice.status !== 'ISSUED')
        throw new BusinessRuleError('The invoice is no longer issued', [
          { field: 'invoiceId', message: `This invoice is ${invoice.status.toLowerCase()}` },
        ]);

      const creditNoteNo = await this.documents.next(tx, {
        branchId: current.branchId,
        docType: 'CREDIT_NOTE',
      });
      let batteriesReturned = 0;
      for (const line of current.lines) {
        if (line.serialUnitId) {
          await this.posting.moveSerialUnit(tx, {
            unitId: line.serialUnitId,
            branchId: current.branchId,
            from: ['SOLD'],
            to: 'RETURNED',
          });
          await tx.battery.updateMany({
            where: { serialUnitId: line.serialUnitId },
            data: { warrantyEnd: null },
          });
          batteriesReturned += await this.returnFittedBatteries(
            tx,
            current.branchId,
            line.serialUnitId,
            id,
          );
        }
        await this.posting.post(tx, {
          branchId: current.branchId,
          itemId: line.itemId,
          state: 'RETURNED',
          qtyDelta: line.qty,
          movementType: 'SALE_RETURN',
          ...(line.serialUnitId ? { serialUnitId: line.serialUnitId } : {}),
          sourceDocId: id,
          sourceDocType: 'CREDIT_NOTE',
        });
      }
      await tx.creditNote.update({
        where: { id },
        data: {
          status: 'APPROVED',
          creditNoteNo,
          decidedBy: auth.userId,
          decidedAt: new Date(),
          updatedBy: auth.userId,
        },
      });
      await this.commissions.reduceForCreditNote(tx, auth, { id, invoiceId: current.invoiceId });
      const row = await this.load(tx, id);
      await this.audit.record(tx, {
        action: 'CREDIT_NOTE_APPROVED',
        entityType: 'CreditNote',
        entityId: id,
        branchId: current.branchId,
        oldValue: { status: 'PENDING' },
        newValue: {
          status: 'APPROVED',
          creditNoteNo,
          amount: money(current.amount),
          batteriesReturned,
        },
      });
      await this.outbox.enqueue(tx, {
        eventType: 'credit_note.approved',
        branchId: current.branchId,
        payload: {
          creditNoteId: id,
          creditNoteNo,
          invoiceId: current.invoiceId,
          customerId: invoice.customerId,
          amount: money(current.amount),
          approvedBy: auth.userId,
        },
      });
      return this.toDto(tx, row);
    });
  }

  /** An approver may reject any request; a person may also withdraw a request of their own. */
  async reject(auth: AuthContext, id: string, body: unknown): Promise<CreditNote> {
    const input = RejectCreditNoteRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const current = await this.lock(tx, id);
      const mayDecide = auth.permissions.includes('credit_notes.approve');
      const mayWithdraw =
        current.createdBy === auth.userId && auth.permissions.includes('credit_notes.create');
      if (!mayDecide && !mayWithdraw)
        throw new ForbiddenError('You may not reject this credit note');
      this.assertVersion(current, input.rowVersion);
      this.assertPending(current, 'REJECTED');
      await tx.creditNote.update({
        where: { id },
        data: {
          status: 'REJECTED',
          decidedBy: auth.userId,
          decidedAt: new Date(),
          decisionNote: input.reason,
          updatedBy: auth.userId,
        },
      });
      const row = await this.load(tx, id);
      await this.audit.record(tx, {
        action: 'CREDIT_NOTE_REJECTED',
        entityType: 'CreditNote',
        entityId: id,
        branchId: current.branchId,
        oldValue: { status: 'PENDING' },
        newValue: { status: 'REJECTED', reason: input.reason },
      });
      return this.toDto(tx, row);
    });
  }

  // ---------- helpers ----------

  private noAmounts(): Amounts & { qty: number } {
    const zero = new Prisma.Decimal(0);
    return { qty: 0, taxable: zero, cgst: zero, sgst: zero, igst: zero };
  }

  /** What is already credited or waiting on each invoice line (rejected credit notes do not count). */
  private async creditedByLine(
    tx: TxClient,
    lineIds: string[],
  ): Promise<Map<string, Amounts & { qty: number }>> {
    const rows = await tx.creditNoteLine.findMany({
      where: { invoiceLineId: { in: lineIds }, creditNote: { status: { not: 'REJECTED' } } },
    });
    const totals = new Map<string, Amounts & { qty: number }>();
    for (const row of rows) {
      const so = totals.get(row.invoiceLineId) ?? this.noAmounts();
      totals.set(row.invoiceLineId, {
        qty: so.qty + row.qty,
        taxable: so.taxable.plus(row.taxableAmount),
        cgst: so.cgst.plus(row.cgstAmount),
        sgst: so.sgst.plus(row.sgstAmount),
        igst: so.igst.plus(row.igstAmount),
      });
    }
    return totals;
  }

  /**
   * The amounts credited for part of a line are in proportion to the share returned, rounded half up. Crediting
   * everything that is left takes exactly what is left, so the paise of many small credits always add back to the line.
   */
  private amountsFor(
    line: {
      qty: number;
      taxableAmount: Money;
      cgstAmount: Money;
      sgstAmount: Money;
      igstAmount: Money;
    },
    qty: number,
    remaining: number,
    done: Amounts,
  ): Amounts {
    if (qty === remaining)
      return {
        taxable: line.taxableAmount.minus(done.taxable),
        cgst: line.cgstAmount.minus(done.cgst),
        sgst: line.sgstAmount.minus(done.sgst),
        igst: line.igstAmount.minus(done.igst),
      };
    const part = (whole: Money, soFar: Money): Money => {
      const share = roundMoney(toMoney(whole).times(qty).dividedBy(line.qty));
      const left = toMoney(whole).minus(soFar);
      return share.greaterThan(left) ? left : share;
    };
    return {
      taxable: part(line.taxableAmount, done.taxable),
      cgst: part(line.cgstAmount, done.cgst),
      sgst: part(line.sgstAmount, done.sgst),
      igst: part(line.igstAmount, done.igst),
    };
  }

  private assertVersion(row: NoteRow, rowVersion: number): void {
    if (row.rowVersion !== rowVersion)
      throw new ConflictError(
        'This credit note was changed by someone else. Reload it and try again',
      );
  }

  private assertPending(row: NoteRow, to: string): void {
    if (row.status !== 'PENDING') throw new InvalidStateError('The credit note', row.status, to);
  }

  /**
   * The batteries fitted in a vehicle were sold with it, so they come back with it: as returned goods, with their warranty
   * cleared as on any other return. They stay fitted in the vehicle. Returns how many came back.
   */
  private async returnFittedBatteries(
    tx: TxClient,
    branchId: string,
    vehicleUnitId: string,
    creditNoteId: string,
  ): Promise<number> {
    const batteries = await tx.battery.findMany({
      where: { installedInSerialUnitId: vehicleUnitId, serialUnit: { state: 'SOLD' } },
      select: { serialUnitId: true, serialUnit: { select: { itemId: true } } },
      orderBy: { serialUnitId: 'asc' },
    });
    for (const battery of batteries) {
      await this.posting.moveSerialUnit(tx, {
        unitId: battery.serialUnitId,
        branchId,
        from: ['SOLD'],
        to: 'RETURNED',
      });
      await this.posting.post(tx, {
        branchId,
        itemId: battery.serialUnit.itemId,
        state: 'RETURNED',
        qtyDelta: 1,
        movementType: 'SALE_RETURN',
        serialUnitId: battery.serialUnitId,
        sourceDocId: creditNoteId,
        sourceDocType: 'CREDIT_NOTE',
      });
      await tx.battery.update({
        where: { serialUnitId: battery.serialUnitId },
        data: { warrantyEnd: null },
      });
    }
    return batteries.length;
  }

  /** The exchange, if any, that each of these vehicles is part of while it is pending or approved. */
  private async exchangeNumbers(tx: TxClient, unitIds: string[]): Promise<Map<string, string>> {
    if (unitIds.length === 0) return new Map();
    const rows = await tx.exchange.findMany({
      where: { oldSerialUnitId: { in: unitIds }, status: { in: ['PENDING', 'APPROVED'] } },
      select: { oldSerialUnitId: true, exchangeNo: true },
    });
    return new Map(rows.map((row) => [row.oldSerialUnitId, row.exchangeNo]));
  }

  private async lock(tx: TxClient, id: string): Promise<NoteRow> {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM credit_notes WHERE id = ${id}::uuid FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundError('Credit note', id);
    return this.load(tx, id);
  }

  private async load(tx: TxClient, id: string): Promise<NoteRow> {
    const row = await tx.creditNote.findUnique({ where: { id }, include: NOTE_INCLUDE });
    if (!row) throw new NotFoundError('Credit note', id);
    return row;
  }

  private async userNames(tx: TxClient, ids: (string | null)[]): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.flatMap((id) => (id ? [id] : [])))];
    const users = await tx.user.findMany({
      where: { id: { in: wanted } },
      select: { id: true, fullName: true },
    });
    return new Map(users.map((user) => [user.id, user.fullName]));
  }

  private async toDto(tx: TxClient, row: NoteRow): Promise<CreditNote> {
    const names = await this.userNames(tx, [row.createdBy]);
    return {
      id: row.id,
      creditNoteNo: row.creditNoteNo,
      status: row.status as CreditNoteStatusName,
      branchId: row.branchId,
      branchCode: row.branch.code,
      invoiceId: row.invoiceId,
      invoiceNo: row.invoice.invoiceNo,
      customerName: row.invoice.customer.name,
      reason: row.reason,
      taxableValue: money(row.taxableValue),
      cgstAmount: money(row.cgstAmount),
      sgstAmount: money(row.sgstAmount),
      igstAmount: money(row.igstAmount),
      amount: money(row.amount),
      requestedByName: row.createdBy ? (names.get(row.createdBy) ?? null) : null,
      createdAt: row.createdAt.toISOString(),
      decidedByName: row.decider?.fullName ?? null,
      decidedAt: row.decidedAt?.toISOString() ?? null,
      decisionNote: row.decisionNote,
      lines: row.lines.map((line) => ({
        id: line.id,
        invoiceLineId: line.invoiceLineId,
        itemId: line.itemId,
        itemCode: line.item.itemCode,
        itemName: line.item.name,
        serialUnitId: line.serialUnitId,
        serialNo: line.serialUnit?.serialNo ?? null,
        qty: line.qty,
        taxableAmount: money(line.taxableAmount),
        cgstAmount: money(line.cgstAmount),
        sgstAmount: money(line.sgstAmount),
        igstAmount: money(line.igstAmount),
        amount: money(line.amount),
      })),
      rowVersion: row.rowVersion,
    };
  }
}
