import type { Prisma } from '@prisma/client';
import type {
  Invoice,
  InvoiceLine,
  InvoiceStatusName,
  InvoiceSummary,
  InvoiceTypeName,
} from '@erp/contracts';
import { isInterState } from './invoice-calc.js';
import { invoiceProfit, lineProfit, unitCostFor } from './profit.js';
import type { ProfitLine, ProfitViewer } from './profit.js';

export const INVOICE_INCLUDE = {
  branch: true,
  customer: true,
  broker: true,
  quotation: { select: { quotationNo: true } },
  replaces: true,
  canceller: true,
  invoiceLines: {
    include: { item: true, serialUnit: true },
    orderBy: [{ lineNo: 'asc' }],
  },
} satisfies Prisma.InvoiceInclude;
export type InvoiceRow = Prisma.InvoiceGetPayload<{ include: typeof INVOICE_INCLUDE }>;

const day = (value: Date | null): string | null =>
  value ? value.toISOString().slice(0, 10) : null;
const money = (value: { toFixed: (places: number) => string }): string => value.toFixed(2);

export function toLineDto(
  line: InvoiceRow['invoiceLines'][number],
  viewer: ProfitViewer,
): InvoiceLine {
  const cost = unitCostFor(line, viewer);
  const profit = lineProfit(line, viewer);
  return {
    id: line.id,
    itemId: line.itemId,
    itemCode: line.item.itemCode,
    itemName: line.item.name,
    unitCode: line.item.unitCode,
    hsnCode: line.hsnCode,
    taxRate: line.taxRate === null ? null : money(line.taxRate),
    qty: line.qty,
    unitPrice: money(line.unitPrice),
    discountAmount: money(line.discountAmount),
    taxableAmount: money(line.taxableAmount),
    cgstAmount: money(line.cgstAmount),
    sgstAmount: money(line.sgstAmount),
    igstAmount: money(line.igstAmount),
    amount: money(line.amount),
    serialUnitId: line.serialUnitId,
    serialNo: line.serialUnit?.serialNo ?? null,
    unitCost: cost === null ? null : money(cost),
    profit: profit === null ? null : money(profit),
  };
}

/** Profit counts only for an issued invoice; a draft or a cancelled one has made no sale. */
function profitOf(
  row: { status: string; invoiceLines: readonly ProfitLine[] },
  viewer: ProfitViewer,
): string | null {
  if (row.status !== 'ISSUED') return null;
  const profit = invoiceProfit(row.invoiceLines, viewer);
  return profit === null ? null : money(profit);
}

function commissionOf(row: InvoiceRow): Invoice['commission'] {
  if (
    row.commissionType !== 'NONE' &&
    row.commissionType !== 'FIXED' &&
    row.commissionType !== 'GIFT'
  )
    return null;
  return {
    type: row.commissionType,
    amount: row.commissionAmount?.toFixed(2) ?? null,
    giftName: row.giftName,
    hasPhoto: row.giftPhotoKey !== null,
    photoFileName: row.giftPhotoFileName,
  };
}

export function toInvoiceDto(row: InvoiceRow, viewer: ProfitViewer): Invoice {
  return {
    id: row.id,
    invoiceNo: row.invoiceNo,
    type: row.type as InvoiceTypeName,
    status: row.status as InvoiceStatusName,
    branchId: row.branchId,
    branchCode: row.branch.code,
    customerId: row.customerId,
    customerName: row.customer.name,
    customerGstin: row.customerGstin,
    branchGstin: row.branchGstin,
    brokerId: row.brokerId,
    brokerName: row.broker?.name ?? null,
    commission: commissionOf(row),
    quotationId: row.quotationId,
    quotationNo: row.quotation?.quotationNo ?? null,
    placeOfSupply: row.placeOfSupply,
    interState: row.placeOfSupply ? isInterState(row.branch.stateCode, row.placeOfSupply) : false,
    issuedOn: day(row.issuedOn),
    dueDate: day(row.dueDate),
    subtotal: money(row.subtotal),
    discountTotal: money(row.discountTotal),
    taxableValue: money(row.taxableValue),
    cgstAmount: money(row.cgstAmount),
    sgstAmount: money(row.sgstAmount),
    igstAmount: money(row.igstAmount),
    roundOff: money(row.roundOff),
    total: money(row.total),
    lines: row.invoiceLines.map((line) => toLineDto(line, viewer)),
    profit: profitOf(row, viewer),
    replacesInvoiceId: row.replacesInvoiceId,
    replacesInvoiceNo: row.replaces?.invoiceNo ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancelledByName: row.canceller?.fullName ?? null,
    cancelReason: row.cancelReason,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
  };
}

export type SummaryRow = Prisma.InvoiceGetPayload<{
  include: {
    branch: true;
    customer: true;
    _count: { select: { invoiceLines: true } };
    invoiceLines: {
      select: {
        qty: true;
        taxableAmount: true;
        unitCostActual: true;
        unitCostDisplay: true;
      };
    };
  };
}>;

export function toSummaryDto(row: SummaryRow, viewer: ProfitViewer): InvoiceSummary {
  return {
    id: row.id,
    invoiceNo: row.invoiceNo,
    type: row.type as InvoiceTypeName,
    status: row.status as InvoiceStatusName,
    branchCode: row.branch.code,
    customerName: row.customer.name,
    issuedOn: day(row.issuedOn),
    dueDate: day(row.dueDate),
    total: money(row.total),
    lineCount: row._count.invoiceLines,
    profit: profitOf(row, viewer),
    createdAt: row.createdAt.toISOString(),
  };
}

export function invoiceSnapshot(row: InvoiceRow): Record<string, unknown> {
  return {
    invoiceNo: row.invoiceNo,
    type: row.type,
    status: row.status,
    customerId: row.customerId,
    total: money(row.total),
    lines: row.invoiceLines.length,
  };
}
