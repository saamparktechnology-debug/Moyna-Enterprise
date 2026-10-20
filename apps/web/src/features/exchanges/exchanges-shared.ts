import type { ExchangeDispositionName, ExchangeKindName, ExchangeStatusName } from '@erp/contracts';
import { settlementOf } from '@erp/contracts';

export const STATUS_TEXT: Record<ExchangeStatusName, string> = {
  PENDING: 'Waiting for approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Withdrawn',
};

export const KIND_TEXT: Record<ExchangeKindName, string> = {
  OLD_FOR_NEW: 'Old for new',
  NEW_FOR_NEW: 'New for new',
};

export const DISPOSITION_TEXT: Record<ExchangeDispositionName, string> = {
  STOCK: 'Back into stock as returned goods',
  SCRAP: 'Scrapped',
};

/** What the difference means for the customer, in words. */
export function settlementText(difference: string): string {
  const kind = settlementOf(difference);
  if (kind === 'PAYABLE') return `The customer pays ${difference}`;
  if (kind === 'REFUNDABLE')
    return `${difference.replace('-', '')} is held as credit for the customer`;
  return 'Nothing to pay either way';
}

/** The price of the new vehicle less the valuation, to the paisa, without floating-point error. */
export function differenceOf(newAmount: string, valuation: string): string {
  const paise = (value: string): number => {
    const [rupees = '0', fraction = ''] = value.trim().split('.');
    return Number(rupees) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2));
  };
  const diff = paise(newAmount) - paise(valuation);
  const sign = diff < 0 ? '-' : '';
  const abs = Math.abs(diff);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
