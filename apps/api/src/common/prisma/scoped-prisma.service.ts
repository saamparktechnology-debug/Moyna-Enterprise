import { Inject, Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { BranchContextService } from '../branch-context/branch-context.service.js';
import { branchScopeExtension } from './branch-scope.extension.js';
import { PrismaService } from './prisma.service.js';
import { toRlsSettings } from './rls-session.js';

@Injectable()
export class ScopedPrismaService {
  private readonly filtered;
  readonly client;

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(BranchContextService) private readonly contexts: BranchContextService,
  ) {
    this.filtered = this.prisma.$extends(branchScopeExtension(this.contexts));
    this.client = this.filtered.$extends(this.sessionExtension());
  }

  get transactional() {
    return this.filtered;
  }

  private sessionExtension() {
    const prisma = this.prisma;
    const contexts = this.contexts;
    return Prisma.defineExtension({
      name: 'rls-session',
      query: {
        async $allOperations({ model, args, query }) {
          if (!model) return query(args);
          const settings = toRlsSettings(contexts.require());
          const [, result] = await prisma.$transaction([
            prisma.$queryRaw`SELECT set_config('app.user_id', ${settings.userId}, true), set_config('app.branch_ids', ${settings.branchIds}, true), set_config('app.is_super', ${settings.isSuper}, true)`,
            query(args),
          ]);
          return result;
        },
      },
    });
  }
}

export type ScopedClient = ScopedPrismaService['client'];
export type FilteredClient = ScopedPrismaService['transactional'];
export type TxClient = Omit<
  FilteredClient,
  '$connect' | '$disconnect' | '$on' | '$transaction' | '$extends'
>;
