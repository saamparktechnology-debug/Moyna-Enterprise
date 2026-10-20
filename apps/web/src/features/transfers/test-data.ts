import type { Transfer, TransferLine, TransferSummary } from '@erp/contracts';
import { jsonResponse, makeSession, signedIn } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';

export const TO_ID = '5b3f9c1e-0a4d-4c55-8f5e-0d6f1f0a1b2c';
export const FROM_ID = '6c4a0d2f-1b5e-4d66-9a6f-1e7a2a1b2c3d';
export const ITEM_ID = '8b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e';
export const LINE_ID = '9c3d4e5f-6a7b-4c8d-8e9f-0a1b2c3d4e5f';
export const SERIAL_ITEM_ID = 'be5f6a7b-8c9d-4eaf-8ab1-2c3d4e5f6071';
export const SERIAL_LINE_ID = 'ad4e5f6a-7b8c-4d9e-9fa0-1b2c3d4e5f60';

export const BRANCHES = [
  { id: TO_ID, code: 'HQ', name: 'Head Office' },
  { id: FROM_ID, code: 'EAB', name: 'East Branch' },
];

export const ALL = [
  'transfers.view',
  'transfers.request',
  'transfers.approve',
  'transfers.dispatch',
  'transfers.receive',
];
export const VIEWER = ['transfers.view'];

export function makeLine(over: Partial<TransferLine> = {}): TransferLine {
  return {
    id: LINE_ID,
    itemId: ITEM_ID,
    itemCode: 'BATT-48V',
    itemName: '48V battery',
    isSerialized: false,
    serialNo: null,
    qtyRequested: 10,
    qtySent: 0,
    qtyReceived: 0,
    qtyDamaged: 0,
    discrepancies: [],
    ...over,
  };
}

export function makeTransfer(over: Partial<Transfer> = {}): Transfer {
  return {
    id: 'tr-1',
    transferNo: 'TRF-HQ-0001',
    fromBranchId: FROM_ID,
    fromBranchCode: 'EAB',
    fromBranchName: 'East Branch',
    toBranchId: TO_ID,
    toBranchCode: 'HQ',
    toBranchName: 'Head Office',
    status: 'REQUESTED',
    requestedByName: 'Asha Rao',
    createdAt: '2026-10-08T05:00:00.000Z',
    lines: [makeLine()],
    events: [
      {
        id: 'e-1',
        status: 'REQUESTED',
        at: '2026-10-08T05:00:00.000Z',
        userName: 'Asha Rao',
        note: null,
      },
    ],
    rowVersion: 3,
    ...over,
  };
}

export function summaryOf(transfer: Transfer): TransferSummary {
  const { lines, events, ...rest } = transfer;
  void events;
  return {
    ...rest,
    itemCount: lines.length,
    unitCount: lines.reduce((sum, line) => sum + line.qtyRequested, 0),
    openDiscrepancies: lines.reduce(
      (sum, line) => sum + line.discrepancies.filter((entry) => entry.status === 'OPEN').length,
      0,
    ),
  };
}

export const pageOf = <T>(items: T[], over: Record<string, number> = {}) => ({
  items,
  page: 1,
  pageSize: 10,
  total: items.length,
  totalPages: items.length === 0 ? 0 : 1,
  ...over,
});

/** `worksIn` is the branch the signed-in person works in: HQ receives, EAB sends. */
export function transferHandlers(
  permissions: string[] = ALL,
  transfers: Transfer[] = [makeTransfer()],
  worksIn: 'HQ' | 'EAB' | 'both' | 'neither' = 'HQ',
): Record<string, RouteHandler> {
  const mine =
    worksIn === 'neither'
      ? [{ id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d', code: 'WST', name: 'West Branch' }]
      : BRANCHES.filter((branch) => worksIn === 'both' || branch.code === worksIn);
  return {
    ...signedIn(makeSession({ permissions, branches: mine })),
    'GET /api/transfers?*': () => jsonResponse(pageOf(transfers.map(summaryOf))),
    ...Object.fromEntries(
      transfers.map((transfer) => [
        `GET /api/transfers/${transfer.id}`,
        () => jsonResponse(transfer),
      ]),
    ),
    'GET /api/reference/branches': () => jsonResponse(BRANCHES),
  };
}
