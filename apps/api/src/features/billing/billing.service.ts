import { Inject, Injectable } from '@nestjs/common';
import {
  CancelInvoiceRequestSchema,
  ConvertQuotationRequestSchema,
  CreateInvoiceRequestSchema,
  DiscardInvoiceRequestSchema,
  INVOICE_SORT_FIELDS,
  InvoiceListQuerySchema,
  IssueInvoiceRequestSchema,
  PreviewInvoiceRequestSchema,
  ReissueInvoiceRequestSchema,
  UpdateInvoiceRequestSchema,
  todayInIndia,
} from '@erp/contracts';
import type {
  ErrorDetail,
  Invoice,
  InvoiceLine,
  InvoiceListResponse,
  InvoicePreview,
  InvoiceTypeName,
} from '@erp/contracts';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service.js';
import { OutboxService } from '../../common/outbox/outbox.service.js';
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
import {
  buildPage,
  escapeLike,
  toOrderBy,
  toSkipTake,
} from '../../common/pagination/pagination.js';
import type { TxClient } from '../../common/prisma/scoped-prisma.service.js';
import { TransactionService } from '../../common/prisma/transaction.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { BatteriesService } from '../batteries/batteries.service.js';
import { CommissionsService } from '../brokers/commissions.service.js';
import { QuotationsService } from '../quotations/quotations.service.js';
import { StockPostingService } from '../stock/stock-posting.service.js';
import { INVOICE_INCLUDE, invoiceSnapshot, toInvoiceDto, toSummaryDto } from './billing.mapper.js';
import type { InvoiceRow } from './billing.mapper.js';
import { calculateInvoice, isInterState } from './invoice-calc.js';
import { buildInvoicePdf } from './invoice-pdf.js';
import type { CalcResult } from './invoice-calc.js';

type BodyInput = ReturnType<typeof CreateInvoiceRequestSchema.parse>;
type LineInput = BodyInput['lines'][number];

interface Prepared {
  branch: { id: string; code: string; gstin: string | null; stateCode: string };
  customer: { id: string; name: string; gstin: string | null; stateCode: string | null };
  type: InvoiceTypeName;
  placeOfSupply: string | null;
  interState: boolean;
  lines: {
    input: LineInput;
    item: {
      id: string;
      itemCode: string;
      name: string;
      unitCode: string;
      hsnCode: string | null;
      taxRate: Prisma.Decimal | null;
    };
    serialNo: string | null;
  }[];
  calc: CalcResult;
}

const parseIsoDate = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
const money = (value: { toFixed: (places: number) => string }): string => value.toFixed(2);

@Injectable()
export class BillingService {
  constructor(
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(DocumentNumberService) private readonly documents: DocumentNumberService,
    @Inject(StockPostingService) private readonly posting: StockPostingService,
    @Inject(BatteriesService) private readonly batteries: BatteriesService,
    @Inject(BranchContextService) private readonly contexts: BranchContextService,
    @Inject(CommissionsService) private readonly commissions: CommissionsService,
    @Inject(QuotationsService) private readonly quotations: QuotationsService,
  ) {}

  // ---------- reading ----------

  async list(rawQuery: unknown): Promise<InvoiceListResponse> {
    const query = InvoiceListQuerySchema.parse(rawQuery);
    const filters: Prisma.InvoiceWhereInput[] = [];
    if (query.status !== 'all') filters.push({ status: query.status });
    if (query.type !== 'all') filters.push({ type: query.type });
    if (query.customerId) filters.push({ customerId: query.customerId });
    if (query.branchId) filters.push({ branchId: query.branchId });
    if (query.from) filters.push({ issuedOn: { gte: parseIsoDate(query.from) } });
    if (query.to) filters.push({ issuedOn: { lte: parseIsoDate(query.to) } });
    const search = query.search?.trim();
    if (search) {
      const like = { contains: escapeLike(search), mode: 'insensitive' as const };
      filters.push({ OR: [{ invoiceNo: like }, { customer: { name: like } }] });
    }
    const where: Prisma.InvoiceWhereInput = { AND: filters };
    const orderBy = toOrderBy(INVOICE_SORT_FIELDS, query, { field: 'createdAt', order: 'desc' });
    return this.transactions.run(async (tx) => {
      const [rows, total] = await Promise.all([
        tx.invoice.findMany({
          where,
          orderBy,
          include: { branch: true, customer: true, _count: { select: { invoiceLines: true } } },
          ...toSkipTake(query),
        }),
        tx.invoice.count({ where }),
      ]);
      return buildPage(rows.map(toSummaryDto), total, query);
    });
  }

  async get(id: string): Promise<Invoice> {
    return this.transactions.run(async (tx) => toInvoiceDto(await this.load(tx, id)));
  }

  async preview(body: unknown): Promise<InvoicePreview> {
    const input = PreviewInvoiceRequestSchema.parse(body);
    const branchId = this.resolveBranch(input.branchId);
    return this.transactions.run(async (tx) => {
      const prepared = await this.prepare(tx, branchId, input);
      return {
        interState: prepared.interState,
        placeOfSupply: prepared.placeOfSupply,
        ...this.totals(prepared.calc),
        lines: this.previewLines(prepared),
      };
    });
  }

  async pdf(id: string): Promise<{ body: Buffer; fileName: string }> {
    return this.transactions.run(async (tx) => {
      const row = await this.load(tx, id);
      const invoice = toInvoiceDto(row);
      const body = buildInvoicePdf(invoice, row.branch.name);
      const label = (row.invoiceNo ?? `draft-${row.id.slice(0, 8)}`).replace(
        /[^A-Za-z0-9._-]/g,
        '-',
      );
      return { body, fileName: `${label}.pdf` };
    });
  }

  // ---------- drafts ----------

  async createDraft(auth: AuthContext, body: unknown): Promise<Invoice> {
    const input = CreateInvoiceRequestSchema.parse(body);
    const branchId = this.resolveBranch(input.branchId);
    return this.transactions.run(async (tx) => {
      const row = await this.insertDraft(tx, auth, branchId, input, null);
      await this.audit.record(tx, {
        action: 'INVOICE_DRAFT_CREATED',
        entityType: 'Invoice',
        entityId: row.id,
        branchId,
        newValue: invoiceSnapshot(row),
      });
      return toInvoiceDto(row);
    });
  }

  async updateDraft(auth: AuthContext, id: string, body: unknown): Promise<Invoice> {
    const input = UpdateInvoiceRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const current = await this.lock(tx, id);
      this.assertVersion(current, input.rowVersion);
      this.assertDraft(current, 'edited');
      if (current.quotationId)
        await this.quotations.assertInvoiceMatches(tx, current.quotationId, input);
      const prepared = await this.prepare(tx, current.branchId, input);
      await this.commissions.assertUsable(tx, input.brokerId);
      await this.clearLines(tx, id);
      await tx.invoiceLine.createMany({
        data: this.lineRows(prepared, id, current.branchId, auth.userId),
      });
      await tx.invoice.update({
        where: { id },
        data: {
          customerId: input.customerId,
          type: input.type,
          brokerId: input.brokerId,
          dueDate: input.dueDate ? parseIsoDate(input.dueDate) : null,
          ...this.headerData(prepared),
          updatedBy: auth.userId,
        },
      });
      const row = await this.reload(tx, id);
      await this.audit.record(tx, {
        action: 'INVOICE_DRAFT_UPDATED',
        entityType: 'Invoice',
        entityId: id,
        branchId: current.branchId,
        oldValue: invoiceSnapshot(current),
        newValue: invoiceSnapshot(row),
      });
      return toInvoiceDto(row);
    });
  }

  async discardDraft(auth: AuthContext, id: string, body: unknown): Promise<void> {
    const input = DiscardInvoiceRequestSchema.parse(body);
    await this.transactions.run(async (tx) => {
      const current = await this.lock(tx, id);
      this.assertVersion(current, input.rowVersion);
      this.assertDraft(current, 'discarded');
      await this.discard(tx, id);
      await this.audit.record(tx, {
        action: 'INVOICE_DRAFT_DISCARDED',
        entityType: 'Invoice',
        entityId: id,
        branchId: current.branchId,
        oldValue: invoiceSnapshot(current),
      });
    });
  }

  // ---------- issuing ----------

  /**
   * Makes a draft invoice from an accepted quotation, at the quoted prices and with the vehicles set aside for it. The
   * invoice is then issued like any other; at that point the advances are applied and the order must be paid for.
   */
  async convertFromQuotation(auth: AuthContext, body: unknown): Promise<Invoice> {
    const input = ConvertQuotationRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const { quotation, lines } = await this.quotations.loadForConversion(
        tx,
        input.quotationId,
        input.rowVersion,
      );
      const draft = await this.insertDraft(
        tx,
        auth,
        quotation.branchId,
        {
          customerId: quotation.customerId,
          type: quotation.type as InvoiceTypeName,
          dueDate: input.dueDate,
          brokerId: quotation.brokerId,
          lines: lines.map((line) => ({
            itemId: line.itemId,
            qty: line.qty,
            unitPrice: money(line.unitPrice),
            discountAmount: money(line.discountAmount),
            ...(line.serialUnitId ? { serialUnitId: line.serialUnitId } : {}),
          })),
        },
        null,
        quotation.id,
      );
      await this.audit.record(tx, {
        action: 'INVOICE_DRAFT_FROM_QUOTATION',
        entityType: 'Invoice',
        entityId: draft.id,
        branchId: quotation.branchId,
        newValue: { quotationId: quotation.id, quotationNo: quotation.quotationNo },
      });
      return toInvoiceDto(draft);
    });
  }

  async issue(auth: AuthContext, id: string, body: unknown): Promise<Invoice> {
    const input = IssueInvoiceRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      // An invoice that delivers a quotation takes the customer first, then the invoice, as every path that touches both does.
      const peek = await tx.invoice.findUnique({
        where: { id },
        select: { quotationId: true, customerId: true },
      });
      if (peek?.quotationId)
        await tx.$queryRaw`SELECT id FROM customers WHERE id = ${peek.customerId}::uuid FOR UPDATE`;
      const current = await this.lock(tx, id);
      this.assertVersion(current, input.rowVersion);
      this.assertDraft(current, 'issued');

      const prepared = await this.prepare(tx, current.branchId, {
        customerId: current.customerId,
        type: current.type as InvoiceTypeName,
        lines: current.invoiceLines.map((line) => ({
          itemId: line.itemId,
          qty: line.qty,
          unitPrice: money(line.unitPrice),
          discountAmount: money(line.discountAmount),
          ...(line.serialUnitId ? { serialUnitId: line.serialUnitId } : {}),
        })),
      });
      this.assertMayIssue(auth, prepared);

      const today = todayInIndia();
      if (current.dueDate && current.dueDate.toISOString().slice(0, 10) < today)
        throw new ValidationFailedError('The due date has passed', [
          { field: 'dueDate', message: 'The due date cannot be before today' },
        ]);

      const invoiceNo = await this.documents.next(tx, {
        branchId: current.branchId,
        docType: prepared.type === 'GST' ? 'INVOICE_GST' : 'INVOICE_NON_GST',
      });
      await this.clearLines(tx, id);
      await tx.invoiceLine.createMany({
        data: this.lineRows(prepared, id, current.branchId, auth.userId),
      });

      const ordered = [...prepared.lines].sort((a, b) =>
        `${a.input.itemId}${a.input.serialUnitId ?? ''}`.localeCompare(
          `${b.input.itemId}${b.input.serialUnitId ?? ''}`,
        ),
      );
      for (const line of ordered) {
        if (line.input.serialUnitId)
          await this.sellSerialUnit(
            tx,
            auth,
            current.branchId,
            id,
            line.input.serialUnitId,
            input.overrideReason,
            today,
          );
        else
          await this.posting.post(tx, {
            branchId: current.branchId,
            itemId: line.input.itemId,
            state: 'AVAILABLE',
            qtyDelta: -line.input.qty,
            movementType: 'SALE',
            sourceDocId: id,
            sourceDocType: 'INVOICE',
          });
      }

      await tx.invoice.update({
        where: { id },
        data: {
          status: 'ISSUED',
          invoiceNo,
          issuedOn: parseIsoDate(today),
          ...this.headerData(prepared),
          updatedBy: auth.userId,
        },
      });
      const row = await this.reload(tx, id);
      await this.commissions.accrue(tx, auth, row);
      await this.quotations.onInvoiceIssued(tx, auth, row, {
        unpaidDeliveryReason: input.unpaidDeliveryReason,
      });
      await this.audit.record(tx, {
        action: 'INVOICE_ISSUED',
        entityType: 'Invoice',
        entityId: id,
        branchId: current.branchId,
        oldValue: { status: 'DRAFT' },
        newValue: {
          ...invoiceSnapshot(row),
          discountApproved: prepared.calc.lines.some((line) => line.needsDiscountApproval),
        },
      });
      await this.outbox.enqueue(tx, {
        eventType: 'invoice.issued',
        branchId: current.branchId,
        payload: {
          invoiceId: id,
          invoiceNo,
          customerId: row.customerId,
          total: money(row.total),
          issuedBy: auth.userId,
        },
      });
      return toInvoiceDto(row);
    });
  }

  // ---------- cancelling ----------

  async cancel(auth: AuthContext, id: string, body: unknown): Promise<Invoice> {
    const input = CancelInvoiceRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const row = await this.cancelInTx(tx, auth, id, input.rowVersion, input.reason);
      return toInvoiceDto(row);
    });
  }

  /** Cancels the invoice and puts a draft with the same lines in its place, so it can be corrected and issued again. */
  async reissue(auth: AuthContext, id: string, body: unknown): Promise<Invoice> {
    const input = ReissueInvoiceRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const cancelled = await this.cancelInTx(tx, auth, id, input.rowVersion, input.reason);
      const draft = await this.insertDraft(
        tx,
        auth,
        cancelled.branchId,
        {
          customerId: cancelled.customerId,
          type: cancelled.type as InvoiceTypeName,
          dueDate: null,
          brokerId: await this.commissions.usableOrNull(tx, cancelled.brokerId),
          lines: cancelled.invoiceLines.map((line) => ({
            itemId: line.itemId,
            qty: line.qty,
            unitPrice: money(line.unitPrice),
            discountAmount: money(line.discountAmount),
            ...(line.serialUnitId ? { serialUnitId: line.serialUnitId } : {}),
          })),
        },
        cancelled.id,
        cancelled.quotationId,
      );
      await this.audit.record(tx, {
        action: 'INVOICE_REISSUED',
        entityType: 'Invoice',
        entityId: draft.id,
        branchId: cancelled.branchId,
        newValue: { replaces: cancelled.invoiceNo, reason: input.reason },
      });
      return toInvoiceDto(draft);
    });
  }

  private async cancelInTx(
    tx: TxClient,
    auth: AuthContext,
    id: string,
    rowVersion: number,
    reason: string,
  ): Promise<InvoiceRow> {
    const current = await this.lock(tx, id);
    this.assertVersion(current, rowVersion);
    if (current.status !== 'ISSUED')
      throw new InvalidStateError('The invoice', current.status, 'CANCELLED');

    const [payments, creditNotes, exchanges] = await Promise.all([
      tx.paymentAllocation.count({ where: { invoiceId: id, payment: { reversal: null } } }),
      tx.creditNote.count({ where: { invoiceId: id, status: { in: ['PENDING', 'APPROVED'] } } }),
      tx.exchange.count({
        where: {
          OR: [{ invoiceId: id }, { originalInvoiceId: id }],
          status: { in: ['PENDING', 'APPROVED'] },
        },
      }),
    ]);
    if (payments > 0)
      throw new BusinessRuleError('This invoice has payments against it', [
        { field: 'invoice', message: 'Reverse the payments before cancelling the invoice' },
      ]);
    if (creditNotes > 0)
      throw new BusinessRuleError('This invoice has credit notes against it', [
        { field: 'invoice', message: 'An invoice with a credit note cannot be cancelled' },
      ]);
    if (exchanges > 0)
      throw new BusinessRuleError('This invoice has an exchange against it', [
        { field: 'invoice', message: 'An invoice with an exchange cannot be cancelled' },
      ]);

    for (const line of current.invoiceLines) {
      if (line.serialUnitId)
        await this.restoreSerialUnit(tx, current.branchId, id, line.serialUnitId);
      else
        await this.posting.post(tx, {
          branchId: current.branchId,
          itemId: line.itemId,
          state: 'AVAILABLE',
          qtyDelta: line.qty,
          movementType: 'SALE_RETURN',
          sourceDocId: id,
          sourceDocType: 'INVOICE',
        });
    }
    await tx.invoice.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancelledAt: new Date(),
        cancelledBy: auth.userId,
        cancelReason: reason,
        updatedBy: auth.userId,
      },
    });
    const row = await this.reload(tx, id);
    await this.commissions.reverseForCancellation(tx, auth, id);
    await this.quotations.onInvoiceCancelled(tx, auth, row);
    await this.audit.record(tx, {
      action: 'INVOICE_CANCELLED',
      entityType: 'Invoice',
      entityId: id,
      branchId: current.branchId,
      oldValue: { status: 'ISSUED' },
      newValue: { status: 'CANCELLED', invoiceNo: current.invoiceNo, reason },
    });
    await this.outbox.enqueue(tx, {
      eventType: 'invoice.cancelled',
      branchId: current.branchId,
      payload: {
        invoiceId: id,
        invoiceNo: current.invoiceNo,
        customerId: current.customerId,
        total: money(current.total),
        cancelledBy: auth.userId,
      },
    });
    return row;
  }

  // ---------- stock ----------

  /** Sells one serial unit. A vehicle takes the batteries installed in it along, and a battery's warranty starts today. */
  private async sellSerialUnit(
    tx: TxClient,
    auth: AuthContext,
    branchId: string,
    invoiceId: string,
    unitId: string,
    overrideReason: string | undefined,
    today: string,
  ): Promise<void> {
    await this.moveOneUnit(
      tx,
      auth,
      branchId,
      invoiceId,
      unitId,
      'AVAILABLE',
      overrideReason,
      today,
    );
    const installed = await tx.battery.findMany({
      where: { installedInSerialUnitId: unitId },
      select: { serialUnitId: true },
      orderBy: { serialUnitId: 'asc' },
    });
    for (const battery of installed)
      await this.moveOneUnit(
        tx,
        auth,
        branchId,
        invoiceId,
        battery.serialUnitId,
        'RESERVED',
        overrideReason,
        today,
      );
  }

  private async moveOneUnit(
    tx: TxClient,
    auth: AuthContext,
    branchId: string,
    invoiceId: string,
    unitId: string,
    from: 'AVAILABLE' | 'RESERVED',
    overrideReason: string | undefined,
    today: string,
  ): Promise<void> {
    const unit = await tx.serialUnit.findUnique({
      where: { id: unitId },
      select: { itemId: true },
    });
    if (!unit) throw new NotFoundError('Serial unit', unitId);
    await this.batteries.assertSellable(tx, auth, unitId, overrideReason);
    const current = await tx.serialUnit.findUnique({
      where: { id: unitId },
      select: { serialNo: true, state: true },
    });
    if (current && current.state !== from)
      throw new BusinessRuleError(
        `Serial number ${current.serialNo} is not available to sell (it is ${current.state.toLowerCase()})`,
        [{ field: 'serialUnitId', message: `This unit is ${current.state.toLowerCase()}` }],
      );
    await this.posting.moveSerialUnit(tx, { unitId, branchId, from: [from], to: 'SOLD' });
    await this.posting.post(tx, {
      branchId,
      itemId: unit.itemId,
      state: from,
      qtyDelta: -1,
      movementType: 'SALE',
      serialUnitId: unitId,
      sourceDocId: invoiceId,
      sourceDocType: 'INVOICE',
    });
    await this.batteries.startWarranty(tx, unitId, today);
  }

  private async restoreSerialUnit(
    tx: TxClient,
    branchId: string,
    invoiceId: string,
    unitId: string,
  ): Promise<void> {
    await this.moveBackOneUnit(tx, branchId, invoiceId, unitId, 'AVAILABLE');
    const installed = await tx.battery.findMany({
      where: { installedInSerialUnitId: unitId, serialUnit: { state: 'SOLD' } },
      select: { serialUnitId: true },
      orderBy: { serialUnitId: 'asc' },
    });
    for (const battery of installed)
      await this.moveBackOneUnit(tx, branchId, invoiceId, battery.serialUnitId, 'RESERVED');
  }

  private async moveBackOneUnit(
    tx: TxClient,
    branchId: string,
    invoiceId: string,
    unitId: string,
    to: 'AVAILABLE' | 'RESERVED',
  ): Promise<void> {
    const unit = await tx.serialUnit.findUnique({
      where: { id: unitId },
      select: { itemId: true },
    });
    if (!unit) throw new NotFoundError('Serial unit', unitId);
    await this.posting.moveSerialUnit(tx, { unitId, branchId, from: ['SOLD'], to });
    await this.posting.post(tx, {
      branchId,
      itemId: unit.itemId,
      state: to,
      qtyDelta: 1,
      movementType: 'SALE_RETURN',
      serialUnitId: unitId,
      sourceDocId: invoiceId,
      sourceDocType: 'INVOICE',
    });
    await tx.battery.updateMany({ where: { serialUnitId: unitId }, data: { warrantyEnd: null } });
  }

  // ---------- building an invoice ----------

  /** Loads everything an invoice depends on and works the money out. Nothing the client sends about price is trusted beyond the unit price and discount, which items do not carry. */
  private async prepare(
    tx: TxClient,
    branchId: string,
    input: Pick<BodyInput, 'customerId' | 'type' | 'lines'>,
  ): Promise<Prepared> {
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
    const units = await tx.serialUnit.findMany({
      where: {
        id: { in: input.lines.flatMap((line) => (line.serialUnitId ? [line.serialUnitId] : [])) },
      },
    });
    const unitById = new Map(units.map((unit) => [unit.id, unit]));

    const lines = input.lines.map((line, index) => {
      const item = byId.get(line.itemId);
      const at = (field: string, message: string) =>
        problems.push({ field: `lines.${index}.${field}`, message });
      if (!item || !item.isActive) {
        at('itemId', 'Choose an active item');
        return null;
      }
      let serialNo: string | null = null;
      if (item.isSerialized && !line.serialUnitId)
        at('serialUnitId', 'Choose the serial number being sold');
      if (!item.isSerialized && line.serialUnitId)
        at('serialUnitId', 'This item is not tracked by serial number');
      if (line.serialUnitId) {
        const unit = unitById.get(line.serialUnitId);
        if (!unit || unit.itemId !== item.id || unit.branchId !== branchId)
          at('serialUnitId', 'This serial number is not in stock in this branch');
        else serialNo = unit.serialNo;
      }
      if (input.type === 'GST' && item.taxRate === null)
        at('itemId', `${item.itemCode} has no GST rate`);
      return { input: line, item, serialNo };
    });
    if (problems.length > 0) throw new ValidationFailedError('The invoice has problems', problems);

    const prepared = lines.flatMap((line) => (line ? [line] : []));
    const placeOfSupply = input.type === 'GST' ? (customer.stateCode ?? branch.stateCode) : null;
    const interState = placeOfSupply ? isInterState(branch.stateCode, placeOfSupply) : false;
    const calc = calculateInvoice(
      prepared.map((line) => ({
        qty: line.input.qty,
        unitPrice: line.input.unitPrice,
        discountAmount: line.input.discountAmount ?? '0',
        taxRate: line.item.taxRate,
      })),
      { type: input.type, interState },
    );
    return {
      branch: {
        id: branch.id,
        code: branch.code,
        gstin: branch.gstin,
        stateCode: branch.stateCode,
      },
      customer: {
        id: customer.id,
        name: customer.name,
        gstin: customer.gstin,
        stateCode: customer.stateCode,
      },
      type: input.type,
      placeOfSupply,
      interState,
      lines: prepared.map((line) => ({
        input: line.input,
        item: line.item,
        serialNo: line.serialNo,
      })),
      calc,
    };
  }

  private assertMayIssue(auth: AuthContext, prepared: Prepared): void {
    if (prepared.type === 'GST' && !prepared.branch.gstin)
      throw new BusinessRuleError('This branch has no GSTIN, so it cannot issue a GST invoice', [
        { field: 'type', message: `Add a GSTIN to branch ${prepared.branch.code} first` },
      ]);
    const flagged = prepared.calc.lines.flatMap((line, index) =>
      line.needsDiscountApproval ? [index] : [],
    );
    if (flagged.length > 0 && !auth.permissions.includes('discounts.approve'))
      throw new ForbiddenError(
        'A discount is above what staff may give. Ask a manager to issue this invoice, or lower the discount',
      );
  }

  private totals(calc: CalcResult) {
    return {
      subtotal: money(calc.subtotal),
      discountTotal: money(calc.discountTotal),
      taxableValue: money(calc.taxableValue),
      cgstAmount: money(calc.cgst),
      sgstAmount: money(calc.sgst),
      igstAmount: money(calc.igst),
      roundOff: money(calc.roundOff),
      total: money(calc.total),
    };
  }

  private headerData(prepared: Prepared) {
    const gst = prepared.type === 'GST';
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
      branchGstin: gst ? prepared.branch.gstin : null,
      customerGstin: gst ? prepared.customer.gstin : null,
    };
  }

  private lineRows(
    prepared: Prepared,
    invoiceId: string,
    branchId: string,
    userId: string,
  ): Prisma.InvoiceLineCreateManyInput[] {
    const gst = prepared.type === 'GST';
    return prepared.lines.map((line, index) => {
      const calc = prepared.calc.lines[index];
      if (!calc) throw new Error('A line was not calculated');
      return {
        branchId,
        invoiceId,
        lineNo: index + 1,
        itemId: line.item.id,
        serialUnitId: line.input.serialUnitId ?? null,
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

  private previewLines(prepared: Prepared): InvoiceLine[] {
    return prepared.lines.map((line, index) => {
      const calc = prepared.calc.lines[index];
      if (!calc) throw new Error('A line was not calculated');
      const gst = prepared.type === 'GST';
      return {
        id: null,
        itemId: line.item.id,
        itemCode: line.item.itemCode,
        itemName: line.item.name,
        unitCode: line.item.unitCode,
        hsnCode: gst ? line.item.hsnCode : null,
        taxRate: gst && line.item.taxRate ? money(line.item.taxRate) : null,
        qty: line.input.qty,
        unitPrice: money(new Prisma.Decimal(line.input.unitPrice)),
        discountAmount: money(calc.discount),
        taxableAmount: money(calc.taxable),
        cgstAmount: money(calc.cgst),
        sgstAmount: money(calc.sgst),
        igstAmount: money(calc.igst),
        amount: money(calc.amount),
        serialUnitId: line.input.serialUnitId ?? null,
        serialNo: line.serialNo,
      };
    });
  }

  private async insertDraft(
    tx: TxClient,
    auth: AuthContext,
    branchId: string,
    input: BodyInput,
    replacesInvoiceId: string | null,
    quotationId: string | null = null,
  ): Promise<InvoiceRow> {
    const prepared = await this.prepare(tx, branchId, input);
    await this.commissions.assertUsable(tx, input.brokerId);
    const created = await tx.invoice.create({
      data: {
        branchId,
        customerId: input.customerId,
        type: input.type,
        brokerId: input.brokerId,
        status: 'DRAFT',
        dueDate: input.dueDate ? parseIsoDate(input.dueDate) : null,
        replacesInvoiceId,
        quotationId,
        ...this.headerData(prepared),
        createdBy: auth.userId,
        updatedBy: auth.userId,
      },
    });
    await tx.invoiceLine.createMany({
      data: this.lineRows(prepared, created.id, branchId, auth.userId),
    });
    return this.reload(tx, created.id);
  }

  // ---------- small helpers ----------

  private assertVersion(row: InvoiceRow, rowVersion: number): void {
    if (row.rowVersion !== rowVersion)
      throw new ConflictError('This invoice was changed by someone else. Reload it and try again');
  }

  /** Editing or issuing a document that has moved on is a conflict; asking to discard one is a rule it breaks. */
  private assertDraft(row: InvoiceRow, action: 'edited' | 'discarded' | 'issued'): void {
    if (row.status === 'DRAFT') return;
    const details = [{ field: 'status', message: `This invoice is ${row.status.toLowerCase()}` }];
    if (action === 'discarded')
      throw new BusinessRuleError(`Only a draft can be ${action}`, details);
    throw new ConflictError(`Only a draft can be ${action}`, details);
  }

  /** The application cannot delete rows itself, so replacing the lines of a draft goes through a guarded database function. */
  private async clearLines(tx: TxClient, id: string): Promise<void> {
    const rows = await tx.$queryRaw<
      { ok: boolean }[]
    >`SELECT clear_invoice_draft_lines(${id}::uuid) AS ok`;
    if (!rows[0]?.ok) throw new NotFoundError('Invoice', id);
  }

  private async discard(tx: TxClient, id: string): Promise<void> {
    const rows = await tx.$queryRaw<
      { ok: boolean }[]
    >`SELECT discard_invoice_draft(${id}::uuid) AS ok`;
    if (!rows[0]?.ok) throw new NotFoundError('Invoice', id);
  }

  private async lock(tx: TxClient, id: string): Promise<InvoiceRow> {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM invoices WHERE id = ${id}::uuid FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundError('Invoice', id);
    return this.reload(tx, id);
  }

  private async load(tx: TxClient, id: string): Promise<InvoiceRow> {
    const row = await tx.invoice.findUnique({ where: { id }, include: INVOICE_INCLUDE });
    if (!row) throw new NotFoundError('Invoice', id);
    return row;
  }

  private reload(tx: TxClient, id: string): Promise<InvoiceRow> {
    return tx.invoice.findUniqueOrThrow({ where: { id }, include: INVOICE_INCLUDE });
  }

  private resolveBranch(requested: string | undefined): string {
    if (requested) return requested;
    const context = this.contexts.require();
    const only = context.branchIds[0];
    if (!context.isSuperAdmin && context.branchIds.length === 1 && only) return only;
    throw new ValidationFailedError('Choose the branch for this invoice', [
      { field: 'branchId', message: 'Choose a branch' },
    ]);
  }
}
