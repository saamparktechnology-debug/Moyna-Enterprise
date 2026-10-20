import type { LowStock, Movement, SerialUnit, StockAdjustment, StockBalance } from '@erp/contracts';
import { jsonResponse, makeSession, signedIn } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';

export const BRANCH_ID = '11111111-1111-4111-8111-aaaaaaaaaaaa';
export const OTHER_BRANCH_ID = '22222222-2222-4222-8222-bbbbbbbbbbbb';

export const VIEWER = ['stock.view'];
export const STAFF = ['stock.view', 'stock.adjust'];
export const MANAGER = ['stock.view', 'stock.adjust', 'stock.adjust_approve'];

export const page = <T>(items: T[], over: Record<string, number> = {}) => ({
  items,
  page: 1,
  pageSize: 10,
  total: items.length,
  totalPages: items.length === 0 ? 0 : 1,
  ...over,
});

export const balance = (over: Partial<StockBalance> = {}): StockBalance => ({
  branchId: 'b1',
  branchCode: 'HQ',
  itemId: 'i-1',
  itemCode: 'BAT-1',
  itemName: 'Battery 12V',
  unitCode: 'PCS',
  isSerialized: false,
  reorderLevel: 5,
  available: 3,
  reserved: 1,
  inTransit: 0,
  damaged: 2,
  returned: 0,
  quarantine: 0,
  total: 6,
  isLow: true,
  ...over,
});

export const lowStock = (over: Partial<LowStock> = {}): LowStock => ({
  branchId: 'b1',
  branchCode: 'HQ',
  itemId: 'i-1',
  itemCode: 'BAT-1',
  itemName: 'Battery 12V',
  unitCode: 'PCS',
  available: 3,
  reorderLevel: 5,
  shortBy: 2,
  ...over,
});

export const movement = (over: Partial<Movement> = {}): Movement => ({
  id: 'm-1',
  createdAt: '2026-10-02T10:00:00.000Z',
  branchId: 'b1',
  branchCode: 'HQ',
  itemId: 'i-1',
  itemCode: 'BAT-1',
  itemName: 'Battery 12V',
  serialNo: null,
  state: 'AVAILABLE',
  qtyDelta: 5,
  movementType: 'ADJUSTMENT_IN',
  sourceDocType: 'STOCK_ADJUSTMENT',
  sourceDocId: 'a-1',
  createdByName: 'Asha Rao',
  ...over,
});

export const serialUnit = (over: Partial<SerialUnit> = {}): SerialUnit => ({
  id: 'u-1',
  branchId: 'b1',
  branchCode: 'HQ',
  itemId: 'i-2',
  itemCode: 'TOTO-X1',
  itemName: 'TOTO X1',
  serialNo: 'SN-1001',
  chassisNo: 'CH-1001',
  state: 'AVAILABLE',
  ...over,
});

export const adjustment = (over: Partial<StockAdjustment> = {}): StockAdjustment => ({
  id: 'a-1',
  branchId: 'b1',
  branchCode: 'HQ',
  itemId: 'i-1',
  itemCode: 'BAT-1',
  itemName: 'Battery 12V',
  isSerialized: false,
  kind: 'OUT',
  state: 'AVAILABLE',
  toState: null,
  qty: 2,
  serialUnitId: null,
  serialNo: null,
  chassisNo: null,
  reason: 'Water damage',
  status: 'PENDING',
  requestedById: 'user-2',
  requestedByName: 'Meera Das',
  approvedByName: null,
  decidedAt: null,
  decisionNote: null,
  rowVersion: 1,
  createdAt: '2026-10-02T10:00:00.000Z',
  ...over,
});

export function inventoryHandlers(
  permissions: string[] = MANAGER,
  over: Record<string, RouteHandler> = {},
  branches = [{ id: BRANCH_ID, code: 'HQ', name: 'Head Office' }],
): Record<string, RouteHandler> {
  return {
    ...signedIn(makeSession({ permissions, branches })),
    'GET /api/stock/balances?*': () => jsonResponse(page([balance()])),
    'GET /api/stock/low-stock?*': () => jsonResponse(page([lowStock()])),
    'GET /api/stock/movements?*': () => jsonResponse(page([movement()])),
    'GET /api/stock/serial-units?*': () => jsonResponse(page([serialUnit()])),
    'GET /api/stock/adjustments?*': () => jsonResponse(page([adjustment()])),
    ...over,
  };
}
