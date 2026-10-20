import type { BranchContext } from '../branch-context/branch-context.service.js';

export interface RlsSettings {
  userId: string;
  branchIds: string;
  isSuper: string;
}

export function toRlsSettings(context: BranchContext): RlsSettings {
  return {
    userId: context.userId ?? '',
    branchIds: context.branchIds.join(','),
    isSuper: context.isSuperAdmin ? 'true' : 'false',
  };
}
