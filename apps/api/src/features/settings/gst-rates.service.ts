import { Inject, Injectable } from '@nestjs/common';
import { CreateGstRateRequestSchema, UpdateGstRateRequestSchema } from '@erp/contracts';
import type { GstRateAdmin } from '@erp/contracts';
import type { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service.js';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
} from '../../common/errors/domain-errors.js';
import type { TxClient } from '../../common/prisma/scoped-prisma.service.js';
import { TransactionService } from '../../common/prisma/transaction.service.js';
import type { AuthContext } from '../auth/auth.types.js';

type Row = Prisma.GstRateGetPayload<object>;

/** The GST percentages items can be given. The percentage never changes once it exists; it can be switched off. */
@Injectable()
export class GstRatesService {
  constructor(
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  private async itemsUsing(tx: TxClient, rate: Prisma.Decimal): Promise<number> {
    return tx.item.count({ where: { taxRate: rate, isActive: true } });
  }

  private async present(tx: TxClient, row: Row): Promise<GstRateAdmin> {
    return {
      id: row.id,
      rate: row.rate.toFixed(2),
      label: row.label,
      isActive: row.isActive,
      itemsUsing: await this.itemsUsing(tx, row.rate),
      rowVersion: row.rowVersion,
    };
  }

  async list(): Promise<GstRateAdmin[]> {
    return this.transactions.run(async (tx) => {
      const rows = await tx.gstRate.findMany({ orderBy: { rate: 'asc' } });
      return Promise.all(rows.map((row) => this.present(tx, row)));
    });
  }

  async create(auth: AuthContext, rawBody: unknown): Promise<GstRateAdmin> {
    const input = CreateGstRateRequestSchema.parse(rawBody);
    return this.transactions.run(async (tx) => {
      if (await tx.gstRate.findUnique({ where: { rate: input.rate } }))
        throw new ConflictError(`A ${Number(input.rate)}% rate already exists`);
      const row = await tx.gstRate.create({
        data: {
          rate: input.rate,
          label: input.label,
          createdBy: auth.userId,
          updatedBy: auth.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'GST_RATE_CREATED',
        entityType: 'GstRate',
        entityId: row.id,
        newValue: { rate: row.rate.toFixed(2), label: row.label },
      });
      return this.present(tx, row);
    });
  }

  async update(auth: AuthContext, id: string, rawBody: unknown): Promise<GstRateAdmin> {
    const input = UpdateGstRateRequestSchema.parse(rawBody);
    return this.transactions.run(async (tx) => {
      const row = await tx.gstRate.findUnique({ where: { id } });
      if (!row) throw new NotFoundError('GST rate', id);
      if (row.rowVersion !== input.rowVersion)
        throw new ConflictError(
          'This rate changed while you were looking at it. Reload and try again',
        );
      if (input.isActive === false && row.isActive) {
        const using = await this.itemsUsing(tx, row.rate);
        if (using > 0)
          throw new BusinessRuleError('This rate is still in use', [
            {
              field: 'isActive',
              message: `${using} active ${using === 1 ? 'item uses' : 'items use'} ${row.rate.toFixed(2)}%. Move them to another rate first.`,
            },
          ]);
      }
      const updated = await tx.gstRate.update({
        where: { id },
        data: {
          ...(input.label !== undefined ? { label: input.label } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
          updatedBy: auth.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'GST_RATE_CHANGED',
        entityType: 'GstRate',
        entityId: id,
        oldValue: { label: row.label, isActive: row.isActive },
        newValue: {
          label: updated.label,
          isActive: updated.isActive,
          rate: updated.rate.toFixed(2),
        },
      });
      return this.present(tx, updated);
    });
  }
}
