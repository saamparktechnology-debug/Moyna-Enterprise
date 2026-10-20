import { Inject, Injectable } from '@nestjs/common';
import { CreateItemCategoryRequestSchema, UpdateItemCategoryRequestSchema } from '@erp/contracts';
import type { ItemCategory } from '@erp/contracts';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service.js';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationFailedError,
} from '../../common/errors/domain-errors.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { TxClient } from '../../common/prisma/scoped-prisma.service.js';
import { TransactionService } from '../../common/prisma/transaction.service.js';
import type { AuthContext } from '../auth/auth.types.js';

const MAX_DEPTH = 3;
const MAX_CATEGORIES = 1000;

type CategoryRow = Prisma.ItemCategoryGetPayload<{
  include: { parent: true; _count: { select: { items: true } } };
}>;
const INCLUDE = {
  parent: true,
  _count: { select: { items: true } },
} satisfies Prisma.ItemCategoryInclude;

function toDto(row: CategoryRow): ItemCategory {
  return {
    id: row.id,
    name: row.name,
    parentId: row.parentId,
    parentName: row.parent?.name ?? null,
    isActive: row.isActive,
    itemCount: row._count.items,
    rowVersion: row.rowVersion,
  };
}

@Injectable()
export class ItemCategoriesService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(): Promise<ItemCategory[]> {
    const rows = await this.prisma.itemCategory.findMany({
      include: INCLUDE,
      orderBy: [{ name: 'asc' }, { id: 'asc' }],
      take: MAX_CATEGORIES,
    });
    return rows.map(toDto);
  }

  async create(auth: AuthContext, body: unknown): Promise<ItemCategory> {
    const input = CreateItemCategoryRequestSchema.parse(body);
    try {
      return await this.transactions.run(async (tx) => {
        if (input.parentId) await this.assertParentUsable(tx, input.parentId, null);
        const row = await tx.itemCategory.create({
          data: {
            name: input.name,
            parentId: input.parentId,
            createdBy: auth.userId,
            updatedBy: auth.userId,
          },
          include: INCLUDE,
        });
        await this.audit.record(tx, {
          action: 'ITEM_CATEGORY_CREATED',
          entityType: 'ItemCategory',
          entityId: row.id,
          newValue: { name: row.name, parentId: row.parentId },
        });
        return toDto(row);
      });
    } catch (error) {
      throw this.explain(error);
    }
  }

  async update(auth: AuthContext, id: string, body: unknown): Promise<ItemCategory> {
    const input = UpdateItemCategoryRequestSchema.parse(body);
    try {
      return await this.transactions.run(async (tx) => {
        const rows = await tx.$queryRaw<
          { id: string }[]
        >`SELECT id FROM item_categories WHERE id = ${id}::uuid FOR UPDATE`;
        if (rows.length === 0) throw new NotFoundError('Category', id);
        const current = await tx.itemCategory.findUniqueOrThrow({
          where: { id },
          include: INCLUDE,
        });
        if (current.rowVersion !== input.rowVersion)
          throw new ConflictError(
            'This category was changed by someone else. Reload it and try again',
          );

        const next = {
          name: input.name ?? current.name,
          parentId: input.parentId === undefined ? current.parentId : input.parentId,
          isActive: input.isActive ?? current.isActive,
        };
        if (
          next.name === current.name &&
          next.parentId === current.parentId &&
          next.isActive === current.isActive
        )
          return toDto(current);

        if (next.parentId !== current.parentId && next.parentId)
          await this.assertParentUsable(tx, next.parentId, id);
        if (!next.isActive && current.isActive) await this.assertCanDeactivate(tx, id);

        await tx.itemCategory.update({ where: { id }, data: { ...next, updatedBy: auth.userId } });
        const row = await tx.itemCategory.findUniqueOrThrow({ where: { id }, include: INCLUDE });
        await this.audit.record(tx, {
          action: 'ITEM_CATEGORY_UPDATED',
          entityType: 'ItemCategory',
          entityId: id,
          oldValue: { name: current.name, parentId: current.parentId, isActive: current.isActive },
          newValue: next,
        });
        return toDto(row);
      });
    } catch (error) {
      throw this.explain(error);
    }
  }

  /** The parent must be active, must not be the category itself or one of its descendants, and the tree stays shallow. */
  private async assertParentUsable(
    tx: TxClient,
    parentId: string,
    movingId: string | null,
  ): Promise<void> {
    const chain: string[] = [];
    let cursor: string | null = parentId;
    while (cursor) {
      if (chain.includes(cursor)) break;
      chain.push(cursor);
      const found: { id: string; parentId: string | null; isActive: boolean } | null =
        await tx.itemCategory.findUnique({
          where: { id: cursor },
          select: { id: true, parentId: true, isActive: true },
        });
      if (!found) throw this.invalidParent('Choose an existing parent category');
      if (chain.length === 1 && !found.isActive)
        throw this.invalidParent('Choose an active parent category');
      cursor = found.parentId;
    }
    if (movingId && chain.includes(movingId))
      throw this.invalidParent(
        'A category cannot be placed inside itself or its own subcategories',
      );
    if (chain.length >= MAX_DEPTH)
      throw this.invalidParent(`Categories can be at most ${MAX_DEPTH} levels deep`);
  }

  private async assertCanDeactivate(tx: TxClient, id: string): Promise<void> {
    const [items, children] = await Promise.all([
      tx.item.count({ where: { categoryId: id, isActive: true } }),
      tx.itemCategory.count({ where: { parentId: id, isActive: true } }),
    ]);
    const reasons: string[] = [];
    if (items > 0)
      reasons.push(`${items} active item${items === 1 ? ' uses' : 's use'} this category`);
    if (children > 0)
      reasons.push(`${children} active subcategor${children === 1 ? 'y is' : 'ies are'} inside it`);
    if (reasons.length > 0)
      throw new BusinessRuleError(
        'This category cannot be deactivated yet',
        reasons.map((message) => ({ field: 'isActive', message })),
      );
  }

  private invalidParent(message: string): ValidationFailedError {
    return new ValidationFailedError('The parent category is not valid', [
      { field: 'parentId', message },
    ]);
  }

  private explain(error: unknown): Error {
    if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
      return new ConflictError('A category with this name already exists here', [
        { field: 'name', message: 'Another category at this level has this name' },
      ]);
    return error instanceof Error ? error : new Error(String(error));
  }
}
