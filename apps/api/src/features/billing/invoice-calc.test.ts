import { describe, expect, it } from 'vitest';
import { calculateInvoice, discountNeedsApproval, isInterState } from './invoice-calc.js';

const line = (
  qty: number,
  unitPrice: string,
  discountAmount = '0',
  taxRate: string | null = '18',
) => ({
  qty,
  unitPrice,
  discountAmount,
  taxRate,
});
const text = (value: { toFixed: (places: number) => string }) => value.toFixed(2);

describe('tax on an invoice', () => {
  it('splits GST into equal CGST and SGST inside the state', () => {
    const result = calculateInvoice([line(2, '1000.00')], { type: 'GST', interState: false });
    expect(text(result.subtotal)).toBe('2000.00');
    expect(text(result.cgst)).toBe('180.00');
    expect(text(result.sgst)).toBe('180.00');
    expect(text(result.igst)).toBe('0.00');
    expect(text(result.total)).toBe('2360.00');
  });

  it('charges IGST alone across a state border', () => {
    const result = calculateInvoice([line(2, '1000.00')], { type: 'GST', interState: true });
    expect(text(result.igst)).toBe('360.00');
    expect(text(result.cgst)).toBe('0.00');
    expect(text(result.sgst)).toBe('0.00');
    expect(text(result.total)).toBe('2360.00');
  });

  it('charges no tax at all on an invoice without GST', () => {
    const result = calculateInvoice([line(2, '1000.00')], { type: 'NON_GST', interState: true });
    expect(text(result.cgst)).toBe('0.00');
    expect(text(result.igst)).toBe('0.00');
    expect(text(result.total)).toBe('2000.00');
  });

  it('taxes the price after the discount, not before', () => {
    const result = calculateInvoice([line(1, '1000.00', '100.00', '5')], {
      type: 'GST',
      interState: false,
    });
    expect(text(result.taxableValue)).toBe('900.00');
    expect(text(result.cgst)).toBe('22.50');
    expect(text(result.sgst)).toBe('22.50');
    expect(text(result.total)).toBe('945.00');
  });

  it('puts the odd paisa of an uneven tax on the SGST side so the two always add to the whole', () => {
    const odd = calculateInvoice([line(1, '10.10', '0', '5')], { type: 'GST', interState: false });
    expect(odd.cgst.plus(odd.sgst).toFixed(2)).toBe('0.51');
    expect(odd.cgst.toFixed(2)).toBe('0.25');
    expect(odd.sgst.toFixed(2)).toBe('0.26');
  });

  it('applies each line’s own rate and treats an item with no rate as untaxed', () => {
    const result = calculateInvoice(
      [line(1, '100.00', '0', '5'), line(1, '100.00', '0', '28'), line(1, '100.00', '0', null)],
      { type: 'GST', interState: true },
    );
    expect(text(result.igst)).toBe('33.00');
    expect(result.lines.map((l) => text(l.amount))).toEqual(['105.00', '128.00', '100.00']);
  });
});

describe('rounding', () => {
  it('rounds each line’s tax half up to the paisa', () => {
    const result = calculateInvoice([line(1, '33.33', '0', '18')], {
      type: 'GST',
      interState: true,
    });
    expect(text(result.igst)).toBe('6.00');
    const half = calculateInvoice([line(1, '0.25', '0', '18')], { type: 'GST', interState: true });
    expect(text(half.igst)).toBe('0.05');
  });

  it('rounds the total to the nearest rupee and keeps the difference as the round-off', () => {
    const up = calculateInvoice([line(1, '100.60', '0', null)], { type: 'GST', interState: false });
    expect(text(up.total)).toBe('101.00');
    expect(text(up.roundOff)).toBe('0.40');
    const down = calculateInvoice([line(1, '100.40', '0', null)], {
      type: 'GST',
      interState: false,
    });
    expect(text(down.total)).toBe('100.00');
    expect(text(down.roundOff)).toBe('-0.40');
    const half = calculateInvoice([line(1, '100.50', '0', null)], {
      type: 'GST',
      interState: false,
    });
    expect(text(half.total)).toBe('101.00');
    expect(text(half.roundOff)).toBe('0.50');
  });

  it('always adds up: taxable value plus tax plus round-off is exactly the total', () => {
    for (const [price, rate, qty] of [
      ['199.99', '12', 3],
      ['7.77', '28', 7],
      ['1234.56', '5', 1],
      ['0.01', '18', 100],
    ] as const) {
      for (const interState of [false, true]) {
        const result = calculateInvoice([line(qty, price, '0', rate)], { type: 'GST', interState });
        expect(
          result.taxableValue
            .plus(result.cgst)
            .plus(result.sgst)
            .plus(result.igst)
            .plus(result.roundOff)
            .toFixed(2),
        ).toBe(result.total.toFixed(2));
        expect(result.taxableValue.toFixed(2)).toBe(
          result.subtotal.minus(result.discountTotal).toFixed(2),
        );
      }
    }
  });

  it('keeps the sum of the line amounts within the round-off of the total', () => {
    const result = calculateInvoice(
      [line(3, '199.99', '10.00', '12'), line(2, '49.50', '0', '18')],
      { type: 'GST', interState: false },
    );
    const lines = result.lines.reduce(
      (sum, l) => sum.plus(l.amount),
      result.roundOff.minus(result.roundOff),
    );
    expect(result.total.minus(lines).abs().lessThanOrEqualTo(0.5)).toBe(true);
  });
});

describe('discounts and place of supply', () => {
  it('refuses a discount larger than the price', () => {
    expect(() =>
      calculateInvoice([line(1, '100.00', '100.01')], { type: 'GST', interState: false }),
    ).toThrow('A discount is more than the price');
    expect(
      text(
        calculateInvoice([line(1, '100.00', '100.00')], { type: 'GST', interState: false }).total,
      ),
    ).toBe('0.00');
  });

  it('asks for approval only above the staff limit of 5% of the line', () => {
    expect(discountNeedsApproval('1000.00', '50.00')).toBe(false);
    expect(discountNeedsApproval('1000.00', '50.01')).toBe(true);
    expect(discountNeedsApproval('1000.00', '0')).toBe(false);
    const flagged = calculateInvoice([line(1, '1000.00', '60.00'), line(1, '1000.00', '10.00')], {
      type: 'NON_GST',
      interState: false,
    });
    expect(flagged.lines.map((l) => l.needsDiscountApproval)).toEqual([true, false]);
  });

  it('is inter-state exactly when the place of supply differs from the branch state', () => {
    expect(isInterState('27', '27')).toBe(false);
    expect(isInterState('27', '29')).toBe(true);
  });
});
