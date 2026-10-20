import { ADJUSTMENT_SORT_FIELDS } from '@erp/contracts';
import { Inject, Injectable } from '@nestjs/common';
import {
  AdjustmentListQuerySchema,
  ApproveAdjustmentRequestSchema,
  CancelAdjustmentRequestSchema,
  CreateStockAdjustmentRequestSchema,
  RejectAdjustmentRequestSchema,
} from '@erp/contracts';
import type { AdjustmentListResponse, StockAdjustment } from '@erp/contracts';
import type { ApprovalStatus, StockState } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { SettingsService } from '../settings/settings.service.js';
import { AuditService } from '../../common/audit/audit.service.js';
import { BranchContextService } from '../../common/branch-context/branch-context.service.js';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  InvalidStateError,
  NotFoundError,
  ValidationFailedError,
} from '../../common/errors/domain-errors.js';
import { OutboxService } from '../../common/outbox/outbox.service.js';
import { buildPage, toOrderBy, toSkipTake } from '../../common/pagination/pagination.js';
import { ScopedPrismaService } from '../../common/prisma/scoped-prisma.service.js';
import type { TxClient } from '../../common/prisma/scoped-prisma.service.js';
import { TransactionService } from '../../common/prisma/transaction.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { StockPostingService } from './stock-posting.service.js';

const INCLUDE = {
  branch: true,
  item: true,
  serialUnit: true,
  requester: { select: { fullName: true } },
  approver: { select: { fullName: true } },
} satisfies Prisma.StockAdjustmentInclude;
type Row = Prisma.StockAdjustmentGetPayload<{ include: typeof INCLUDE }>;

const APPROVAL_ENTITY = 'STOCK_ADJUSTMENT';

function toDto(row: Row): StockAdjustment {
  return {
    id: row.id,
    branchId: row.branchId,
    branchCode: row.branch.code,
    itemId: row.itemId,
    itemCode: row.item.itemCode,
    itemName: row.item.name,
    isSerialized: row.item.isSerialized,
    kind: row.kind,
    state: row.state,
    toState: row.toState,
    qty: row.qty,
    serialUnitId: row.serialUnitId,
    serialNo: row.serialNo ?? row.serialUnit?.serialNo ?? null,
    chassisNo: row.chassisNo ?? row.serialUnit?.chassisNo ?? null,
    reason: row.reason,
    status: row.status,
    requestedById: row.requestedBy,
    requestedByName: row.requester.fullName,
    approvedByName: row.approver?.fullName ?? null,
    decidedAt: row.decidedAt?.toISOString() ?? null,
    decisionNote: row.decisionNote,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
  };
}

const asDate = (value: string | undefined): Date | null =>
  value ? new Date(`${value}T00:00:00.000Z`) : null;

@Injectable()
export class StockAdjustmentsService {
  constructor(
    @Inject(ScopedPrismaService) private readonly scoped: ScopedPrismaService,
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(StockPostingService) private readonly posting: StockPostingService,
    @Inject(BranchContextService) private readonly contexts: BranchContextService,
    @Inject(SettingsService) private readonly settings: SettingsService,
  ) {}

  async list(rawQuery: unknown): Promise<AdjustmentListResponse> {
    const query = AdjustmentListQuerySchema.parse(rawQuery);
    const where: Prisma.StockAdjustmentWhereInput = {
      ...(query.status === 'all' ? {} : { status: query.status }),
      ...(query.kind ? { kind: query.kind } : {}),
      ...(query.itemId ? { itemId: query.itemId } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {}),
    };
    const [rows, total] = await Promise.all([
      this.scoped.client.stockAdjustment.findMany({
        where,
        include: INCLUDE,
        orderBy: toOrderBy(ADJUSTMENT_SORT_FIELDS, query, { field: 'createdAt', order: 'desc' }),
        ...toSkipTake(query),
      }),
      this.scoped.client.stockAdjustment.count({ where }),
    ]);
    return buildPage(rows.map(toDto), total, query);
  }

  async get(id: string): Promise<StockAdjustment> {
    const row = await this.scoped.client.stockAdjustment.findUnique({
      where: { id },
      include: INCLUDE,
    });
    if (!row) throw new NotFoundError('Stock adjustment', id);
    return toDto(row);
  }

  async create(auth: AuthContext, body: unknown): Promise<StockAdjustment> {
    const input = CreateStockAdjustmentRequestSchema.parse(body);
    const branchId = this.resolveBranch(input.branchId);
    return this.transactions.run(async (tx) => {
      await this.assertFeasible(tx, branchId, input);
      const created = await tx.stockAdjustment.create({
        data: {
          branchId,
          itemId: input.itemId,
          kind: input.kind,
          state: input.state,
          toState: input.toState ?? null,
          qty: input.qty,
          serialUnitId: input.serialUnitId ?? null,
          serialNo: input.serialNo ?? null,
          chassisNo: input.chassisNo ?? null,
          manufacturedOn: asDate(input.manufacturedOn),
          expiryOn: asDate(input.expiryOn),
          warrantyMonths: input.warrantyMonths ?? null,
          reason: input.reason,
          requestedBy: auth.userId,
          createdBy: auth.userId,
          updatedBy: auth.userId,
        },
      });
      await tx.approval.create({
        data: {
          branchId,
          entityType: APPROVAL_ENTITY,
          entityId: created.id,
          requestedBy: auth.userId,
          reason: input.reason,
          createdBy: auth.userId,
          updatedBy: auth.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'STOCK_ADJUSTMENT_REQUESTED',
        entityType: 'StockAdjustment',
        entityId: created.id,
        branchId,
        newValue: {
          kind: input.kind,
          itemId: input.itemId,
          state: input.state,
          qty: input.qty,
          reason: input.reason,
        },
      });
      return toDto(await this.reload(tx, created.id));
    });
  }

  async approve(auth: AuthContext, id: string, body: unknown): Promise<StockAdjustment> {
    const input = ApproveAdjustmentRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const current = await this.lockPending(tx, id, input.rowVersion, 'APPROVED');
      this.assertMayApprove(auth, current, await this.settings.adjustmentLimit(tx));
      await this.apply(tx, current);
      const row = await this.decide(tx, current, 'APPROVED', auth.userId, input.note ?? null);
      await this.audit.record(tx, {
        action: 'STOCK_ADJUSTMENT_APPROVED',
        entityType: 'StockAdjustment',
        entityId: id,
        branchId: current.branchId,
        oldValue: { status: 'PENDING' },
        newValue: { status: 'APPROVED', approvedBy: auth.userId, note: input.note ?? null },
      });
      await this.outbox.enqueue(tx, {
        eventType: 'stock.adjustment.approved',
        payload: { adjustmentId: id, itemId: current.itemId, kind: current.kind, qty: current.qty },
        branchId: current.branchId,
      });
      return toDto(row);
    });
  }

  /** Nobody approves their own request (a Super Admin may, so a business with one owner can still work), and big adjustments need a Super Admin. */
  private assertMayApprove(
    auth: AuthContext,
    current: { requestedBy: string; qty: number },
    limit: number,
  ): void {
    if (auth.isSuperAdmin) return;
    if (current.requestedBy === auth.userId)
      throw new ForbiddenError(
        'You cannot approve your own adjustment. Ask another approver to decide it',
      );
    if (current.qty > limit)
      throw new BusinessRuleError(`Adjustments of more than ${limit} units need a Super Admin`, [
        {
          field: 'qty',
          message: `This request is for ${current.qty} units. Ask a Super Admin to approve it`,
        },
      ]);
  }

  async reject(auth: AuthContext, id: string, body: unknown): Promise<StockAdjustment> {
    const input = RejectAdjustmentRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const current = await this.lockPending(tx, id, input.rowVersion, 'REJECTED');
      const row = await this.decide(tx, current, 'REJECTED', auth.userId, input.note);
      await this.audit.record(tx, {
        action: 'STOCK_ADJUSTMENT_REJECTED',
        entityType: 'StockAdjustment',
        entityId: id,
        branchId: current.branchId,
        oldValue: { status: 'PENDING' },
        newValue: { status: 'REJECTED', note: input.note },
      });
      return toDto(row);
    });
  }

  async cancel(auth: AuthContext, id: string, body: unknown): Promise<StockAdjustment> {
    const input = CancelAdjustmentRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const current = await this.lockPending(tx, id, input.rowVersion, 'CANCELLED');
      if (current.requestedBy !== auth.userId)
        throw new ForbiddenError('Only the person who asked for the adjustment can cancel it');
      const row = await this.decide(tx, current, 'CANCELLED', null, null);
      await this.audit.record(tx, {
        action: 'STOCK_ADJUSTMENT_CANCELLED',
        entityType: 'StockAdjustment',
        entityId: id,
        branchId: current.branchId,
        oldValue: { status: 'PENDING' },
        newValue: { status: 'CANCELLED' },
      });
      return toDto(row);
    });
  }

  private resolveBranch(requested: string | undefined): string {
    if (requested) return requested;
    const context = this.contexts.require();
    const only = context.branchIds[0];
    if (!context.isSuperAdmin && context.branchIds.length === 1 && only) return only;
    throw new ValidationFailedError('Choose the branch for this adjustment', [
      { field: 'branchId', message: 'Choose a branch' },
    ]);
  }

  /** Checks the request against today's stock so obvious mistakes are refused at once. The movement itself is checked again when approved. */
  private async assertFeasible(
    tx: TxClient,
    branchId: string,
    input: ReturnType<typeof CreateStockAdjustmentRequestSchema.parse>,
  ): Promise<void> {
    const branch = await tx.branch.findUnique({
      where: { id: branchId },
      select: { isActive: true },
    });
    if (!branch) throw new NotFoundError('Branch', branchId);
    if (!branch.isActive) throw new BusinessRuleError('This branch is inactive');
    const item = await tx.item.findUnique({ where: { id: input.itemId } });
    if (!item)
      throw new ValidationFailedError('Choose an item', [
        { field: 'itemId', message: 'This item does not exist' },
      ]);
    if (!item.isActive)
      throw new BusinessRuleError('This item is inactive', [
        { field: 'itemId', message: `${item.itemCode} is inactive` },
      ]);

    if (!item.isSerialized) {
      if (input.serialNo || input.serialUnitId)
        throw new ValidationFailedError('This item is not tracked by serial number', [
          {
            field: input.serialNo ? 'serialNo' : 'serialUnitId',
            message: `${item.itemCode} has no serial numbers`,
          },
        ]);
      if (input.kind !== 'IN')
        await this.assertEnoughStock(tx, branchId, item.id, item.itemCode, input.state, input.qty);
      return;
    }

    if (input.kind === 'IN') {
      if (!input.serialNo)
        throw new ValidationFailedError('Enter the serial number', [
          { field: 'serialNo', message: `${item.itemCode} is tracked by serial number` },
        ]);
      const used = await tx.$queryRaw<{ found: boolean }[]>`
        SELECT serial_number_in_use(${input.serialNo}, ${input.chassisNo ?? null}) AS found`;
      if (used[0]?.found)
        throw new ConflictError('This serial number is already in use', [
          {
            field: 'serialNo',
            message: 'Another unit or request already has this serial or chassis number',
          },
        ]);
      return;
    }

    if (!input.serialUnitId)
      throw new ValidationFailedError('Choose the serial unit', [
        { field: 'serialUnitId', message: `${item.itemCode} is tracked by serial number` },
      ]);
    const unit = await tx.serialUnit.findUnique({ where: { id: input.serialUnitId } });
    if (!unit || unit.itemId !== item.id || unit.branchId !== branchId)
      throw new ValidationFailedError('Choose a serial unit of this item in this branch', [
        { field: 'serialUnitId', message: 'This serial unit is not in this branch' },
      ]);
    if (unit.state !== input.state)
      throw new BusinessRuleError(
        `Serial unit ${unit.serialNo} is ${unit.state.toLowerCase()}, not ${input.state.toLowerCase()}`,
        [{ field: 'state', message: `The unit is ${unit.state.toLowerCase()}` }],
      );
    const open = await tx.stockAdjustment.findFirst({
      where: { status: 'PENDING', serialUnitId: unit.id },
      select: { id: true },
    });
    if (open)
      throw new ConflictError('This serial unit already has a request waiting', [
        { field: 'serialUnitId', message: 'Decide the earlier request first' },
      ]);
  }

  private async assertEnoughStock(
    tx: TxClient,
    branchId: string,
    itemId: string,
    itemCode: string,
    state: StockState,
    qty: number,
  ): Promise<void> {
    const balance = await tx.stockBalance.findUnique({
      where: { branchId_itemId_state: { branchId, itemId, state } },
    });
    const have = balance?.quantity ?? 0;
    if (have < qty)
      throw new BusinessRuleError(
        `Only ${have} of ${itemCode} ${state.toLowerCase()} in this branch`,
        [{ field: 'qty', message: `The quantity is more than the ${have} on hand` }],
      );
  }

  private async lockPending(
    tx: TxClient,
    id: string,
    rowVersion: number,
    to: ApprovalStatus,
  ): Promise<Row> {
    const found = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM stock_adjustments WHERE id = ${id}::uuid FOR UPDATE`;
    if (found.length === 0) throw new NotFoundError('Stock adjustment', id);
    const row = await this.reload(tx, id);
    if (row.status !== 'PENDING') throw new InvalidStateError('Stock adjustment', row.status, to);
    if (row.rowVersion !== rowVersion)
      throw new ConflictError('This request was changed by someone else. Reload it and try again');
    return row;
  }

  private async decide(
    tx: TxClient,
    current: Row,
    status: ApprovalStatus,
    decidedBy: string | null,
    note: string | null,
  ): Promise<Row> {
    const now = new Date();
    await tx.stockAdjustment.update({
      where: { id: current.id },
      data: {
        status,
        approvedBy: decidedBy,
        decidedAt: now,
        decisionNote: note,
        updatedBy: this.contexts.require().userId,
      },
    });
    await tx.approval.updateMany({
      where: { entityType: APPROVAL_ENTITY, entityId: current.id },
      data: {
        status,
        approvedBy: decidedBy,
        decidedAt: now,
        updatedBy: this.contexts.require().userId,
      },
    });
    return this.reload(tx, current.id);
  }

  /** Posts the stock movements an approved request stands for. */
  private async apply(tx: TxClient, adjustment: Row): Promise<void> {
    const base = {
      branchId: adjustment.branchId,
      itemId: adjustment.itemId,
      sourceDocId: adjustment.id,
      sourceDocType: APPROVAL_ENTITY,
    };
    const serial = adjustment.item.isSerialized;

    if (adjustment.kind === 'IN') {
      if (!adjustment.item.isActive)
        throw new BusinessRuleError(
          `${adjustment.item.itemCode} is inactive, so stock cannot be added`,
        );
      const unitId =
        serial && adjustment.serialNo
          ? await this.posting.createSerialUnit(tx, {
              branchId: adjustment.branchId,
              itemId: adjustment.itemId,
              serialNo: adjustment.serialNo,
              chassisNo: adjustment.chassisNo ?? undefined,
              state: adjustment.state,
            })
          : undefined;
      await this.posting.post(tx, {
        ...base,
        state: adjustment.state,
        qtyDelta: adjustment.qty,
        movementType: 'ADJUSTMENT_IN',
        serialUnitId: unitId,
      });
      if (
        unitId &&
        (adjustment.manufacturedOn || adjustment.expiryOn || adjustment.warrantyMonths !== null)
      ) {
        await tx.battery.create({
          data: {
            serialUnitId: unitId,
            manufacturedOn: adjustment.manufacturedOn,
            expiryOn: adjustment.expiryOn,
            warrantyMonths: adjustment.warrantyMonths,
          },
        });
      }
      return;
    }

    if (adjustment.kind === 'STATE_CHANGE') {
      const to = adjustment.toState;
      if (!to) throw new Error('A state change has no new state');
      if (serial && adjustment.serialUnitId)
        await this.posting.moveSerialUnit(tx, {
          unitId: adjustment.serialUnitId,
          branchId: adjustment.branchId,
          from: [adjustment.state],
          to,
        });
      const unit = serial ? { serialUnitId: adjustment.serialUnitId ?? undefined } : {};
      await this.posting.post(tx, {
        ...base,
        ...unit,
        state: adjustment.state,
        qtyDelta: -adjustment.qty,
        movementType: 'STATE_CHANGE',
      });
      await this.posting.post(tx, {
        ...base,
        ...unit,
        state: to,
        qtyDelta: adjustment.qty,
        movementType: 'STATE_CHANGE',
      });
      return;
    }

    // OUT and WRITE_OFF both remove stock; a serial unit that leaves is scrapped.
    if (serial && adjustment.serialUnitId)
      await this.posting.moveSerialUnit(tx, {
        unitId: adjustment.serialUnitId,
        branchId: adjustment.branchId,
        from: [adjustment.state],
        to: 'SCRAPPED',
      });
    await this.posting.post(tx, {
      ...base,
      state: adjustment.state,
      qtyDelta: -adjustment.qty,
      movementType: adjustment.kind === 'OUT' ? 'ADJUSTMENT_OUT' : 'WRITE_OFF',
      serialUnitId: serial ? (adjustment.serialUnitId ?? undefined) : undefined,
    });
  }

  private reload(tx: TxClient, id: string): Promise<Row> {
    return tx.stockAdjustment.findUniqueOrThrow({ where: { id }, include: INCLUDE });
  }
}
