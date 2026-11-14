import type { DocumentCompany } from '@erp/contracts';
import { PAGE_HEIGHT, PAGE_WIDTH, Page, fit, serifWidth, textWidth } from './pdf-kit.js';
import type { Rgb } from './pdf-kit.js';

/** The edges of the printed frame: every invoice, credit note and receipt is drawn inside a ruled border. */
export const FRAME = { left: 24, right: PAGE_WIDTH - 24, bottom: 24, top: PAGE_HEIGHT - 24 };
/** The inner edge of the content, one step inside the frame. */
export const INNER = { left: 30, right: PAGE_WIDTH - 30 };

const RED: Rgb = [0.8, 0.12, 0.12];
const WATERMARK_BLUE: Rgb = [0.9, 0.93, 0.97];
const WATERMARK_GREEN: Rgb = [0.88, 0.95, 0.88];
const WATERMARK_GREY: Rgb = [0.9, 0.92, 0.94];

/** The ruled border around the page. */
export function drawFrame(page: Page): void {
  page.frame(FRAME.left, FRAME.bottom, FRAME.right - FRAME.left, FRAME.top - FRAME.bottom, 1);
}

/** The company name, faint and large, behind everything else on the page. Drawn first so the text stays readable. */
export function drawWatermark(page: Page, company: DocumentCompany): void {
  const words = company.name.toUpperCase().split(/\s+/).filter(Boolean);
  const first = words[0] ?? '';
  const rest = words.slice(1).join(' ');
  const size = Math.min(130, Math.floor(480 / Math.max(first.length, 1) / 0.74));
  page.styled(
    (PAGE_WIDTH - serifWidth(first, size) * 1.02) / 2,
    455,
    first,
    size,
    'F2',
    WATERMARK_BLUE,
  );
  if (rest) {
    const restSize = 46;
    page.styled(
      (PAGE_WIDTH - rest.length * restSize * 0.78) / 2,
      392,
      rest.split('').join(' '),
      restSize,
      'F2',
      WATERMARK_GREEN,
    );
  }
  if (company.tagline) {
    const tagSize = 30;
    page.styled(
      (PAGE_WIDTH - textWidth(company.tagline, tagSize)) / 2,
      340,
      company.tagline,
      tagSize,
      'F1',
      WATERMARK_GREY,
    );
  }
}

/**
 * The top of the page: what the document is (in red), the mobile number, the company name in large letters, the
 * proprietor, the GSTIN in a rounded box and the address. Returns the y where the header ends.
 */
export function drawLetterhead(
  page: Page,
  company: DocumentCompany,
  label: string,
  showGstin: boolean,
  gstin: string | null,
): number {
  const top = FRAME.top - 6;
  const bottom = 690;
  page.frame(INNER.left, bottom, INNER.right - INNER.left, top - bottom, 0.8);
  page.styled(250 - serifWidth(label, 11) * 0.4, top - 18, label, 11, 'F2', RED);
  if (company.phone) page.styled(366, top - 18, `Mob-${company.phone}`, 10, 'F2');
  const name = company.name.toUpperCase();
  const nameSize = Math.min(38, Math.floor(500 / Math.max(name.length, 1) / 0.7));
  page.styled((PAGE_WIDTH - serifWidth(name, nameSize)) / 2, top - 60, name, nameSize, 'F3');
  let y = top - 78;
  if (company.proprietor) {
    const line = `Prop-${company.proprietor}`;
    page.styled((PAGE_WIDTH - textWidth(line, 11) * 1.08) / 2, y, line, 11, 'F2');
    y -= 20;
  }
  const number = showGstin ? (gstin ?? company.gstin) : null;
  if (number) {
    const text = `GST IN: ${number}`;
    const width = textWidth(text, 11) * 1.1 + 36;
    page.roundBox((PAGE_WIDTH - width) / 2, y - 4, width, 18, 6);
    page.styled((PAGE_WIDTH - textWidth(text, 11) * 1.1) / 2, y + 1, text, 11, 'F2');
    y -= 20;
  }
  if (company.address) {
    const line = fit(company.address, INNER.right - INNER.left - 20, 10);
    page.styled((PAGE_WIDTH - textWidth(line, 10)) / 2, y - 2, line, 10, 'F1');
  }
  return bottom;
}

/** The size for a line in the date and number box, so a long document number still fits inside it. */
export function boxLineSize(text: string): number {
  return text.length > 34 ? 8 : text.length > 26 ? 9 : 10;
}

/** A line of text with a rule under it, as on a printed form. */
export function ruledLine(
  page: Page,
  x: number,
  y: number,
  width: number,
  text: string,
  size = 10,
): void {
  page.text(x, y, fit(text, width, size), size, true);
  page.line(x, y - 4, x + width, y - 4, 0.5);
}
