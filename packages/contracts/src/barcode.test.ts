import { describe, expect, it } from 'vitest';
import { buildInternalEan13, ean13CheckDigit, isValidEan13 } from './barcode.js';

describe('EAN-13', () => {
  it('computes the check digit of a known code', () => {
    expect(ean13CheckDigit('400638133393')).toBe(1);
    expect(isValidEan13('4006381333931')).toBe(true);
  });

  it('rejects a wrong check digit, a wrong length and non-digits', () => {
    expect(isValidEan13('4006381333932')).toBe(false);
    expect(isValidEan13('400638133393')).toBe(false);
    expect(isValidEan13('40063813339X1')).toBe(false);
    expect(() => ean13CheckDigit('12345')).toThrow();
  });

  it('builds internal barcodes with prefix 20 and a valid check digit', () => {
    expect(buildInternalEan13(1n)).toBe('2000000000015');
    expect(buildInternalEan13(9_999_999_999n)).toHaveLength(13);
    for (const sequence of [1n, 2n, 99n, 123_456_789n])
      expect(isValidEan13(buildInternalEan13(sequence))).toBe(true);
  });

  it('refuses a sequence number outside the range', () => {
    expect(() => buildInternalEan13(0n)).toThrow(RangeError);
    expect(() => buildInternalEan13(10_000_000_000n)).toThrow(RangeError);
  });
});
