import { describe, expect, it } from 'vitest';
import { invoiceNumberAt, invoiceStamp } from './invoice-number.js';

describe('invoice numbers', () => {
  it('are the prefix and the day, month, year, hour and minute in India time', () => {
    // 11 Nov 2026, 11:23 in India is 05:53 UTC
    expect(invoiceNumberAt('ME', new Date('2026-11-11T05:53:00Z'))).toBe('ME-111120261123');
  });

  it('cross midnight in India, not in UTC', () => {
    // 18:30 UTC on the 31st is midnight on 1 January in India
    expect(invoiceStamp(new Date('2026-12-31T18:30:00Z'))).toBe('010120270000');
    expect(invoiceStamp(new Date('2026-12-31T18:29:00Z'))).toBe('311220262359');
  });

  it('pad single digits', () => {
    expect(invoiceStamp(new Date('2026-03-05T03:34:00Z'))).toBe('050320260904');
  });

  it('stay within the 16 characters an invoice number may have, even with a 3-letter prefix', () => {
    expect(invoiceNumberAt('ABC', new Date('2026-11-11T05:53:00Z')).length).toBe(16);
    expect(invoiceNumberAt('ME', new Date('2026-11-11T05:53:00Z')).length).toBe(15);
  });
});
