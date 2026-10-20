import type { DueStatusName } from '@erp/contracts';
import { Alert } from '@/components/alert';
import type { Problem } from '../purchasing/purchasing-shared';

export const DUE_STATUS_TEXT: Record<DueStatusName, string> = {
  UNPAID: 'Unpaid',
  PARTIAL: 'Part paid',
  PAID: 'Settled',
};

export const DUE_SCOPE_TEXT = {
  outstanding: 'Outstanding',
  overdue: 'Overdue',
  settled: 'Settled',
  all: 'All',
} as const;

export const LEDGER_TYPE_TEXT = {
  INVOICE: 'Invoice',
  INVOICE_CANCELLED: 'Invoice cancelled',
  CREDIT_NOTE: 'Credit note',
  PAYMENT: 'Payment',
  PAYMENT_REVERSAL: 'Payment reversed',
  REFUND: 'Refund paid',
} as const;

export function ProblemAlert({ problem }: { problem: Problem }) {
  return (
    <Alert tone="error">
      <p>{problem.message}</p>
      {problem.reasons.length > 0 ? (
        <ul className="mt-1 list-disc pl-5">
          {problem.reasons.map((reason) => (
            <li key={reason}>{reason}</li>
          ))}
        </ul>
      ) : null}
    </Alert>
  );
}

/** A balance that may be negative: a negative figure means the customer has credit. */
export function balanceText(value: string): string {
  return Number(value) < 0 ? `${value.replace('-', '')} credit` : value;
}
