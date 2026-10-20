import { describe, expect, it } from 'vitest';
import type { Invoice } from '@erp/contracts';
import { amountInWords, buildInvoicePdf } from './invoice-pdf.js';

const base: Invoice = {
  id: 'i-1',
  invoiceNo: 'HQ/GI/26-27/00001',
  type: 'GST',
  status: 'ISSUED',
  branchId: 'b-1',
  branchCode: 'HQ',
  customerId: 'c-1',
  customerName: 'Ravi Kumar',
  customerGstin: '27AAPFU0939F1ZV',
  branchGstin: '29ABCDE1234F1Z5',
  brokerId: null,
  brokerName: null,
  quotationId: null,
  quotationNo: null,
  placeOfSupply: '27',
  interState: true,
  issuedOn: '2026-10-08',
  dueDate: '2026-10-22',
  subtotal: '2000.00',
  discountTotal: '100.00',
  taxableValue: '1900.00',
  cgstAmount: '0.00',
  sgstAmount: '0.00',
  igstAmount: '342.00',
  roundOff: '-0.00',
  total: '2242.00',
  lines: [
    {
      id: 'l-1',
      itemId: 'it-1',
      itemCode: 'TOTO-X1',
      itemName: 'E-rickshaw (cap) & more',
      unitCode: 'PCS',
      hsnCode: '8703',
      taxRate: '18.00',
      qty: 2,
      unitPrice: '1000.00',
      discountAmount: '100.00',
      taxableAmount: '1900.00',
      cgstAmount: '0.00',
      sgstAmount: '0.00',
      igstAmount: '342.00',
      amount: '2242.00',
      serialUnitId: null,
      serialNo: null,
    },
  ],
  replacesInvoiceId: null,
  replacesInvoiceNo: null,
  cancelledAt: null,
  cancelledByName: null,
  cancelReason: null,
  rowVersion: 2,
  createdAt: '2026-10-08T00:00:00.000Z',
};

describe('amount in words', () => {
  it('writes rupees in the Indian way', () => {
    expect(amountInWords('0.00')).toBe('Rupees Zero Only');
    expect(amountInWords('1.00')).toBe('Rupees One Only');
    expect(amountInWords('19.00')).toBe('Rupees Nineteen Only');
    expect(amountInWords('2360.00')).toBe('Rupees Two Thousand Three Hundred Sixty Only');
    expect(amountInWords('100000.00')).toBe('Rupees One Lakh Only');
    expect(amountInWords('102000.00')).toBe('Rupees One Lakh Two Thousand Only');
    expect(amountInWords('12345678.00')).toBe(
      'Rupees One Crore Twenty Three Lakh Forty Five Thousand Six Hundred Seventy Eight Only',
    );
  });

  it('adds paise when there are any', () => {
    expect(amountInWords('10.50')).toBe('Rupees Ten and Fifty Paise Only');
    expect(amountInWords('0.05')).toBe('Rupees Zero and Five Paise Only');
  });
});

describe('the invoice PDF', () => {
  const text = (invoice: Invoice) => buildInvoicePdf(invoice, 'Head Office').toString('latin1');

  it('is a well-formed PDF whose cross-reference table points at every object', () => {
    const pdf = buildInvoicePdf(base, 'Head Office');
    const body = pdf.toString('latin1');
    expect(body.startsWith('%PDF-1.4')).toBe(true);
    expect(body.trimEnd().endsWith('%%EOF')).toBe(true);
    const start = Number(/startxref\n(\d+)/.exec(body)?.[1]);
    expect(body.slice(start, start + 4)).toBe('xref');
    const offsets = [...body.slice(start).matchAll(/^(\d{10}) 00000 n $/gm)].map((m) =>
      Number(m[1]),
    );
    expect(offsets.length).toBeGreaterThan(5);
    offsets.forEach((offset, index) =>
      expect(body.slice(offset, offset + `${index + 1} 0 obj`.length)).toBe(`${index + 1} 0 obj`),
    );
  });

  it('shows the invoice number, the parties, the tax and the total in words', () => {
    const body = text(base);
    for (const expected of [
      'TAX INVOICE',
      'HQ/GI/26-27/00001',
      'Head Office',
      'Ravi Kumar',
      'GSTIN: 27AAPFU0939F1ZV',
      'IGST',
      '342.00',
      'Rupees Two Thousand Two Hundred Forty Two Only',
    ])
      expect(body).toContain(expected);
    expect(body).not.toContain('CGST');
  });

  it('shows CGST and SGST inside the state, and calls an invoice without GST just an invoice', () => {
    const inside = text({
      ...base,
      interState: false,
      cgstAmount: '171.00',
      sgstAmount: '171.00',
      igstAmount: '0.00',
    });
    expect(inside).toContain('CGST');
    expect(inside).toContain('SGST');
    expect(inside).not.toContain('IGST');
    const plain = text({ ...base, type: 'NON_GST' });
    expect(plain).not.toContain('TAX INVOICE');
    expect(plain).toContain('INVOICE');
  });

  it('marks a draft and a cancelled invoice so neither can pass for a valid one', () => {
    expect(text({ ...base, status: 'DRAFT', invoiceNo: null })).toContain(
      'DRAFT - this is not a valid invoice',
    );
    expect(text({ ...base, status: 'CANCELLED', cancelReason: 'Wrong customer' })).toContain(
      'CANCELLED - Wrong customer',
    );
  });

  it('prints serial numbers and survives characters a PDF string cannot hold', () => {
    const body = text({
      ...base,
      customerName: 'Anil (Kumar) \\ Sons \u20b9 \u0939',
      lines: [{ ...base.lines[0]!, serialNo: 'SN-0001' }],
    });
    expect(body).toContain('S/N: SN-0001');
    expect(body).toContain('Anil \\(Kumar\\) \\\\ Sons ? ?');
  });

  it('continues on further pages with the totals at the end', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      ...base.lines[0]!,
      id: `l-${i}`,
      itemCode: `IT-${i}`,
    }));
    const pdf = text({ ...base, lines: many });
    expect(pdf).toContain('Page 1 of 3');
    expect(pdf).toContain('Page 3 of 3');
    expect(pdf).toContain('continued');
    expect(pdf.indexOf('TOTAL')).toBeGreaterThan(pdf.indexOf('IT-99'));
    expect(pdf.match(/TOTAL /g)).toHaveLength(1);
  });
});
