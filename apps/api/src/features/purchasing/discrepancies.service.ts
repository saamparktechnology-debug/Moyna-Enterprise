import { DISCREPANCY_SORT_FIELDS } from '@erp/contracts';
import { Inject, Injectable } from '@nestjs/common';
import {
  ALLOWED_RESOLUTIONS,
  ALLOWED_TRANSFER_RESOLUTIONS,
  DiscrepancyListQuerySchema,
  ResolveDiscrepancyRequestSchema,
} from '@erp/contracts';
import type { Discrepancy, DiscrepancyListResponse } from '@erp/contracts';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service.js';
import {
  BusinessRuleError,
  ConflictError,
  InvalidStateError,
  NotFoundError,
} from '../../common/errors/domain-errors.js';
import { OutboxService } from '../../common/outbox/outbox.service.js';
import { buildPage, toOrderBy, toSkipTake } from '../../common/pagination/pagination.js';
import type { TxClient } from '../../common/prisma/scoped-prisma.service.js';
import { TransactionService } from '../../common/prisma/transaction.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { StockPostingService } from '../stock/stock-posting.service.js';
import { PurchaseReturnsService } from './purchase-returns.service.js';
import { refreshPoStatus } from './purchasing-queries.js';

const INCLUDE = {
  branch: true,
  receiptLine: {
    include: {
      item: true,
      poLine: true,
      receipt: { include: { po: { include: { supplier: true } } } },
    },
  },
  transferLine: { include: { item: true, transfer: true } },
} satisfies Prisma.DiscrepancyInclude;
type Row = Prisma.DiscrepancyGetPayload<{ include: typeof INCLUDE }>;

const toDto = (row: Row): Discrepancy => {
  const item = row.receiptLine?.item ?? row.transferLine?.item ?? null;
  return {
    id: row.id,
    branchId: row.branchId,
    branchCode: row.branch.code,
    type: row.type,
    qty: row.qty,
    status: row.status,
    resolution: row.resolution,
    resolvedAt: row.resolvedAt?.toISOString() ?? null,
    itemId: item?.id ?? null,
    itemCode: item?.itemCode ?? null,
    itemName: item?.name ?? null,
    documentNo: row.receiptLine?.receipt.grnNo ?? row.transferLine?.transfer.transferNo ?? null,
    supplierName: row.receiptLine?.receipt.po?.supplier.name ?? null,
    allowedResolutions:
      row.status === 'OPEN'
        ? [...(row.transferLine ? ALLOWED_TRANSFER_RESOLUTIONS : ALLOWED_RESOLUTIONS)[row.type]]
        : [],
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
  };
};

/**
 * The workflow that settles anything that arrived wrong: goods received from suppliers, and goods received by transfer.
 */
@Injectable()
export class DiscrepanciesService {
  constructor(
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(StockPostingService) private readonly posting: StockPostingService,
    @Inject(PurchaseReturnsService) private readonly returns: PurchaseReturnsService,
  ) {}

  async list(rawQuery: unknown): Promise<DiscrepancyListResponse> {
    const query = DiscrepancyListQuerySchema.parse(rawQuery);
    const where: Prisma.DiscrepancyWhereInput = {
      ...(query.status !== 'all' ? { status: query.status } : {}),
      ...(query.type ? { type: query.type } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {}),
    };
    return this.transactions.run(async (tx) => {
      const [rows, total] = await Promise.all([
        tx.discrepancy.findMany({
          where,
          include: INCLUDE,
          orderBy: toOrderBy(DISCREPANCY_SORT_FIELDS, query, { field: 'createdAt', order: 'desc' }),
          ...toSkipTake(query),
        }),
        tx.discrepancy.count({ where }),
      ]);
      return buildPage(rows.map(toDto), total, query);
    });
  }

  async get(id: string): Promise<Discrepancy> {
    return this.transactions.run((tx) => this.load(tx, id));
  }

  async resolve(auth: AuthContext, id: string, body: unknown): Promise<Discrepancy> {
    const input = ResolveDiscrepancyRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const locked = await tx.$queryRaw<
        { id: string }[]
      >`SELECT id FROM discrepancies WHERE id = ${id}::uuid FOR UPDATE`;
      if (locked.length === 0) throw new NotFoundError('Discrepancy', id);
      const current = await tx.discrepancy.findUniqueOrThrow({ where: { id }, include: INCLUDE });
      if (current.status !== 'OPEN')
        throw new InvalidStateError('Discrepancy', 'RESOLVED', 'RESOLVED');
      if (current.rowVersion !== input.rowVersion)
        throw new ConflictError(
          'This discrepancy was changed by someone else. Reload it and try again',
        );
      const allowed = current.transferLine ? ALLOWED_TRANSFER_RESOLUTIONS : ALLOWED_RESOLUTIONS;
      if (!(allowed[current.type] as readonly string[]).includes(input.resolution))
        throw new BusinessRuleError(
          `A ${current.type.toLowerCase().replace('_', ' ')} discrepancy cannot be settled by ${input.resolution.toLowerCase().replace('_', ' ')}`,
          [{ field: 'resolution', message: 'Choose one of the allowed decisions' }],
        );
      const line = current.receiptLine;
      const item = line?.item ?? current.transferLine?.item;
      if (!item) throw new BusinessRuleError('This discrepancy has no goods to settle');

      await this.applyStock(tx, auth, current, item, line, input.resolution, input.note);
      await tx.discrepancy.update({
        where: { id },
        data: {
          status: 'RESOLVED',
          resolution: input.resolution,
          resolvedAt: new Date(),
          updatedBy: auth.userId,
        },
      });
      if (line?.receipt.poId) await refreshPoStatus(tx, line.receipt.poId);
      await this.audit.record(tx, {
        action: 'DISCREPANCY_RESOLVED',
        entityType: 'Discrepancy',
        entityId: id,
        branchId: current.branchId,
        oldValue: { status: 'OPEN' },
        newValue: {
          status: 'RESOLVED',
          type: current.type,
          qty: current.qty,
          resolution: input.resolution,
          note: input.note ?? null,
        },
      });
      await this.outbox.enqueue(tx, {
        eventType: 'purchasing.discrepancy.resolved',
        payload: { discrepancyId: id, resolution: input.resolution },
        branchId: current.branchId,
      });
      return this.load(tx, id);
    });
  }

  /** What each decision does to the quarantined stock. A short delivery has no stock, so a claim or write-off only closes it. */
  private async applyStock(
    tx: TxClient,
    auth: AuthContext,
    discrepancy: Row,
    item: { id: string; isSerialized: boolean },
    line: Row['receiptLine'],
    resolution: 'ACCEPT' | 'RETURN' | 'CLAIM' | 'WRITE_OFF',
    note: string | undefined,
  ): Promise<void> {
    if (discrepancy.type === 'SHORT') {
      // Goods that never arrived by transfer are still held "in transit" at the receiving branch until they are written off.
      if (discrepancy.transferLine) await this.writeOffInTransit(tx, discrepancy, item);
      return;
    }
    const base = { branchId: discrepancy.branchId, itemId: item.id };
    const unitIds = item.isSerialized
      ? (
          await tx.stockLedger.findMany({
            where: {
              sourceDocType: 'DISCREPANCY',
              sourceDocId: discrepancy.id,
              serialUnitId: { not: null },
            },
            select: { serialUnitId: true },
            orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
          })
        ).flatMap((row) => (row.serialUnitId ? [row.serialUnitId] : []))
      : [];
    const parts: { serialUnitId: string | null; qty: number }[] = item.isSerialized
      ? unitIds.map((serialUnitId) => ({ serialUnitId, qty: 1 }))
      : [{ serialUnitId: null, qty: discrepancy.qty }];
    if (item.isSerialized && unitIds.length !== discrepancy.qty)
      throw new BusinessRuleError('The serial units of this discrepancy cannot be found');

    if (resolution === 'ACCEPT') {
      for (const part of parts) {
        const unit = part.serialUnitId ? { serialUnitId: part.serialUnitId } : {};
        if (part.serialUnitId)
          await this.posting.moveSerialUnit(tx, {
            unitId: part.serialUnitId,
            branchId: base.branchId,
            from: ['QUARANTINE'],
            to: 'AVAILABLE',
          });
        for (const [state, qtyDelta] of [
          ['QUARANTINE', -part.qty],
          ['AVAILABLE', part.qty],
        ] as const)
          await this.posting.post(tx, {
            ...base,
            ...unit,
            state,
            qtyDelta,
            movementType: 'STATE_CHANGE',
            sourceDocType: 'DISCREPANCY',
            sourceDocId: discrepancy.id,
          });
      }
      return;
    }
    if (resolution === 'RETURN') {
      if (!line)
        throw new BusinessRuleError('Goods that came by transfer cannot be returned to a supplier');
      const po = line.receipt.po;
      if (!po)
        throw new BusinessRuleError(
          'This receipt has no purchase order, so there is no supplier to return to',
        );
      const created = await this.returns.createRecord(tx, auth, {
        branchId: base.branchId,
        supplierId: po.supplierId,
        poId: po.id,
        discrepancyId: discrepancy.id,
        reason:
          note?.trim() ||
          `Returned after a ${discrepancy.type.toLowerCase().replace('_', ' ')} discrepancy`,
        lines: parts.map((part) => ({
          poLineId: line.poLineId,
          itemId: item.id,
          serialUnitId: part.serialUnitId,
          qty: part.qty,
          unitCost: new Prisma.Decimal(0),
        })),
      });
      for (const part of parts)
        await this.returns.takeOut(
          tx,
          base.branchId,
          { itemId: item.id, ...part },
          'QUARANTINE',
          created.id,
          'PURCHASE_RETURN',
        );
      return;
    }
    // WRITE_OFF of damaged or wrong stock: it leaves quarantine for good.
    for (const part of parts) {
      if (part.serialUnitId)
        await this.posting.moveSerialUnit(tx, {
          unitId: part.serialUnitId,
          branchId: base.branchId,
          from: ['QUARANTINE'],
          to: 'SCRAPPED',
        });
      await this.posting.post(tx, {
        ...base,
        state: 'QUARANTINE',
        qtyDelta: -part.qty,
        movementType: 'WRITE_OFF',
        sourceDocType: 'DISCREPANCY',
        sourceDocId: discrepancy.id,
        ...(part.serialUnitId ? { serialUnitId: part.serialUnitId } : {}),
      });
    }
  }

  private async writeOffInTransit(
    tx: TxClient,
    discrepancy: Row,
    item: { id: string; isSerialized: boolean },
  ): Promise<void> {
    const unitId = item.isSerialized ? (discrepancy.transferLine?.serialUnitId ?? null) : null;
    if (item.isSerialized && !unitId)
      throw new BusinessRuleError('The serial unit of this discrepancy cannot be found');
    if (unitId)
      await this.posting.moveSerialUnit(tx, {
        unitId,
        branchId: discrepancy.branchId,
        from: ['IN_TRANSIT'],
        to: 'SCRAPPED',
      });
    await this.posting.post(tx, {
      branchId: discrepancy.branchId,
      itemId: item.id,
      state: 'IN_TRANSIT',
      qtyDelta: -discrepancy.qty,
      movementType: 'WRITE_OFF',
      sourceDocType: 'DISCREPANCY',
      sourceDocId: discrepancy.id,
      ...(unitId ? { serialUnitId: unitId } : {}),
    });
  }

  private async load(tx: TxClient, id: string): Promise<Discrepancy> {
    const row = await tx.discrepancy.findUnique({ where: { id }, include: INCLUDE });
    if (!row) throw new NotFoundError('Discrepancy', id);
    return toDto(row);
  }
}
