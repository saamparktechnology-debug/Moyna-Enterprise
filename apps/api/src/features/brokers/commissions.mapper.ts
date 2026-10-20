import { Prisma } from '@prisma/client';
import type { Commission } from '@erp/contracts';
import { overpaid } from './commission-calc.js';

export const COMMISSION_INCLUDE = {
  branch: { select: { code: true } },
  broker: { select: { name: true } },
  invoice: { select: { invoiceNo: true, customer: { select: { name: true } } } },
  rule: { select: { type: true, value: true } },
  adjustments: { select: { amount: true } },
} satisfies Prisma.CommissionInclude;

export type CommissionRow = Prisma.CommissionGetPayload<{ include: typeof COMMISSION_INCLUDE }>;

export function adjustedOf(row: Pick<CommissionRow, 'adjustments'>): Prisma.Decimal {
  return row.adjustments.reduce((sum, a) => sum.plus(a.amount), new Prisma.Decimal(0));
}

export function effectiveOf(row: Pick<CommissionRow, 'amount' | 'adjustments'>): Prisma.Decimal {
  return row.amount.minus(adjustedOf(row));
}

export function toCommissionDto(row: CommissionRow): Commission {
  const adjusted = adjustedOf(row);
  const effective = row.amount.minus(adjusted);
  return {
    id: row.id,
    status: row.status,
    branchId: row.branchId,
    branchCode: row.branch.code,
    brokerId: row.brokerId,
    brokerName: row.broker.name,
    invoiceId: row.invoiceId,
    invoiceNo: row.invoice.invoiceNo,
    customerName: row.invoice.customer.name,
    ruleType: row.rule.type,
    ruleValue: row.rule.value.toFixed(2),
    baseAmount: row.baseAmount.toFixed(2),
    amount: row.amount.toFixed(2),
    adjusted: adjusted.toFixed(2),
    effective: effective.toFixed(2),
    paidAt: row.paidAt?.toISOString() ?? null,
    paidAmount: row.paidAmount?.toFixed(2) ?? null,
    payoutReference: row.payoutReference,
    toRecover:
      row.status === 'PAID' && row.paidAmount
        ? overpaid(row.paidAmount, effective).toFixed(2)
        : '0.00',
    createdAt: row.createdAt.toISOString(),
  };
}
