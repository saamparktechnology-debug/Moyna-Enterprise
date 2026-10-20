import { describe, expect, it } from 'vitest';
import { fromPaise, planAutomaticAllocation } from './allocation.js';

describe('fromPaise', () => {
  it('formats whole paise as rupees with two decimals', () => {
    expect(fromPaise(0)).toBe('0.00');
    expect(fromPaise(5)).toBe('0.05');
    expect(fromPaise(1999)).toBe('19.99');
    expect(fromPaise(12345678999)).toBe('123456789.99');
  });
});

describe('planAutomaticAllocation', () => {
  const dues = [
    { invoiceId: 'a', outstanding: '300.00' },
    { invoiceId: 'b', outstanding: '200.50' },
    { invoiceId: 'c', outstanding: '100.00' },
  ];

  it('settles the first dues in full and part-pays the one where the money runs out', () => {
    expect(planAutomaticAllocation(dues, '450.25')).toEqual({
      allocations: [
        { invoiceId: 'a', amount: '300.00' },
        { invoiceId: 'b', amount: '150.25' },
      ],
      leftover: '0.00',
    });
  });

  it('leaves what is not owed as leftover credit', () => {
    const plan = planAutomaticAllocation(dues, '1000.00');
    expect(plan.allocations.map((a) => a.amount)).toEqual(['300.00', '200.50', '100.00']);
    expect(plan.leftover).toBe('399.50');
  });

  it('applies nothing when nothing is owed, and skips settled invoices', () => {
    expect(planAutomaticAllocation([], '10.00')).toEqual({ allocations: [], leftover: '10.00' });
    expect(
      planAutomaticAllocation([{ invoiceId: 'z', outstanding: '0.00' }], '10.00').allocations,
    ).toEqual([]);
  });

  it('never over-applies, even with decimals that floating point gets wrong', () => {
    const plan = planAutomaticAllocation(
      [
        { invoiceId: 'a', outstanding: '0.10' },
        { invoiceId: 'b', outstanding: '0.20' },
      ],
      '0.30',
    );
    expect(plan.allocations).toEqual([
      { invoiceId: 'a', amount: '0.10' },
      { invoiceId: 'b', amount: '0.20' },
    ]);
    expect(plan.leftover).toBe('0.00');
  });
});
