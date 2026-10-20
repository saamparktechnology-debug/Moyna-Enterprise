import { TRANSFER_SORT_FIELDS } from '@erp/contracts';
import { Inject, Injectable } from '@nestjs/common';
import {
  ApproveTransferRequestSchema,
  CancelTransferRequestSchema,
  CreateTransferRequestSchema,
  DispatchTransferRequestSchema,
  RECEIVABLE_STATUSES,
  ReceiveTransferRequestSchema,
  RejectTransferRequestSchema,
  TransferListQuerySchema,
} from '@erp/contracts';
import type { ErrorDetail, Transfer, TransferListResponse, TransferStatus } from '@erp/contracts';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service.js';
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
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { TxClient } from '../../common/prisma/scoped-prisma.service.js';
import { TransactionService } from '../../common/prisma/transaction.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { ItemsService } from '../items/items.service.js';
import { StockPostingService } from '../stock/stock-posting.service.js';
import { TRANSFER_INCLUDE, toTransferDto, toTransferSummary } from './transfers.mapper.js';
import type { TransferRow } from './transfers.mapper.js';

const DOC = 'TRANSFER_LINE';

@Injectable()
export class TransfersService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(OutboxService) private readonly outbox: OutboxService,
    @Inject(StockPostingService) private readonly posting: StockPostingService,
    @Inject(DocumentNumberService) private readonly numbers: DocumentNumberService,
    @Inject(ItemsService) private readonly items: ItemsService,
  ) {}

  async list(auth: AuthContext, rawQuery: unknown): Promise<TransferListResponse> {
    const query = TransferListQuerySchema.parse(rawQuery);
    const mine = auth.branchIds;
    const where: Prisma.TransferWhereInput = {
      ...(query.status !== 'all' ? { status: query.status } : {}),
      ...(query.search
        ? { transferNo: { contains: escapeLike(query.search), mode: 'insensitive' } }
        : {}),
      ...(query.direction === 'incoming' && !auth.isSuperAdmin ? { toBranchId: { in: mine } } : {}),
      ...(query.direction === 'outgoing' && !auth.isSuperAdmin
        ? { fromBranchId: { in: mine } }
        : {}),
    };
    return this.transactions.run(async (tx) => {
      const [rows, total] = await Promise.all([
        tx.transfer.findMany({
          where,
          include: TRANSFER_INCLUDE,
          orderBy: toOrderBy(TRANSFER_SORT_FIELDS, query, { field: 'createdAt', order: 'desc' }),
          ...toSkipTake(query),
        }),
        tx.transfer.count({ where }),
      ]);
      return buildPage(rows.map(toTransferSummary), total, query);
    });
  }

  async get(id: string): Promise<Transfer> {
    return this.transactions.run((tx) => this.load(tx, id));
  }

  async create(auth: AuthContext, body: unknown): Promise<Transfer> {
    const input = CreateTransferRequestSchema.parse(body);
    if (!this.mayActFor(auth, input.toBranchId))
      throw new ForbiddenError('You can only ask for stock for a branch you work in');
    const branches = await this.prisma.branch.findMany({
      where: { id: { in: [input.fromBranchId, input.toBranchId] } },
    });
    const problems: ErrorDetail[] = [];
    for (const [field, id] of [
      ['fromBranchId', input.fromBranchId],
      ['toBranchId', input.toBranchId],
    ] as const) {
      const branch = branches.find((candidate) => candidate.id === id);
      if (!branch?.isActive) problems.push({ field, message: 'Choose an active branch' });
    }
    if (problems.length > 0)
      throw new ValidationFailedError('The branches are not valid', problems);
    await this.items.requireUsable(input.lines.map((line) => line.itemId));

    return this.transactions.run(async (tx) => {
      const transferNo = await this.numbers.next(tx, {
        branchId: input.toBranchId,
        docType: 'TRANSFER',
      });
      const created = await tx.transfer.create({
        data: {
          transferNo,
          fromBranchId: input.fromBranchId,
          toBranchId: input.toBranchId,
          createdBy: auth.userId,
          updatedBy: auth.userId,
          transferLines: {
            create: input.lines.map((line) => ({
              itemId: line.itemId,
              qtyRequested: line.qty,
              qtySent: line.qty,
              fromBranchId: input.fromBranchId,
              toBranchId: input.toBranchId,
              createdBy: auth.userId,
              updatedBy: auth.userId,
            })),
          },
          transferEvents: {
            create: {
              status: 'REQUESTED',
              userId: auth.userId,
              note: input.note ?? null,
              fromBranchId: input.fromBranchId,
              toBranchId: input.toBranchId,
            },
          },
        },
      });
      await this.audit.record(tx, {
        action: 'TRANSFER_REQUESTED',
        entityType: 'Transfer',
        entityId: created.id,
        branchId: input.toBranchId,
        newValue: {
          transferNo,
          from: input.fromBranchId,
          to: input.toBranchId,
          lines: input.lines.length,
        },
      });
      await this.outbox.enqueue(tx, {
        eventType: 'transfers.requested',
        payload: { transferId: created.id, transferNo },
        branchId: input.toBranchId,
      });
      return this.load(tx, created.id);
    });
  }

  async approve(auth: AuthContext, id: string, body: unknown): Promise<Transfer> {
    const input = ApproveTransferRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const transfer = await this.lock(tx, id, input.rowVersion);
      this.requireStatus(transfer, ['REQUESTED'], 'APPROVED');
      this.requireBranch(
        auth,
        transfer.fromBranchId,
        'Only the branch that holds the stock can approve this transfer',
      );
      await this.advance(tx, auth, transfer, 'APPROVED');
      await this.record(tx, transfer, 'TRANSFER_APPROVED', transfer.fromBranchId);
      return this.load(tx, id);
    });
  }

  async reject(auth: AuthContext, id: string, body: unknown): Promise<Transfer> {
    const input = RejectTransferRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const transfer = await this.lock(tx, id, input.rowVersion);
      this.requireStatus(transfer, ['REQUESTED'], 'REJECTED');
      this.requireBranch(
        auth,
        transfer.fromBranchId,
        'Only the branch that holds the stock can reject this transfer',
      );
      await this.advance(tx, auth, transfer, 'REJECTED', input.note);
      await this.record(tx, transfer, 'TRANSFER_REJECTED', transfer.fromBranchId, input.note);
      return this.load(tx, id);
    });
  }

  async cancel(auth: AuthContext, id: string, body: unknown): Promise<Transfer> {
    const input = CancelTransferRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const transfer = await this.lock(tx, id, input.rowVersion);
      if (RECEIVABLE_STATUSES.includes(transfer.status))
        throw new BusinessRuleError(
          'The goods are already on their way, so the transfer cannot be cancelled. Receive them and record any problem',
        );
      this.requireStatus(transfer, ['REQUESTED', 'APPROVED'], 'CANCELLED');
      if (
        !this.mayActFor(auth, transfer.fromBranchId) &&
        !this.mayActFor(auth, transfer.toBranchId)
      )
        throw new ForbiddenError('Only the two branches in this transfer can cancel it');
      await this.advance(tx, auth, transfer, 'CANCELLED', input.note);
      await this.record(tx, transfer, 'TRANSFER_CANCELLED', transfer.toBranchId, input.note);
      return this.load(tx, id);
    });
  }

  /**
   * Stock leaves the sender here and only here. The sender's available stock goes down and the same quantity is held
   * "in transit" at the destination, where only the receiving branch can bring it into stock.
   */
  async dispatch(auth: AuthContext, id: string, body: unknown): Promise<Transfer> {
    const input = DispatchTransferRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const transfer = await this.lock(tx, id, input.rowVersion);
      this.requireStatus(transfer, ['APPROVED'], 'DISPATCHED');
      this.requireBranch(
        auth,
        transfer.fromBranchId,
        'Only the branch that holds the stock can dispatch this transfer',
      );

      const entries = new Map(input.items.map((entry) => [entry.itemId, entry]));
      const problems: ErrorDetail[] = [];
      for (const itemId of entries.keys())
        if (!transfer.transferLines.some((line) => line.itemId === itemId))
          problems.push({
            field: 'items',
            message: 'An item was listed that is not in this transfer',
          });
      for (const line of transfer.transferLines)
        if (!entries.has(line.itemId))
          problems.push({
            field: 'items',
            message: `Say how many ${line.item.itemCode} are being sent`,
          });
      if (problems.length > 0)
        throw new ValidationFailedError('The dispatch is not complete', problems);

      await this.advance(tx, auth, transfer, 'DISPATCHED', input.note);

      for (const line of transfer.transferLines) {
        const entry = entries.get(line.itemId);
        if (!entry) continue;
        const code = line.item.itemCode;
        if (line.item.isSerialized) {
          const numbers = entry.serialNos;
          if (!numbers || entry.qty !== undefined)
            throw new ValidationFailedError('The dispatch is not valid', [
              { field: 'items', message: `${code} has serial numbers, so scan each unit` },
            ]);
          if (numbers.length !== line.qtyRequested)
            throw new ValidationFailedError('The dispatch is not valid', [
              {
                field: 'items',
                message: `${code}: ${line.qtyRequested} unit${line.qtyRequested === 1 ? ' was' : 's were'} asked for, ${numbers.length} scanned`,
              },
            ]);
          const units = await tx.serialUnit.findMany({
            where: {
              branchId: transfer.fromBranchId,
              itemId: line.itemId,
              serialNo: { in: numbers },
            },
          });
          const unitProblems: ErrorDetail[] = [];
          for (const no of numbers) {
            const unit = units.find((candidate) => candidate.serialNo === no);
            if (!unit)
              unitProblems.push({
                field: 'items',
                message: `${no} is not in stock at ${transfer.fromBranch.code}`,
              });
            else if (unit.state !== 'AVAILABLE')
              unitProblems.push({
                field: 'items',
                message: `${no} is ${unit.state.toLowerCase().replace('_', ' ')}, not available`,
              });
          }
          if (unitProblems.length > 0)
            throw new ValidationFailedError('Some units cannot be sent', unitProblems);
          const ordered = numbers.flatMap(
            (no) => units.find((candidate) => candidate.serialNo === no) ?? [],
          );
          for (const [index, unit] of ordered.entries()) {
            const row =
              index === 0
                ? await tx.transferLine.update({
                    where: { id: line.id },
                    data: {
                      serialUnitId: unit.id,
                      serialNo: unit.serialNo,
                      qtyRequested: 1,
                      qtySent: 1,
                      updatedBy: auth.userId,
                    },
                  })
                : await tx.transferLine.create({
                    data: {
                      transferId: transfer.id,
                      itemId: line.itemId,
                      serialUnitId: unit.id,
                      serialNo: unit.serialNo,
                      qtyRequested: 1,
                      qtySent: 1,
                      fromBranchId: transfer.fromBranchId,
                      toBranchId: transfer.toBranchId,
                      createdBy: auth.userId,
                      updatedBy: auth.userId,
                    },
                  });
            await this.takeOffShelf(tx, auth, transfer, row.id, line.itemId, 1, unit.id);
          }
        } else {
          const qty = entry.qty;
          if (qty === undefined || entry.serialNos !== undefined)
            throw new ValidationFailedError('The dispatch is not valid', [
              { field: 'items', message: `${code} has no serial numbers, so give a quantity` },
            ]);
          if (qty > line.qtyRequested)
            throw new ValidationFailedError('The dispatch is not valid', [
              { field: 'items', message: `${code}: only ${line.qtyRequested} were asked for` },
            ]);
          await tx.transferLine.update({
            where: { id: line.id },
            data: { qtySent: qty, updatedBy: auth.userId },
          });
          await this.takeOffShelf(tx, auth, transfer, line.id, line.itemId, qty, undefined);
        }
      }
      await this.record(tx, transfer, 'TRANSFER_DISPATCHED', transfer.fromBranchId, input.note);
      return this.load(tx, id);
    });
  }

  /**
   * Goods arrive only here, and only for what the receiving branch counted or scanned. Good units become available,
   * damaged ones go to quarantine, and anything that did not arrive stays in transit as a discrepancy for a decision.
   */
  async receive(auth: AuthContext, id: string, body: unknown): Promise<Transfer> {
    const input = ReceiveTransferRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const transfer = await this.lock(tx, id, input.rowVersion);
      this.requireStatus(transfer, [...RECEIVABLE_STATUSES], 'RECEIVED');
      this.requireBranch(
        auth,
        transfer.toBranchId,
        'Only the receiving branch can receive this transfer',
      );

      const plain = transfer.transferLines.filter((line) => !line.item.isSerialized);
      const serial = transfer.transferLines.filter((line) => line.item.isSerialized);
      const problems: ErrorDetail[] = [];
      const counted = new Map(input.lines.map((line) => [line.lineId, line]));
      for (const lineId of counted.keys())
        if (!plain.some((line) => line.id === lineId))
          problems.push({
            field: 'lines',
            message: 'A line was listed that is not part of this transfer',
          });
      for (const line of plain) {
        const entry = counted.get(line.id);
        if (!entry)
          problems.push({ field: 'lines', message: `Say how many ${line.item.itemCode} arrived` });
        else if (entry.received > line.qtySent)
          problems.push({
            field: 'lines',
            message: `${line.item.itemCode}: only ${line.qtySent} were sent, so ${entry.received} cannot have arrived`,
          });
      }
      const scanned = new Map(input.serials.map((entry) => [entry.serialNo, entry]));
      for (const no of scanned.keys())
        if (!serial.some((line) => line.serialNo === no))
          problems.push({ field: 'serials', message: `${no} is not part of this transfer` });
      if (problems.length > 0)
        throw new ValidationFailedError('The goods do not match this transfer', problems);

      for (const line of plain) {
        const entry = counted.get(line.id);
        if (!entry) continue;
        const good = entry.received - entry.damaged;
        const short = line.qtySent - entry.received;
        const base = { branchId: transfer.toBranchId, itemId: line.itemId };
        const doc = {
          sourceDocType: DOC,
          sourceDocId: line.id,
          movementType: 'TRANSFER_RECEIPT',
        } as const;
        if (entry.received > 0)
          await this.posting.post(tx, {
            ...base,
            ...doc,
            state: 'IN_TRANSIT',
            qtyDelta: -entry.received,
          });
        if (good > 0)
          await this.posting.post(tx, { ...base, ...doc, state: 'AVAILABLE', qtyDelta: good });
        if (entry.damaged > 0) {
          const damaged = await this.discrepancy(
            tx,
            auth,
            transfer,
            line.id,
            'DAMAGED',
            entry.damaged,
          );
          await this.posting.post(tx, {
            ...base,
            movementType: 'TRANSFER_RECEIPT',
            state: 'QUARANTINE',
            qtyDelta: entry.damaged,
            sourceDocType: 'DISCREPANCY',
            sourceDocId: damaged,
          });
        }
        if (short > 0) await this.discrepancy(tx, auth, transfer, line.id, 'SHORT', short);
        await tx.transferLine.update({
          where: { id: line.id },
          data: { qtyReceived: entry.received, qtyDamaged: entry.damaged, updatedBy: auth.userId },
        });
      }

      for (const line of serial) {
        const entry = line.serialNo ? scanned.get(line.serialNo) : undefined;
        if (!entry || !line.serialUnitId) {
          await this.discrepancy(tx, auth, transfer, line.id, 'SHORT', 1);
          continue;
        }
        const base = {
          branchId: transfer.toBranchId,
          itemId: line.itemId,
          serialUnitId: line.serialUnitId,
        };
        const doc = {
          sourceDocType: DOC,
          sourceDocId: line.id,
          movementType: 'TRANSFER_RECEIPT',
        } as const;
        await this.posting.moveSerialUnit(tx, {
          unitId: line.serialUnitId,
          branchId: transfer.toBranchId,
          from: ['IN_TRANSIT'],
          to: entry.damaged ? 'QUARANTINE' : 'AVAILABLE',
        });
        await this.posting.post(tx, { ...base, ...doc, state: 'IN_TRANSIT', qtyDelta: -1 });
        if (entry.damaged) {
          const damaged = await this.discrepancy(tx, auth, transfer, line.id, 'DAMAGED', 1);
          await this.posting.post(tx, {
            ...base,
            movementType: 'TRANSFER_RECEIPT',
            state: 'QUARANTINE',
            qtyDelta: 1,
            sourceDocType: 'DISCREPANCY',
            sourceDocId: damaged,
          });
        } else await this.posting.post(tx, { ...base, ...doc, state: 'AVAILABLE', qtyDelta: 1 });
        await tx.transferLine.update({
          where: { id: line.id },
          data: { qtyReceived: 1, qtyDamaged: entry.damaged ? 1 : 0, updatedBy: auth.userId },
        });
      }

      await this.advance(tx, auth, transfer, 'RECEIVED', input.note);
      await this.record(tx, transfer, 'TRANSFER_RECEIVED', transfer.toBranchId, input.note);
      return this.load(tx, id);
    });
  }

  private async takeOffShelf(
    tx: TxClient,
    auth: AuthContext,
    transfer: TransferRow,
    lineId: string,
    itemId: string,
    qty: number,
    serialUnitId: string | undefined,
  ): Promise<void> {
    await this.posting.post(tx, {
      branchId: transfer.fromBranchId,
      itemId,
      state: 'AVAILABLE',
      qtyDelta: -qty,
      movementType: 'TRANSFER_DISPATCH',
      sourceDocType: DOC,
      sourceDocId: lineId,
      ...(serialUnitId ? { serialUnitId } : {}),
    });
    await tx.$executeRaw`SELECT transfer_arrive_in_transit(${lineId}::uuid, ${auth.userId}::uuid)`;
  }

  private async discrepancy(
    tx: TxClient,
    auth: AuthContext,
    transfer: TransferRow,
    lineId: string,
    type: 'SHORT' | 'DAMAGED',
    qty: number,
  ): Promise<string> {
    const created = await tx.discrepancy.create({
      data: {
        branchId: transfer.toBranchId,
        transferLineId: lineId,
        type,
        qty,
        createdBy: auth.userId,
        updatedBy: auth.userId,
      },
    });
    return created.id;
  }

  private mayActFor(auth: AuthContext, branchId: string): boolean {
    return auth.isSuperAdmin || auth.branchIds.includes(branchId);
  }

  private requireBranch(auth: AuthContext, branchId: string, message: string): void {
    if (!this.mayActFor(auth, branchId)) throw new ForbiddenError(message);
  }

  private requireStatus(
    transfer: TransferRow,
    allowed: TransferStatus[],
    to: TransferStatus,
  ): void {
    if (!allowed.includes(transfer.status))
      throw new InvalidStateError('Transfer', transfer.status, to);
  }

  private async advance(
    tx: TxClient,
    auth: AuthContext,
    transfer: TransferRow,
    status: TransferStatus,
    note?: string,
  ): Promise<void> {
    await tx.transfer.update({
      where: { id: transfer.id },
      data: { status, updatedBy: auth.userId },
    });
    await tx.transferEvent.create({
      data: {
        transferId: transfer.id,
        status,
        userId: auth.userId,
        note: note ?? null,
        fromBranchId: transfer.fromBranchId,
        toBranchId: transfer.toBranchId,
      },
    });
  }

  private async record(
    tx: TxClient,
    transfer: TransferRow,
    action: string,
    branchId: string,
    note?: string,
  ): Promise<void> {
    await this.audit.record(tx, {
      action,
      entityType: 'Transfer',
      entityId: transfer.id,
      branchId,
      newValue: { transferNo: transfer.transferNo, note: note ?? null },
    });
    await this.outbox.enqueue(tx, {
      eventType: `transfers.${action.replace('TRANSFER_', '').toLowerCase()}`,
      payload: { transferId: transfer.id, transferNo: transfer.transferNo },
      branchId,
    });
  }

  private async lock(tx: TxClient, id: string, rowVersion: number): Promise<TransferRow> {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM transfers WHERE id = ${id}::uuid FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundError('Transfer', id);
    const row = await tx.transfer.findUniqueOrThrow({ where: { id }, include: TRANSFER_INCLUDE });
    if (row.rowVersion !== rowVersion)
      throw new ConflictError('This transfer was changed by someone else. Reload it and try again');
    return row;
  }

  private async load(tx: TxClient, id: string): Promise<Transfer> {
    const row = await tx.transfer.findUnique({ where: { id }, include: TRANSFER_INCLUDE });
    if (!row) throw new NotFoundError('Transfer', id);
    return toTransferDto(row);
  }
}
