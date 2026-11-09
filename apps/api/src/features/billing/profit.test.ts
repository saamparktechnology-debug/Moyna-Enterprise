import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { invoiceProfit, lineProfit, unitCostFor } from './profit.js';
import type { ProfitLine } from './profit.js';

const D = (value: string) => new Prisma.Decimal(value);
const line = (over: Partial<ProfitLine> = {}): ProfitLine => ({
  qty: 2,
  taxableAmount: D('1000.00'),
  unitCostActual: D('300.00'),
  unitCostDisplay: D('400.00'),
  ...over,
});

describe('profit', () => {
  it('uses the real cost for a Super Admin and the shown cost for everyone else', () => {
    expect(lineProfit(line(), { isSuperAdmin: true })?.toFixed(2)).toBe('400.00');
    expect(lineProfit(line(), { isSuperAdmin: false })?.toFixed(2)).toBe('200.00');
  });

  it('never hands the real cost to a viewer who is not a Super Admin', () => {
    expect(unitCostFor(line(), { isSuperAdmin: false })?.toFixed(2)).toBe('400.00');
    expect(unitCostFor(line({ unitCostDisplay: null }), { isSuperAdmin: false })).toBeNull();
  });

  it('gives no profit when a cost was not recorded', () => {
    expect(lineProfit(line({ unitCostActual: null }), { isSuperAdmin: true })).toBeNull();
    expect(lineProfit(line({ unitCostDisplay: null }), { isSuperAdmin: false })).toBeNull();
  });

  it('can be a loss', () => {
    expect(
      lineProfit(line({ taxableAmount: D('500.00') }), { isSuperAdmin: true })?.toFixed(2),
    ).toBe('-100.00');
  });

  it('adds the lines up, and gives nothing if any line has no cost', () => {
    const lines = [line(), line({ qty: 1, taxableAmount: D('100.00') })];
    expect(invoiceProfit(lines, { isSuperAdmin: true })?.toFixed(2)).toBe('200.00');
    expect(
      invoiceProfit([...lines, line({ unitCostActual: null })], { isSuperAdmin: true }),
    ).toBeNull();
    expect(invoiceProfit([], { isSuperAdmin: true })).toBeNull();
  });
});
