import { Prisma } from '@prisma/client';
import type { BranchContextService } from '../branch-context/branch-context.service.js';
import { scopeArgs } from './branch-scope.js';

export function branchScopeExtension(contexts: BranchContextService) {
  return Prisma.defineExtension({
    name: 'branch-scope',
    query: {
      $allOperations({ model, operation, args, query }) {
        if (!model) return query(args);
        return query(scopeArgs(model, operation, args, contexts.require()));
      },
    },
  });
}
