import type { DocumentCompany } from '@erp/contracts';
import { FRAME, INNER, drawFrame, drawLetterhead, drawWatermark } from '../billing/letterhead.js';
import { PAGE_WIDTH, Page, assemblePdf, fit, wrap } from '../billing/pdf-kit.js';

/** What the printed agreement shows. `text` already has its {{placeholders}} filled in. */
export interface AgreementPdfData {
  company: DocumentCompany;
  agreementNo: string;
  title: string;
  effectiveFrom: string;
  employeeName: string;
  employeeCode: string;
  text: string;
}

const LINE = 13;
const TEXT_WIDTH = INNER.right - INNER.left - 16;
const FIRST_TOP = 662;
const OTHER_TOP = 770;
const BOTTOM = 66;
/** The room the two signature blocks need. */
const SIGNATURE_HEIGHT = 120;

/** Splits the text into lines that fit the page: a blank line starts a new paragraph, and a new line is kept. */
function layout(text: string): { text: string; gap: boolean }[] {
  const lines: { text: string; gap: boolean }[] = [];
  const paragraphs = text.replace(/\r\n/g, '\n').split(/\n\s*\n/);
  paragraphs.forEach((paragraph, index) => {
    const rows = paragraph
      .split('\n')
      .flatMap((row) => (row.trim() === '' ? [''] : wrap(row.trim(), TEXT_WIDTH, 10)));
    rows.forEach((row, rowIndex) => lines.push({ text: row, gap: index > 0 && rowIndex === 0 }));
  });
  return lines;
}

/**
 * Builds the agreement as an A4 PDF to print and sign: the company's heading, the title and number, the terms, and at the
 * end two places to sign. The employee signs on the left and the Super Admin on the right. The signed copy is then uploaded
 * as the acceptance.
 */
export function buildAgreementPdf(data: AgreementPdfData): Buffer {
  const { company } = data;
  const rows = layout(data.text);
  const pages: Page[] = [];
  let page: Page | null = null;
  let y = 0;
  const open = (first: boolean): void => {
    page = new Page();
    pages.push(page);
    drawWatermark(page, company);
    drawFrame(page);
    if (first) {
      drawLetterhead(page, company, 'EMPLOYMENT AGREEMENT', false, null);
      const title = fit(data.title, INNER.right - INNER.left - 20, 13);
      page.styled(INNER.left + 10, 672, title, 13, 'F2');
      page.text(INNER.left + 10, 656, `Agreement no: ${data.agreementNo}`, 9, true);
      page.right(INNER.right - 10, 656, `Effective from: ${data.effectiveFrom}`, 9, true);
      y = FIRST_TOP - 22;
    } else {
      page.text(
        INNER.left + 10,
        FRAME.top - 22,
        `${company.name} - ${data.title} (${data.agreementNo}), continued`,
        9,
        true,
      );
      y = OTHER_TOP;
    }
  };
  open(true);
  for (const row of rows) {
    const need = LINE + (row.gap ? 6 : 0);
    if (y - need < BOTTOM) open(false);
    if (row.gap) y -= 6;
    if (row.text !== '') (page as Page | null)?.text(INNER.left + 8, y, row.text, 10);
    y -= LINE;
  }
  if (y - SIGNATURE_HEIGHT < BOTTOM) open(false);
  const last = page as Page | null;
  if (last) {
    y -= 40;
    const leftX = INNER.left + 14;
    const rightX = INNER.right - 214;
    last.line(leftX, y, leftX + 200, y, 0.8);
    last.line(rightX, y, rightX + 200, y, 0.8);
    last.text(leftX, y - 14, 'Signature of the Employee', 10, true);
    last.text(rightX, y - 14, 'Signature of the Super Admin', 10, true);
    last.text(leftX, y - 30, fit(`Name: ${data.employeeName} (${data.employeeCode})`, 200, 9), 9);
    last.text(rightX, y - 30, fit(`For ${company.name.toUpperCase()}`, 200, 9), 9, true);
    last.text(leftX, y - 46, 'Date:', 9);
    last.text(rightX, y - 46, 'Date:', 9);
  }
  pages.forEach((entry, index) =>
    entry.text((PAGE_WIDTH - 60) / 2, FRAME.bottom + 6, `Page ${index + 1} of ${pages.length}`, 7),
  );
  return assemblePdf(pages);
}
