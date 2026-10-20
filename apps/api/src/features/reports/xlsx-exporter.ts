import type { ReportColumn } from '@erp/contracts';
import type { ExportableReport, ReportCellValue, ReportExporter } from './export-types.js';
import { zip } from './zip.js';

const escapeXml = (value: string): string =>
  value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');

/** A1-style column name: 0 is A, 25 is Z, 26 is AA. */
export function columnName(index: number): string {
  let name = '';
  for (let n = index + 1; n > 0; n = Math.floor((n - 1) / 26))
    name = String.fromCharCode(65 + ((n - 1) % 26)) + name;
  return name;
}

// Cell styles (see styles.xml): 0 plain, 1 bold, 2 two decimals, 3 bold two decimals, 4 whole number, 5 bold whole number.
const STYLE = { plain: 0, bold: 1, money: 2, boldMoney: 3, int: 4, boldInt: 5 };

function cell(
  ref: string,
  value: ReportCellValue,
  type: ReportColumn['type'],
  bold: boolean,
): string {
  if (value === null || value === '')
    return `<c r="${ref}" s="${bold ? STYLE.bold : STYLE.plain}"/>`;
  if ((type === 'money' || type === 'int') && Number.isFinite(Number(value))) {
    const style =
      type === 'money' ? (bold ? STYLE.boldMoney : STYLE.money) : bold ? STYLE.boldInt : STYLE.int;
    return `<c r="${ref}" s="${style}"><v>${Number(value)}</v></c>`;
  }
  return `<c r="${ref}" s="${bold ? STYLE.bold : STYLE.plain}" t="inlineStr"><is><t xml:space="preserve">${escapeXml(String(value))}</t></is></c>`;
}

const STYLES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<numFmts count="1"><numFmt numFmtId="164" formatCode="#,##0.00"/></numFmts>
<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts>
<fills count="2"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill></fills>
<borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders>
<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>
<cellXfs count="6">
<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>
<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/>
<xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="164" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
<xf numFmtId="1" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/>
<xf numFmtId="1" fontId="1" fillId="0" borderId="0" xfId="0" applyNumberFormat="1" applyFont="1"/>
</cellXfs>
<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>
</styleSheet>`;

/** Builds an .xlsx workbook with one sheet: a title, the filters, the column headings, the rows and a totals row. */
export const xlsxExporter: ReportExporter = {
  contentType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  extension: 'xlsx',
  render(report: ExportableReport): Buffer {
    const rows: string[] = [];
    let rowNo = 1;
    const textRow = (value: string, bold: boolean): void => {
      rows.push(`<row r="${rowNo}">${cell(`A${rowNo}`, value, 'text', bold)}</row>`);
      rowNo += 1;
    };
    textRow(report.title, true);
    for (const line of report.subtitle) textRow(line, false);
    rowNo += 1;

    rows.push(
      `<row r="${rowNo}">${report.columns
        .map((column, index) => cell(`${columnName(index)}${rowNo}`, column.label, 'text', true))
        .join('')}</row>`,
    );
    const headerRow = rowNo;
    rowNo += 1;

    for (const row of report.rows) {
      rows.push(
        `<row r="${rowNo}">${report.columns
          .map((column, index) =>
            cell(`${columnName(index)}${rowNo}`, row[column.key] ?? null, column.type, false),
          )
          .join('')}</row>`,
      );
      rowNo += 1;
    }
    if (Object.keys(report.totals).length > 0) {
      rows.push(
        `<row r="${rowNo}">${report.columns
          .map((column, index) =>
            cell(
              `${columnName(index)}${rowNo}`,
              index === 0 ? 'Total' : (report.totals[column.key] ?? null),
              index === 0 ? 'text' : column.type,
              true,
            ),
          )
          .join('')}</row>`,
      );
    }

    const widths = report.columns
      .map((column, index) => {
        const longest = Math.max(
          column.label.length,
          ...report.rows.slice(0, 200).map((row) => String(row[column.key] ?? '').length),
        );
        return `<col min="${index + 1}" max="${index + 1}" width="${Math.min(Math.max(longest + 2, 10), 40)}" customWidth="1"/>`;
      })
      .join('');
    const sheet = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
<sheetViews><sheetView workbookViewId="0"><pane ySplit="${headerRow}" topLeftCell="A${headerRow + 1}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>
<cols>${widths}</cols>
<sheetData>${rows.join('')}</sheetData>
</worksheet>`;

    return zip([
      {
        name: '[Content_Types].xml',
        data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>`),
      },
      {
        name: '_rels/.rels',
        data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
      },
      {
        name: 'xl/workbook.xml',
        data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets><sheet name="${escapeXml(report.title.slice(0, 31).replace(/[\\/?*[\]:]/g, ' '))}" sheetId="1" r:id="rId1"/></sheets></workbook>`),
      },
      {
        name: 'xl/_rels/workbook.xml.rels',
        data: Buffer.from(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
      },
      { name: 'xl/styles.xml', data: Buffer.from(STYLES) },
      { name: 'xl/worksheets/sheet1.xml', data: Buffer.from(sheet) },
    ]);
  },
};
