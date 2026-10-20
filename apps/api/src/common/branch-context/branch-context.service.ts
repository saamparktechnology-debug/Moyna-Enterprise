import { AsyncLocalStorage } from 'node:async_hooks';
import { Injectable } from '@nestjs/common';

export interface BranchContext {
  userId: string | null;
  branchIds: readonly string[];
  isSuperAdmin: boolean;
  ipAddress?: string | undefined;
  userAgent?: string | undefined;
  requestId?: string | undefined;
}

export class MissingBranchContextError extends Error {
  constructor() {
    super(
      'No branch context is active. Run this code inside BranchContextService.run() or runAsSystem().',
    );
    this.name = 'MissingBranchContextError';
  }
}

@Injectable()
export class BranchContextService {
  private readonly storage = new AsyncLocalStorage<BranchContext>();

  /**
   * Runs `fn` with the given context and awaits it before the context ends. Prisma queries start only when
   * awaited, so awaiting here is what keeps the context attached to them.
   */
  run<T>(context: BranchContext, fn: () => PromiseLike<T> | T): Promise<T> {
    const frozen = Object.freeze({ ...context, branchIds: [...context.branchIds] });
    return this.storage.run(frozen, async () => await fn());
  }

  runAsSystem<T>(fn: () => PromiseLike<T> | T): Promise<T> {
    return this.run({ userId: null, branchIds: [], isSuperAdmin: true }, fn);
  }

  current(): BranchContext | undefined {
    return this.storage.getStore();
  }

  require(): BranchContext {
    const context = this.storage.getStore();
    if (!context) throw new MissingBranchContextError();
    return context;
  }
}
