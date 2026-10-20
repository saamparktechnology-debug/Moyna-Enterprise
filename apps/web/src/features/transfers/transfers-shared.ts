import type { TransferStatus } from '@erp/contracts';
import { useAuth } from '@/features/auth/auth-provider';

export const TRANSFER_STATUS_TEXT: Record<TransferStatus, string> = {
  REQUESTED: 'Requested',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  DISPATCHED: 'On its way',
  IN_TRANSIT: 'In transit',
  RECEIVED: 'Received',
  CANCELLED: 'Cancelled',
};

/** One serial number per line, or separated by commas. Blank entries are ignored. */
export const splitSerials = (text: string): string[] =>
  text
    .split(/[\n,]/)
    .map((entry) => entry.trim().toUpperCase())
    .filter((entry) => entry !== '');

/** Whether the signed-in person may act for a branch. The server decides again; this only hides buttons that would be refused. */
export function useWorksIn(): (branchId: string) => boolean {
  const { user } = useAuth();
  return (branchId) =>
    Boolean(user?.isSuperAdmin) || (user?.branches ?? []).some((branch) => branch.id === branchId);
}
