import { describe, expect, it } from 'vitest';
import type { CreditNote } from '@erp/contracts';
import { buildCreditNotePdf } from './credit-note-pdf.js';
import type { CreditNotePdfContext } from './credit-note-pdf.js';

const line = (
  n: number,
  over: Partial<CreditNote['lines'][number]> = {},
): CreditNote['lines'][number] => ({
  id: `l-${n}`,
  invoiceLineId: `il-${n}`,
  itemId: `it-${n}`,
  itemCode: `TOTO-${n}`,
  itemName: 'E-rickshaw (cap) & more',
  serialUnitId: null,
  serialNo: null,
  qty: 1,
  taxableAmount: '1000.00',
  cgstAmount: '90.00',
  sgstAmount: '90.00',
  igstAmount: '0.00',
  amount: '1180.00',
  ...over,
});

const base: CreditNote = {
  id: 'cn-1',
  creditNoteNo: 'HQ/CN/26-27/00001',
  status: 'APPROVED',
  branchId: 'b-1',
  branchCode: 'HQ',
  invoiceId: 'inv-1',
  invoiceNo: 'HQ/GI/26-27/00007',
  customerName: 'Ravi Kumar',
  reason: 'Customer returned a damaged unit',
  taxableValue: '1000.00',
  cgstAmount: '90.00',
  sgstAmount: '90.00',
  igstAmount: '0.00',
  amount: '1180.00',
  requestedByName: 'Asha Rao',
  createdAt: '2026-10-08T05:00:00.000Z',
  decidedByName: 'Meera Nair',
  decidedAt: '2026-10-09T05:00:00.000Z',
  decisionNote: null,
  lines: [line(1)],
  rowVersion: 3,
};
const context: CreditNotePdfContext = {
  branchName: 'Head office (Pune)',
  branchGstin: '27AAPFU0939F1ZV',
  customerGstin: null,
  gst: true,
  invoiceDate: '2026-10-01',
};
const text = (pdf: Buffer): string => pdf.toString('latin1');

describe('buildCreditNotePdf', () => {
  it('makes a PDF with the number, the invoice it follows, who it is for, the reason and the amount in words', () => {
    const pdf = buildCreditNotePdf(base, context);
    const out = text(pdf);
    expect(out.startsWith('%PDF-1.4')).toBe(true);
    expect(out.trimEnd().endsWith('%%EOF')).toBe(true);
    for (const expected of [
      'CREDIT NOTE',
      'Credit note no: HQ/CN/26-27/00001',
      'Date: 2026-10-09',
      'Against invoice: HQ/GI/26-27/00007 of 2026-10-01',
      'Ravi Kumar',
      'Reason: Customer returned a damaged unit',
      'GSTIN: 27AAPFU0939F1ZV',
      'CGST',
      'SGST',
      'CREDIT \\(Rs\\)',
      'Rupees One Thousand One Hundred Eighty Only',
    ])
      expect(out, expected).toContain(expected);
    expect(out).not.toContain('IGST');
    expect(out).not.toContain('PENDING');
  });

  it('shows IGST for an inter-state credit and no tax columns for a non-GST one', () => {
    const inter = buildCreditNotePdf(
      {
        ...base,
        cgstAmount: '0.00',
        sgstAmount: '0.00',
        igstAmount: '180.00',
        lines: [line(1, { cgstAmount: '0.00', sgstAmount: '0.00', igstAmount: '180.00' })],
      },
      context,
    );
    expect(text(inter)).toContain('IGST');
    expect(text(inter)).not.toContain('SGST');
    const plain = buildCreditNotePdf(
      { ...base, cgstAmount: '0.00', sgstAmount: '0.00', amount: '1000.00' },
      { ...context, gst: false },
    );
    expect(text(plain)).not.toContain('CGST');
    expect(text(plain)).not.toContain('GSTIN');
  });

  it('says plainly that a waiting or rejected credit note is not valid, and gives it no number or date', () => {
    const pending = text(
      buildCreditNotePdf(
        { ...base, status: 'PENDING', creditNoteNo: null, decidedAt: null, decidedByName: null },
        context,
      ),
    );
    expect(pending).toContain('PENDING - this credit note is not valid until it is approved');
    expect(pending).toContain('not yet numbered');
    expect(pending).toContain('Date: -');
    expect(
      text(buildCreditNotePdf({ ...base, status: 'REJECTED', creditNoteNo: null }, context)),
    ).toContain('REJECTED - this credit note is not valid');
  });

  it('prints the serial number of a returned vehicle', () => {
    const out = text(
      buildCreditNotePdf(
        { ...base, lines: [line(1, { serialNo: 'SN-0042', itemName: 'TOTO X1' })] },
        context,
      ),
    );
    expect(out).toContain('S/N: SN-0042');
  });

  it('spreads many lines over pages and keeps the totals together', () => {
    const lines = Array.from({ length: 70 }, (_, i) =>
      line(i + 1, { serialNo: i % 3 === 0 ? `SN-${i}` : null }),
    );
    const out = text(buildCreditNotePdf({ ...base, lines }, context));
    const pages = Number(/\/Count (\d+)/.exec(out)?.[1]);
    expect(pages).toBeGreaterThanOrEqual(3);
    expect(out).toContain(`Page ${pages} of ${pages}`);
    expect(out).toContain('\\(continued\\)');
    expect(out.match(/CREDIT \\\(Rs\\\)/g)).toHaveLength(1);
    expect(out.match(/Page 1 of/g)).toHaveLength(1);
  });

  it('keeps awkward text from breaking the file', () => {
    const out = text(
      buildCreditNotePdf(
        { ...base, customerName: 'A (B) \\ C \u20b9 \u00e9', reason: 'It said (oops)' },
        context,
      ),
    );
    expect(out).toContain('A \\(B\\) \\\\ C ? ?');
    expect(out).toContain('Reason: It said \\(oops\\)');
    expect(out.trimEnd().endsWith('%%EOF')).toBe(true);
  });
});
