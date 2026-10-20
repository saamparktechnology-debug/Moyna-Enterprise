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

export class Page {
  private readonly commands: string[] = [];
  text(x: number, y: number, value: string, size = 9, bold = false): void {
    this.commands.push(
      `BT /${bold ? 'F2' : 'F1'} ${size} Tf ${x.toFixed(2)} ${y.toFixed(2)} Td (${clean(value)}) Tj ET`,
    );
  }
  right(rightX: number, y: number, value: string, size = 9, bold = false): void {
    this.text(rightX - textWidth(value, size), y, value, size, bold);
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
  const kids = pages.map((_, index) => `${5 + index * 2} 0 R`).join(' ');
  objects.push(`<< /Type /Pages /Kids [${kids}] /Count ${pages.length} >>`);
  objects.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica /Encoding /WinAnsiEncoding >>');
  objects.push(
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold /Encoding /WinAnsiEncoding >>',
  );
  pages.forEach((page, index) => {
    const content = page.content();
    objects.push(
      `<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${PAGE_WIDTH} ${PAGE_HEIGHT}] /Resources << /Font << /F1 3 0 R /F2 4 0 R >> >> /Contents ${6 + index * 2} 0 R >>`,
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
