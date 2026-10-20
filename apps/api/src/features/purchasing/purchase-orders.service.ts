import { Inject, Injectable } from '@nestjs/common';
import {
  ApprovePurchaseOrderRequestSchema,
  CancelPurchaseOrderRequestSchema,
  CreatePurchaseOrderRequestSchema,
  PO_SORT_FIELDS,
  PurchaseOrderListQuerySchema,
  UpdatePurchaseOrderRequestSchema,
  todayInIndia,
} from '@erp/contracts';
import type {
  PurchaseOrder,
  PurchaseOrderListResponse,
  PurchaseOrderSummary,
} from '@erp/contracts';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service.js';
import { BranchContextService } from '../../common/branch-context/branch-context.service.js';
import { DocumentNumberService } from '../../common/document-number/document-number.service.js';
import {
  BusinessRuleError,
  ConflictError,
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
import { lineProgress, progressOrEmpty, remainingOf, acceptedOf } from './purchasing-queries.js';
import type { LineProgress } from './purchasing-queries.js';

export const PO_INCLUDE = {
  branch: true,
  supplier: true,
  // Lines of one order are created together and share a timestamp, so they are listed by item code.
  poLines: { include: { item: true }, orderBy: [{ item: { itemCode: 'asc' } }, { id: 'asc' }] },
  _count: { select: { goodsReceipts: true } },
} satisfies Prisma.PurchaseOrderInclude;
type PoRow = Prisma.PurchaseOrderGetPayload<{ include: typeof PO_INCLUDE }>;

const asDate = (value: string): Date => new Date(`${value}T00:00:00.000Z`);
const asDay = (value: Date): string => value.toISOString().slice(0, 10);

export function toPurchaseOrderDto(po: PoRow, progress: Map<string, LineProgress>): PurchaseOrder {
  const lines = po.poLines.map((line) => {
    const p = progressOrEmpty(progress, line.id);
    return {
      id: line.id,
      itemId: line.itemId,
      itemCode: line.item.itemCode,
      itemName: line.item.name,
      unitCode: line.item.unitCode,
      isSerialized: line.item.isSerialized,
      qtyOrdered: line.qtyOrdered,
      unitCost: line.unitCost.toFixed(2),
      lineTotal: line.unitCost.mul(line.qtyOrdered).toFixed(2),
      accepted: acceptedOf(p),
      closed: p.writtenOff,
      remaining: remainingOf(line.qtyOrdered, p),
    };
  });
  const total = po.poLines.reduce(
    (sum, line) => sum.plus(line.unitCost.mul(line.qtyOrdered)),
    new Prisma.Decimal(0),
  );
  return {
    id: po.id,
    poNo: po.poNo,
    branchId: po.branchId,
    branchCode: po.branch.code,
    supplierId: po.supplierId,
    supplierName: po.supplier.name,
    status: po.status,
    orderDate: asDay(po.orderDate),
    total: total.toFixed(2),
    orderedQty: lines.reduce((sum, line) => sum + line.qtyOrdered, 0),
    remainingQty:
      po.status === 'DRAFT' || po.status === 'CANCELLED'
        ? 0
        : lines.reduce((sum, line) => sum + line.remaining, 0),
    receiptCount: po._count.goodsReceipts,
    lines,
    rowVersion: po.rowVersion,
  };
}

@Injectable()
export class PurchaseOrdersService {
  constructor(
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(DocumentNumberService) private readonly numbers: DocumentNumberService,
    @Inject(BranchContextService) private readonly contexts: BranchContextService,
  ) {}

  async list(rawQuery: unknown): Promise<PurchaseOrderListResponse> {
    const query = PurchaseOrderListQuerySchema.parse(rawQuery);
    const filters: Prisma.PurchaseOrderWhereInput[] = [];
    if (query.status === 'open')
      filters.push({ status: { in: ['APPROVED', 'PARTIALLY_RECEIVED'] } });
    else if (query.status !== 'all') filters.push({ status: query.status });
    if (query.supplierId) filters.push({ supplierId: query.supplierId });
    if (query.branchId) filters.push({ branchId: query.branchId });
    const search = query.search?.trim();
    if (search)
      filters.push({
        OR: [
          { poNo: { contains: escapeLike(search), mode: 'insensitive' } },
          { supplier: { name: { contains: escapeLike(search), mode: 'insensitive' } } },
        ],
      });
    const where: Prisma.PurchaseOrderWhereInput = { AND: filters };
    const orderBy = toOrderBy(PO_SORT_FIELDS, query, { field: 'createdAt', order: 'desc' });
    return this.transactions.run(async (tx) => {
      const [rows, total] = await Promise.all([
        tx.purchaseOrder.findMany({ where, orderBy, include: PO_INCLUDE, ...toSkipTake(query) }),
        tx.purchaseOrder.count({ where }),
      ]);
      const progress = await lineProgress(
        tx,
        rows.map((row) => row.id),
      );
      const items = rows.map((row): PurchaseOrderSummary => {
        const { lines: _lines, ...summary } = toPurchaseOrderDto(row, progress);
        void _lines;
        return summary;
      });
      return buildPage(items, total, query);
    });
  }

  async get(id: string): Promise<PurchaseOrder> {
    return this.transactions.run(async (tx) => this.load(tx, id));
  }

  async create(auth: AuthContext, body: unknown): Promise<PurchaseOrder> {
    const input = CreatePurchaseOrderRequestSchema.parse(body);
    const branchId = this.resolveBranch(input.branchId);
    const orderDate = input.orderDate ?? todayInIndia();
    return this.transactions.run(async (tx) => {
      await this.assertBranchAndSupplier(tx, branchId, input.supplierId);
      await this.assertItems(
        tx,
        input.lines.map((line) => line.itemId),
      );
      const poNo = await this.numbers.next(tx, {
        branchId,
        docType: 'PURCHASE_ORDER',
        date: asDate(orderDate),
      });
      const created = await tx.purchaseOrder.create({
        data: {
          branchId,
          poNo,
          supplierId: input.supplierId,
          orderDate: asDate(orderDate),
          createdBy: auth.userId,
          updatedBy: auth.userId,
          poLines: {
            create: input.lines.map((line) => ({
              branchId,
              itemId: line.itemId,
              qtyOrdered: line.qtyOrdered,
              unitCost: line.unitCost,
              createdBy: auth.userId,
              updatedBy: auth.userId,
            })),
          },
        },
      });
      await this.audit.record(tx, {
        action: 'PURCHASE_ORDER_CREATED',
        entityType: 'PurchaseOrder',
        entityId: created.id,
        branchId,
        newValue: { poNo, supplierId: input.supplierId, lines: input.lines.length },
      });
      return this.load(tx, created.id);
    });
  }

  async update(auth: AuthContext, id: string, body: unknown): Promise<PurchaseOrder> {
    const input = UpdatePurchaseOrderRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const current = await this.lock(tx, id);
      if (current.rowVersion !== input.rowVersion) throw this.stale();
      if (current.status !== 'DRAFT')
        throw new ConflictError('Only a draft purchase order can be changed');
      if (input.supplierId && input.supplierId !== current.supplierId)
        await this.assertBranchAndSupplier(tx, current.branchId, input.supplierId);

      if (input.lines) {
        await this.assertItems(
          tx,
          input.lines.map((line) => line.itemId),
        );
        const keep = new Set(input.lines.map((line) => line.itemId));
        const existing = new Map(current.poLines.map((line) => [line.itemId, line]));
        await tx.poLine.deleteMany({
          where: { poId: id, itemId: { notIn: [...keep] } },
        });
        for (const line of input.lines) {
          const found = existing.get(line.itemId);
          if (found)
            await tx.poLine.update({
              where: { id: found.id },
              data: {
                qtyOrdered: line.qtyOrdered,
                unitCost: line.unitCost,
                updatedBy: auth.userId,
              },
            });
          else
            await tx.poLine.create({
              data: {
                branchId: current.branchId,
                poId: id,
                itemId: line.itemId,
                qtyOrdered: line.qtyOrdered,
                unitCost: line.unitCost,
                createdBy: auth.userId,
                updatedBy: auth.userId,
              },
            });
        }
      }
      await tx.purchaseOrder.update({
        where: { id },
        data: {
          ...(input.supplierId ? { supplierId: input.supplierId } : {}),
          ...(input.orderDate ? { orderDate: asDate(input.orderDate) } : {}),
          updatedBy: auth.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'PURCHASE_ORDER_UPDATED',
        entityType: 'PurchaseOrder',
        entityId: id,
        branchId: current.branchId,
        newValue: {
          supplierId: input.supplierId,
          orderDate: input.orderDate,
          lines: input.lines?.length,
        },
      });
      return this.load(tx, id);
    });
  }

  async approve(auth: AuthContext, id: string, body: unknown): Promise<PurchaseOrder> {
    const input = ApprovePurchaseOrderRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const current = await this.lock(tx, id);
      if (current.rowVersion !== input.rowVersion) throw this.stale();
      if (current.status !== 'DRAFT')
        throw new InvalidStateError('Purchase order', current.status, 'APPROVED');
      const supplier = await tx.supplier.findUniqueOrThrow({ where: { id: current.supplierId } });
      if (!supplier.isActive) throw new BusinessRuleError('This supplier is inactive');
      await tx.purchaseOrder.update({
        where: { id },
        data: { status: 'APPROVED', updatedBy: auth.userId },
      });
      await this.audit.record(tx, {
        action: 'PURCHASE_ORDER_APPROVED',
        entityType: 'PurchaseOrder',
        entityId: id,
        branchId: current.branchId,
        oldValue: { status: 'DRAFT' },
        newValue: { status: 'APPROVED', approvedBy: auth.userId },
      });
      await this.outbox.enqueue(tx, {
        eventType: 'purchasing.order.approved',
        payload: { poId: id, poNo: current.poNo },
        branchId: current.branchId,
      });
      return this.load(tx, id);
    });
  }

  async cancel(auth: AuthContext, id: string, body: unknown): Promise<PurchaseOrder> {
    const input = CancelPurchaseOrderRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const current = await this.lock(tx, id);
      if (current.rowVersion !== input.rowVersion) throw this.stale();
      if (current.status !== 'DRAFT' && current.status !== 'APPROVED')
        throw current.status === 'CANCELLED'
          ? new InvalidStateError('Purchase order', current.status, 'CANCELLED')
          : new ConflictError(
              'Goods have been received against this purchase order, so it cannot be cancelled',
            );
      await tx.purchaseOrder.update({
        where: { id },
        data: { status: 'CANCELLED', updatedBy: auth.userId },
      });
      await this.audit.record(tx, {
        action: 'PURCHASE_ORDER_CANCELLED',
        entityType: 'PurchaseOrder',
        entityId: id,
        branchId: current.branchId,
        oldValue: { status: current.status },
        newValue: { status: 'CANCELLED', reason: input.reason },
      });
      return this.load(tx, id);
    });
  }

  private async load(tx: TxClient, id: string): Promise<PurchaseOrder> {
    const row = await tx.purchaseOrder.findUnique({ where: { id }, include: PO_INCLUDE });
    if (!row) throw new NotFoundError('Purchase order', id);
    return toPurchaseOrderDto(row, await lineProgress(tx, [id]));
  }

  private async lock(tx: TxClient, id: string): Promise<PoRow> {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM purchase_orders WHERE id = ${id}::uuid FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundError('Purchase order', id);
    return tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: PO_INCLUDE });
  }

  private async assertBranchAndSupplier(
    tx: TxClient,
    branchId: string,
    supplierId: string,
  ): Promise<void> {
    const branch = await tx.branch.findUnique({
      where: { id: branchId },
      select: { isActive: true },
    });
    if (!branch) throw new NotFoundError('Branch', branchId);
    if (!branch.isActive) throw new BusinessRuleError('This branch is inactive');
    const supplier = await tx.supplier.findUnique({ where: { id: supplierId } });
    if (!supplier) throw new NotFoundError('Supplier', supplierId);
    if (!supplier.isActive)
      throw new ValidationFailedError('This supplier is inactive', [
        { field: 'supplierId', message: 'Choose an active supplier' },
      ]);
  }

  private async assertItems(tx: TxClient, ids: string[]): Promise<void> {
    const items = await tx.item.findMany({
      where: { id: { in: ids } },
      select: { id: true, itemCode: true, isActive: true },
    });
    const byId = new Map(items.map((item) => [item.id, item]));
    const problems = ids.flatMap((id) => {
      const item = byId.get(id);
      if (!item) return [{ field: 'lines', message: 'An item on this order does not exist' }];
      return item.isActive ? [] : [{ field: 'lines', message: `${item.itemCode} is inactive` }];
    });
    if (problems.length > 0)
      throw new ValidationFailedError('Some items cannot be ordered', problems);
  }

  private resolveBranch(requested: string | undefined): string {
    if (requested) return requested;
    const context = this.contexts.require();
    const only = context.branchIds[0];
    if (!context.isSuperAdmin && context.branchIds.length === 1 && only) return only;
    throw new ValidationFailedError('Choose the branch for this order', [
      { field: 'branchId', message: 'Choose a branch' },
    ]);
  }

  private stale(): ConflictError {
    return new ConflictError(
      'This purchase order was changed by someone else. Reload it and try again',
    );
  }
}
