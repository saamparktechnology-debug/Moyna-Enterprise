import { toPaise } from '@erp/contracts';

export interface OpenDue {
  invoiceId: string;
  outstanding: string;
}

export interface PlannedAllocation {
  invoiceId: string;
  amount: string;
}

export function fromPaise(paise: number): string {
  const whole = Math.floor(paise / 100);
  const fraction = String(paise % 100).padStart(2, '0');
  return `${whole}.${fraction}`;
}

/**
 * Settles dues in the order given (the caller sorts them oldest first) until the money runs out. Each invoice takes
 * at most what it still owes, so nothing is over-applied; what is left over stays with the customer as credit.
 */
export function planAutomaticAllocation(
  dues: readonly OpenDue[],
  amount: string,
): { allocations: PlannedAllocation[]; leftover: string } {
  let remaining = toPaise(amount);
  const allocations: PlannedAllocation[] = [];
  for (const due of dues) {
    if (remaining <= 0) break;
    const owed = toPaise(due.outstanding);
    if (owed <= 0) continue;
    const take = Math.min(owed, remaining);
    allocations.push({ invoiceId: due.invoiceId, amount: fromPaise(take) });
    remaining -= take;
  }
  return { allocations, leftover: fromPaise(remaining) };
}
