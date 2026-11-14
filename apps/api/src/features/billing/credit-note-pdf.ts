import type { CreditNote, DocumentCompany } from '@erp/contracts';
import { todayInIndia } from '@erp/contracts';
import {
  FRAME,
  INNER,
  boxLineSize,
  drawFrame,
  drawLetterhead,
  drawWatermark,
  ruledLine,
} from './letterhead.js';
import {
  FIRST_PAGE_ROWS,
  MARGIN,
  OTHER_PAGE_ROWS,
  PAGE_WIDTH,
  Page,
  ROW,
  amountInWords,
  assemblePdf,
  fit,
  inr,
} from './pdf-kit.js';

/** What a credit note needs besides itself: who it is from, who it is for, and the invoice it follows. */
export interface CreditNotePdfContext {
  branchName: string;
  branchGstin: string | null;
  customerGstin: string | null;
  /** The invoice's type: a GST credit note shows the tax split, a non-GST one does not. */
  gst: boolean;
  invoiceDate: string | null;
  /** The heading printed at the top of the page. Without it the branch's name is used. */
  company?: DocumentCompany;
  customerPhone?: string | null;
  customerAddress?: string | null;
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
  const company: DocumentCompany = context.company ?? {
    name: context.branchName,
    proprietor: null,
    address: null,
    phone: null,
    gstin: null,
    tagline: null,
    terms: null,
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
    drawWatermark(page, company);
    drawFrame(page);
    let y = FRAME.top - 22;
    if (pageIndex === 0) {
      // A credit note without GST carries no GSTIN, as the invoice it follows did not.
      drawLetterhead(page, company, 'CREDIT NOTE', gst, gst ? context.branchGstin : null);
      const banner = BANNER[note.status];
      if (banner) page.styled(INNER.left + 8, 677, banner, 10, 'F2', [0.8, 0.12, 0.12]);
      ruledLine(page, INNER.left + 4, 662, 242, `Credited to - ${note.customerName}`);
      ruledLine(page, INNER.left + 254, 662, 120, `Mob:- ${context.customerPhone ?? ''}`);
      ruledLine(page, INNER.left + 4, 644, 370, `Address- ${context.customerAddress ?? ''}`);
      if (gst && context.customerGstin)
        page.text(INNER.left + 4, 626, `GSTIN- ${context.customerGstin}`, 9, true);
      page.frame(412, 616, INNER.right - 412, 70, 0.8);
      page.text(418, 672, `Date:- ${issuedOn ?? '-'}`, 10, true);
      const noLine = `Credit Note No:- ${note.creditNoteNo ?? 'not yet numbered'}`;
      page.text(418, 655, noLine, boxLineSize(noLine), true);
      const against = `Against invoice:- ${note.invoiceNo ?? '-'}`;
      page.text(418, 638, against, boxLineSize(against), true);
      if (context.invoiceDate)
        page.text(418, 622, `Invoice date:- ${context.invoiceDate}`, 9, true);
      page.text(
        INNER.left + 4,
        604,
        fit(`Reason: ${note.reason}`, INNER.right - INNER.left - 8, 9),
        9,
        true,
      );
      y = 586;
    } else {
      page.text(
        INNER.left + 4,
        y,
        `${company.name} - ${note.creditNoteNo ?? 'Credit note'} (continued)`,
        10,
        true,
      );
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
      page.right(COLUMNS.taxable + 50, y, inr(line.taxableAmount), 8);
      if (gst) page.right(COLUMNS.tax + 44, y, inr(taxOf(line)), 8);
      page.right(COLUMNS.amount, y, inr(line.amount), 8);
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
        page.right(PAGE_WIDTH - MARGIN, y, inr(value), 9);
        y -= 12;
      }
      page.line(380, y + 8, PAGE_WIDTH - MARGIN, y + 8);
      page.text(380, y - 4, 'CREDIT (Rs)', 10, true);
      page.right(PAGE_WIDTH - MARGIN, y - 4, inr(note.amount), 10, true);
      page.text(MARGIN, y - 4, fit(amountInWords(note.amount), 330, 9), 9, true);
      page.text(INNER.left + 4, 52, 'This is a computer-generated credit note.', 8);
      page.right(INNER.right - 10, 56, fit(`For ${company.name.toUpperCase()}`, 220, 11), 11, true);
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
