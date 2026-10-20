const INTERNAL_PREFIX = '20';
const MAX_SEQUENCE = 9_999_999_999n;
const EAN13_LENGTH = 13;

export function ean13CheckDigit(firstTwelve: string): number {
  if (!/^\d{12}$/.test(firstTwelve)) throw new Error('An EAN-13 body has exactly 12 digits');
  const sum = [...firstTwelve].reduce(
    (total, digit, index) => total + Number(digit) * (index % 2 === 0 ? 1 : 3),
    0,
  );
  return (10 - (sum % 10)) % 10;
}

export function isValidEan13(value: string): boolean {
  return (
    value.length === EAN13_LENGTH &&
    /^\d{13}$/.test(value) &&
    ean13CheckDigit(value.slice(0, 12)) === Number(value.charAt(12))
  );
}

/** Builds the internal barcode for a sequence number: prefix 20 (reserved for in-store use), 10 digits, check digit. */
export function buildInternalEan13(sequence: bigint): string {
  if (sequence < 1n || sequence > MAX_SEQUENCE)
    throw new RangeError('Barcode sequence is out of range');
  const body = `${INTERNAL_PREFIX}${sequence.toString().padStart(10, '0')}`;
  return `${body}${ean13CheckDigit(body)}`;
}
