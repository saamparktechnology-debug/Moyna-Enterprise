import type { DocumentCompany, Invoice } from '@erp/contracts';
import {
  INNER,
  FRAME,
  boxLineSize,
  drawFrame,
  drawLetterhead,
  drawWatermark,
  ruledLine,
} from './letterhead.js';
import {
  PAGE_WIDTH,
  Page,
  amountInWords,
  assemblePdf,
  fit,
  inr,
  wordsUpper,
  wrap,
} from './pdf-kit.js';
import type { PdfParty } from './pdf-kit.js';

export { amountInWords };
export type { PdfParty };

/** The table's columns: Sl, Description, HSN/SAC, Quantity, Rate, Amount. Each entry is where the column starts. */
const COL = {
  sl: INNER.left,
  desc: 58,
  hsn: 303,
  qty: 358,
  rate: 408,
  amount: 480,
  end: INNER.right,
};
const ROW = 12;
const TABLE_HEAD_TOP = 608;
const BODY_TOP_FIRST = TABLE_HEAD_TOP - 22;
const BODY_TOP_OTHER = 758;
const TOTALS_TOP = 214;
const BODY_BOTTOM_OTHER = 66;

const RED = [0.8, 0.12, 0.12] as const;

/** The mobile number and address of the business, plus a company with no details at all. */
const EMPTY_COMPANY: DocumentCompany = {
  name: 'Invoice',
  proprietor: null,
  address: null,
  phone: null,
  gstin: null,
  tagline: null,
  terms: null,
};

/** One tax amount in paise, so rows can be added without any rounding. */
const paise = (amount: string): number => Math.round(Number(amount) * 100);
const money = (paiseAmount: number): string => (paiseAmount / 100).toFixed(2);
const half = (rate: string | null): string => {
  const value = Number(rate ?? 0) / 2;
  return Number.isInteger(value * 10) ? String(value) : value.toFixed(2);
};

interface TaxRow {
  label: string;
  value: string;
}

/** The GST rows under the table: one pair (CGST and SGST, or IGST) for each rate the invoice has. */
function taxRows(invoice: Invoice): TaxRow[] {
  const rates = [...new Set(invoice.lines.map((line) => line.taxRate ?? '0.00'))].sort(
    (a, b) => Number(a) - Number(b),
  );
  if (rates.length <= 1) {
    const rate = rates[0] ?? null;
    return invoice.interState
      ? [{ label: `I.G.S.T (${Number(rate ?? 0)}%) Rs.`, value: invoice.igstAmount }]
      : [
          { label: `C.G.S.T (${half(rate)}%) Rs.`, value: invoice.cgstAmount },
          { label: `S.G.S.T (${half(rate)}%) Rs.`, value: invoice.sgstAmount },
        ];
  }
  const rows: TaxRow[] = [];
  for (const rate of rates) {
    const lines = invoice.lines.filter((line) => (line.taxRate ?? '0.00') === rate);
    const sum = (pick: (line: Invoice['lines'][number]) => string): string =>
      money(lines.reduce((total, line) => total + paise(pick(line)), 0));
    if (invoice.interState)
      rows.push({
        label: `I.G.S.T (${Number(rate)}%) Rs.`,
        value: sum((line) => line.igstAmount),
      });
    else
      rows.push(
        { label: `C.G.S.T (${half(rate)}%) Rs.`, value: sum((line) => line.cgstAmount) },
        { label: `S.G.S.T (${half(rate)}%) Rs.`, value: sum((line) => line.sgstAmount) },
      );
  }
  return rows;
}

/** A vehicle (HSN 8701 to 8716) carries a chassis number; anything else a serial number. */
const isVehicle = (line: Invoice['lines'][number]): boolean =>
  /^87(0[1-9]|1[0-6])/.test(line.hsnCode ?? '');

/** The rows one invoice line takes in the description column: its name, then a row each for serial number and discount. */
const rowsOf = (line: Invoice['lines'][number]): number =>
  1 + (line.serialNo ? 1 : 0) + (Number(line.discountAmount) > 0 ? 1 : 0);
const heightOf = (line: Invoice['lines'][number]): number => rowsOf(line) * ROW + 6;

function tableHead(page: Page, top: number): void {
  const height = 20;
  page.frame(INNER.left, top - height, INNER.right - INNER.left, height, 0.8);
  const heads: [number, number, string][] = [
    [COL.sl, COL.desc, 'Sl'],
    [COL.desc, COL.hsn, 'Description'],
    [COL.hsn, COL.qty, 'HSN/SAC'],
    [COL.qty, COL.rate, 'Quantity'],
    [COL.rate, COL.amount, 'Rate'],
    [COL.amount, COL.end, 'Amount'],
  ];
  for (const [from, to, text] of heads) {
    const width = text.length * 5.6;
    page.text(from + (to - from - width) / 2, top - 14, text, 10, true);
  }
}

/** The ruled columns of the table, from the header down to `bottom`. */
function tableColumns(page: Page, top: number, bottom: number): void {
  for (const x of [COL.desc, COL.hsn, COL.qty, COL.rate, COL.amount])
    page.line(x, top - 20, x, bottom, 0.8);
  page.line(INNER.left, top - 20, INNER.left, bottom, 0.8);
  page.line(INNER.right, top - 20, INNER.right, bottom, 0.8);
}

/**
 * Builds an A4 invoice as a PDF in the layout of the business's own printed invoice: a ruled frame, the company name in
 * large letters with the proprietor, GSTIN and address, the buyer on the left and the date and invoice number in a box on
 * the right, a table of Sl, Description, HSN/SAC, Quantity, Rate and Amount, the value in words, the GST rows, the round
 * off and the total, and the customer's signature and the company's at the foot. It uses only the standard PDF fonts.
 */
export function buildInvoicePdf(
  invoice: Invoice,
  company: DocumentCompany = EMPTY_COMPANY,
): Buffer {
  const gst = invoice.type === 'GST';
  const heading = { ...company, name: company.name || 'Invoice' };

  // Which lines go on which page. The totals need the room under the table on the last page.
  const chunks: Invoice['lines'][] = [[]];
  let used = 0;
  for (const line of invoice.lines) {
    const room = (chunks.length === 1 ? BODY_TOP_FIRST : BODY_TOP_OTHER) - BODY_BOTTOM_OTHER;
    if (used + heightOf(line) > room) {
      chunks.push([]);
      used = 0;
    }
    chunks[chunks.length - 1]?.push(line);
    used += heightOf(line);
  }
  const lastTop = chunks.length === 1 ? BODY_TOP_FIRST : BODY_TOP_OTHER;
  if (used > lastTop - TOTALS_TOP - 8) chunks.push([]);

  const pages: Page[] = [];
  chunks.forEach((rows, pageIndex) => {
    const page = new Page();
    pages.push(page);
    const isLast = pageIndex === chunks.length - 1;
    drawWatermark(page, heading);
    drawFrame(page);
    let tableTop: number;
    let bodyTop: number;
    if (pageIndex === 0) {
      drawLetterhead(page, heading, gst ? 'GST INVOICE' : 'INVOICE', gst, invoice.branchGstin);
      if (invoice.status !== 'ISSUED')
        page.styled(
          INNER.left + 8,
          677,
          invoice.status === 'DRAFT'
            ? 'DRAFT - this is not a valid invoice'
            : `CANCELLED - ${invoice.cancelReason ?? 'no reason given'}`,
          10,
          'F2',
          RED,
        );
      const buyerWidth = 372;
      ruledLine(
        page,
        INNER.left + 4,
        662,
        buyerWidth - 130,
        `Buyer's name - ${invoice.customerName}`,
      );
      ruledLine(
        page,
        INNER.left + buyerWidth - 120,
        662,
        124,
        `Mob:- ${invoice.customerPhone ?? ''}`,
      );
      ruledLine(page, INNER.left + 4, 644, buyerWidth, `Address- ${invoice.customerAddress ?? ''}`);
      const extra = [
        gst && invoice.customerGstin ? `GSTIN- ${invoice.customerGstin}` : null,
        gst && invoice.placeOfSupply ? `Place of supply: ${invoice.placeOfSupply}` : null,
      ]
        .filter(Boolean)
        .join('    ');
      if (extra) page.text(INNER.left + 4, 626, fit(extra, buyerWidth, 9), 9, true);
      // Date, invoice number and vehicle number in a box, as on the printed form.
      const boxX = 412;
      page.frame(boxX, 616, INNER.right - boxX, 70, 0.8);
      page.text(boxX + 6, 672, `Date:- ${invoice.issuedOn ?? '-'}`, 10, true);
      const numberLine = `Invoice No:- ${invoice.invoiceNo ?? 'not yet numbered'}`;
      page.text(boxX + 6, 655, numberLine, boxLineSize(numberLine), true);
      page.text(boxX + 6, 638, 'Vehicle No:-', 10, true);
      if (invoice.dueDate) page.text(boxX + 6, 622, `Due:- ${invoice.dueDate}`, 9, true);
      tableTop = TABLE_HEAD_TOP;
      bodyTop = BODY_TOP_FIRST;
    } else {
      page.text(
        INNER.left + 4,
        FRAME.top - 22,
        `${company.name} - ${invoice.invoiceNo ?? 'Draft invoice'} (continued)`,
        10,
        true,
      );
      tableTop = FRAME.top - 34;
      bodyTop = BODY_TOP_OTHER;
    }
    tableHead(page, tableTop);
    const bodyBottom = isLast ? TOTALS_TOP : BODY_BOTTOM_OTHER;
    tableColumns(page, tableTop, bodyBottom);
    page.line(INNER.left, bodyBottom, INNER.right, bodyBottom, 0.8);

    let y = bodyTop - 14;
    const firstNumber = chunks.slice(0, pageIndex).reduce((sum, chunk) => sum + chunk.length, 0);
    rows.forEach((line, index) => {
      page.text(COL.sl + 6, y, String(firstNumber + index + 1), 10, true);
      page.text(COL.desc + 4, y, fit(line.itemName, COL.hsn - COL.desc - 8, 10), 10, true);
      if (gst && line.hsnCode) page.text(COL.hsn + 6, y, line.hsnCode, 10, true);
      page.text(COL.qty + 22, y, String(line.qty), 10, true);
      page.right(COL.amount - 6, y, inr(line.unitPrice), 10, true);
      page.right(COL.end - 5, y, inr(line.taxableAmount), 10, true);
      if (Number(line.discountAmount) > 0) {
        y -= ROW;
        page.text(COL.desc + 12, y, `Less discount Rs. ${inr(line.discountAmount)}`, 8);
      }
      if (line.serialNo) {
        y -= ROW;
        page.text(
          COL.desc + 4,
          y,
          fit(`${isVehicle(line) ? 'CH No' : 'S/N'}- ${line.serialNo}`, COL.hsn - COL.desc - 8, 10),
          10,
          true,
        );
      }
      y -= ROW + 6;
    });

    if (isLast) {
      // Left: the value in words and the terms.
      const words = wrap(`Total Value (in Word)- ${wordsUpper(invoice.total)}`, 318, 10, true);
      words
        .slice(0, 3)
        .forEach((text, index) =>
          page.text(INNER.left + 4, TOTALS_TOP - 16 - index * 13, text, 10, true),
        );
      if (company.terms)
        wrap(`1. ${company.terms}`, 318, 10, true)
          .slice(0, 3)
          .forEach((text, index) =>
            page.text(INNER.left + 4, TOTALS_TOP - 78 - index * 13, text, 10, true),
          );

      // Right: the GST rows, the round off and the total, each in its own ruled row.
      const gstRows = gst ? taxRows(invoice) : [];
      const rows2: TaxRow[] = [
        ...gstRows,
        {
          label: 'Round Off',
          value: invoice.roundOff.startsWith('-') ? invoice.roundOff : `+${invoice.roundOff}`,
        },
      ];
      const rowHeight = rows2.length > 4 ? 18 : 22;
      const left = 358;
      let top = TOTALS_TOP;
      for (const row of rows2) {
        page.frame(left, top - rowHeight, INNER.right - left, rowHeight, 0.8);
        page.text(left + 6, top - rowHeight + 7, row.label, 10, true);
        page.right(INNER.right - 6, top - rowHeight + 7, inr(row.value), 10, true);
        top -= rowHeight;
      }
      page.frame(left, top - 24, INNER.right - left, 24, 0.8);
      page.text(left + 6, top - 16, 'Total Invoice RS.', 11, true);
      page.right(INNER.right - 6, top - 16, inr(invoice.total), 11, true);
      top -= 24;
      page.text(left + (INNER.right - left - 38) / 2, top - 16, 'E & O.E', 10, true);
      // The foot: the customer signs on the left, the company on the right.
      const foot = 56;
      page.text(INNER.left + 4, foot, 'Customer Signature', 10, true);
      const forCompany = `For ${company.name.toUpperCase()}`;
      page.right(INNER.right - 10, foot, fit(forCompany, 220, 11), 11, true);
    } else {
      page.text(INNER.right - 130, BODY_BOTTOM_OTHER - 14, 'Continued on next page', 8);
    }
    page.text(
      (PAGE_WIDTH - 60) / 2,
      FRAME.bottom + 6,
      `Page ${pageIndex + 1} of ${chunks.length}`,
      7,
    );
  });

  return assemblePdf(pages);
}
