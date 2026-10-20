import { Inject, Injectable } from '@nestjs/common';
import type { MovementType, SerialUnitState, StockState } from '@prisma/client';
import { Prisma } from '@prisma/client';
import { BranchContextService } from '../../common/branch-context/branch-context.service.js';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
} from '../../common/errors/domain-errors.js';
import type { TxClient } from '../../common/prisma/scoped-prisma.service.js';

export interface StockMovement {
  branchId: string;
  itemId: string;
  state: StockState;
  /** Positive brings stock in, negative takes it out. A serial unit always moves by exactly one. */
  qtyDelta: number;
  movementType: MovementType;
  /** Required for a serialized item, and only for a serialized item. */
  serialUnitId?: string | undefined;
  sourceDocId?: string | undefined;
  sourceDocType?: string | undefined;
}

export interface NewSerialUnit {
  branchId: string;
  itemId: string;
  serialNo: string;
  chassisNo?: string | undefined;
  state: StockState;
}

export interface SerialUnitMove {
  unitId: string;
  /** The branch the unit must currently be in. */
  branchId: string;
  /** The states the unit may be in now; any other state is refused. */
  from: readonly SerialUnitState[];
  to: SerialUnitState;
}

const STATE_LABELS: Record<StockState, string> = {
  AVAILABLE: 'available',
  RESERVED: 'reserved',
  IN_TRANSIT: 'in-transit',
  DAMAGED: 'damaged',
  RETURNED: 'returned',
  QUARANTINE: 'quarantined',
};

/**
 * The only place that changes stock. A movement appends to the ledger and changes the balance in the same transaction;
 * the balance row is changed with one conditional UPDATE, so two requests for the last unit cannot both succeed and
 * the balance can never go below zero. Callers must run inside `TransactionService.run`.
 */
@Injectable()
export class StockPostingService {
  constructor(@Inject(BranchContextService) private readonly contexts: BranchContextService) {}

  async post(tx: TxClient, movement: StockMovement): Promise<void> {
    if (!Number.isInteger(movement.qtyDelta) || movement.qtyDelta === 0)
      throw new RangeError('A stock movement must change the quantity by a whole number, not zero');
    const item = await tx.item.findUnique({
      where: { id: movement.itemId },
      select: { itemCode: true, isSerialized: true },
    });
    if (!item) throw new NotFoundError('Item', movement.itemId);
    if (item.isSerialized !== (movement.serialUnitId !== undefined))
      throw new BusinessRuleError(
        item.isSerialized
          ? `${item.itemCode} is tracked by serial number, so choose the serial unit`
          : `${item.itemCode} is not tracked by serial number`,
      );
    if (movement.serialUnitId !== undefined && Math.abs(movement.qtyDelta) !== 1)
      throw new BusinessRuleError('A serial unit always moves one at a time');

    await tx.$executeRaw`
      INSERT INTO stock_balances (branch_id, item_id, state, quantity)
      VALUES (${movement.branchId}::uuid, ${movement.itemId}::uuid, ${movement.state}::"StockState", 0)
      ON CONFLICT (branch_id, item_id, state) DO NOTHING`;
    const updated = await tx.$queryRaw<{ quantity: number }[]>`
      UPDATE stock_balances SET quantity = quantity + ${movement.qtyDelta}::int
      WHERE branch_id = ${movement.branchId}::uuid AND item_id = ${movement.itemId}::uuid
        AND state = ${movement.state}::"StockState" AND quantity + ${movement.qtyDelta}::int >= 0
      RETURNING quantity`;
    if (updated.length === 0)
      throw new BusinessRuleError(
        `There is not enough ${STATE_LABELS[movement.state]} stock of ${item.itemCode}`,
        [{ field: 'qty', message: 'The quantity is more than the stock on hand' }],
      );

    await tx.stockLedger.create({
      data: {
        branchId: movement.branchId,
        itemId: movement.itemId,
        serialUnitId: movement.serialUnitId ?? null,
        state: movement.state,
        qtyDelta: movement.qtyDelta,
        movementType: movement.movementType,
        sourceDocId: movement.sourceDocId ?? null,
        sourceDocType: movement.sourceDocType ?? null,
        createdBy: this.contexts.require().userId,
      },
    });
  }

  async createSerialUnit(tx: TxClient, input: NewSerialUnit): Promise<string> {
    const userId = this.contexts.require().userId;
    try {
      const unit = await tx.serialUnit.create({
        data: {
          branchId: input.branchId,
          itemId: input.itemId,
          serialNo: input.serialNo,
          chassisNo: input.chassisNo ?? null,
          state: input.state,
          createdBy: userId,
          updatedBy: userId,
        },
      });
      return unit.id;
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw new ConflictError('This serial number or chassis number already exists', [
          { field: 'serialNo', message: 'Another unit already has this serial or chassis number' },
        ]);
      throw error;
    }
  }

  async moveSerialUnit(tx: TxClient, move: SerialUnitMove): Promise<void> {
    const rows = await tx.$queryRaw<{ id: string; state: SerialUnitState; branch_id: string }[]>`
      SELECT id, state, branch_id FROM serial_units WHERE id = ${move.unitId}::uuid FOR UPDATE`;
    const unit = rows[0];
    if (!unit) throw new NotFoundError('Serial unit', move.unitId);
    if (unit.branch_id !== move.branchId)
      throw new BusinessRuleError('This serial unit is not in this branch');
    if (!move.from.includes(unit.state))
      throw new BusinessRuleError(
        `This serial unit is ${unit.state.toLowerCase().replace('_', '-')}, so it cannot be changed this way`,
      );
    await tx.serialUnit.update({
      where: { id: move.unitId },
      data: { state: move.to, updatedBy: this.contexts.require().userId },
    });
  }
}
