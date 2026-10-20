import { Prisma } from '@prisma/client';

const Decimal = Prisma.Decimal;
export type Money = Prisma.Decimal;
export type MoneyInput = Prisma.Decimal | string | number;

const MONEY_PLACES = 2;
const RATE_PLACES = 2;

export function toMoney(value: MoneyInput): Money {
  const decimal = new Decimal(value);
  if (!decimal.isFinite()) {
    throw new RangeError('Money value must be a finite number');
  }
  return decimal;
}

export function roundMoney(value: MoneyInput): Money {
  return toMoney(value).toDecimalPlaces(MONEY_PLACES, Decimal.ROUND_HALF_UP);
}

export function sumMoney(values: readonly MoneyInput[]): Money {
  return values.reduce<Money>((total, value) => total.plus(toMoney(value)), new Decimal(0));
}

export function percentOf(amount: MoneyInput, ratePercent: MoneyInput): Money {
  const rate = toMoney(ratePercent);
  if (rate.isNegative() || rate.greaterThan(100)) {
    throw new RangeError('Percentage must be between 0 and 100');
  }
  return roundMoney(toMoney(amount).times(rate).dividedBy(100));
}

export function multiplyMoney(unitPrice: MoneyInput, quantity: number): Money {
  if (!Number.isInteger(quantity) || quantity < 0) {
    throw new RangeError('Quantity must be a non-negative integer');
  }
  return roundMoney(toMoney(unitPrice).times(quantity));
}

export interface TaxSplit {
  cgst: Money;
  sgst: Money;
  igst: Money;
  total: Money;
}

export function splitTax(
  taxable: MoneyInput,
  ratePercent: MoneyInput,
  interState: boolean,
): TaxSplit {
  const rate = toMoney(ratePercent).toDecimalPlaces(RATE_PLACES, Decimal.ROUND_HALF_UP);
  const total = percentOf(taxable, rate);
  const zero = new Decimal(0);
  if (interState) {
    return { cgst: zero, sgst: zero, igst: total, total };
  }
  const cgst = total.dividedBy(2).toDecimalPlaces(MONEY_PLACES, Decimal.ROUND_DOWN);
  return { cgst, sgst: total.minus(cgst), igst: zero, total };
}

export function allocateProportionally(total: MoneyInput, weights: readonly MoneyInput[]): Money[] {
  const amount = roundMoney(total);
  const parts = weights.map(toMoney);
  const weightSum = sumMoney(parts);
  if (parts.length === 0 || weightSum.isZero() || parts.some((weight) => weight.isNegative())) {
    throw new RangeError('Weights must be non-negative with a positive sum');
  }
  const shares = parts.map((weight) =>
    amount.times(weight).dividedBy(weightSum).toDecimalPlaces(MONEY_PLACES, Decimal.ROUND_DOWN),
  );
  let remainder = amount.minus(sumMoney(shares));
  const cent = new Decimal(1).dividedBy(10 ** MONEY_PLACES);
  const result = [...shares];
  for (let i = 0; remainder.greaterThan(0); i = (i + 1) % result.length) {
    result[i] = (result[i] ?? new Decimal(0)).plus(cent);
    remainder = remainder.minus(cent);
  }
  return result;
}

export function formatMoney(value: MoneyInput): string {
  return roundMoney(value).toFixed(MONEY_PLACES);
}
