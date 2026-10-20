import type { Battery } from '@erp/contracts';
import { jsonResponse, makeSession, signedIn } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';

export function makeBattery(over: Partial<Battery> = {}): Battery {
  return {
    serialUnitId: 'u-1',
    serialNo: 'BAT-0001',
    chassisNo: null,
    itemId: 'i-1',
    itemCode: 'BATT-48V',
    itemName: '48V lead-acid battery',
    branchId: 'b-1',
    branchCode: 'HQ',
    state: 'AVAILABLE',
    manufacturedOn: '2026-01-10',
    expiryOn: '2027-01-10',
    expiryStatus: 'OK',
    daysToExpiry: 200,
    warrantyMonths: 12,
    warrantyEnd: null,
    warrantyStatus: 'NONE',
    installedInSerialUnitId: null,
    installedInSerialNo: null,
    installedOn: null,
    rowVersion: 2,
    ...over,
  };
}

export const batteryPage = (items: Battery[], over: Record<string, number> = {}) => ({
  items,
  page: 1,
  pageSize: 10,
  total: items.length,
  totalPages: items.length === 0 ? 0 : 1,
  ...over,
});

export const MANAGER = [
  'batteries.view',
  'stock.view',
  'stock.adjust',
  'batteries.override_expiry',
];
export const STAFF = ['batteries.view', 'stock.view', 'stock.adjust'];
export const VIEWER = ['batteries.view'];

export const serialUnitPage = (serials: string[]) => ({
  items: serials.map((serialNo, index) => ({
    id: `s-${index + 1}`,
    branchId: 'b-1',
    branchCode: 'HQ',
    itemId: 'i-9',
    itemCode: 'TOTO-X1',
    itemName: 'TOTO X1',
    serialNo,
    chassisNo: null,
    state: 'AVAILABLE',
  })),
  page: 1,
  pageSize: 10,
  total: serials.length,
  totalPages: 1,
});

export function batteryHandlers(
  permissions: string[] = MANAGER,
  items: Battery[] = [makeBattery()],
): Record<string, RouteHandler> {
  return {
    ...signedIn(makeSession({ permissions })),
    'GET /api/batteries?*': () => jsonResponse(batteryPage(items)),
    'GET /api/batteries/alerts*': () => jsonResponse({ withinDays: 30, expired: 2, expiring: 5 }),
  };
}
