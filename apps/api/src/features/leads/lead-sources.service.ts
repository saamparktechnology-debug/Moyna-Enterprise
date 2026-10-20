import { Inject, Injectable } from '@nestjs/common';
import { CreateLeadSourceRequestSchema, UpdateLeadSourceRequestSchema } from '@erp/contracts';
import type { LeadSourceAdmin } from '@erp/contracts';
import { AuditService } from '../../common/audit/audit.service.js';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
} from '../../common/errors/domain-errors.js';
import { TransactionService } from '../../common/prisma/transaction.service.js';
import type { TxClient } from '../../common/prisma/scoped-prisma.service.js';
import type { AuthContext } from '../auth/auth.types.js';

/** The places leads come from. They are added, renamed and switched on or off, never deleted, because leads refer to them. */
@Injectable()
export class LeadSourcesService {
  constructor(
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(): Promise<LeadSourceAdmin[]> {
    return this.transactions.run(async (tx) => {
      const rows = await tx.leadSource.findMany({
        orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
        include: { _count: { select: { leads: true } } },
      });
      return rows.map((row) => ({
        code: row.code,
        name: row.name,
        isActive: row.isActive,
        leadCount: row._count.leads,
        rowVersion: row.rowVersion,
      }));
    });
  }

  async create(auth: AuthContext, body: unknown): Promise<LeadSourceAdmin> {
    const input = CreateLeadSourceRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('lead-sources', 0))`;
      if (await tx.leadSource.findUnique({ where: { code: input.code } }))
        throw new ConflictError('That code is already used', [
          { field: 'code', message: 'Choose a code no other source has' },
        ]);
      await this.assertNameFree(tx, input.name, null);
      await tx.leadSource.create({
        data: {
          code: input.code,
          name: input.name,
          isActive: true,
          createdBy: auth.userId,
          updatedBy: auth.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'LEAD_SOURCE_CREATED',
        entityType: 'LeadSource',
        entityId: null,
        branchId: null,
        newValue: { code: input.code, name: input.name },
      });
      return this.present(tx, input.code);
    });
  }

  async update(auth: AuthContext, code: string, body: unknown): Promise<LeadSourceAdmin> {
    const input = UpdateLeadSourceRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtextextended('lead-sources', 0))`;
      const current = await tx.leadSource.findUnique({ where: { code } });
      if (!current) throw new NotFoundError('Lead source', code);
      if (current.rowVersion !== input.rowVersion)
        throw new ConflictError('This source was changed by someone else. Reload it and try again');
      if (input.name !== undefined) await this.assertNameFree(tx, input.name, code);
      if (input.isActive === false && current.isActive) {
        const others = await tx.leadSource.count({
          where: { isActive: true, code: { not: code } },
        });
        if (others === 0)
          throw new BusinessRuleError('At least one source must stay switched on', [
            { field: 'isActive', message: 'Leads need somewhere to come from' },
          ]);
      }
      await tx.leadSource.update({
        where: { code },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          updatedBy: auth.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'LEAD_SOURCE_UPDATED',
        entityType: 'LeadSource',
        entityId: null,
        branchId: null,
        oldValue: { code, name: current.name, isActive: current.isActive },
        newValue: {
          code,
          name: input.name ?? current.name,
          isActive: input.isActive ?? current.isActive,
        },
      });
      return this.present(tx, code);
    });
  }

  private async assertNameFree(tx: TxClient, name: string, ownCode: string | null): Promise<void> {
    const other = await tx.leadSource.findFirst({
      where: {
        name: { equals: name, mode: 'insensitive' },
        ...(ownCode ? { code: { not: ownCode } } : {}),
      },
      select: { code: true },
    });
    if (other)
      throw new ConflictError('That name is already used', [
        { field: 'name', message: 'Choose a name no other source has' },
      ]);
  }

  private async present(tx: TxClient, code: string): Promise<LeadSourceAdmin> {
    const row = await tx.leadSource.findUniqueOrThrow({
      where: { code },
      include: { _count: { select: { leads: true } } },
    });
    return {
      code: row.code,
      name: row.name,
      isActive: row.isActive,
      leadCount: row._count.leads,
      rowVersion: row.rowVersion,
    };
  }
}
