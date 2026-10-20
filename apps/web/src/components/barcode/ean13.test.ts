import { describe, expect, it } from 'vitest';
import { ean13Modules } from './ean13';

describe('ean13Modules', () => {
  it('encodes 2000000000015 with the left parity pattern for first digit 2', () => {
    const expected = [
      '101',
      '0001101',
      '0001101',
      '0100111',
      '0100111',
      '0001101',
      '0100111',
      '01010',
      '1110010',
      '1110010',
      '1110010',
      '1110010',
      '1100110',
      '1001110',
      '101',
    ].join('');
    expect(ean13Modules('2000000000015')).toBe(expected);
  });

  it('always gives 95 modules with the guard patterns in place', () => {
    for (const code of ['4006381333931', '2000000000015', '5901234123457']) {
      const modules = ean13Modules(code);
      expect(modules).toHaveLength(95);
      expect(modules.slice(0, 3)).toBe('101');
      expect(modules.slice(45, 50)).toBe('01010');
      expect(modules.slice(92)).toBe('101');
    }
  });

  it('refuses a wrong check digit, a wrong length and non-digits', () => {
    expect(() => ean13Modules('4006381333932')).toThrow();
    expect(() => ean13Modules('12345')).toThrow();
    expect(() => ean13Modules('40063813339X1')).toThrow();
  });
});
