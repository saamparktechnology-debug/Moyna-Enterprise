import { describe, expect, it } from 'vitest';
import type { DocumentCompany, Invoice } from '@erp/contracts';
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

const company: DocumentCompany = {
  name: 'Moyna Enterprise',
  proprietor: 'Balaram Das Gajendra Mahapatra',
  address: 'Garsafat (Brishpatibarer Bazar), Moyna, Purba Medinipur, Pin-721629, WB-19',
  phone: '9564245909',
  gstin: '19ANLPD2676F2ZU',
  tagline: 'Powering Every Journey',
  terms: 'Goods once sold will not take back.',
};

/** How a string appears inside a PDF: brackets and backslashes are escaped. */
const inPdf = (value: string): string => value.replace(/[()\\]/g, '\\$&');

describe('the invoice PDF', () => {
  const text = (invoice: Invoice) => buildInvoicePdf(invoice, company).toString('latin1');

  it('is a well-formed PDF whose cross-reference table points at every object', () => {
    const pdf = buildInvoicePdf(base, company);
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
      'GST INVOICE',
      'Mob-9564245909',
      'MOYNA ENTERPRISE',
      'Prop-Balaram Das Gajendra Mahapatra',
      'GST IN: 29ABCDE1234F1Z5',
      'Garsafat',
      'Invoice No:- HQ/GI/26-27/00001',
      'Date:- 2026-10-08',
      'Vehicle No:-',
      "Buyer's name - Ravi Kumar",
      'HSN/SAC',
      'I.G.S.T (18%) Rs.',
      '342.00',
      '2,242.00',
      'Total Value (in Word)- TWO THOUSAND',
      'ONLY',
      'Total Invoice RS.',
      'E & O.E',
      '1. Goods once sold will not take back.',
      'Customer Signature',
      'For MOYNA ENTERPRISE',
    ])
      expect(body).toContain(inPdf(expected));
    expect(body).not.toContain('C.G.S.T');
  });

  it('prints the buyer phone and address, and amounts with Indian digit grouping', () => {
    const body = text({
      ...base,
      customerPhone: '9937117681',
      customerAddress: 'MURAIL, MURAIL PURBA MEDINIPUR,721634',
      taxableValue: '150476.19',
      total: '158000.00',
      lines: [
        {
          ...base.lines[0]!,
          unitPrice: '150476.19',
          taxableAmount: '150476.19',
          discountAmount: '0.00',
        },
      ],
    });
    expect(body).toContain('Mob:- 9937117681');
    expect(body).toContain('Address- MURAIL, MURAIL PURBA MEDINIPUR,721634');
    expect(body).toContain('1,50,476.19');
    expect(body).toContain('1,58,000.00');
    expect(body).toContain('ONE LAKH FIFTY EIGHT THOUSAND ONLY');
  });

  it('shows the round off with its sign', () => {
    expect(text({ ...base, roundOff: '0.01' })).toContain('+0.01');
    expect(text({ ...base, roundOff: '-0.40' })).toContain('-0.40');
  });

  it('shows one pair of GST rows for each rate when an invoice has more than one rate', () => {
    const first = {
      ...base.lines[0]!,
      taxRate: '18.00',
      cgstAmount: '171.00',
      sgstAmount: '171.00',
      igstAmount: '0.00',
    };
    const second = {
      ...first,
      id: 'l-2',
      taxRate: '5.00',
      cgstAmount: '47.50',
      sgstAmount: '47.50',
    };
    const body = text({ ...base, interState: false, lines: [first, second] });
    expect(body).toContain(inPdf('C.G.S.T (2.5%) Rs.'));
    expect(body).toContain(inPdf('S.G.S.T (2.5%) Rs.'));
    expect(body).toContain(inPdf('C.G.S.T (9%) Rs.'));
    expect(body).toContain('47.50');
    expect(body).toContain('171.00');
  });

  it('shows CGST and SGST inside the state, and calls an invoice without GST just an invoice', () => {
    const inside = text({
      ...base,
      interState: false,
      cgstAmount: '171.00',
      sgstAmount: '171.00',
      igstAmount: '0.00',
    });
    expect(inside).toContain(inPdf('C.G.S.T (9%) Rs.'));
    expect(inside).toContain(inPdf('S.G.S.T (9%) Rs.'));
    expect(inside).not.toContain('I.G.S.T');
    const plain = text({ ...base, type: 'NON_GST' });
    expect(plain).not.toContain('GST INVOICE');
    expect(plain).not.toContain('GST IN:');
    expect(plain).not.toContain('C.G.S.T');
    expect(plain).toContain('(INVOICE)');
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
    expect(body).toContain('CH No- SN-0001');
    const battery = text({
      ...base,
      lines: [{ ...base.lines[0]!, hsnCode: '8507', serialNo: 'BAT-77' }],
    });
    expect(battery).toContain('S/N- BAT-77');
    expect(body).toContain('Anil \\(Kumar\\) \\\\ Sons ? ?');
  });

  it('continues on further pages with the totals at the end', () => {
    const many = Array.from({ length: 100 }, (_, i) => ({
      ...base.lines[0]!,
      id: `l-${i}`,
      itemName: `Item ${i}`,
    }));
    const pdf = text({ ...base, lines: many });
    const pages = Number(/Page 1 of (\d+)/.exec(pdf)?.[1]);
    expect(pages).toBeGreaterThanOrEqual(3);
    expect(pdf).toContain(`Page ${pages} of ${pages}`);
    expect(pdf).toContain('continued');
    expect(pdf.indexOf('Total Invoice RS.')).toBeGreaterThan(pdf.indexOf('Item 99'));
    expect(pdf.match(/Total Invoice RS\./g)).toHaveLength(1);
    expect(pdf.match(/Customer Signature/g)).toHaveLength(1);
  });
});
