import { todayInIndia } from '@erp/contracts';
import {
  MARGIN,
  PAGE_HEIGHT,
  PAGE_WIDTH,
  Page,
  amountInWords,
  assemblePdf,
  fit,
  party,
} from '../billing/pdf-kit.js';

/** What a receipt shows. An advance on a quotation also shows the order it is for. */
export interface ReceiptPdfData {
  receiptNo: string;
  paidOn: string;
  branchName: string;
  customerName: string;
  customerPhone: string | null;
  modeName: string;
  reference: string | null;
  amount: string;
  /** Set when the money is an advance for a quotation. */
  advance: {
    quotationNo: string;
    quotationTotal: string;
    /** All advances still held for the quotation, this one included unless it was reversed. */
    heldTotal: string;
    balanceDue: string;
  } | null;
  reversed: { on: string; reason: string } | null;
}

/**
 * Builds an A4 receipt as a PDF: the paper a customer is given when they pay. It is a receipt, not a tax invoice. A tax
 * invoice is issued when the goods are delivered, and an advance is adjusted against it.
 */
export function buildReceiptPdf(data: ReceiptPdfData): Buffer {
  const page = new Page();
  const title = data.advance ? 'ADVANCE RECEIPT' : 'PAYMENT RECEIPT';
  let y = PAGE_HEIGHT - MARGIN - 6;
  page.centre(y, title, 15, true);
  if (data.reversed) {
    page.centre(
      y - 14,
      `REVERSED on ${data.reversed.on} - this receipt is no longer valid`,
      10,
      true,
    );
  }
  y -= 38;
  party(page, MARGIN, y, 'RECEIVED BY', {
    name: data.branchName,
    address: null,
    phone: null,
    gstin: null,
  });
  party(page, 320, y, 'RECEIVED FROM', {
    name: data.customerName,
    address: null,
    phone: data.customerPhone,
    gstin: null,
  });
  page.text(320, y - 50, `Receipt no: ${data.receiptNo}`, 9, true);
  page.text(320, y - 62, `Date: ${data.paidOn}`, 9);
  y -= 90;

  page.box(MARGIN, y - 54, PAGE_WIDTH - 2 * MARGIN, 66);
  page.text(MARGIN + 10, y, 'Amount received (Rs)', 9);
  page.text(MARGIN + 10, y - 20, data.amount, 16, true);
  page.text(MARGIN + 10, y - 38, fit(amountInWords(data.amount), 360, 9), 9, true);
  page.text(320, y, `Paid by: ${data.modeName}`, 9);
  if (data.reference) page.text(320, y - 14, fit(`Reference: ${data.reference}`, 230, 9), 9);
  y -= 84;

  if (data.advance) {
    page.text(MARGIN, y, `Towards the order on quotation ${data.advance.quotationNo}`, 10, true);
    y -= 18;
    const rows: [string, string][] = [
      ['Quoted total', data.advance.quotationTotal],
      ['Advance held so far', data.advance.heldTotal],
      ['Balance still to pay', data.advance.balanceDue],
    ];
    for (const [label, value] of rows) {
      page.text(MARGIN + 10, y, label, 9);
      page.right(300, y, value, 9, true);
      y -= 13;
    }
    y -= 8;
    page.text(
      MARGIN,
      y,
      fit(
        'This advance holds the quoted price. It is adjusted against the tax invoice issued when the goods are delivered.',
        PAGE_WIDTH - 2 * MARGIN,
        9,
      ),
      9,
    );
    y -= 14;
  }
  if (data.reversed)
    page.text(MARGIN, y, fit(`Reversed: ${data.reversed.reason}`, PAGE_WIDTH - 2 * MARGIN, 9), 9);

  page.text(
    MARGIN,
    70,
    'This is a computer-generated receipt for money received. It is not a tax invoice.',
    8,
  );
  page.text(MARGIN, 58, `Printed on ${todayInIndia()}`, 8);
  page.line(PAGE_WIDTH - 200, 90, PAGE_WIDTH - MARGIN, 90);
  page.text(PAGE_WIDTH - 200, 78, 'Authorised signatory', 8);
  return assemblePdf([page]);
}
