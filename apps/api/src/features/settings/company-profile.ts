import type { DocumentCompany } from '@erp/contracts';
import type { TxClient } from '../../common/prisma/scoped-prisma.service.js';

/** The letters an invoice number starts with, until the owner sets their own in the settings. */
export const DEFAULT_INVOICE_PREFIX = 'ME';

/** Printed at the foot of an invoice until the owner sets their own line in the settings. */
export const DEFAULT_INVOICE_TERMS = 'Goods once sold will not take back.';

/**
 * The business's details for the top of an invoice, credit note or receipt, from the company settings. The company name
 * falls back to the branch's name when none is set, so a document always has a heading.
 */
export async function loadCompanyProfile(
  tx: TxClient,
  fallbackName: string,
): Promise<DocumentCompany> {
  const rows = await tx.appSetting.findMany({ where: { key: { startsWith: 'company.' } } });
  const read = (key: string): string | null => {
    const value = rows.find((row) => row.key === key)?.value;
    return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
  };
  return {
    name: read('company.name') ?? fallbackName,
    proprietor: read('company.proprietor'),
    address: read('company.address'),
    phone: read('company.phone'),
    gstin: read('company.gstin'),
    tagline: read('company.tagline'),
    terms: read('company.invoice_terms') ?? DEFAULT_INVOICE_TERMS,
  };
}

/** The prefix for invoice numbers, from the company settings. */
export async function loadInvoicePrefix(tx: TxClient): Promise<string> {
  const row = await tx.appSetting.findUnique({ where: { key: 'company.invoice_prefix' } });
  const value = row?.value;
  return typeof value === 'string' && /^[A-Za-z0-9]{1,3}$/.test(value.trim())
    ? value.trim().toUpperCase()
    : DEFAULT_INVOICE_PREFIX;
}
