import type { DocumentCompany } from '@erp/contracts';
import { todayInIndia } from '@erp/contracts';
import {
  FRAME,
  INNER,
  boxLineSize,
  drawFrame,
  drawLetterhead,
  drawWatermark,
  ruledLine,
} from '../billing/letterhead.js';
import { PAGE_WIDTH, Page, assemblePdf, fit, inr, wordsUpper, wrap } from '../billing/pdf-kit.js';

/** What a receipt shows. An advance on a quotation also shows the order it is for. */
export interface ReceiptPdfData {
  company: DocumentCompany;
  receiptNo: string;
  paidOn: string;
  customerName: string;
  customerPhone: string | null;
  customerAddress: string | null;
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
 * Builds an A4 receipt as a PDF, in the same frame and letterhead as the invoice: the paper a customer is given when they
 * pay. It is a receipt, not a tax invoice. A tax invoice is issued when the goods are delivered, and an advance is
 * adjusted against it.
 */
export function buildReceiptPdf(data: ReceiptPdfData): Buffer {
  const page = new Page();
  const company = data.company;
  const label = data.advance ? 'ADVANCE RECEIPT' : 'PAYMENT RECEIPT';
  drawWatermark(page, company);
  drawFrame(page);
  drawLetterhead(page, company, label, false, null);
  if (data.reversed)
    page.styled(
      INNER.left + 8,
      677,
      `REVERSED on ${data.reversed.on} - this receipt is no longer valid`,
      10,
      'F2',
      [0.8, 0.12, 0.12],
    );
  ruledLine(page, INNER.left + 4, 662, 242, `Received from - ${data.customerName}`);
  ruledLine(page, INNER.left + 254, 662, 120, `Mob:- ${data.customerPhone ?? ''}`);
  ruledLine(page, INNER.left + 4, 644, 370, `Address- ${data.customerAddress ?? ''}`);
  page.frame(412, 616, INNER.right - 412, 70, 0.8);
  page.text(418, 672, `Date:- ${data.paidOn}`, 10, true);
  const numberLine = `Receipt No:- ${data.receiptNo}`;
  page.text(418, 655, numberLine, boxLineSize(numberLine), true);
  page.text(418, 638, fit(`Paid by:- ${data.modeName}`, 140, 10), 10, true);
  if (data.reference) page.text(418, 622, fit(`Ref:- ${data.reference}`, 140, 9), 9, true);

  let y = 580;
  page.frame(INNER.left, y - 70, INNER.right - INNER.left, 80, 0.8);
  page.text(INNER.left + 10, y - 4, 'Amount received (Rs)', 10, true);
  page.text(INNER.left + 10, y - 30, inr(data.amount), 20, true);
  wrap(`Total Value (in Word)- ${wordsUpper(data.amount)}`, 500, 10, true)
    .slice(0, 2)
    .forEach((line, index) => page.text(INNER.left + 10, y - 52 - index * 13, line, 10, true));
  y -= 100;

  if (data.advance) {
    page.text(
      INNER.left + 4,
      y,
      `Towards the order on quotation ${data.advance.quotationNo}`,
      11,
      true,
    );
    y -= 24;
    const rows: [string, string][] = [
      ['Quoted total', data.advance.quotationTotal],
      ['Advance held so far', data.advance.heldTotal],
      ['Balance still to pay', data.advance.balanceDue],
    ];
    for (const [rowLabel, value] of rows) {
      page.frame(INNER.left, y - 8, 300, 22, 0.8);
      page.text(INNER.left + 8, y, rowLabel, 10, true);
      page.right(INNER.left + 292, y, inr(value), 10, true);
      y -= 22;
    }
    y -= 12;
    wrap(
      'This advance holds the quoted price. It is adjusted against the tax invoice issued when the goods are delivered.',
      INNER.right - INNER.left - 8,
      10,
    ).forEach((line) => {
      page.text(INNER.left + 4, y, line, 10);
      y -= 13;
    });
  }
  if (data.reversed)
    page.text(
      INNER.left + 4,
      y - 8,
      fit(`Reversed: ${data.reversed.reason}`, INNER.right - INNER.left - 8, 10),
      10,
      true,
    );

  page.text(
    INNER.left + 4,
    92,
    'This is a computer-generated receipt for money received. It is not a tax invoice.',
    8,
  );
  page.text(INNER.left + 4, 80, `Printed on ${todayInIndia()}`, 8);
  page.text(INNER.left + 4, 56, 'Customer Signature', 10, true);
  page.right(INNER.right - 10, 56, fit(`For ${company.name.toUpperCase()}`, 220, 11), 11, true);
  page.text((PAGE_WIDTH - 60) / 2, FRAME.bottom + 6, 'Page 1 of 1', 7);
  return assemblePdf([page]);
}
