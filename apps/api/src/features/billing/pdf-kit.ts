export interface PdfParty {
  name: string;
  address: string | null;
  phone: string | null;
  gstin: string | null;
}

const ONES = [
  'Zero',
  'One',
  'Two',
  'Three',
  'Four',
  'Five',
  'Six',
  'Seven',
  'Eight',
  'Nine',
  'Ten',
  'Eleven',
  'Twelve',
  'Thirteen',
  'Fourteen',
  'Fifteen',
  'Sixteen',
  'Seventeen',
  'Eighteen',
  'Nineteen',
];
const TENS = ['', '', 'Twenty', 'Thirty', 'Forty', 'Fifty', 'Sixty', 'Seventy', 'Eighty', 'Ninety'];

function below1000(n: number): string {
  const parts: string[] = [];
  if (n >= 100) {
    parts.push(`${ONES[Math.floor(n / 100)]} Hundred`);
    n %= 100;
  }
  if (n >= 20) {
    parts.push(`${TENS[Math.floor(n / 10)]}${n % 10 ? ` ${ONES[n % 10]}` : ''}`);
  } else if (n > 0) {
    parts.push(ONES[n] ?? '');
  }
  return parts.join(' ');
}

/** An amount in words the Indian way (thousand, lakh, crore), for example "Rupees One Lakh Five Thousand Only". */
export function amountInWords(amount: string): string {
  const [rupeesText = '0', paiseText = '00'] = amount.split('.');
  let rupees = Number(rupeesText);
  const paise = Number(paiseText.padEnd(2, '0').slice(0, 2));
  const parts: string[] = [];
  const units: [number, string][] = [
    [10_000_000, 'Crore'],
    [100_000, 'Lakh'],
    [1_000, 'Thousand'],
  ];
  for (const [size, name] of units) {
    if (rupees >= size) {
      parts.push(`${below1000(Math.floor(rupees / size))} ${name}`);
      rupees %= size;
    }
  }
  if (rupees > 0 || parts.length === 0) parts.push(below1000(rupees) || 'Zero');
  const words = `Rupees ${parts.join(' ')}`;
  return paise > 0 ? `${words} and ${below1000(paise)} Paise Only` : `${words} Only`;
}

export const PAGE_WIDTH = 595;
export const PAGE_HEIGHT = 842;
export const MARGIN = 36;
export const ROW = 14;
export const FIRST_PAGE_ROWS = 24;
export const OTHER_PAGE_ROWS = 44;

const WIDTH_OF: Record<string, number> = {
  '.': 0.278,
  ',': 0.278,
  '-': 0.333,
  ' ': 0.278,
  '%': 0.889,
};
export function textWidth(text: string, size: number): number {
  let width = 0;
  for (const char of text) width += /[0-9]/.test(char) ? 0.556 : (WIDTH_OF[char] ?? 0.55);
  return width * size;
}

/** Keeps text in the standard Western character set the PDF font supports, and escapes what PDF treats specially. */
function clean(text: string): string {
  return text
    .replace(/[^\x20-\x7e]/g, '?')
    .replace(/\\/g, '\\\\')
    .replace(/\(/g, '\\(')
    .replace(/\)/g, '\\)');
}

export function fit(text: string, maxWidth: number, size: number): string {
  if (textWidth(text, size) <= maxWidth) return text;
  let cut = text;
  while (cut.length > 1 && textWidth(`${cut}...`, size) > maxWidth) cut = cut.slice(0, -1);
  return `${cut}...`;
}

/** An amount with Indian digit grouping (1,50,476.19). A leading + or - is kept. */
export function inr(amount: string): string {
  const match = /^([+-]?)(\d+)(?:\.(\d+))?$/.exec(amount.trim());
  if (!match) return amount;
  const [, sign = '', whole = '', fraction] = match;
  const tail = whole.slice(-3);
  const head = whole.slice(0, -3).replace(/\B(?=(\d{2})+(?!\d))/g, ',');
  return `${sign}${head ? `${head},${tail}` : tail}${fraction === undefined ? '' : `.${fraction}`}`;
}

/** The amount in words as printed on an Indian invoice: ONE LAKH FIFTY EIGHT THOUSAND ONLY. */
export function wordsUpper(amount: string): string {
  return amountInWords(amount)
    .replace(/^Rupees /, '')
    .toUpperCase();
}

/** Splits text into lines no wider than `maxWidth` at the given size. */
export function wrap(text: string, maxWidth: number, size: number, bold = false): string[] {
  const lines: string[] = [];
  let current = '';
  for (const word of text.split(/\s+/).filter(Boolean)) {
    const next = current ? `${current} ${word}` : word;
    if (current && textWidth(next, size) * (bold ? 1.08 : 1) > maxWidth) {
      lines.push(current);
      current = word;
    } else current = next;
  }
  if (current) lines.push(current);
  return lines;
}

export type Rgb = readonly [number, number, number];
export type PdfFont = 'F1' | 'F2' | 'F3';

/** A rough width for capital letters in Times Bold, enough to centre a heading. */
export function serifWidth(text: string, size: number): number {
  return text.length * size * 0.7;
}

export class Page {
  private readonly commands: string[] = [];
  /** Text in a chosen font (F1 Helvetica, F2 Helvetica Bold, F3 Times Bold) and colour. */
  styled(x: number, y: number, value: string, size: number, font: PdfFont, rgb?: Rgb): void {
    const colour = rgb ? `${rgb[0]} ${rgb[1]} ${rgb[2]} rg ` : '';
    this.commands.push(
      `${colour}BT /${font} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${clean(value)}) Tj ET${rgb ? ' 0 g' : ''}`,
    );
  }
  /** A box with rounded corners. */
  roundBox(x: number, y: number, w: number, h: number, r: number, width = 0.8): void {
    const k = r * 0.5523;
    this.commands.push(
      `${width} w ${x + r} ${y} m ${x + w - r} ${y} l ${x + w - r + k} ${y} ${x + w} ${y + r - k} ${x + w} ${y + r} c ` +
        `${x + w} ${y + h - r} l ${x + w} ${y + h - r + k} ${x + w - r + k} ${y + h} ${x + w - r} ${y + h} c ` +
        `${x + r} ${y + h} l ${x + r - k} ${y + h} ${x} ${y + h - r + k} ${x} ${y + h - r} c ` +
        `${x} ${y + r} l ${x} ${y + r - k} ${x + r - k} ${y} ${x + r} ${y} c S`,
    );
  }
  /** A box with a line of a chosen width. */
  frame(x: number, y: number, w: number, h: number, width = 0.5): void {
    this.commands.push(`${width} w ${x} ${y} ${w} ${h} re S`);
  }
  text(x: number, y: number, value: string, size = 9, bold = false): void {
    this.commands.push(
      `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${clean(value)}) Tj ET`,
    );
  }
  right(rightX: number, y: number, value: string, size = 9, bold = false): void {
    this.text(rightX - textWidth(value, size) * (bold ? 1.1 : 1), y, value, size, bold);
  }
  centre(y: number, value: string, size: number, bold = false): void {
    this.text((PAGE_WIDTH - textWidth(value, size)) / 2, y, value, size, bold);
  }
  line(x1: number, y1: number, x2: number, y2: number, width = 0.5): void {
    this.commands.push(`${width} w ${x1} ${y1} m ${x2} ${y2} l S`);
  }
  box(x: number, y: number, w: number, h: number): void {
    this.commands.push(`0.5 w ${x} ${y} ${w} ${h} re S`);
  }
  content(): string {
    return this.commands.join('\n');
  }
}

export function party(page: Page, x: number, y: number, title: string, who: PdfParty): void {
  page.text(x, y, title, 8, true);
  page.text(x, y - 12, fit(who.name, 230, 10), 10, true);
  let at = y - 25;
  for (const line of [
    who.address,
    who.phone ? `Phone: ${who.phone}` : null,
    who.gstin ? `GSTIN: ${who.gstin}` : null,
  ]) {
    if (!line) continue;
    page.text(x, at, fit(line, 230, 9), 9);
    at -= 11;
  }
}

/** Puts finished pages into a PDF file, using only the standard Helvetica fonts. */
export function assemblePdf(pages: Page[]): Buffer {
  // ---- assemble the file ----
  const objects: string[] = [];
  objects.push('<< /Type /Catalog /Pages 2 0 R >>');
  const kids = pages.map((_, index) => `${6 + index * 2} 0 R`).join(' ');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects.push(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  );
  objects.push(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Times-Bold /Encoding /WinAnsiEncoding >>',
  );
  pages.forEach((page, index) => {
    const content = page.content();
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R /F3 5 0 R >> >> /Contents ${7 + index * 2} 0 R >>`,
    );
    objects.push(
      `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
    );
  });

  let file = '%PDF-1.4\n';
  const offsets: number[] = [];
  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(file, 'latin1'));
    file += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });
  const xref = Buffer.byteLength(file, 'latin1');
  file += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets) file += `${String(offset).padStart(10, '0')} 00000 n \n`;
  file += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(file, 'latin1');
}
