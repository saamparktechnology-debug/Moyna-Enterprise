import { Prisma } from '@prisma/client';
import { describe, expect, it } from 'vitest';
import { commissionFor, overpaid, totalReduction } from './commission-calc.js';

const d = (value: string | number) => new Prisma.Decimal(value);
const show = (value: Prisma.Decimal) => value.toFixed(2);

describe('commissionFor', () => {
  it('takes a percentage of the taxable value, rounded to the paisa with halves up', () => {
    expect(show(commissionFor({ type: 'PERCENT', value: d('2.5') }, d('100000')))).toBe('2500.00');
    expect(show(commissionFor({ type: 'PERCENT', value: d('3') }, d('999.99')))).toBe('30.00');
    expect(show(commissionFor({ type: 'PERCENT', value: d('0.5') }, d('1.01')))).toBe('0.01');
    expect(show(commissionFor({ type: 'PERCENT', value: d('0.5') }, d('0.99')))).toBe('0.00');
    expect(show(commissionFor({ type: 'PERCENT', value: d('12.5') }, d('0.30')))).toBe('0.04');
  });

  it('pays a fixed amount as it is, whatever the size of the sale', () => {
    expect(show(commissionFor({ type: 'FIXED', value: d('5000') }, d('100000')))).toBe('5000.00');
    expect(show(commissionFor({ type: 'FIXED', value: d('5000') }, d('6000')))).toBe('5000.00');
  });

  it('never pays more than the taxable value, and nothing on an invoice with none', () => {
    expect(show(commissionFor({ type: 'FIXED', value: d('5000') }, d('1200')))).toBe('1200.00');
    expect(show(commissionFor({ type: 'PERCENT', value: d('100') }, d('750.50')))).toBe('750.50');
    expect(show(commissionFor({ type: 'FIXED', value: d('5000') }, d('0')))).toBe('0.00');
    expect(show(commissionFor({ type: 'PERCENT', value: d('5') }, d('0')))).toBe('0.00');
  });
});

describe('totalReduction', () => {
  it('takes back the credited share of the commission', () => {
    expect(show(totalReduction(d('1000'), d('25000'), d('100000')))).toBe('250.00');
    expect(show(totalReduction(d('5000'), d('50000'), d('100000')))).toBe('2500.00');
  });

  it('takes back the whole commission when the whole invoice is credited, with no paisa left over', () => {
    expect(show(totalReduction(d('333.33'), d('300'), d('300')))).toBe('333.33');
    expect(show(totalReduction(d('333.33'), d('301'), d('300')))).toBe('333.33');
  });

  it('works on the total credited so far, so notes taken one by one add up exactly', () => {
    const amount = d('100.00');
    const base = d('3');
    let taken = d(0);
    for (let note = 1; note <= 3; note += 1) {
      const target = totalReduction(amount, d(note), base);
      taken = taken.plus(target.minus(taken));
    }
    expect(show(taken)).toBe('100.00');
  });

  it('takes back nothing when nothing is credited or there is no commission', () => {
    expect(show(totalReduction(d('1000'), d('0'), d('100000')))).toBe('0.00');
    expect(show(totalReduction(d('0'), d('50'), d('100')))).toBe('0.00');
  });
});

describe('overpaid', () => {
  it('is what a paid commission was over-paid by, never negative', () => {
    expect(show(overpaid(d('1000'), d('750')))).toBe('250.00');
    expect(show(overpaid(d('1000'), d('1000')))).toBe('0.00');
    expect(show(overpaid(d('1000'), d('1200')))).toBe('0.00');
  });
});
