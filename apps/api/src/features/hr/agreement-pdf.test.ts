import { describe, expect, it } from 'vitest';
import { buildAgreementPdf } from './agreement-pdf.js';
import type { AgreementPdfData } from './agreement-pdf.js';

const base: AgreementPdfData = {
  company: {
    name: 'Moyna Enterprise',
    proprietor: 'Balaram Das Gajendra Mahapatra',
    address: 'Garsafat, Moyna, Purba Medinipur',
    phone: '9564245909',
    gstin: null,
    tagline: null,
    terms: null,
  },
  agreementNo: 'AG-111120261123',
  title: 'Employment agreement',
  effectiveFrom: '01/11/2026',
  employeeName: 'Ravi Kumar',
  employeeCode: 'EMP-0001',
  text: 'Ravi Kumar works as Fitter.\n\nPay is Rs. 31,000.00 a month.\n\nThe Employee will keep the shop (and its keys) safe.',
};
const out = (data: AgreementPdfData): string => buildAgreementPdf(data).toString('latin1');

describe('the printed agreement', () => {
  it('has the heading, the title, the number, the terms and two places to sign', () => {
    const text = out(base);
    expect(text.startsWith('%PDF-')).toBe(true);
    for (const expected of [
      'EMPLOYMENT AGREEMENT',
      'MOYNA ENTERPRISE',
      'Employment agreement',
      'Agreement no: AG-111120261123',
      'Effective from: 01/11/2026',
      'Ravi Kumar works as Fitter.',
      'Rs. 31,000.00 a month.',
      'Signature of the Employee',
      'Signature of the Super Admin',
      'Name: Ravi Kumar \\(EMP-0001\\)',
      'For MOYNA ENTERPRISE',
      'Page 1 of 1',
    ])
      expect(text).toContain(expected);
    expect(text).toContain('keep the shop \\(and its keys\\) safe');
  });

  it('puts the employee’s signature on the left and the Super Admin’s on the right', () => {
    const text = out(base);
    const x = (label: string): number => {
      const at = text.indexOf(`(${label})`);
      const before = text.lastIndexOf('Td', at);
      return Number(text.slice(text.lastIndexOf('\n', before), before).trim().split(/\s+/).at(-2));
    };
    expect(x('Signature of the Employee')).toBeLessThan(x('Signature of the Super Admin'));
  });

  it('runs over to more pages when the terms are long, keeping every paragraph and signing on the last page', () => {
    const paragraphs = Array.from(
      { length: 60 },
      (_, i) =>
        `Clause ${i + 1}. ${'The Employee will do what is asked of them with care. '.repeat(3)}`,
    );
    const text = out({ ...base, text: paragraphs.join('\n\n') });
    const pages = Number(/Page 1 of (\d+)/.exec(text)?.[1]);
    expect(pages).toBeGreaterThanOrEqual(3);
    expect(text).toContain(`Page ${pages} of ${pages}`);
    expect(text).toContain('Clause 1.');
    expect(text).toContain('Clause 60.');
    expect(text.match(/Signature of the Employee/g)).toHaveLength(1);
    expect(text.indexOf('Signature of the Employee')).toBeGreaterThan(text.indexOf('Clause 60.'));
    expect(text).toContain('continued');
  });

  it('copes with long unbroken words and special characters', () => {
    const text = out({ ...base, text: `${'x'.repeat(400)}\n\nBrackets (a) \\ slash and “quotes”` });
    expect(text.startsWith('%PDF-')).toBe(true);
    expect(text).toContain('%%EOF');
  });
});
