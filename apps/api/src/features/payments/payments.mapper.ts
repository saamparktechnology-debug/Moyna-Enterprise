import { Prisma } from '@prisma/client';
import type { Payment, PaymentSummary } from '@erp/contracts';

export const PAYMENT_INCLUDE = {
  branch: { select: { code: true } },
  customer: { select: { name: true } },
  paymentMode: { select: { name: true } },
  paymentAllocations: {
    include: { invoice: { select: { invoiceNo: true } } },
    orderBy: [{ createdAt: 'asc' }, { invoiceId: 'asc' }],
  },
  reversal: true,
} satisfies Prisma.PaymentInclude;

export type PaymentRow = Prisma.PaymentGetPayload<{ include: typeof PAYMENT_INCLUDE }>;

const day = (value: Date): string => value.toISOString().slice(0, 10);

export function allocatedOf(row: PaymentRow): Prisma.Decimal {
  return row.paymentAllocations.reduce((sum, a) => sum.plus(a.amount), new Prisma.Decimal(0));
}

/** What is left of an active payment after its allocations. A reversed payment holds nothing. */
export function unallocatedOf(row: PaymentRow): Prisma.Decimal {
  return row.reversal ? new Prisma.Decimal(0) : row.amount.minus(allocatedOf(row));
}

export function toSummaryDto(row: PaymentRow, names: ReadonlyMap<string, string>): PaymentSummary {
  return {
    id: row.id,
    receiptNo: row.receiptNo,
    status: row.reversal ? 'REVERSED' : 'ACTIVE',
    branchId: row.branchId,
    branchCode: row.branch.code,
    customerId: row.customerId,
    customerName: row.customer.name,
    mode: row.mode,
    modeName: row.paymentMode.name,
    amount: row.amount.toFixed(2),
    allocated: allocatedOf(row).toFixed(2),
    unallocated: unallocatedOf(row).toFixed(2),
    paidOn: day(row.paidOn),
    reference: row.reference,
    createdByName: row.createdBy ? (names.get(row.createdBy) ?? null) : null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function toPaymentDto(row: PaymentRow, names: ReadonlyMap<string, string>): Payment {
  const { reversal } = row;
  return {
    ...toSummaryDto(row, names),
    note: row.note,
    allocations: row.paymentAllocations.map((a) => ({
      invoiceId: a.invoiceId,
      invoiceNo: a.invoice.invoiceNo,
      amount: a.amount.toFixed(2),
    })),
    reversal: reversal
      ? {
          reason: reversal.reason,
          reversedOn: day(reversal.reversedOn),
          reversedAt: reversal.createdAt.toISOString(),
          reversedByName: reversal.createdBy ? (names.get(reversal.createdBy) ?? null) : null,
        }
      : null,
  };
}

export function userIdsOf(rows: readonly PaymentRow[]): string[] {
  const ids = new Set<string>();
  for (const row of rows) {
    if (row.createdBy) ids.add(row.createdBy);
    if (row.reversal?.createdBy) ids.add(row.reversal.createdBy);
  }
  return [...ids];
}
