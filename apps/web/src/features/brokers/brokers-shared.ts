import type { CommissionRuleTypeName, CommissionStatusName } from '@erp/contracts';

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

/** A balance that may be negative: a negative figure means the broker has been paid more than is due. */
export function owedText(value: string): string {
  return Number(value) < 0 ? `${value.replace('-', '')} to get back` : value;
}
