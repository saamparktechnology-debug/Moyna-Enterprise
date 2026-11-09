import { describe, expect, it } from 'vitest';
import { buildReceiptPdf } from './receipt-pdf.js';
import type { ReceiptPdfData } from './receipt-pdf.js';

const base: ReceiptPdfData = {
  receiptNo: 'HQ/RCT/26-27/00007',
  paidOn: '2026-10-12',
  branchName: 'Moyna Enterprise (HQ)',
  customerName: 'Ravi Kumar',
  customerPhone: '9000000001',
  modeName: 'Cash',
  reference: null,
  amount: '25000.00',
  advance: null,
  reversed: null,
};
const text = (data: ReceiptPdfData): string => buildReceiptPdf(data).toString('latin1');

describe('buildReceiptPdf', () => {
  it('makes a one-page PDF for an ordinary payment', () => {
    const pdf = buildReceiptPdf(base);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    const out = text(base);
    expect(out).toContain('PAYMENT RECEIPT');
    expect(out).toContain('HQ/RCT/26-27/00007');
    expect(out).toContain('Ravi Kumar');
    expect(out).toContain('25000.00');
    expect(out).toContain('not a tax invoice');
    expect(out).not.toContain('ADVANCE RECEIPT');
  });

  it('is an advance receipt that names the quotation and the balance', () => {
    const out = text({
      ...base,
      reference: 'UPI 4411',
      advance: {
        quotationNo: 'HQ/QT/26-27/00003',
        quotationTotal: '150000.00',
        heldTotal: '25000.00',
        balanceDue: '125000.00',
      },
    });
    expect(out).toContain('ADVANCE RECEIPT');
    expect(out).toContain('HQ/QT/26-27/00003');
    expect(out).toContain('125000.00');
    expect(out).toContain('UPI 4411');
    expect(out).toContain('adjusted against the tax invoice');
  });

  it('says plainly when the payment was reversed', () => {
    const out = text({ ...base, reversed: { on: '2026-10-13', reason: 'Cheque bounced' } });
    expect(out).toContain('REVERSED on 2026-10-13');
    expect(out).toContain('Cheque bounced');
  });

  it('copes with brackets and long text without breaking the file', () => {
    const pdf = buildReceiptPdf({
      ...base,
      customerName: 'A (B) \\ C '.repeat(12),
      reference: 'x'.repeat(300),
    });
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.toString('latin1')).toContain('%%EOF');
  });
});
