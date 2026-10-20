import type { Customer, Invoice, InvoicePreview, InvoiceSummary } from '@erp/contracts';
import { jsonResponse, makeSession, signedIn } from '@/test/fetch-mock';
import type { RouteHandler } from '@/test/fetch-mock';
import { itemPage, makeItem } from '../items/test-data';

export const BRANCH_ID = '5b3f9c1e-0a4d-4c55-8f5e-0d6f1f0a1b2c';
export const CUSTOMER_ID = '7a1b2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d';
export const ITEM_ID = '8b2c3d4e-5f6a-4b7c-9d8e-0f1a2b3c4d5e';
export const SERIAL_ITEM_ID = 'be5f6a7b-8c9d-4eaf-8ab1-2c3d4e5f6071';
export const UNIT_ID = 'cf6a7b8c-9d0e-4fb1-9bc2-3d4e5f607182';
export const UNIT_TWO_ID = 'd07b8c9d-0e1f-4ac2-8cd3-4e5f60718293';

export const CASHIER = [
  'invoices.view',
  'invoices.create',
  'customers.view',
  'items.view',
  'stock.view',
];
export const MANAGER = [...CASHIER, 'invoices.cancel', 'discounts.approve'];
export const VIEWER = ['invoices.view'];

export const CUSTOMER: Customer = {
  id: CUSTOMER_ID,
  name: 'Ravi Kumar',
  phone: '9000000001',
  email: null,
  address: null,
  stateCode: '27',
  stateName: 'Maharashtra',
  gstin: null,
  kycStatus: 'VERIFIED',
  rowVersion: 1,
  createdAt: '2026-10-01T00:00:00.000Z',
};

export function makeInvoice(over: Partial<Invoice> = {}): Invoice {
  return {
    id: 'inv-1',
    invoiceNo: null,
    type: 'GST',
    status: 'DRAFT',
    branchId: BRANCH_ID,
    branchCode: 'HQ',
    customerId: CUSTOMER_ID,
    customerName: 'Ravi Kumar',
    customerGstin: null,
    branchGstin: '29ABCDE1234F1Z5',
    brokerId: null,
    brokerName: null,
    quotationId: null,
    quotationNo: null,
    placeOfSupply: '27',
    interState: true,
    issuedOn: null,
    dueDate: null,
    subtotal: '2000.00',
    discountTotal: '100.00',
    taxableValue: '1900.00',
    cgstAmount: '0.00',
    sgstAmount: '0.00',
    igstAmount: '342.00',
    roundOff: '0.00',
    total: '2242.00',
    lines: [
      {
        id: 'l-1',
        itemId: ITEM_ID,
        itemCode: 'BATT-48V',
        itemName: '48V battery',
        unitCode: 'PCS',
        hsnCode: '8507',
        taxRate: '18.00',
        qty: 2,
        unitPrice: '1000.00',
        discountAmount: '100.00',
        taxableAmount: '1900.00',
        cgstAmount: '0.00',
        sgstAmount: '0.00',
        igstAmount: '342.00',
        amount: '2242.00',
        serialUnitId: null,
        serialNo: null,
      },
    ],
    replacesInvoiceId: null,
    replacesInvoiceNo: null,
    cancelledAt: null,
    cancelledByName: null,
    cancelReason: null,
    rowVersion: 4,
    createdAt: '2026-10-08T00:00:00.000Z',
    ...over,
  };
}

export const ISSUED = (over: Partial<Invoice> = {}): Invoice =>
  makeInvoice({
    status: 'ISSUED',
    invoiceNo: 'HQ/GI/26-27/00001',
    issuedOn: '2026-10-08',
    ...over,
  });

export function summaryOf(invoice: Invoice): InvoiceSummary {
  return {
    id: invoice.id,
    invoiceNo: invoice.invoiceNo,
    type: invoice.type,
    status: invoice.status,
    branchCode: invoice.branchCode,
    customerName: invoice.customerName,
    issuedOn: invoice.issuedOn,
    dueDate: invoice.dueDate,
    total: invoice.total,
    lineCount: invoice.lines.length,
    createdAt: invoice.createdAt,
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

export function previewOf(over: Partial<InvoicePreview> = {}): InvoicePreview {
  const { lines } = makeInvoice();
  return {
    interState: true,
    placeOfSupply: '27',
    subtotal: '2000.00',
    discountTotal: '100.00',
    taxableValue: '1900.00',
    cgstAmount: '0.00',
    sgstAmount: '0.00',
    igstAmount: '342.00',
    roundOff: '0.00',
    total: '2242.00',
    lines,
    ...over,
  };
}

export const serialUnits = (serials: [string, string][]) => ({
  items: serials.map(([id, serialNo]) => ({
    id,
    branchId: BRANCH_ID,
    branchCode: 'HQ',
    itemId: SERIAL_ITEM_ID,
    itemCode: 'TOTO-X1',
    itemName: 'TOTO X1',
    serialNo,
    chassisNo: null,
    state: 'AVAILABLE',
  })),
  page: 1,
  pageSize: 50,
  total: serials.length,
  totalPages: 1,
});

export function billingHandlers(
  permissions: string[] = MANAGER,
  invoices: Invoice[] = [makeInvoice()],
): Record<string, RouteHandler> {
  return {
    ...signedIn(
      makeSession({ permissions, branches: [{ id: BRANCH_ID, code: 'HQ', name: 'Head Office' }] }),
    ),
    'GET /api/invoices?*': () => jsonResponse(pageOf(invoices.map(summaryOf))),
    ...Object.fromEntries(
      invoices.map((invoice) => [`GET /api/invoices/${invoice.id}`, () => jsonResponse(invoice)]),
    ),
    'GET /api/customers?*': () => jsonResponse(pageOf([CUSTOMER])),
    'GET /api/items?*': () =>
      jsonResponse(
        itemPage([
          makeItem({ id: ITEM_ID, itemCode: 'BATT-48V', name: '48V battery', isSerialized: false }),
          makeItem({
            id: SERIAL_ITEM_ID,
            itemCode: 'TOTO-X1',
            name: 'TOTO X1',
            isSerialized: true,
          }),
        ]),
      ),
    'GET /api/stock/serial-units?*': () =>
      jsonResponse(
        serialUnits([
          [UNIT_ID, 'SN-0001'],
          [UNIT_TWO_ID, 'SN-0002'],
        ]),
      ),
    'POST /api/invoices/preview': () => jsonResponse(previewOf()),
  };
}
