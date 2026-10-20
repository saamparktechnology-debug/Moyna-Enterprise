/**
 * Decimal text handling for money. Amounts are strings from the keyboard to the API (`"1250.50"`), so
 * nothing here converts to a floating-point number and rounding can never change a figure.
 */
export interface MoneyOptions {
  /** Digits after the point; two for rupees. */
  decimals?: number;
  allowNegative?: boolean;
}

/** Keeps only what can be part of an amount while it is being typed. */
export function sanitizeMoney(
  text: string,
  { decimals = 2, allowNegative = false }: MoneyOptions = {},
): string {
  let negative = false;
  let body = text.replace(/[^\d.-]/g, '');
  if (allowNegative && body.startsWith('-')) negative = true;
  body = body.replace(/-/g, '');
  const point = body.indexOf('.');
  if (point !== -1) {
    const whole = body.slice(0, point);
    const fraction = body
      .slice(point + 1)
      .replace(/\./g, '')
      .slice(0, decimals);
    body = `${whole}.${fraction}`;
  }
  return `${negative ? '-' : ''}${body}`;
}

/** The text shown once typing is finished: no leading zeros, always the full number of decimals. */
export function finishMoney(
  text: string,
  { decimals = 2, allowNegative = false }: MoneyOptions = {},
): string {
  const clean = sanitizeMoney(text, { decimals, allowNegative });
  if (clean === '' || clean === '-' || clean === '.' || clean === '-.') return '';
  const negative = clean.startsWith('-');
  const [rawWhole = '', rawFraction = ''] = clean.replace('-', '').split('.');
  const whole = rawWhole.replace(/^0+(?=\d)/, '') || '0';
  const fraction = rawFraction.padEnd(decimals, '0');
  const isZero = /^0*$/.test(whole) && /^0*$/.test(fraction);
  const body = decimals > 0 ? `${whole}.${fraction}` : whole;
  return `${negative && !isZero ? '-' : ''}${body}`;
}

const rupees = new Intl.NumberFormat('en-IN', {
  style: 'currency',
  currency: 'INR',
  minimumFractionDigits: 2,
});

/** For display only. */
export function formatMoney(amount: string | number): string {
  return rupees.format(Number(amount));
}
