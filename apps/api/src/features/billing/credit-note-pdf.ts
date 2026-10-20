import type { CreditNote } from '@erp/contracts';
import { todayInIndia } from '@erp/contracts';
import {
  FIRST_PAGE_ROWS,
  MARGIN,
  OTHER_PAGE_ROWS,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  Page,
  ROW,
  amountInWords,
  assemblePdf,
  fit,
  party,
} from './pdf-kit.js';
import type { PdfParty } from './pdf-kit.js';

/** What a credit note needs besides itself: who it is from, who it is for, and the invoice it follows. */
export interface CreditNotePdfContext {
  branchName: string;
  branchGstin: string | null;
  customerGstin: string | null;
  /** The invoice's type: a GST credit note shows the tax split, a non-GST one does not. */
  gst: boolean;
  invoiceDate: string | null;
}

const COLUMNS = { no: 40, item: 58, qty: 330, taxable: 400, tax: 462, amount: PAGE_WIDTH - MARGIN };

const BANNER: Record<string, string> = {
  PENDING: 'PENDING - this credit note is not valid until it is approved',
  REJECTED: 'REJECTED - this credit note is not valid',
};

function tableHeader(page: Page, y: number, gst: boolean): void {
  page.box(MARGIN, y - 4, PAGE_WIDTH - 2 * MARGIN, ROW + 2);
  page.text(COLUMNS.no, y, '#', 8, true);
  page.text(COLUMNS.item, y, 'Item returned', 8, true);
  page.right(COLUMNS.qty + 22, y, 'Qty', 8, true);
  page.right(COLUMNS.taxable + 50, y, 'Taxable', 8, true);
  page.right(COLUMNS.tax + 44, y, gst ? 'GST' : '', 8, true);
  page.right(COLUMNS.amount, y, 'Amount', 8, true);
}

const taxOf = (line: CreditNote['lines'][number]): string =>
  (Number(line.cgstAmount) + Number(line.sgstAmount) + Number(line.igstAmount)).toFixed(2);

/** Builds an A4 credit note as a PDF. Only an approved credit note has a number and is valid; the others say so on the page. */
export function buildCreditNotePdf(note: CreditNote, context: CreditNotePdfContext): Buffer {
  const gst = context.gst;
  // A credit note without GST carries no GSTIN, as the invoice it follows did not.
  const seller: PdfParty = {
    name: context.branchName,
    address: null,
    phone: null,
    gstin: gst ? context.branchGstin : null,
  };
  const buyer: PdfParty = {
    name: note.customerName,
    address: null,
    phone: null,
    gstin: gst ? context.customerGstin : null,
  };
  const interState = Number(note.igstAmount) > 0;
  const rowsOf = (line: CreditNote['lines'][number]): number => (line.serialNo ? 2 : 1);

  const chunks: CreditNote['lines'][] = [[]];
  let used = 0;
  for (const line of note.lines) {
    const capacity = chunks.length === 1 ? FIRST_PAGE_ROWS - 3 : OTHER_PAGE_ROWS;
    if (used + rowsOf(line) > capacity) {
      chunks.push([]);
      used = 0;
    }
    chunks[chunks.length - 1]?.push(line);
    used += rowsOf(line);
  }
  const lastCapacity = chunks.length === 1 ? FIRST_PAGE_ROWS - 3 : OTHER_PAGE_ROWS;
  if (used > lastCapacity - 12) chunks.push([]);

  const issuedOn =
    note.decidedAt && note.status === 'APPROVED' ? todayInIndia(new Date(note.decidedAt)) : null;
  const pages: Page[] = [];
  chunks.forEach((rows, pageIndex) => {
    const page = new Page();
    pages.push(page);
    let y = PAGE_HEIGHT - MARGIN - 6;
    if (pageIndex === 0) {
      page.centre(y, 'CREDIT NOTE', 15, true);
      const banner = BANNER[note.status];
      if (banner) page.centre(y - 14, banner, 10, true);
      y -= 38;
      party(page, MARGIN, y, 'ISSUED BY', seller);
      party(page, 320, y, 'CREDITED TO', buyer);
      page.text(320, y - 62, `Credit note no: ${note.creditNoteNo ?? 'not yet numbered'}`, 9, true);
      page.text(320, y - 74, `Date: ${issuedOn ?? '-'}`, 9);
      page.text(
        320,
        y - 86,
        `Against invoice: ${note.invoiceNo ?? '-'}${context.invoiceDate ? ` of ${context.invoiceDate}` : ''}`,
        9,
      );
      y -= 104;
      page.text(MARGIN, y + 6, fit(`Reason: ${note.reason}`, PAGE_WIDTH - 2 * MARGIN, 9), 9);
      y -= 14;
    } else {
      page.text(MARGIN, y, `${note.creditNoteNo ?? 'Credit note'} (continued)`, 9, true);
      y -= 24;
    }
    tableHeader(page, y, gst);
    y -= ROW + 6;
    const firstNumber = chunks.slice(0, pageIndex).reduce((sum, chunk) => sum + chunk.length, 0);
    rows.forEach((line, index) => {
      page.text(COLUMNS.no, y, String(firstNumber + index + 1), 8);
      page.text(
        COLUMNS.item,
        y,
        fit(`${line.itemCode} ${line.itemName}`, COLUMNS.qty - COLUMNS.item - 30, 8),
        8,
      );
      page.right(COLUMNS.qty + 22, y, String(line.qty), 8);
      page.right(COLUMNS.taxable + 50, y, line.taxableAmount, 8);
      if (gst) page.right(COLUMNS.tax + 44, y, taxOf(line), 8);
      page.right(COLUMNS.amount, y, line.amount, 8);
      if (line.serialNo) {
        y -= ROW - 2;
        page.text(COLUMNS.item + 8, y, `S/N: ${line.serialNo}`, 7);
        y -= 2;
      }
      y -= ROW;
    });
    page.line(MARGIN, y + ROW - 4, PAGE_WIDTH - MARGIN, y + ROW - 4);

    if (pageIndex === chunks.length - 1) {
      y -= 8;
      const totals: [string, string][] = [
        ['Taxable value', note.taxableValue],
        ...(gst
          ? ((interState
              ? [['IGST', note.igstAmount]]
              : [
                  ['CGST', note.cgstAmount],
                  ['SGST', note.sgstAmount],
                ]) as [string, string][])
          : []),
      ];
      for (const [label, value] of totals) {
        page.text(380, y, label, 9);
        page.right(PAGE_WIDTH - MARGIN, y, value, 9);
        y -= 12;
      }
      page.line(380, y + 8, PAGE_WIDTH - MARGIN, y + 8);
      page.text(380, y - 4, 'CREDIT (Rs)', 10, true);
      page.right(PAGE_WIDTH - MARGIN, y - 4, note.amount, 10, true);
      page.text(MARGIN, y - 4, fit(amountInWords(note.amount), 330, 9), 9, true);
      page.text(MARGIN, 52, 'This is a computer-generated credit note.', 8);
    }
    page.right(PAGE_WIDTH - MARGIN, 52, `Page ${pageIndex + 1} of ${chunks.length}`, 8);
  });
  return assemblePdf(pages);
}
