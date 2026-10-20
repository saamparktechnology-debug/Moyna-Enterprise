import type { Item, ItemCategory } from '@erp/contracts';
import { jsonResponse, makeSession, signedIn } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';

export const CATEGORY_ROOT = '11111111-1111-4111-8111-aaaaaaaaaaaa';
export const CATEGORY_CHILD = '22222222-2222-4222-8222-bbbbbbbbbbbb';

export function makeItem(over: Partial<Item> = {}): Item {
  return {
    id: 'i-1',
    itemCode: 'TOTO-X1',
    name: 'TOTO X1 e-rickshaw',
    categoryId: CATEGORY_ROOT,
    categoryName: 'TOTO Vehicles',
    unitCode: 'PCS',
    unitName: 'Pieces',
    hsnCode: '8703',
    hsnDescription: 'E-rickshaw',
    taxRate: '5.00',
    reorderLevel: 2,
    isSerialized: true,
    isActive: true,
    barcodes: [{ id: 'bc-1', barcode: '2000000000015' }],
    rowVersion: 3,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...over,
  };
}

export function itemPage(items: Item[], over: Record<string, number> = {}) {
  return {
    items,
    page: 1,
    pageSize: 10,
    total: items.length,
    totalPages: items.length === 0 ? 0 : 1,
    ...over,
  };
}

export const CATEGORIES: ItemCategory[] = [
  {
    id: CATEGORY_ROOT,
    name: 'Spare Parts',
    parentId: null,
    parentName: null,
    isActive: true,
    itemCount: 4,
    rowVersion: 1,
  },
  {
    id: CATEGORY_CHILD,
    name: 'Tyres',
    parentId: CATEGORY_ROOT,
    parentName: 'Spare Parts',
    isActive: true,
    itemCount: 0,
    rowVersion: 1,
  },
];

export const MANAGER = ['items.view', 'items.manage'];
export const VIEWER = ['items.view'];

export function itemHandlers(
  permissions: string[] = MANAGER,
  items: Item[] = [makeItem()],
): Record<string, RouteHandler> {
  return {
    ...signedIn(makeSession({ permissions })),
    'GET /api/items?*': () => jsonResponse(itemPage(items)),
    'GET /api/item-categories': () => jsonResponse(CATEGORIES),
    'GET /api/reference/units': () =>
      jsonResponse([
        { code: 'PCS', name: 'Pieces' },
        { code: 'KG', name: 'Kilogram' },
      ]),
    'GET /api/reference/gst-rates': () =>
      jsonResponse([
        { rate: '5.00', label: 'GST 5%' },
        { rate: '18.00', label: 'GST 18%' },
      ]),
    'GET /api/reference/hsn-codes*': () =>
      jsonResponse({
        items: [{ code: '8703', description: 'E-rickshaw', gstRate: '5.00' }],
        page: 1,
        pageSize: 20,
        total: 1,
        totalPages: 1,
      }),
  };
}
