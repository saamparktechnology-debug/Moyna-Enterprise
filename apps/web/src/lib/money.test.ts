import { describe, expect, it } from 'vitest';
import { finishMoney, formatMoney, sanitizeMoney } from './money';

describe('money text', () => {
  it('keeps only digits and one decimal point, limited to the decimals', () => {
    expect(sanitizeMoney('12a3.456')).toBe('123.45');
    expect(sanitizeMoney('1.2.3')).toBe('1.23');
    expect(sanitizeMoney('₹ 1,250')).toBe('1250');
    expect(sanitizeMoney('abc')).toBe('');
  });

  it('rejects a minus sign unless negatives are allowed', () => {
    expect(sanitizeMoney('-5')).toBe('5');
    expect(sanitizeMoney('-5', { allowNegative: true })).toBe('-5');
    expect(sanitizeMoney('5-3', { allowNegative: true })).toBe('53');
  });

  it('pads to the full decimals and drops leading zeros without using floating point', () => {
    expect(finishMoney('5')).toBe('5.00');
    expect(finishMoney('007.5')).toBe('7.50');
    expect(finishMoney('.5')).toBe('0.50');
    expect(finishMoney('0.1')).toBe('0.10');
    expect(finishMoney('9007199254740993.99')).toBe('9007199254740993.99');
    expect(finishMoney('', {})).toBe('');
    expect(finishMoney('.')).toBe('');
  });

  it('never shows negative zero', () => {
    expect(finishMoney('-0', { allowNegative: true })).toBe('0.00');
    expect(finishMoney('-2.5', { allowNegative: true })).toBe('-2.50');
  });

  it('supports other precisions', () => {
    expect(finishMoney('12.3456', { decimals: 3 })).toBe('12.345');
    expect(finishMoney('12.7', { decimals: 0 })).toBe('12');
  });

  it('formats for display in Indian grouping', () => {
    expect(formatMoney('1250.5')).toContain('1,250.50');
    expect(formatMoney('1234567.89')).toContain('12,34,567.89');
  });
});
