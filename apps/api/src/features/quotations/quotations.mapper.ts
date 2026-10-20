import { Prisma } from '@prisma/client';
import type { BuildStageName, Quotation, QuotationAdvance, QuotationSummary } from '@erp/contracts';
import { isInterState } from '../billing/invoice-calc.js';

export const SUMMARY_INCLUDE = {
  branch: { select: { code: true } },
  customer: { select: { name: true } },
} satisfies Prisma.QuotationInclude;

export const DETAIL_INCLUDE = {
  branch: { select: { code: true, stateCode: true } },
  customer: { select: { name: true } },
  broker: { select: { name: true } },
  lines: {
    orderBy: [{ lineNo: 'asc' }],
    include: {
      item: { select: { itemCode: true, name: true, isSerialized: true } },
      serialUnit: {
        select: {
          id: true,
          serialNo: true,
          chassisNo: true,
          motorNo: true,
          installedBatteries: {
            select: { serialUnit: { select: { id: true, serialNo: true } } },
            orderBy: { serialUnitId: 'asc' },
          },
        },
      },
    },
  },
  advances: {
    orderBy: [{ paidOn: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }],
    include: { paymentMode: { select: { name: true } }, reversal: { select: { id: true } } },
  },
  buildUpdates: { orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] },
} satisfies Prisma.QuotationInclude;

export type QuotationDetailRow = Prisma.QuotationGetPayload<{ include: typeof DETAIL_INCLUDE }>;
export type QuotationSummaryRow = Prisma.QuotationGetPayload<{ include: typeof SUMMARY_INCLUDE }>;

const day = (value: Date): string => value.toISOString().slice(0, 10);

export function liveAdvanceTotal(
  advances: readonly { amount: Prisma.Decimal; reversal: unknown }[],
): Prisma.Decimal {
  return advances
    .filter((a) => !a.reversal)
    .reduce((sum, a) => sum.plus(a.amount), new Prisma.Decimal(0));
}

export function toSummaryDto(
  row: QuotationSummaryRow,
  advancePaid: Prisma.Decimal,
): QuotationSummary {
  return {
    id: row.id,
    quotationNo: row.quotationNo,
    status: row.status,
    branchId: row.branchId,
    branchCode: row.branch.code,
    customerId: row.customerId,
    customerName: row.customer.name,
    type: row.type,
    validUntil: day(row.validUntil),
    isCustomBuild: row.isCustomBuild,
    buildStage: row.buildStage as BuildStageName,
    total: row.total.toFixed(2),
    advancePaid: advancePaid.toFixed(2),
    createdAt: row.createdAt.toISOString(),
  };
}

export function toQuotationDto(
  row: QuotationDetailRow,
  names: ReadonlyMap<string, string>,
  invoice: { id: string; invoiceNo: string | null; status: 'DRAFT' | 'ISSUED' } | null,
): Quotation {
  const paid = liveAdvanceTotal(row.advances);
  const due = Prisma.Decimal.max(row.total.minus(paid), new Prisma.Decimal(0));
  const advances: QuotationAdvance[] = row.advances.map((a) => ({
    paymentId: a.id,
    receiptNo: a.receiptNo,
    mode: a.mode,
    modeName: a.paymentMode.name,
    amount: a.amount.toFixed(2),
    paidOn: day(a.paidOn),
    reference: a.reference,
    status: a.reversal ? 'REVERSED' : 'ACTIVE',
  }));
  return {
    ...toSummaryDto({ ...row, branch: { code: row.branch.code } }, paid),
    subtotal: row.subtotal.toFixed(2),
    discountTotal: row.discountTotal.toFixed(2),
    taxableValue: row.taxableValue.toFixed(2),
    cgstAmount: row.cgstAmount.toFixed(2),
    sgstAmount: row.sgstAmount.toFixed(2),
    igstAmount: row.igstAmount.toFixed(2),
    roundOff: row.roundOff.toFixed(2),
    placeOfSupply: row.placeOfSupply,
    interState: row.placeOfSupply ? isInterState(row.branch.stateCode, row.placeOfSupply) : false,
    brokerId: row.brokerId,
    brokerName: row.broker?.name ?? null,
    specification: row.specification,
    balanceDue: due.toFixed(2),
    sentAt: row.sentAt?.toISOString() ?? null,
    acceptedAt: row.acceptedAt?.toISOString() ?? null,
    cancelledAt: row.cancelledAt?.toISOString() ?? null,
    cancelReason: row.cancelReason,
    createdByName: row.createdBy ? (names.get(row.createdBy) ?? null) : null,
    rowVersion: row.rowVersion,
    lines: row.lines.map((line) => ({
      id: line.id,
      lineNo: line.lineNo,
      itemId: line.itemId,
      itemCode: line.item.itemCode,
      itemName: line.item.name,
      isSerialized: line.item.isSerialized,
      qty: line.qty,
      unitPrice: line.unitPrice.toFixed(2),
      discountAmount: line.discountAmount.toFixed(2),
      taxRate: line.taxRate?.toFixed(2) ?? null,
      taxableAmount: line.taxableAmount.toFixed(2),
      amount: line.amount.toFixed(2),
      unit: line.serialUnit
        ? {
            id: line.serialUnit.id,
            serialNo: line.serialUnit.serialNo,
            chassisNo: line.serialUnit.chassisNo,
            motorNo: line.serialUnit.motorNo,
            batteries: line.serialUnit.installedBatteries.map((b) => ({
              id: b.serialUnit.id,
              serialNo: b.serialUnit.serialNo,
            })),
          }
        : null,
    })),
    advances,
    buildUpdates: row.buildUpdates.map((update) => ({
      id: update.id,
      stage: update.stage as BuildStageName,
      note: update.note,
      createdByName: update.createdBy ? (names.get(update.createdBy) ?? null) : null,
      createdAt: update.createdAt.toISOString(),
    })),
    invoiceId: invoice?.id ?? null,
    invoiceNo: invoice?.invoiceNo ?? null,
    invoiceStatus: invoice?.status ?? null,
  };
}

export function userIdsOf(row: QuotationDetailRow): string[] {
  const ids = new Set<string>();
  if (row.createdBy) ids.add(row.createdBy);
  for (const update of row.buildUpdates) if (update.createdBy) ids.add(update.createdBy);
  return [...ids];
}
