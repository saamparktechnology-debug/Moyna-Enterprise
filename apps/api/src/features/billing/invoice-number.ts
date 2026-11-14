/**
 * The time part of an invoice number: day, month, year, hour and minute in India time, as in ME-111120261123 for 11 November
 * 2026 at 11:23. India is five and a half hours ahead of UTC and has no daylight saving.
 */
export function invoiceStamp(when: Date): string {
  const ist = new Date(when.getTime() + 330 * 60_000);
  const two = (value: number): string => String(value).padStart(2, '0');
  return `${two(ist.getUTCDate())}${two(ist.getUTCMonth() + 1)}${ist.getUTCFullYear()}${two(ist.getUTCHours())}${two(ist.getUTCMinutes())}`;
}

/** The number for an invoice issued at `when`: the prefix, a dash and the stamp. */
export function invoiceNumberAt(prefix: string, when: Date): string {
  return `${prefix}-${invoiceStamp(when)}`;
}
