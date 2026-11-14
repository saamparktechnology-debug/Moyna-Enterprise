import { describe, expect, it } from 'vitest';
import { inr, wordsUpper, wrap } from './pdf-kit.js';

describe('inr', () => {
  it('groups digits the Indian way', () => {
    expect(inr('0.00')).toBe('0.00');
    expect(inr('999.50')).toBe('999.50');
    expect(inr('1000.00')).toBe('1,000.00');
    expect(inr('150476.19')).toBe('1,50,476.19');
    expect(inr('158000.00')).toBe('1,58,000.00');
    expect(inr('12345678.90')).toBe('1,23,45,678.90');
    expect(inr('7')).toBe('7');
  });

  it('keeps a sign, and leaves text that is not an amount alone', () => {
    expect(inr('+0.01')).toBe('+0.01');
    expect(inr('-1234567.00')).toBe('-12,34,567.00');
    expect(inr('abc')).toBe('abc');
  });
});

describe('wordsUpper', () => {
  it('is the amount in capital letters without the word Rupees', () => {
    expect(wordsUpper('158000.00')).toBe('ONE LAKH FIFTY EIGHT THOUSAND ONLY');
    expect(wordsUpper('10.50')).toBe('TEN AND FIFTY PAISE ONLY');
  });
});

describe('wrap', () => {
  it('breaks text at word boundaries and never loses a word', () => {
    const lines = wrap('Total Value (in Word)- ONE LAKH FIFTY EIGHT THOUSAND ONLY', 150, 10, true);
    expect(lines.length).toBeGreaterThan(1);
    expect(lines.join(' ')).toBe('Total Value (in Word)- ONE LAKH FIFTY EIGHT THOUSAND ONLY');
  });

  it('keeps one long word on its own line', () => {
    expect(wrap('Supercalifragilisticexpialidocious', 20, 10)).toEqual([
      'Supercalifragilisticexpialidocious',
    ]);
  });
});
