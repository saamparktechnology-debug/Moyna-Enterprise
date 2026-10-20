import type { Transfer, TransferSummary } from '@erp/contracts';
import { Prisma } from '@prisma/client';

export const TRANSFER_INCLUDE = {
  fromBranch: true,
  toBranch: true,
  transferLines: {
    include: { item: true, discrepancies: true },
    orderBy: [{ item: { itemCode: 'asc' } }, { serialNo: 'asc' }, { id: 'asc' }],
  },
  transferEvents: {
    include: { user: true },
    orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }],
  },
} satisfies Prisma.TransferInclude;

export type TransferRow = Prisma.TransferGetPayload<{ include: typeof TRANSFER_INCLUDE }>;

export function toTransferDto(row: TransferRow): Transfer {
  const requested = row.transferEvents.find((event) => event.status === 'REQUESTED');
  return {
    id: row.id,
    transferNo: row.transferNo,
    fromBranchId: row.fromBranchId,
    fromBranchCode: row.fromBranch.code,
    fromBranchName: row.fromBranch.name,
    toBranchId: row.toBranchId,
    toBranchCode: row.toBranch.code,
    toBranchName: row.toBranch.name,
    status: row.status,
    requestedByName: requested?.user.fullName ?? '',
    createdAt: row.createdAt.toISOString(),
    lines: row.transferLines.map((line) => ({
      id: line.id,
      itemId: line.itemId,
      itemCode: line.item.itemCode,
      itemName: line.item.name,
      isSerialized: line.item.isSerialized,
      serialNo: line.serialNo,
      qtyRequested: line.qtyRequested,
      qtySent: line.qtySent,
      qtyReceived: line.qtyReceived,
      qtyDamaged: line.qtyDamaged,
      discrepancies: [...line.discrepancies]
        .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id))
        .map((entry) => ({ id: entry.id, type: entry.type, qty: entry.qty, status: entry.status })),
    })),
    events: row.transferEvents.map((event) => ({
      id: event.id,
      status: event.status,
      at: event.occurredAt.toISOString(),
      userName: event.user.fullName,
      note: event.note,
    })),
    rowVersion: row.rowVersion,
  };
}

export function toTransferSummary(row: TransferRow): TransferSummary {
  const { lines, events, ...summary } = toTransferDto(row);
  void events;
  return {
    ...summary,
    itemCount: new Set(lines.map((line) => line.itemId)).size,
    unitCount: lines.reduce((sum, line) => sum + line.qtyRequested, 0),
    openDiscrepancies: lines
      .flatMap((line) => line.discrepancies)
      .filter((entry) => entry.status === 'OPEN').length,
  };
}
