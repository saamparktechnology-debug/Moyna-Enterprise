import { describe, expect, it } from 'vitest';
import {
  allocateProportionally,
  formatMoney,
  multiplyMoney,
  percentOf,
  roundMoney,
  splitTax,
  sumMoney,
  toMoney,
} from './money.js';

describe('roundMoney', () => {
  it.each([
    ['1.005', '1.01'],
    ['1.004', '1.00'],
    ['2.675', '2.68'],
    ['0.005', '0.01'],
    ['-0.005', '-0.01'],
    ['10', '10.00'],
  ])('rounds %s half-up to %s without floating point error', (input, expected) => {
    expect(roundMoney(input).toFixed(2)).toBe(expected);
  });

  it('rejects values that are not finite numbers', () => {
    expect(() => toMoney(Number.NaN)).toThrowError(RangeError);
    expect(() => toMoney(Number.POSITIVE_INFINITY)).toThrowError(RangeError);
  });
});

describe('sumMoney', () => {
  it('adds exactly where floating point would not', () => {
    expect(sumMoney(['0.1', '0.2']).toFixed(2)).toBe('0.30');
    expect(sumMoney([]).toFixed(2)).toBe('0.00');
  });
});

describe('percentOf', () => {
  it('computes and rounds a percentage', () => {
    expect(percentOf('999.99', '18').toFixed(2)).toBe('180.00');
    expect(percentOf('0.01', '50').toFixed(2)).toBe('0.01');
    expect(percentOf('100', '0').toFixed(2)).toBe('0.00');
  });

  it('rejects percentages outside 0 to 100', () => {
    expect(() => percentOf('100', '-1')).toThrowError(RangeError);
    expect(() => percentOf('100', '100.01')).toThrowError(RangeError);
  });
});

describe('multiplyMoney', () => {
  it('multiplies a unit price by a whole quantity', () => {
    expect(multiplyMoney('33.335', 3).toFixed(2)).toBe('100.01');
  });

  it.each([-1, 1.5, Number.NaN])('rejects the quantity %s', (quantity) => {
    expect(() => multiplyMoney('10', quantity)).toThrowError(RangeError);
  });
});

describe('splitTax', () => {
  it('splits intra-state tax into equal CGST and SGST', () => {
    const tax = splitTax('1000', '18', false);
    expect([
      tax.cgst.toFixed(2),
      tax.sgst.toFixed(2),
      tax.igst.toFixed(2),
      tax.total.toFixed(2),
    ]).toEqual(['90.00', '90.00', '0.00', '180.00']);
  });

  it('puts the whole tax on IGST for inter-state sales', () => {
    const tax = splitTax('1000', '18', true);
    expect([tax.cgst.toFixed(2), tax.sgst.toFixed(2), tax.igst.toFixed(2)]).toEqual([
      '0.00',
      '0.00',
      '180.00',
    ]);
  });

  it('keeps CGST plus SGST equal to the total when the paise are odd', () => {
    const tax = splitTax('0.50', '5', false);
    expect(tax.total.toFixed(2)).toBe('0.03');
    expect(tax.cgst.plus(tax.sgst).equals(tax.total)).toBe(true);
    expect(tax.sgst.greaterThanOrEqualTo(tax.cgst)).toBe(true);
  });

  it('handles a nil-rated sale and a zero amount', () => {
    expect(splitTax('500', '0', false).total.toFixed(2)).toBe('0.00');
    expect(splitTax('0', '18', true).igst.toFixed(2)).toBe('0.00');
  });
});

describe('allocateProportionally', () => {
  it('shares a total by weight and never loses a paisa', () => {
    const shares = allocateProportionally('100.00', ['1', '1', '1']);
    expect(shares.map((s) => s.toFixed(2))).toEqual(['33.34', '33.33', '33.33']);
    expect(sumMoney(shares).toFixed(2)).toBe('100.00');
  });

  it('gives a zero weight nothing', () => {
    expect(allocateProportionally('10', ['0', '5']).map((s) => s.toFixed(2))).toEqual([
      '0.00',
      '10.00',
    ]);
  });

  it('rejects empty, all-zero and negative weights', () => {
    expect(() => allocateProportionally('10', [])).toThrowError(RangeError);
    expect(() => allocateProportionally('10', ['0', '0'])).toThrowError(RangeError);
    expect(() => allocateProportionally('10', ['-1', '2'])).toThrowError(RangeError);
  });
});

describe('formatMoney', () => {
  it('always shows two decimals', () => {
    expect(formatMoney('5')).toBe('5.00');
    expect(formatMoney('5.555')).toBe('5.56');
  });
});
