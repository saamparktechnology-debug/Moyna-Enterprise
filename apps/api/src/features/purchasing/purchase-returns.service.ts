import { PURCHASE_RETURN_SORT_FIELDS } from '@erp/contracts';
import { Inject, Injectable } from '@nestjs/common';
import {
  CreatePurchaseReturnRequestSchema,
  PurchaseReturnListQuerySchema,
  todayInIndia,
} from '@erp/contracts';
import type { PurchaseReturn, PurchaseReturnListResponse } from '@erp/contracts';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service.js';
import { DocumentNumberService } from '../../common/document-number/document-number.service.js';
import {
  BusinessRuleError,
  NotFoundError,
  ValidationFailedError,
} from '../../common/errors/domain-errors.js';
import { OutboxService } from '../../common/outbox/outbox.service.js';
import { buildPage, toOrderBy, toSkipTake } from '../../common/pagination/pagination.js';
import type { TxClient } from '../../common/prisma/scoped-prisma.service.js';
import { TransactionService } from '../../common/prisma/transaction.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { StockPostingService } from '../stock/stock-posting.service.js';
import { chargedQtyOf, lineProgress, progressOrEmpty } from './purchasing-queries.js';

const RETURN_INCLUDE = {
  branch: true,
  supplier: true,
  po: true,
  lines: {
    include: { item: true, serialUnit: true },
    orderBy: [{ item: { itemCode: 'asc' } }, { serialUnit: { serialNo: 'asc' } }, { id: 'asc' }],
  },
} satisfies Prisma.PurchaseReturnInclude;
type ReturnRow = Prisma.PurchaseReturnGetPayload<{ include: typeof RETURN_INCLUDE }>;

const toDto = (row: ReturnRow): PurchaseReturn => ({
  id: row.id,
  returnNo: row.returnNo,
  branchId: row.branchId,
  branchCode: row.branch.code,
  supplierId: row.supplierId,
  supplierName: row.supplier.name,
  poNo: row.po?.poNo ?? null,
  discrepancyId: row.discrepancyId,
  reason: row.reason,
  returnedOn: row.returnedOn.toISOString().slice(0, 10),
  credit: row.lines
    .reduce((sum, line) => sum.plus(line.unitCost.mul(line.qty)), new Prisma.Decimal(0))
    .toFixed(2),
  lines: row.lines.map((line) => ({
    id: line.id,
    itemId: line.itemId,
    itemCode: line.item.itemCode,
    itemName: line.item.name,
    qty: line.qty,
    serialNo: line.serialUnit?.serialNo ?? null,
    unitCost: line.unitCost.toFixed(2),
  })),
});

export interface ReturnRecordInput {
  branchId: string;
  supplierId: string;
  poId: string | null;
  discrepancyId: string | null;
  reason: string;
  lines: {
    poLineId: string | null;
    itemId: string;
    serialUnitId: string | null;
    qty: number;
    unitCost: Prisma.Decimal;
  }[];
}

@Injectable()
export class PurchaseReturnsService {
  constructor(
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(DocumentNumberService) private readonly numbers: DocumentNumberService,
    @Inject(StockPostingService) private readonly posting: StockPostingService,
  ) {}

  async list(rawQuery: unknown): Promise<PurchaseReturnListResponse> {
    const query = PurchaseReturnListQuerySchema.parse(rawQuery);
    const where: Prisma.PurchaseReturnWhereInput = {
      ...(query.supplierId ? { supplierId: query.supplierId } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {}),
    };
    return this.transactions.run(async (tx) => {
      const [rows, total] = await Promise.all([
        tx.purchaseReturn.findMany({
          where,
          include: RETURN_INCLUDE,
          orderBy: toOrderBy(PURCHASE_RETURN_SORT_FIELDS, query, {
            field: 'createdAt',
            order: 'desc',
          }),
          ...toSkipTake(query),
        }),
        tx.purchaseReturn.count({ where }),
      ]);
      return buildPage(rows.map(toDto), total, query);
    });
  }

  async get(id: string): Promise<PurchaseReturn> {
    return this.transactions.run((tx) => this.load(tx, id));
  }

  /** Sends accepted stock back to the supplier for credit, at the price on the purchase order. */
  async create(auth: AuthContext, body: unknown): Promise<PurchaseReturn> {
    const input = CreatePurchaseReturnRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const locked = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM purchase_orders WHERE id = ${input.poId}::uuid FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundError('Purchase order', input.poId);
      const po = await tx.purchaseOrder.findUniqueOrThrow({
        where: { id: input.poId },
        include: { poLines: { include: { item: true } } },
      });
      const progress = await lineProgress(tx, [po.id]);

      const lines: ReturnRecordInput['lines'] = [];
      for (const line of input.lines) {
        const poLine = po.poLines.find((candidate) => candidate.id === line.poLineId);
        if (!poLine)
          throw new ValidationFailedError('A line is not on this purchase order', [
            { field: 'lines', message: 'Choose lines of this purchase order only' },
          ]);
        const serialized = poLine.item.isSerialized;
        const units = line.serialUnitIds ?? [];
        if (serialized !== units.length > 0)
          throw new ValidationFailedError('The quantity does not suit this item', [
            {
              field: 'lines',
              message: serialized
                ? `${poLine.item.itemCode} is tracked by serial number: choose the units to return`
                : `${poLine.item.itemCode} has no serial numbers: enter how many to return`,
            },
          ]);
        if (!serialized && line.qty === undefined)
          throw new ValidationFailedError('Enter how many to return', [
            { field: 'lines', message: `${poLine.item.itemCode}: enter a quantity` },
          ]);
        if (new Set(units).size !== units.length)
          throw new ValidationFailedError('A unit is listed twice', [
            { field: 'lines', message: `${poLine.item.itemCode}: list each unit once` },
          ]);
        const qty = serialized ? units.length : (line.qty ?? 0);
        const already = await tx.purchaseReturnLine.aggregate({
          where: { poLineId: poLine.id, return: { discrepancyId: null } },
          _sum: { qty: true },
        });
        const returnable =
          chargedQtyOf(progressOrEmpty(progress, poLine.id)) - (already._sum.qty ?? 0);
        if (qty > returnable)
          throw new BusinessRuleError(
            `Only ${Math.max(0, returnable)} of ${poLine.item.itemCode} can still be returned for credit`,
            [
              {
                field: 'lines',
                message: `${poLine.item.itemCode}: ${qty} is more than was bought and kept`,
              },
            ],
          );
        if (serialized)
          for (const unitId of units)
            lines.push({
              poLineId: poLine.id,
              itemId: poLine.itemId,
              serialUnitId: unitId,
              qty: 1,
              unitCost: poLine.unitCost,
            });
        else
          lines.push({
            poLineId: poLine.id,
            itemId: poLine.itemId,
            serialUnitId: null,
            qty,
            unitCost: poLine.unitCost,
          });
      }

      const created = await this.createRecord(tx, auth, {
        branchId: po.branchId,
        supplierId: po.supplierId,
        poId: po.id,
        discrepancyId: null,
        reason: input.reason,
        lines,
      });
      for (const line of lines)
        await this.takeOut(tx, po.branchId, line, 'AVAILABLE', created.id, 'PURCHASE_RETURN');
      await this.audit.record(tx, {
        action: 'PURCHASE_RETURN_CREATED',
        entityType: 'PurchaseReturn',
        entityId: created.id,
        branchId: po.branchId,
        newValue: {
          returnNo: created.returnNo,
          poNo: po.poNo,
          units: lines.reduce((s, l) => s + l.qty, 0),
        },
      });
      await this.outbox.enqueue(tx, {
        eventType: 'purchasing.return.created',
        payload: { returnNo: created.returnNo, poId: po.id },
        branchId: po.branchId,
      });
      return this.load(tx, created.id);
    });
  }

  /** Writes the return document and its lines. The caller moves the stock. */
  async createRecord(
    tx: TxClient,
    auth: AuthContext,
    input: ReturnRecordInput,
  ): Promise<{ id: string; returnNo: string }> {
    const returnNo = await this.numbers.next(tx, {
      branchId: input.branchId,
      docType: 'PURCHASE_RETURN',
    });
    const row = await tx.purchaseReturn.create({
      data: {
        branchId: input.branchId,
        returnNo,
        supplierId: input.supplierId,
        poId: input.poId,
        discrepancyId: input.discrepancyId,
        reason: input.reason,
        returnedOn: new Date(`${todayInIndia()}T00:00:00.000Z`),
        createdBy: auth.userId,
        updatedBy: auth.userId,
        lines: {
          create: input.lines.map((line) => ({
            branchId: input.branchId,
            poLineId: line.poLineId,
            itemId: line.itemId,
            serialUnitId: line.serialUnitId,
            qty: line.qty,
            unitCost: line.unitCost,
            createdBy: auth.userId,
            updatedBy: auth.userId,
          })),
        },
      },
    });
    return { id: row.id, returnNo };
  }

  /** Takes a returned unit or quantity out of stock. A returned serial unit leaves for good, so it is scrapped. */
  async takeOut(
    tx: TxClient,
    branchId: string,
    line: { itemId: string; serialUnitId: string | null; qty: number },
    from: 'AVAILABLE' | 'QUARANTINE',
    sourceId: string,
    sourceType: string,
  ): Promise<void> {
    if (line.serialUnitId)
      await this.posting.moveSerialUnit(tx, {
        unitId: line.serialUnitId,
        branchId,
        from: [from],
        to: 'SCRAPPED',
      });
    await this.posting.post(tx, {
      branchId,
      itemId: line.itemId,
      state: from,
      qtyDelta: -line.qty,
      movementType: 'PURCHASE_RETURN',
      sourceDocType: sourceType,
      sourceDocId: sourceId,
      ...(line.serialUnitId ? { serialUnitId: line.serialUnitId } : {}),
    });
  }

  private async load(tx: TxClient, id: string): Promise<PurchaseReturn> {
    const row = await tx.purchaseReturn.findUnique({ where: { id }, include: RETURN_INCLUDE });
    if (!row) throw new NotFoundError('Purchase return', id);
    return toDto(row);
  }
}
