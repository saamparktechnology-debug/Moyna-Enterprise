import { Inject, Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { BranchContextService } from '../branch-context/branch-context.service.js';
import { ScopedPrismaService } from './scoped-prisma.service.js';
import type { TxClient } from './scoped-prisma.service.js';
import { toRlsSettings } from './rls-session.js';

const DEFAULT_MAX_WAIT_MS = 5000;
const DEFAULT_TIMEOUT_MS = 15000;

export interface TransactionOptions {
  isolationLevel?: Prisma.TransactionIsolationLevel;
  timeoutMs?: number;
}

@Injectable()
export class TransactionService {
  constructor(
    @Inject(ScopedPrismaService) private readonly scoped: ScopedPrismaService,
    @Inject(BranchContextService) private readonly contexts: BranchContextService,
  ) {}

  async run<T>(fn: (tx: TxClient) => Promise<T>, options: TransactionOptions = {}): Promise<T> {
    const settings = toRlsSettings(this.contexts.require());
    return await this.scoped.transactional.$transaction(
      async (tx) => {
        await tx.$queryRaw`SELECT set_config('app.user_id', ${settings.userId}, true), set_config('app.branch_ids', ${settings.branchIds}, true), set_config('app.is_super', ${settings.isSuper}, true)`;
        return fn(tx);
      },
      {
        maxWait: DEFAULT_MAX_WAIT_MS,
        timeout: options.timeoutMs ?? DEFAULT_TIMEOUT_MS,
        ...(options.isolationLevel ? { isolationLevel: options.isolationLevel } : {}),
      },
    );
  }
}
