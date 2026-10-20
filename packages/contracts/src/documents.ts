export const DOCUMENT_TYPES = [
  'PURCHASE_ORDER',
  'GOODS_RECEIPT',
  'TRANSFER',
  'QUOTATION',
  'INVOICE_GST',
  'INVOICE_NON_GST',
  'CREDIT_NOTE',
  'PAYMENT_RECEIPT',
  'PURCHASE_RETURN',
  'EXCHANGE',
  'REFUND',
] as const;
export type DocumentTypeName = (typeof DOCUMENT_TYPES)[number];

export const DOCUMENT_PREFIXES: Readonly<Record<DocumentTypeName, string>> = {
  PURCHASE_ORDER: 'PO',
  GOODS_RECEIPT: 'GRN',
  TRANSFER: 'TRF',
  QUOTATION: 'QT',
  INVOICE_GST: 'G',
  INVOICE_NON_GST: 'N',
  CREDIT_NOTE: 'C',
  PAYMENT_RECEIPT: 'RCT',
  PURCHASE_RETURN: 'PRT',
  EXCHANGE: 'EXC',
  REFUND: 'RFD',
};

export const GST_LENGTH_LIMITED: readonly DocumentTypeName[] = ['INVOICE_GST', 'CREDIT_NOTE'];
export const GST_DOCUMENT_NUMBER_MAX_LENGTH = 16;

const IST_OFFSET_MINUTES = 330;
const APRIL = 3;

export interface FinancialYear {
  label: string;
  short: string;
}

export function financialYearOf(date: Date): FinancialYear {
  const ist = new Date(date.getTime() + IST_OFFSET_MINUTES * 60_000);
  const year = ist.getUTCMonth() >= APRIL ? ist.getUTCFullYear() : ist.getUTCFullYear() - 1;
  const endYear = String((year + 1) % 100).padStart(2, '0');
  return { label: `${year}-${endYear}`, short: `${String(year % 100).padStart(2, '0')}${endYear}` };
}
