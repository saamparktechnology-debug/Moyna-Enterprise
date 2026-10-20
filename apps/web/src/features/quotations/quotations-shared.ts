import type { BuildStageName, QuotationStatusName } from '@erp/contracts';

export const QUOTATION_STATUS_TEXT: Record<QuotationStatusName, string> = {
  DRAFT: 'Draft',
  SENT: 'Sent',
  ACCEPTED: 'Accepted',
  EXPIRED: 'Expired',
  CONVERTED: 'Delivered',
  CANCELLED: 'Cancelled',
};

export const BUILD_STAGE_TEXT: Record<BuildStageName, string> = {
  NOT_STARTED: 'Not started',
  IN_BUILD: 'Being built',
  QUALITY_CHECK: 'Quality check',
  READY: 'Ready for delivery',
};
