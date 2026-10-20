import { Inject, Injectable } from '@nestjs/common';
import {
  BRANCH_SORT_FIELDS,
  BranchListQuerySchema,
  CreateBranchRequestSchema,
  UpdateBranchRequestSchema,
  gstinProblem,
} from '@erp/contracts';
import type { Branch, BranchListResponse } from '@erp/contracts';
import { Prisma } from '@prisma/client';
import type { Branch as BranchRow, State } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service.js';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationFailedError,
} from '../../common/errors/domain-errors.js';
import {
  buildPage,
  containsAny,
  toOrderBy,
  toSkipTake,
} from '../../common/pagination/pagination.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { TxClient } from '../../common/prisma/scoped-prisma.service.js';
import { TransactionService } from '../../common/prisma/transaction.service.js';
import type { AuthContext, RequestInfo } from '../auth/auth.types.js';

type BranchWithState = BranchRow & { state: State };

const OPEN_TRANSFER_STATUSES = ['REQUESTED', 'APPROVED', 'DISPATCHED', 'IN_TRANSIT'] as const;

function toDto(row: BranchWithState): Branch {
  return {
    id: row.id,
    code: row.code,
    name: row.name,
    gstin: row.gstin,
    stateCode: row.stateCode,
    stateName: row.state.name,
    isActive: row.isActive,
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
  };
}

function snapshot(row: BranchRow): Record<string, unknown> {
  return {
    code: row.code,
    name: row.name,
    gstin: row.gstin,
    stateCode: row.stateCode,
    isActive: row.isActive,
  };
}

@Injectable()
export class BranchesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(auth: AuthContext, rawQuery: unknown): Promise<BranchListResponse> {
    const query = BranchListQuerySchema.parse(rawQuery);
    const where: Prisma.BranchWhereInput = {
      AND: [
        auth.isSuperAdmin ? {} : { id: { in: auth.branchIds } },
        query.status === 'all' ? {} : { isActive: query.status === 'active' },
        containsAny(['code', 'name'], query.search) ?? {},
      ],
    };
    const orderBy = toOrderBy(BRANCH_SORT_FIELDS, query, { field: 'code', order: 'asc' });
    const [rows, total] = await Promise.all([
      this.prisma.branch.findMany({
        where,
        orderBy,
        include: { state: true },
        ...toSkipTake(query),
      }),
      this.prisma.branch.count({ where }),
    ]);
    return buildPage(rows.map(toDto), total, query);
  }

  async get(auth: AuthContext, id: string): Promise<Branch> {
    if (!auth.isSuperAdmin && !auth.branchIds.includes(id)) throw new NotFoundError('Branch', id);
    const row = await this.prisma.branch.findUnique({ where: { id }, include: { state: true } });
    if (!row) throw new NotFoundError('Branch', id);
    return toDto(row);
  }

  async create(info: RequestInfo, auth: AuthContext, body: unknown): Promise<Branch> {
    const input = CreateBranchRequestSchema.parse(body);
    await this.assertStateExists(input.stateCode);
    try {
      return await this.transactions.run(async (tx) => {
        const row = await tx.branch.create({
          data: {
            code: input.code,
            name: input.name,
            stateCode: input.stateCode,
            gstin: input.gstin,
            createdBy: auth.userId,
            updatedBy: auth.userId,
          },
          include: { state: true },
        });
        await this.audit.record(tx, {
          action: 'BRANCH_CREATED',
          entityType: 'Branch',
          entityId: row.id,
          branchId: row.id,
          newValue: snapshot(row),
        });
        return toDto(row);
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
        throw this.duplicateCode();
      throw error;
    }
  }

  async update(info: RequestInfo, auth: AuthContext, id: string, body: unknown): Promise<Branch> {
    const input = UpdateBranchRequestSchema.parse(body);
    if (input.stateCode) await this.assertStateExists(input.stateCode);

    return this.transactions.run(async (tx) => {
      const current = await this.lock(tx, id);
      if (current.rowVersion !== input.rowVersion) throw this.staleVersion();

      const next = {
        name: input.name ?? current.name,
        stateCode: input.stateCode ?? current.stateCode,
        gstin: input.gstin === undefined ? current.gstin : input.gstin,
      };
      if (next.gstin) {
        const problem = gstinProblem(next.gstin, next.stateCode);
        if (problem)
          throw new ValidationFailedError('The GSTIN does not fit this branch', [
            { field: 'gstin', message: problem },
          ]);
      }
      const taxIdentityChanged =
        next.stateCode !== current.stateCode || next.gstin !== current.gstin;
      if (
        taxIdentityChanged &&
        (await tx.invoice.count({ where: { branchId: id, status: { not: 'DRAFT' } } })) > 0
      ) {
        throw new BusinessRuleError(
          'The state and GSTIN cannot change once the branch has issued invoices',
        );
      }
      if (next.name === current.name && !taxIdentityChanged)
        return toDto(await this.reload(tx, id));

      await tx.branch.update({ where: { id }, data: { ...next, updatedBy: auth.userId } });
      const row = await this.reload(tx, id);
      await this.audit.record(tx, {
        action: 'BRANCH_UPDATED',
        entityType: 'Branch',
        entityId: id,
        branchId: id,
        oldValue: snapshot(current),
        newValue: snapshot(row),
      });
      return toDto(row);
    });
  }

  async deactivate(info: RequestInfo, auth: AuthContext, id: string): Promise<Branch> {
    return this.transactions.run(async (tx) => {
      const current = await this.lock(tx, id);
      if (!current.isActive) return toDto(await this.reload(tx, id));

      const otherActive = await tx.branch.count({ where: { isActive: true, id: { not: id } } });
      if (otherActive === 0)
        throw new BusinessRuleError('The last active branch cannot be deactivated');

      const stock = await tx.stockBalance.aggregate({
        where: { branchId: id },
        _sum: { quantity: true },
      });
      const openTransfers = await tx.transfer.count({
        where: {
          status: { in: [...OPEN_TRANSFER_STATUSES] },
          OR: [{ fromBranchId: id }, { toBranchId: id }],
        },
      });
      const reasons: string[] = [];
      if ((stock._sum.quantity ?? 0) > 0)
        reasons.push(
          `${stock._sum.quantity} units of stock are still here. Transfer or write them off first`,
        );
      if (openTransfers > 0)
        reasons.push(
          `${openTransfers} stock transfer${openTransfers === 1 ? ' is' : 's are'} still open`,
        );
      if (reasons.length > 0) {
        throw new BusinessRuleError(
          'This branch cannot be deactivated yet',
          reasons.map((message) => ({ field: 'isActive', message })),
        );
      }

      await tx.branch.update({ where: { id }, data: { isActive: false, updatedBy: auth.userId } });
      const row = await this.reload(tx, id);
      await this.audit.record(tx, {
        action: 'BRANCH_DEACTIVATED',
        entityType: 'Branch',
        entityId: id,
        branchId: id,
        oldValue: { isActive: true },
        newValue: { isActive: false },
      });
      return toDto(row);
    });
  }

  async reactivate(info: RequestInfo, auth: AuthContext, id: string): Promise<Branch> {
    return this.transactions.run(async (tx) => {
      const current = await this.lock(tx, id);
      if (current.isActive) return toDto(await this.reload(tx, id));
      await tx.branch.update({ where: { id }, data: { isActive: true, updatedBy: auth.userId } });
      const row = await this.reload(tx, id);
      await this.audit.record(tx, {
        action: 'BRANCH_REACTIVATED',
        entityType: 'Branch',
        entityId: id,
        branchId: id,
        oldValue: { isActive: false },
        newValue: { isActive: true },
      });
      return toDto(row);
    });
  }

  private async lock(tx: TxClient, id: string): Promise<BranchRow> {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM branches WHERE id = ${id}::uuid FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundError('Branch', id);
    return tx.branch.findUniqueOrThrow({ where: { id } });
  }

  private reload(tx: TxClient, id: string): Promise<BranchWithState> {
    return tx.branch.findUniqueOrThrow({ where: { id }, include: { state: true } });
  }

  private async assertStateExists(code: string): Promise<void> {
    const state = await this.prisma.state.findFirst({ where: { code, isActive: true } });
    if (!state)
      throw new ValidationFailedError('Unknown state', [
        { field: 'stateCode', message: 'Choose a state from the list' },
      ]);
  }

  private duplicateCode(): ConflictError {
    return new ConflictError('A branch with this code already exists', [
      { field: 'code', message: 'This code is already used by another branch' },
    ]);
  }

  private staleVersion(): ConflictError {
    return new ConflictError('This branch was changed by someone else. Reload it and try again');
  }
}
