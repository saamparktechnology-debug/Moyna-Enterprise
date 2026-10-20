import type { InvoiceStatusName, InvoiceTypeName } from '@erp/contracts';

export const STATUS_TEXT: Record<InvoiceStatusName, string> = {
  DRAFT: 'Draft',
  ISSUED: 'Issued',
  CANCELLED: 'Cancelled',
};

export const TYPE_TEXT: Record<InvoiceTypeName, string> = {
  GST: 'GST invoice',
  NON_GST: 'Invoice without GST',
};
