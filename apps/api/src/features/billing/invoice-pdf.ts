import type { Invoice } from '@erp/contracts';
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

export { amountInWords };
export type { PdfParty };

const COLUMNS = {
  no: 40,
  item: 58,
  hsn: 236,
  qty: 304,
  rate: 358,
  discount: 408,
  taxable: 466,
  tax: 506,
  amount: PAGE_WIDTH - MARGIN,
};

function tableHeader(page: Page, y: number, gst: boolean): void {
  page.box(MARGIN, y - 4, PAGE_WIDTH - 2 * MARGIN, ROW + 2);
  page.text(COLUMNS.no, y, '#', 8, true);
  page.text(COLUMNS.item, y, 'Item', 8, true);
  page.text(COLUMNS.hsn, y, gst ? 'HSN' : '', 8, true);
  page.right(COLUMNS.qty + 22, y, 'Qty', 8, true);
  page.right(COLUMNS.rate + 40, y, 'Rate', 8, true);
  page.right(COLUMNS.discount + 40, y, 'Discount', 8, true);
  page.right(COLUMNS.taxable + 34, y, 'Taxable', 8, true);
  page.right(COLUMNS.tax + 20, y, gst ? 'GST' : '', 8, true);
  page.right(COLUMNS.amount, y, 'Amount', 8, true);
}

/** Builds a one-or-more page A4 invoice as a PDF, using only the standard Helvetica fonts. */
export function buildInvoicePdf(invoice: Invoice, branchName: string): Buffer {
  const seller: PdfParty = {
    name: branchName,
    address: null,
    phone: null,
    gstin: invoice.branchGstin,
  };
  const buyer: PdfParty = {
    name: invoice.customerName,
    address: null,
    phone: null,
    gstin: invoice.customerGstin,
  };
  const gst = invoice.type === 'GST';
  const pages: Page[] = [];
  const rowsOf = (line: Invoice['lines'][number]): number => (line.serialNo ? 2 : 1);
  const chunks: Invoice['lines'][] = [[]];
  let used = 0;
  for (const line of invoice.lines) {
    const capacity = chunks.length === 1 ? FIRST_PAGE_ROWS : OTHER_PAGE_ROWS;
    if (used + rowsOf(line) > capacity) {
      chunks.push([]);
      used = 0;
    }
    chunks[chunks.length - 1]?.push(line);
    used += rowsOf(line);
  }
  // The totals block needs about 12 rows of room. If the last page is too full, the totals get a page of their own.
  const lastCapacity = chunks.length === 1 ? FIRST_PAGE_ROWS : OTHER_PAGE_ROWS;
  if (used > lastCapacity - 12) chunks.push([]);

  chunks.forEach((rows, pageIndex) => {
    const page = new Page();
    pages.push(page);
    let y = PAGE_HEIGHT - MARGIN - 6;
    if (pageIndex === 0) {
      page.centre(y, gst ? 'TAX INVOICE' : 'INVOICE', 15, true);
      if (invoice.status !== 'ISSUED')
        page.centre(
          y - 14,
          invoice.status === 'DRAFT'
            ? 'DRAFT - this is not a valid invoice'
            : `CANCELLED - ${invoice.cancelReason ?? 'no reason given'}`,
          10,
          true,
        );
      y -= 38;
      party(page, MARGIN, y, 'SOLD BY', seller);
      party(page, 320, y, 'BILLED TO', buyer);
      page.text(320, y - 62, `Invoice no: ${invoice.invoiceNo ?? 'not yet numbered'}`, 9, true);
      page.text(
        320,
        y - 74,
        `Date: ${invoice.issuedOn ?? '-'}    Due: ${invoice.dueDate ?? '-'}`,
        9,
      );
      if (gst && invoice.placeOfSupply)
        page.text(320, y - 86, `Place of supply: ${invoice.placeOfSupply}`, 9);
      y -= 104;
    } else {
      page.text(MARGIN, y, `${invoice.invoiceNo ?? 'Draft invoice'} (continued)`, 9, true);
      y -= 24;
    }
    tableHeader(page, y, gst);
    y -= ROW + 6;
    const firstNumber = chunks.slice(0, pageIndex).reduce((sum, chunk) => sum + chunk.length, 0);
    rows.forEach((line, index) => {
      const name = `${line.itemCode} ${line.itemName}`;
      page.text(COLUMNS.no, y, String(firstNumber + index + 1), 8);
      page.text(COLUMNS.item, y, fit(name, COLUMNS.hsn - COLUMNS.item - 6, 8), 8);
      if (gst) page.text(COLUMNS.hsn, y, line.hsnCode ?? '', 8);
      page.right(COLUMNS.qty + 22, y, String(line.qty), 8);
      page.right(COLUMNS.rate + 40, y, line.unitPrice, 8);
      page.right(COLUMNS.discount + 40, y, line.discountAmount, 8);
      page.right(COLUMNS.taxable + 34, y, line.taxableAmount, 8);
      if (gst) page.right(COLUMNS.tax + 20, y, line.taxRate ? `${line.taxRate}%` : '-', 8);
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
        ['Subtotal', invoice.subtotal],
        ['Discount', `-${invoice.discountTotal}`],
        ['Taxable value', invoice.taxableValue],
        ...(gst
          ? ([
              invoice.interState ? ['IGST', invoice.igstAmount] : ['CGST', invoice.cgstAmount],
              ...(invoice.interState ? [] : [['SGST', invoice.sgstAmount]]),
            ] as [string, string][])
          : []),
        ['Round off', invoice.roundOff],
      ];
      for (const [label, value] of totals) {
        page.text(380, y, label, 9);
        page.right(PAGE_WIDTH - MARGIN, y, value, 9);
        y -= 12;
      }
      page.line(380, y + 8, PAGE_WIDTH - MARGIN, y + 8);
      page.text(380, y - 4, 'TOTAL (Rs)', 10, true);
      page.right(PAGE_WIDTH - MARGIN, y - 4, invoice.total, 10, true);
      page.text(MARGIN, y - 4, fit(amountInWords(invoice.total), 330, 9), 9, true);
      page.text(MARGIN, 52, 'This is a computer-generated invoice.', 8);
    }
    page.right(PAGE_WIDTH - MARGIN, 52, `Page ${pageIndex + 1} of ${chunks.length}`, 8);
  });

  return assemblePdf(pages);
}
