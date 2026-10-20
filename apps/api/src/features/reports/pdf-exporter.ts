import type { ExportableReport, ReportCellValue, ReportExporter } from './export-types.js';

// Helvetica character widths (1/1000 em) for the printable ASCII characters 32 to 126.
const WIDTHS = [
  278, 278, 355, 556, 556, 889, 667, 191, 333, 333, 389, 584, 278, 333, 278, 278, 556, 556, 556,
  556, 556, 556, 556, 556, 556, 556, 278, 278, 584, 584, 584, 556, 1015, 667, 667, 722, 722, 667,
  611, 778, 722, 278, 500, 667, 556, 833, 722, 778, 667, 778, 722, 667, 611, 722, 667, 944, 667,
  667, 611, 278, 278, 278, 469, 556, 333, 556, 556, 500, 556, 556, 278, 556, 556, 222, 222, 500,
  222, 833, 556, 556, 556, 556, 333, 500, 278, 556, 500, 722, 500, 500, 500, 334, 260, 334, 584,
];

const PAGE_WIDTH = 842; // A4 landscape, in points
const PAGE_HEIGHT = 595;
const MARGIN = 28;
const FONT_SIZE = 7.5;
const ROW_HEIGHT = 12;
const HEADER_FONT = 14;

/** The text as the PDF's built-in font can show it: the rupee sign becomes "Rs.", other unusual characters become "?". */
function printable(value: string): string {
  return value
    .replaceAll('₹', 'Rs.')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[^\x20-\x7E\u00A0-\u00FF]/g, '?');
}

function width(text: string, size: number, bold: boolean): number {
  let total = 0;
  for (const char of text) {
    const code = char.charCodeAt(0);
    total += code >= 32 && code <= 126 ? (WIDTHS[code - 32] ?? 556) : 556;
  }
  return ((total * size) / 1000) * (bold ? 1.06 : 1);
}

function fit(text: string, max: number, size: number, bold: boolean): string {
  if (width(text, size, bold) <= max) return text;
  let cut = text;
  while (cut.length > 1 && width(`${cut}...`, size, bold) > max) cut = cut.slice(0, -1);
  return `${cut}...`;
}

const escapePdf = (text: string): string => text.replace(/[\\()]/g, (char) => `\\${char}`);

const money = (value: ReportCellValue): string => {
  if (value === null || value === '') return '';
  const number = Number(value);
  return Number.isFinite(number)
    ? number.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : String(value);
};

function display(value: ReportCellValue, type: string): string {
  if (value === null) return '';
  return type === 'money' ? money(value) : String(value);
}

/** A plain landscape A4 table: a title, the filters, repeated column headings, the rows, a totals row and page numbers. */
export const pdfExporter: ReportExporter = {
  contentType: 'application/pdf',
  extension: 'pdf',
  render(report: ExportableReport): Buffer {
    const available = PAGE_WIDTH - MARGIN * 2;
    const cells = report.rows.map((row) =>
      report.columns.map((column) => printable(display(row[column.key] ?? null, column.type))),
    );
    const totalsRow =
      Object.keys(report.totals).length > 0
        ? report.columns.map((column, index) =>
            index === 0
              ? 'Total'
              : printable(display(report.totals[column.key] ?? null, column.type)),
          )
        : null;
    const headers = report.columns.map((column) => printable(column.label));

    // Column widths: as wide as the content needs (sampling the rows), then squeezed to fit the page.
    const wanted = report.columns.map((_, index) => {
      const sample = cells.slice(0, 300).map((row) => row[index] ?? '');
      const widest = Math.max(
        width(headers[index] ?? '', FONT_SIZE, true),
        ...sample.map((text) => width(text, FONT_SIZE, false)),
        ...(totalsRow ? [width(totalsRow[index] ?? '', FONT_SIZE, true)] : []),
      );
      return Math.min(widest + 8, 190);
    });
    const sum = wanted.reduce((a, b) => a + b, 0);
    const scale = sum > available ? available / sum : 1;
    const widths = wanted.map((w) => w * scale);

    const perPage = Math.floor((PAGE_HEIGHT - MARGIN * 2 - 70 - 20) / ROW_HEIGHT);
    const bodyRows = [
      ...cells.map((row) => ({ row, bold: false })),
      ...(totalsRow ? [{ row: totalsRow, bold: true }] : []),
    ];
    const pageCount = Math.max(1, Math.ceil(bodyRows.length / perPage));
    const generated = report.generatedAt.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

    const streams: string[] = [];
    for (let page = 0; page < pageCount; page += 1) {
      const out: string[] = [];
      const text = (
        x: number,
        y: number,
        value: string,
        size: number,
        bold: boolean,
        rightEdge?: number,
      ): void => {
        const shown = escapePdf(value);
        const left = rightEdge === undefined ? x : rightEdge - width(value, size, bold);
        out.push(
          `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${left.toFixed(2)} ${y.toFixed(2)} Td (${shown}) Tj ET`,
        );
      };

      let y = PAGE_HEIGHT - MARGIN - HEADER_FONT;
      text(MARGIN, y, printable(report.title), HEADER_FONT, true);
      y -= 14;
      for (const line of report.subtitle) {
        text(MARGIN, y, printable(line), 8, false);
        y -= 10;
      }
      y -= 6;

      const drawRow = (values: string[], bold: boolean, rowY: number): void => {
        let x = MARGIN;
        values.forEach((value, index) => {
          const w = widths[index] ?? 40;
          const column = report.columns[index];
          const right = column?.type === 'money' || column?.type === 'int';
          const shown = fit(value, w - 6, FONT_SIZE, bold);
          if (right) text(x, rowY, shown, FONT_SIZE, bold, x + w - 3);
          else text(x + 3, rowY, shown, FONT_SIZE, bold);
          x += w;
        });
      };
      out.push('0.5 w 0.6 G');
      out.push(
        `${MARGIN} ${(y - 3).toFixed(2)} m ${PAGE_WIDTH - MARGIN} ${(y - 3).toFixed(2)} l S`,
      );
      drawRow(headers, true, y);
      y -= ROW_HEIGHT;
      out.push(
        `${MARGIN} ${(y + ROW_HEIGHT - 3 - 1).toFixed(2)} m ${PAGE_WIDTH - MARGIN} ${(y + ROW_HEIGHT - 3 - 1).toFixed(2)} l S`,
      );

      for (const { row, bold } of bodyRows.slice(page * perPage, (page + 1) * perPage)) {
        drawRow(row, bold, y);
        y -= ROW_HEIGHT;
      }
      if (report.rows.length === 0 && page === 0)
        text(MARGIN + 3, y, 'No rows for these filters.', FONT_SIZE, false);
      text(MARGIN, MARGIN - 8, `Generated ${generated}`, 7, false);
      const label = `Page ${page + 1} of ${pageCount}`;
      text(0, MARGIN - 8, label, 7, false, PAGE_WIDTH - MARGIN);
      streams.push(out.join('\n'));
    }

    // Objects: 1 catalog, 2 pages, 3 regular font, 4 bold font, then a content stream and a page for each page.
    const objects: string[] = [];
    const pageIds = streams.map((_, index) => 6 + index * 2);
    objects[1] = '<< /Type /Catalog /Pages 2 0 R >>';
    objects[2] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageCount} >>`;
    objects[3] =
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>';
    objects[4] =
      '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>';
    objects[5] = '<< /Producer (ERP reports) >>';
    const parts: Buffer[] = [Buffer.from('%PDF-1.4\n%\xE2\xE3\xCF\xD3\n', 'latin1')];
    const offsets: number[] = [];
    let position = parts[0]!.length;
    const push = (id: number, body: Buffer): void => {
      offsets[id] = position;
      const chunk = Buffer.concat([
        Buffer.from(`${id} 0 obj\n`, 'latin1'),
        body,
        Buffer.from('\nendobj\n', 'latin1'),
      ]);
      parts.push(chunk);
      position += chunk.length;
    };
    for (let id = 1; id <= 5; id += 1) push(id, Buffer.from(objects[id] ?? '', 'latin1'));
    streams.forEach((stream, index) => {
      const contentId = 6 + index * 2 + 1;
      const pageId = 6 + index * 2;
      push(
        pageId,
        Buffer.from(
          `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${contentId} 0 R >>`,
          'latin1',
        ),
      );
      const data = Buffer.from(stream, 'latin1');
      push(
        contentId,
        Buffer.concat([
          Buffer.from(`<< /Length ${data.length} >>\nstream\n`, 'latin1'),
          data,
          Buffer.from('\nendstream', 'latin1'),
        ]),
      );
    });
    const count = 6 + streams.length * 2;
    const xrefStart = position;
    const xref = [`xref\n0 ${count}\n0000000000 65535 f \n`];
    for (let id = 1; id < count; id += 1)
      xref.push(`${String(offsets[id] ?? 0).padStart(10, '0')} 00000 n \n`);
    xref.push(
      `trailer\n<< /Size ${count} /Root 1 0 R /Info 5 0 R >>\nstartxref\n${xrefStart}\n%%EOF\n`,
    );
    parts.push(Buffer.from(xref.join(''), 'latin1'));
    return Buffer.concat(parts);
  },
};
