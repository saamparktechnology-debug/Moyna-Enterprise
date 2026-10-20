import type { KycStatusName } from '@erp/contracts';

export const KYC_LABELS: Record<KycStatusName, string> = {
  NOT_SUBMITTED: 'Not submitted',
  PENDING: 'Waiting for review',
  VERIFIED: 'Verified',
  REJECTED: 'Rejected',
};

export function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}
