import type {
  Discrepancy,
  GoodsReceipt,
  PurchaseOrder,
  PurchaseOrderSummary,
  PurchaseReturn,
  Supplier,
} from '@erp/contracts';
import { jsonResponse, makeSession, signedIn } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';

export const ALL = [
  'purchases.view',
  'purchases.create',
  'purchases.approve',
  'purchases.receive',
  'purchases.return',
  'suppliers.view',
  'suppliers.manage',
  'supplier_payments.create',
  'discrepancies.view',
  'discrepancies.resolve',
];
export const BRANCH_ID = '5b3f9c1e-0a4d-4c55-8f5e-0d6f1f0a1b2c';
export const SUPPLIER_ID = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
export const ITEM_ID = '8b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e';
export const LINE_ID = '9c3d4e5f-6a7b-4c8d-8e9f-0a1b2c3d4e5f';
export const SERIAL_LINE_ID = 'ad4e5f6a-7b8c-4d9e-9fa0-1b2c3d4e5f60';
export const SERIAL_ITEM_ID = 'be5f6a7b-8c9d-4eaf-8ab1-2c3d4e5f6071';
export const VIEWER = ['purchases.view'];
export const CLERK = ['purchases.view', 'purchases.create', 'suppliers.view'];

export function makeOrder(over: Partial<PurchaseOrder> = {}): PurchaseOrder {
  return {
    id: 'po-1',
    poNo: 'PO-HQ-0001',
    branchId: 'b-1',
    branchCode: 'HQ',
    supplierId: SUPPLIER_ID,
    supplierName: 'Bharat Batteries',
    status: 'DRAFT',
    orderDate: '2026-10-08',
    total: '1200.00',
    orderedQty: 10,
    remainingQty: 10,
    receiptCount: 0,
    lines: [
      {
        id: LINE_ID,
        itemId: ITEM_ID,
        itemCode: 'BATT-48V',
        itemName: '48V battery',
        unitCode: 'PCS',
        isSerialized: false,
        qtyOrdered: 10,
        unitCost: '120.00',
        lineTotal: '1200.00',
        accepted: 0,
        closed: 0,
        remaining: 10,
      },
    ],
    rowVersion: 3,
    ...over,
  };
}

export function summaryOf(order: PurchaseOrder): PurchaseOrderSummary {
  const { lines, ...summary } = order;
  void lines;
  return summary;
}

export const pageOf = <T>(items: T[], over: Record<string, number> = {}) => ({
  items,
  page: 1,
  pageSize: 10,
  total: items.length,
  totalPages: items.length === 0 ? 0 : 1,
  ...over,
});

export function makeSupplier(over: Partial<Supplier> = {}): Supplier {
  return {
    id: SUPPLIER_ID,
    name: 'Bharat Batteries',
    gstin: '29ABCDE1234F1Z5',
    phone: '9876543210',
    stateCode: '29',
    isActive: true,
    rowVersion: 2,
    ...over,
  };
}

export function makeDiscrepancy(over: Partial<Discrepancy> = {}): Discrepancy {
  return {
    id: 'd-1',
    branchId: 'b-1',
    branchCode: 'HQ',
    type: 'SHORT',
    qty: 2,
    status: 'OPEN',
    resolution: null,
    resolvedAt: null,
    itemId: ITEM_ID,
    itemCode: 'BATT-48V',
    itemName: '48V battery',
    documentNo: 'GRN-HQ-0001',
    supplierName: 'Bharat Batteries',
    allowedResolutions: ['WRITE_OFF'],
    rowVersion: 1,
    createdAt: '2026-10-08T05:00:00.000Z',
    ...over,
  } as Discrepancy;
}

export function makeReceipt(over: Partial<GoodsReceipt> = {}): GoodsReceipt {
  return {
    id: 'gr-1',
    grnNo: 'GRN-HQ-0001',
    poId: 'po-1',
    poNo: 'PO-HQ-0001',
    branchId: 'b-1',
    branchCode: 'HQ',
    supplierName: 'Bharat Batteries',
    receivedAt: '2026-10-08T06:00:00.000Z',
    receivedByName: 'Asha Rao',
    deliveryNoteNo: 'DN-77',
    note: null,
    lines: [
      {
        id: 'gl-1',
        poLineId: LINE_ID,
        itemId: ITEM_ID,
        itemCode: 'BATT-48V',
        itemName: '48V battery',
        qtyReceived: 8,
        qtyAccepted: 8,
        discrepancies: [],
      },
    ],
    ...over,
  };
}

export function makeReturn(over: Partial<PurchaseReturn> = {}): PurchaseReturn {
  return {
    id: 'pr-1',
    returnNo: 'PRN-HQ-0001',
    branchId: 'b-1',
    branchCode: 'HQ',
    supplierId: SUPPLIER_ID,
    supplierName: 'Bharat Batteries',
    poNo: 'PO-HQ-0001',
    discrepancyId: null,
    reason: 'Faulty cells',
    returnedOn: '2026-10-08',
    credit: '240.00',
    lines: [
      {
        id: 'rl-1',
        itemId: ITEM_ID,
        itemCode: 'BATT-48V',
        itemName: '48V battery',
        qty: 2,
        serialNo: null,
        unitCost: '120.00',
      },
    ],
    ...over,
  };
}

export function purchasingHandlers(
  permissions: string[] = ALL,
  orders: PurchaseOrder[] = [makeOrder()],
): Record<string, RouteHandler> {
  return {
    ...signedIn(
      makeSession({
        permissions,
        branches: [{ id: BRANCH_ID, code: 'HQ', name: 'Head Office' }],
      }),
    ),
    'GET /api/purchase-orders?*': () => jsonResponse(pageOf(orders.map(summaryOf))),
    ...Object.fromEntries(
      orders.map((order) => [`GET /api/purchase-orders/${order.id}`, () => jsonResponse(order)]),
    ),
    'GET /api/suppliers?*': () => jsonResponse(pageOf([makeSupplier()])),
    'GET /api/goods-receipts?*': () => jsonResponse(pageOf([makeReceipt()])),
    'GET /api/discrepancies?*': () => jsonResponse(pageOf([makeDiscrepancy()])),
    'GET /api/purchase-returns?*': () => jsonResponse(pageOf([makeReturn()])),
  };
}
