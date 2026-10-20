import { Prisma } from '@prisma/client';
import type { CommissionRuleTypeName } from '@erp/contracts';

const { Decimal } = Prisma;
type Money = Prisma.Decimal;

const round = (value: Money): Money => value.toDecimalPlaces(2, Decimal.ROUND_HALF_UP);

/**
 * What a rule pays on an invoice whose taxable value (before GST) is `base`. A percentage is of the base, rounded to the
 * paisa (halves up); a fixed amount is paid as it is. Either way the commission never exceeds the base, and an invoice
 * with nothing taxable pays nothing.
 */
export function commissionFor(
  rule: { type: CommissionRuleTypeName; value: Money },
  base: Money,
): Money {
  if (base.lte(0)) return new Decimal(0);
  const raw = rule.type === 'PERCENT' ? base.mul(rule.value).div(100) : rule.value;
  return Decimal.min(round(raw), base);
}

/**
 * How much of a commission should be taken back once credit notes totalling `creditedBase` (taxable value) have been
 * approved against an invoice whose taxable value is `base`: the same share as the credited share of the invoice, in
 * total and not note by note, so the paisa never drift. Credit of the whole invoice takes back the whole commission.
 */
export function totalReduction(amount: Money, creditedBase: Money, base: Money): Money {
  if (amount.lte(0)) return new Decimal(0);
  if (base.lte(0) || creditedBase.gte(base)) return amount;
  if (creditedBase.lte(0)) return new Decimal(0);
  return Decimal.min(round(amount.mul(creditedBase).div(base)), amount);
}

/** What a paid commission is now over-paid by, after later reductions. */
export function overpaid(paidAmount: Money, effective: Money): Money {
  return Decimal.max(paidAmount.minus(effective), new Decimal(0));
}
