import { Global, Module } from '@nestjs/common';
import { AuditService } from './audit/audit.service.js';
import { BranchContextService } from './branch-context/branch-context.service.js';
import { DocumentNumberService } from './document-number/document-number.service.js';
import { OutboxService } from './outbox/outbox.service.js';
import { ScopedPrismaService } from './prisma/scoped-prisma.service.js';
import { TransactionService } from './prisma/transaction.service.js';
import { APP_CONFIG } from './config/config.module.js';
import type { Env } from './config/env.js';
import { createStorage } from './storage/storage.factory.js';
import { STORAGE_SERVICE } from './storage/storage.service.js';

@Global()
@Module({
  providers: [
    BranchContextService,
    ScopedPrismaService,
    TransactionService,
    AuditService,
    DocumentNumberService,
    OutboxService,
    {
      provide: STORAGE_SERVICE,
      inject: [APP_CONFIG],
      useFactory: (env: Env) => createStorage(env),
    },
  ],
  exports: [
    BranchContextService,
    ScopedPrismaService,
    TransactionService,
    AuditService,
    DocumentNumberService,
    OutboxService,
    STORAGE_SERVICE,
  ],
})
export class CoreModule {}
