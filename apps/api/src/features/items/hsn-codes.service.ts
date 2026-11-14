import { Inject, Injectable } from '@nestjs/common';
import {
  CreateHsnRequestSchema,
  ManagedHsnQuerySchema,
  UpdateHsnRequestSchema,
} from '@erp/contracts';
import type { ManagedHsn, ManagedHsnListResponse } from '@erp/contracts';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service.js';
import {
  ConflictError,
  NotFoundError,
  ValidationFailedError,
} from '../../common/errors/domain-errors.js';
import { buildPage, escapeLike, toSkipTake } from '../../common/pagination/pagination.js';
import { TransactionService } from '../../common/prisma/transaction.service.js';
import type { AuthContext } from '../auth/auth.types.js';

const INCLUDE = { _count: { select: { items: true } } } satisfies Prisma.HsnCodeInclude;
type Row = Prisma.HsnCodeGetPayload<{ include: typeof INCLUDE }>;

const toDto = (row: Row): ManagedHsn => ({
  code: row.code,
  description: row.description,
  gstRate: row.gstRate?.toFixed(2) ?? null,
  isActive: row.isActive,
  usedBy: row._count.items,
  rowVersion: row.rowVersion,
});

/** The list of HSN codes: adding a code, changing its description and GST rate, and switching it off. */
@Injectable()
export class HsnCodesService {
  constructor(
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(rawQuery: unknown): Promise<ManagedHsnListResponse> {
    const query = ManagedHsnQuerySchema.parse(rawQuery);
    return this.transactions.run(async (tx) => {
      const search = query.search ? escapeLike(query.search) : null;
      const where: Prisma.HsnCodeWhereInput = {
        ...(query.status === 'active' ? { isActive: true } : {}),
        ...(query.status === 'inactive' ? { isActive: false } : {}),
        ...(search
          ? {
              OR: [
                { code: { startsWith: query.search } },
                { description: { contains: query.search, mode: 'insensitive' } },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        tx.hsnCode.findMany({
          where,
          include: INCLUDE,
          orderBy: { code: 'asc' },
          ...toSkipTake(query),
        }),
        tx.hsnCode.count({ where }),
      ]);
      return buildPage(rows.map(toDto), total, query);
    });
  }

  async create(auth: AuthContext, body: unknown): Promise<ManagedHsn> {
    const input = CreateHsnRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      try {
        const row = await tx.hsnCode.create({
          data: {
            code: input.code,
            description: input.description,
            gstRate: input.gstRate,
            createdBy: auth.userId,
            updatedBy: auth.userId,
          },
          include: INCLUDE,
        });
        await this.audit.record(tx, {
          action: 'HSN_ADDED',
          entityType: 'HsnCode',
          newValue: { code: row.code, description: row.description, gstRate: input.gstRate },
        });
        return toDto(row);
      } catch (error) {
        throw this.problem(error);
      }
    });
  }

  async update(auth: AuthContext, code: string, body: unknown): Promise<ManagedHsn> {
    const input = UpdateHsnRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const current = await tx.hsnCode.findUnique({ where: { code }, include: INCLUDE });
      if (!current) throw new NotFoundError('HSN code', code);
      if (current.rowVersion !== input.rowVersion)
        throw new ConflictError('This code was changed by someone else. Reload it and try again');
      try {
        const row = await tx.hsnCode.update({
          where: { code },
          data: {
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.gstRate !== undefined ? { gstRate: input.gstRate } : {}),
            ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
            updatedBy: auth.userId,
          },
          include: INCLUDE,
        });
        await this.audit.record(tx, {
          action: 'HSN_EDITED',
          entityType: 'HsnCode',
          oldValue: {
            code,
            description: current.description,
            gstRate: current.gstRate?.toFixed(2) ?? null,
            isActive: current.isActive,
          },
          newValue: {
            code,
            description: row.description,
            gstRate: row.gstRate?.toFixed(2) ?? null,
            isActive: row.isActive,
          },
        });
        return toDto(row);
      } catch (error) {
        throw this.problem(error);
      }
    });
  }

  private problem(error: unknown): unknown {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
      if (error.code === 'P2002')
        return new ConflictError('This HSN code is already in the list', [
          { field: 'code', message: 'It is already in the list' },
        ]);
      if (error.code === 'P2003')
        return new ValidationFailedError('The GST rate is not one of the GST rates', [
          { field: 'gstRate', message: 'Choose a GST rate from the list' },
        ]);
    }
    return error;
  }
}
