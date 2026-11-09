//apps/web/src/features/brokers/brokers-shared.ts
import type { Commission, CommissionRuleTypeName, CommissionStatusName } from '@erp/contracts';

export const COMMISSION_STATUS_TEXT: Record<CommissionStatusName, string> = {
  PAYABLE: 'To pay',
  PAID: 'Paid',
  REVERSED: 'Reversed',
};

export const LEDGER_TYPE_TEXT = {
  COMMISSION: 'Commission',
  CREDIT_NOTE: 'Credit note',
  INVOICE_CANCELLED: 'Invoice cancelled',
  PAYOUT: 'Paid out',
} as const;

/** A rule as people say it: "2.5% of the taxable value" or "500.00 a sale". */
export function ruleText(rule: { type: CommissionRuleTypeName; value: string } | null): string {
  if (!rule) return 'No rule';
  return rule.type === 'PERCENT' ? `${Number(rule.value)}%` : `${rule.value} a sale`;
}

/** What a commission was worked out on, as people say it. */
export function commissionBasis(
  commission: Pick<Commission, 'kind' | 'ruleType' | 'ruleValue' | 'giftName' | 'baseAmount'>,
): string {
  if (commission.kind === 'GIFT') return `Gift: ${commission.giftName ?? ''}`;
  if (commission.kind === 'FIXED') return 'Agreed with the broker';
  if (commission.ruleType && commission.ruleValue !== null)
    return `${ruleText({ type: commission.ruleType, value: commission.ruleValue })} of ${commission.baseAmount}`;
  return `Of ${commission.baseAmount}`;
}

/** A balance that may be negative: a negative figure means the broker has been paid more than is due. */
export function owedText(value: string): string {
  return Number(value) < 0 ? `${value.replace('-', '')} to get back` : value;
}
