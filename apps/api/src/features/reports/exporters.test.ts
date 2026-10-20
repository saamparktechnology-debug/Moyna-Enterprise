import { describe, expect, it } from 'vitest';
import { readZip } from '../../../test/support/zip-reader.js';
import type { ExportableReport } from './export-types.js';
import { pdfExporter } from './pdf-exporter.js';
import { columnName, xlsxExporter } from './xlsx-exporter.js';

const report = (over: Partial<ExportableReport> = {}): ExportableReport => ({
  title: 'Sales',
  subtitle: ['Period: 2026-09-01 to 2026-09-30', 'All branches you can see'],
  columns: [
    { key: 'date', label: 'Date', type: 'date' },
    { key: 'customer', label: 'Customer', type: 'text' },
    { key: 'qty', label: 'Quantity', type: 'int' },
    { key: 'total', label: 'Total', type: 'money' },
  ],
  rows: [
    { date: '2026-09-05', customer: 'Ravi & <Sons> "Ltd"', qty: 2, total: '1050.50' },
    { date: '2026-09-06', customer: 'Meera', qty: 1, total: '99.00' },
    { date: '2026-09-07', customer: null, qty: 0, total: '0.00' },
  ],
  totals: { qty: '3', total: '1149.50' },
  generatedAt: new Date('2026-10-10T08:30:00Z'),
  ...over,
});

describe('columnName', () => {
  it('counts like a spreadsheet', () => {
    expect([0, 1, 25, 26, 27, 51, 52, 701, 702].map(columnName)).toEqual([
      'A',
      'B',
      'Z',
      'AA',
      'AB',
      'AZ',
      'BA',
      'ZZ',
      'AAA',
    ]);
  });
});

describe('the Excel file', () => {
  const files = readZip(xlsxExporter.render(report()));
  const sheet = files.get('xl/worksheets/sheet1.xml')!.toString('utf8');

  it('is a valid package with the parts Excel needs, every checksum correct', () => {
    expect([...files.keys()].sort()).toEqual([
      '[Content_Types].xml',
      '_rels/.rels',
      'xl/_rels/workbook.xml.rels',
      'xl/styles.xml',
      'xl/workbook.xml',
      'xl/worksheets/sheet1.xml',
    ]);
    expect(files.get('xl/workbook.xml')!.toString()).toContain('name="Sales"');
  });

  it('holds the title, the filters, the headings, every row and a totals row', () => {
    for (const text of [
      'Sales',
      'Period: 2026-09-01 to 2026-09-30',
      'Date',
      'Customer',
      'Quantity',
      'Total',
      'Meera',
    ])
      expect(sheet).toContain(text);
    expect(sheet.match(/<row /g)).toHaveLength(1 + 2 + 1 + 3 + 1);
  });

  it('writes money and whole numbers as numbers, so Excel can add them up', () => {
    expect(sheet).toContain('<v>1050.5</v>');
    expect(sheet).toContain('<c r="C6" s="4"><v>2</v></c>');
    expect(sheet).toContain('<c r="D9" s="3"><v>1149.5</v></c>');
  });

  it('escapes characters that would break the XML', () => {
    expect(sheet).toContain('Ravi &amp; &lt;Sons&gt; &quot;Ltd&quot;');
    expect(sheet).not.toContain('<Sons>');
  });

  it('freezes the heading row and leaves empty cells empty', () => {
    expect(sheet).toContain('state="frozen"');
    expect(sheet).toContain('<c r="B8" s="0"/>');
  });

  it('is still a valid file with no rows and no totals', () => {
    const empty = readZip(xlsxExporter.render(report({ rows: [], totals: {} })));
    expect(empty.get('xl/worksheets/sheet1.xml')!.toString()).toContain('<sheetData>');
  });

  it('removes characters a worksheet cannot hold and shortens long sheet names', () => {
    const odd = readZip(
      xlsxExporter.render(
        report({
          title: 'A/B:C?*[x]'.repeat(5),
          rows: [{ date: '', customer: 'bad\u0001char', qty: 1, total: '1.00' }],
        }),
      ),
    );
    expect(odd.get('xl/worksheets/sheet1.xml')!.toString()).toContain('badchar');
    const name = /sheet name="([^"]*)"/.exec(odd.get('xl/workbook.xml')!.toString())![1]!;
    expect(name.length).toBeLessThanOrEqual(31);
    expect(name).not.toMatch(/[\\/?*[\]:]/);
  });
});

describe('the PDF file', () => {
  const text = (buffer: Buffer): string => buffer.toString('latin1');

  it('is a well-formed PDF: header, trailer and a cross-reference table that points at every object', () => {
    const pdf = pdfExporter.render(report());
    const content = text(pdf);
    expect(content.startsWith('%PDF-1.4')).toBe(true);
    expect(content.trimEnd().endsWith('%%EOF')).toBe(true);
    const start = Number(/startxref\n(\d+)/.exec(content)![1]);
    expect(content.slice(start, start + 4)).toBe('xref');
    const entries = [...content.slice(start).matchAll(/(\d{10}) 00000 n /g)].map((m) =>
      Number(m[1]),
    );
    entries.forEach((offset, index) => {
      expect(content.slice(offset, offset + 12)).toMatch(new RegExp(`^${index + 1} 0 obj`));
    });
  });

  it('shows the title, filters, headings, rows and totals', () => {
    const content = text(pdfExporter.render(report()));
    for (const part of [
      '(Sales)',
      'Period: 2026-09-01 to 2026-09-30',
      '(Customer)',
      '(Meera)',
      '1,050.50',
      '(Total)',
      '1,149.50',
    ])
      expect(content).toContain(part);
  });

  it('writes the rupee sign as Rs. and escapes brackets', () => {
    const content = text(
      pdfExporter.render(
        report({
          rows: [{ date: '2026-09-05', customer: '₹ (Ravi) \\ ✓', qty: 1, total: '1.00' }],
        }),
      ),
    );
    expect(content).toContain('Rs. \\(Ravi\\) \\\\ ?');
  });

  it('starts a new page after the rows that fit, repeats the headings and numbers the pages', () => {
    const rows = Array.from({ length: 120 }, (_, i) => ({
      date: '2026-09-05',
      customer: `Customer ${i}`,
      qty: i,
      total: '1.00',
    }));
    const content = text(pdfExporter.render(report({ rows })));
    const pages = Number(/\/Count (\d+)/.exec(content)![1]);
    expect(pages).toBeGreaterThan(2);
    expect(content.match(/\/Type \/Page /g)).toHaveLength(pages);
    expect(content.match(/\(Customer\) Tj/g)).toHaveLength(pages);
    expect(content).toContain(`Page ${pages} of ${pages}`);
    expect(content).toContain('Customer 119');
  });

  it('shortens text that does not fit its column instead of running over', () => {
    const long = 'Very long customer name '.repeat(20);
    const content = text(
      pdfExporter.render(
        report({ rows: [{ date: '2026-09-05', customer: long, qty: 1, total: '1.00' }] }),
      ),
    );
    expect(content).not.toContain(long);
    expect(content).toContain('...');
  });

  it('says so when there are no rows', () => {
    const content = text(pdfExporter.render(report({ rows: [], totals: {} })));
    expect(content).toContain('No rows for these filters.');
    expect(content).toContain('Page 1 of 1');
  });

  it('gives the same bytes for the same report', () => {
    expect(pdfExporter.render(report()).equals(pdfExporter.render(report()))).toBe(true);
  });
});
