import { GOODS_RECEIPT_SORT_FIELDS } from '@erp/contracts';
import { Inject, Injectable } from '@nestjs/common';
import { GoodsReceiptListQuerySchema, ReceiveGoodsRequestSchema } from '@erp/contracts';
import type { GoodsReceipt, GoodsReceiptListResponse } from '@erp/contracts';
import type { DiscrepancyType, StockState } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service.js';
import { DocumentNumberService } from '../../common/document-number/document-number.service.js';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationFailedError,
} from '../../common/errors/domain-errors.js';
import { OutboxService } from '../../common/outbox/outbox.service.js';
import { buildPage, toOrderBy, toSkipTake } from '../../common/pagination/pagination.js';
import type { TxClient } from '../../common/prisma/scoped-prisma.service.js';
import { TransactionService } from '../../common/prisma/transaction.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { StockPostingService } from '../stock/stock-posting.service.js';
import { lineProgress, refreshPoStatus, remainingOf } from './purchasing-queries.js';

const RECEIPT_INCLUDE = {
  branch: true,
  receivedByUser: true,
  po: { include: { supplier: true } },
  receiptLines: {
    include: { item: true, discrepancies: { orderBy: [{ type: 'asc' }, { id: 'asc' }] } },
    orderBy: [{ item: { itemCode: 'asc' } }, { createdAt: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.GoodsReceiptInclude;
type ReceiptRow = Prisma.GoodsReceiptGetPayload<{ include: typeof RECEIPT_INCLUDE }>;

type PoWithLines = Prisma.PurchaseOrderGetPayload<{
  include: { poLines: { include: { item: true } } };
}>;
type ReceiveLineInput = ReturnType<typeof ReceiveGoodsRequestSchema.parse>['lines'][number];
type WrongItemInput = ReturnType<typeof ReceiveGoodsRequestSchema.parse>['wrongItems'][number];

const asDate = (value: string | undefined): Date | null =>
  value ? new Date(`${value}T00:00:00.000Z`) : null;

const toDto = (row: ReceiptRow): GoodsReceipt => ({
  id: row.id,
  grnNo: row.grnNo,
  poId: row.poId,
  poNo: row.po?.poNo ?? null,
  branchId: row.branchId,
  branchCode: row.branch.code,
  supplierName: row.po?.supplier.name ?? null,
  receivedAt: row.receivedAt.toISOString(),
  receivedByName: row.receivedByUser.fullName,
  deliveryNoteNo: row.deliveryNoteNo,
  note: row.note,
  lines: row.receiptLines.map((line) => ({
    id: line.id,
    poLineId: line.poLineId,
    itemId: line.itemId,
    itemCode: line.item.itemCode,
    itemName: line.item.name,
    qtyReceived: line.qtyReceived,
    qtyAccepted: line.qtyAccepted,
    discrepancies: line.discrepancies.map((d) => ({
      id: d.id,
      type: d.type,
      qty: d.qty,
      status: d.status,
    })),
  })),
});

interface Source {
  type: 'GOODS_RECEIPT' | 'DISCREPANCY';
  id: string;
}

@Injectable()
export class GoodsReceiptsService {
  constructor(
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(DocumentNumberService) private readonly numbers: DocumentNumberService,
    @Inject(StockPostingService) private readonly posting: StockPostingService,
  ) {}

  async list(rawQuery: unknown): Promise<GoodsReceiptListResponse> {
    const query = GoodsReceiptListQuerySchema.parse(rawQuery);
    const where: Prisma.GoodsReceiptWhereInput = {
      ...(query.poId ? { poId: query.poId } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {}),
    };
    return this.transactions.run(async (tx) => {
      const [rows, total] = await Promise.all([
        tx.goodsReceipt.findMany({
          where,
          include: RECEIPT_INCLUDE,
          orderBy: toOrderBy(GOODS_RECEIPT_SORT_FIELDS, query, {
            field: 'receivedAt',
            order: 'desc',
          }),
          ...toSkipTake(query),
        }),
        tx.goodsReceipt.count({ where }),
      ]);
      return buildPage(
        rows.map((row) => {
          const { lines, ...header } = toDto(row);
          return {
            ...header,
            lineCount: lines.length,
            openDiscrepancies: lines.reduce(
              (sum, line) => sum + line.discrepancies.filter((d) => d.status === 'OPEN').length,
              0,
            ),
          };
        }),
        total,
        query,
      );
    });
  }

  async get(id: string): Promise<GoodsReceipt> {
    return this.transactions.run((tx) => this.load(tx, id));
  }

  /**
   * Receives goods against an approved purchase order. Each line is verified against what the order still expects:
   * good units go to Available; damaged units, units beyond the order and wrong items go to Quarantine with a
   * discrepancy to resolve; a delivery note that promised more than arrived records a short discrepancy.
   */
  async receive(auth: AuthContext, poId: string, body: unknown): Promise<GoodsReceipt> {
    const input = ReceiveGoodsRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const locked = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM purchase_orders WHERE id = ${poId}::uuid FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundError('Purchase order', poId);
      const po = await tx.purchaseOrder.findUniqueOrThrow({
        where: { id: poId },
        include: { poLines: { include: { item: true } } },
      });
      if (po.status === 'DRAFT' || po.status === 'CANCELLED')
        throw new ConflictError(
          po.status === 'DRAFT'
            ? 'Approve the purchase order before receiving goods against it'
            : 'This purchase order is cancelled',
        );
      const branch = await tx.branch.findUniqueOrThrow({ where: { id: po.branchId } });
      if (!branch.isActive) throw new BusinessRuleError('This branch is inactive');

      const grnNo = await this.numbers.next(tx, {
        branchId: po.branchId,
        docType: 'GOODS_RECEIPT',
      });
      const receipt = await tx.goodsReceipt.create({
        data: {
          branchId: po.branchId,
          grnNo,
          poId,
          receivedBy: auth.userId,
          receivedAt: new Date(),
          deliveryNoteNo: input.deliveryNoteNo ?? null,
          note: input.note ?? null,
          createdBy: auth.userId,
          updatedBy: auth.userId,
        },
      });

      const progress = await lineProgress(tx, [poId]);
      for (const line of input.lines)
        await this.receiveLine(
          tx,
          auth,
          po,
          receipt.id,
          line,
          remainingOf(
            po.poLines.find((candidate) => candidate.id === line.poLineId)?.qtyOrdered ?? 0,
            progress.get(line.poLineId),
          ),
        );
      for (const wrong of input.wrongItems)
        await this.receiveWrongItem(tx, auth, po, receipt.id, wrong);

      await refreshPoStatus(tx, poId);
      await this.audit.record(tx, {
        action: 'GOODS_RECEIVED',
        entityType: 'GoodsReceipt',
        entityId: receipt.id,
        branchId: po.branchId,
        newValue: {
          grnNo,
          poNo: po.poNo,
          lines: input.lines.length,
          wrongItems: input.wrongItems.length,
        },
      });
      await this.outbox.enqueue(tx, {
        eventType: 'purchasing.goods_received',
        payload: { grnNo, poId, poNo: po.poNo },
        branchId: po.branchId,
      });
      return this.load(tx, receipt.id);
    });
  }

  private async receiveLine(
    tx: TxClient,
    auth: AuthContext,
    po: PoWithLines,
    receiptId: string,
    line: ReceiveLineInput,
    remaining: number,
  ): Promise<void> {
    const poLine = po.poLines.find((candidate) => candidate.id === line.poLineId);
    if (!poLine)
      throw new ValidationFailedError('A line is not on this purchase order', [
        { field: 'lines', message: 'Choose lines of this purchase order only' },
      ]);
    const item = poLine.item;
    const serialized = item.isSerialized;
    if (serialized !== (line.serials !== undefined))
      throw new ValidationFailedError('The count does not suit this item', [
        {
          field: 'lines',
          message: serialized
            ? `${item.itemCode} is tracked by serial number: enter one serial number per unit`
            : `${item.itemCode} has no serial numbers: enter how many arrived`,
        },
      ]);

    const serials = line.serials ?? [];
    const received = serialized ? serials.length : (line.received ?? 0);
    const within = Math.min(received, remaining);
    const excess = received - within;
    const damaged = serialized
      ? serials.slice(0, within).filter((serial) => serial.damaged).length
      : line.damaged;
    if (damaged > within)
      throw new ValidationFailedError('More units are damaged than the order still expects', [
        {
          field: 'lines',
          message: `${item.itemCode}: ${remaining} still expected, so at most ${remaining} can be counted as damaged`,
        },
      ]);
    const short =
      line.deliveryNoteQty !== undefined && line.deliveryNoteQty > received
        ? line.deliveryNoteQty - received
        : 0;
    if (received === 0 && short === 0)
      throw new ValidationFailedError('Nothing was entered for a line', [
        {
          field: 'lines',
          message: `${item.itemCode}: enter what arrived, or what the delivery note promised`,
        },
      ]);
    const accepted = within - damaged;

    const receiptLine = await tx.receiptLine.create({
      data: {
        branchId: po.branchId,
        receiptId,
        poLineId: poLine.id,
        itemId: item.id,
        qtyReceived: received,
        qtyAccepted: accepted,
        createdBy: auth.userId,
        updatedBy: auth.userId,
      },
    });
    const open = (type: DiscrepancyType, qty: number) =>
      qty > 0 ? this.openDiscrepancy(tx, auth, po.branchId, receiptLine.id, type, qty) : null;
    const damagedRow = await open('DAMAGED', damaged);
    const excessRow = await open('EXCESS', excess);
    await open('SHORT', short);

    const base = { branchId: po.branchId, itemId: item.id };
    if (!serialized) {
      if (accepted > 0)
        await this.stock(tx, base, 'AVAILABLE', accepted, {
          type: 'GOODS_RECEIPT',
          id: receiptLine.id,
        });
      if (damagedRow)
        await this.stock(tx, base, 'QUARANTINE', damaged, {
          type: 'DISCREPANCY',
          id: damagedRow.id,
        });
      if (excessRow)
        await this.stock(tx, base, 'QUARANTINE', excess, { type: 'DISCREPANCY', id: excessRow.id });
      return;
    }
    for (const [index, serial] of serials.entries()) {
      const inOrder = index < within;
      const bad = inOrder && serial.damaged;
      const state: StockState = inOrder && !bad ? 'AVAILABLE' : 'QUARANTINE';
      const source: Source =
        !inOrder && excessRow
          ? { type: 'DISCREPANCY', id: excessRow.id }
          : bad && damagedRow
            ? { type: 'DISCREPANCY', id: damagedRow.id }
            : { type: 'GOODS_RECEIPT', id: receiptLine.id };
      const unitId = await this.posting.createSerialUnit(tx, {
        ...base,
        serialNo: serial.serialNo,
        chassisNo: serial.chassisNo,
        state,
      });
      await this.stock(tx, base, state, 1, source, unitId);
      if (serial.manufacturedOn || serial.expiryOn || serial.warrantyMonths !== undefined)
        await tx.battery.create({
          data: {
            serialUnitId: unitId,
            manufacturedOn: asDate(serial.manufacturedOn),
            expiryOn: asDate(serial.expiryOn),
            warrantyMonths: serial.warrantyMonths ?? null,
            warrantyEnd: null,
          },
        });
    }
  }

  /** An item that was not ordered, or that does not match the order, is held in quarantine until it is sent back. */
  private async receiveWrongItem(
    tx: TxClient,
    auth: AuthContext,
    po: PoWithLines,
    receiptId: string,
    wrong: WrongItemInput,
  ): Promise<void> {
    const item = await tx.item.findUnique({ where: { id: wrong.itemId } });
    if (!item || !item.isActive)
      throw new ValidationFailedError('The item that arrived cannot be recorded', [
        {
          field: 'wrongItems',
          message: item ? `${item.itemCode} is inactive` : 'This item does not exist',
        },
      ]);
    if (item.isSerialized !== (wrong.serials !== undefined))
      throw new ValidationFailedError('The count does not suit this item', [
        {
          field: 'wrongItems',
          message: item.isSerialized
            ? `${item.itemCode} is tracked by serial number: give one per unit`
            : `${item.itemCode} has no serial numbers`,
        },
      ]);
    const receiptLine = await tx.receiptLine.create({
      data: {
        branchId: po.branchId,
        receiptId,
        poLineId: null,
        itemId: item.id,
        qtyReceived: wrong.qty,
        qtyAccepted: 0,
        createdBy: auth.userId,
        updatedBy: auth.userId,
      },
    });
    const discrepancy = await this.openDiscrepancy(
      tx,
      auth,
      po.branchId,
      receiptLine.id,
      'WRONG_ITEM',
      wrong.qty,
    );
    const base = { branchId: po.branchId, itemId: item.id };
    const source: Source = { type: 'DISCREPANCY', id: discrepancy.id };
    if (!wrong.serials) {
      await this.stock(tx, base, 'QUARANTINE', wrong.qty, source);
      return;
    }
    for (const serial of wrong.serials) {
      const unitId = await this.posting.createSerialUnit(tx, {
        ...base,
        serialNo: serial.serialNo,
        chassisNo: serial.chassisNo,
        state: 'QUARANTINE',
      });
      await this.stock(tx, base, 'QUARANTINE', 1, source, unitId);
    }
  }

  private openDiscrepancy(
    tx: TxClient,
    auth: AuthContext,
    branchId: string,
    receiptLineId: string,
    type: DiscrepancyType,
    qty: number,
  ) {
    return tx.discrepancy.create({
      data: { branchId, receiptLineId, type, qty, createdBy: auth.userId, updatedBy: auth.userId },
    });
  }

  private stock(
    tx: TxClient,
    base: { branchId: string; itemId: string },
    state: StockState,
    qty: number,
    source: Source,
    serialUnitId?: string,
  ): Promise<void> {
    return this.posting.post(tx, {
      ...base,
      state,
      qtyDelta: qty,
      movementType: 'PURCHASE_RECEIPT',
      sourceDocType: source.type,
      sourceDocId: source.id,
      ...(serialUnitId ? { serialUnitId } : {}),
    });
  }

  private async load(tx: TxClient, id: string): Promise<GoodsReceipt> {
    const row = await tx.goodsReceipt.findUnique({ where: { id }, include: RECEIPT_INCLUDE });
    if (!row) throw new NotFoundError('Goods receipt', id);
    return toDto(row);
  }
}
