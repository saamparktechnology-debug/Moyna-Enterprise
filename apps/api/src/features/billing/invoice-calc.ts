import { DISCOUNT_STAFF_LIMIT_PERCENT } from '@erp/contracts';
import type { InvoiceTypeName } from '@erp/contracts';
import { Prisma } from '@prisma/client';
import { ValidationFailedError } from '../../common/errors/domain-errors.js';
import {
  multiplyMoney,
  roundMoney,
  splitTax,
  sumMoney,
  toMoney,
} from '../../common/money/money.js';
import type { Money, MoneyInput } from '../../common/money/money.js';

export interface CalcLineInput {
  qty: number;
  unitPrice: MoneyInput;
  discountAmount: MoneyInput;
  /** The GST rate of the item. Ignored on an invoice without GST. */
  taxRate: MoneyInput | null;
}

export interface CalcLine {
  gross: Money;
  discount: Money;
  taxable: Money;
  cgst: Money;
  sgst: Money;
  igst: Money;
  /** What the customer pays for the line: the taxable amount plus its tax. */
  amount: Money;
  /** True when the discount is more than staff may give on their own. */
  needsDiscountApproval: boolean;
}

export interface CalcResult {
  lines: CalcLine[];
  subtotal: Money;
  discountTotal: Money;
  taxableValue: Money;
  cgst: Money;
  sgst: Money;
  igst: Money;
  roundOff: Money;
  total: Money;
}

const ZERO = new Prisma.Decimal(0);

/** A sale is charged IGST when the place of supply is in a different state from the selling branch. */
export function isInterState(branchStateCode: string, placeOfSupply: string): boolean {
  return branchStateCode !== placeOfSupply;
}

export function discountNeedsApproval(gross: MoneyInput, discount: MoneyInput): boolean {
  return toMoney(discount)
    .times(100)
    .greaterThan(toMoney(gross).times(DISCOUNT_STAFF_LIMIT_PERCENT));
}

/**
 * Works out an invoice from its lines. Tax is worked out line by line and rounded half up to the paisa, then added
 * up; the total is then rounded to the nearest rupee and the difference is kept as the round-off, so the printed
 * lines always add up to the printed total.
 */
export function calculateInvoice(
  inputs: readonly CalcLineInput[],
  options: { type: InvoiceTypeName; interState: boolean },
): CalcResult {
  const lines = inputs.map((input, index): CalcLine => {
    const gross = multiplyMoney(input.unitPrice, input.qty);
    const discount = roundMoney(input.discountAmount);
    if (discount.greaterThan(gross))
      throw new ValidationFailedError('A discount is more than the price', [
        {
          field: `lines.${index}.discountAmount`,
          message: 'The discount cannot be more than the price',
        },
      ]);
    const taxable = gross.minus(discount);
    const tax =
      options.type === 'GST' && input.taxRate !== null
        ? splitTax(taxable, input.taxRate, options.interState)
        : { cgst: ZERO, sgst: ZERO, igst: ZERO, total: ZERO };
    return {
      gross,
      discount,
      taxable,
      cgst: tax.cgst,
      sgst: tax.sgst,
      igst: tax.igst,
      amount: taxable.plus(tax.total),
      needsDiscountApproval: discountNeedsApproval(gross, discount),
    };
  });
  const subtotal = sumMoney(lines.map((line) => line.gross));
  const discountTotal = sumMoney(lines.map((line) => line.discount));
  const taxableValue = subtotal.minus(discountTotal);
  const cgst = sumMoney(lines.map((line) => line.cgst));
  const sgst = sumMoney(lines.map((line) => line.sgst));
  const igst = sumMoney(lines.map((line) => line.igst));
  const exact = taxableValue.plus(cgst).plus(sgst).plus(igst);
  const total = exact.toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP);
  return {
    lines,
    subtotal,
    discountTotal,
    taxableValue,
    cgst,
    sgst,
    igst,
    roundOff: total.minus(exact),
    total,
  };
}
