import { Inject, Injectable } from '@nestjs/common';
import {
  AddBarcodeRequestSchema,
  CreateItemRequestSchema,
  ITEM_SORT_FIELDS,
  ItemListQuerySchema,
  ItemLookupQuerySchema,
  LabelRequestSchema,
  UpdateItemRequestSchema,
  buildInternalEan13,
  isValidEan13,
} from '@erp/contracts';
import type { ErrorDetail, Item, ItemListResponse, LabelResponse } from '@erp/contracts';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service.js';
import {
  BusinessRuleError,
  ConflictError,
  NotFoundError,
  ValidationFailedError,
} from '../../common/errors/domain-errors.js';
import {
  buildPage,
  escapeLike,
  toOrderBy,
  toSkipTake,
} from '../../common/pagination/pagination.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import type { TxClient } from '../../common/prisma/scoped-prisma.service.js';
import { TransactionService } from '../../common/prisma/transaction.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { ITEM_INCLUDE, itemSnapshot, toItemDto } from './items.mapper.js';
import type { ItemRow } from './items.mapper.js';

const MAX_BARCODES_PER_ITEM = 10;

interface References {
  categoryId?: string | undefined;
  unitCode?: string | undefined;
  hsnCode?: string | null | undefined;
  taxRate?: string | null | undefined;
}

@Injectable()
export class ItemsService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(AuditService) private readonly audit: AuditService,
  ) {}

  async list(rawQuery: unknown): Promise<ItemListResponse> {
    const query = ItemListQuerySchema.parse(rawQuery);
    const filters: Prisma.ItemWhereInput[] = [];
    if (query.status !== 'all') filters.push({ isActive: query.status === 'active' });
    if (query.tracking !== 'any') filters.push({ isSerialized: query.tracking === 'serialized' });
    if (query.categoryId) {
      filters.push({ categoryId: { in: await this.categoryWithDescendants(query.categoryId) } });
    }
    const search = query.search?.trim();
    if (search) {
      const like = { contains: escapeLike(search), mode: 'insensitive' as const };
      filters.push({
        OR: [{ itemCode: like }, { name: like }, { itemBarcodes: { some: { barcode: search } } }],
      });
    }
    const where: Prisma.ItemWhereInput = { AND: filters };
    const orderBy = toOrderBy(ITEM_SORT_FIELDS, query, { field: 'itemCode', order: 'asc' });
    const [rows, total] = await Promise.all([
      this.prisma.item.findMany({ where, orderBy, include: ITEM_INCLUDE, ...toSkipTake(query) }),
      this.prisma.item.count({ where }),
    ]);
    return buildPage(rows.map(toItemDto), total, query);
  }

  async get(id: string): Promise<Item> {
    const row = await this.prisma.item.findUnique({ where: { id }, include: ITEM_INCLUDE });
    if (!row) throw new NotFoundError('Item', id);
    return toItemDto(row);
  }

  /** Scan lookup: a barcode first, then an item code typed by hand. Inactive items are found but refused. */
  async lookup(rawQuery: unknown): Promise<Item> {
    const { barcode } = ItemLookupQuerySchema.parse(rawQuery);
    const hit = await this.prisma.itemBarcode.findUnique({
      where: { barcode },
      select: { itemId: true },
    });
    const row = hit
      ? await this.prisma.item.findUnique({ where: { id: hit.itemId }, include: ITEM_INCLUDE })
      : await this.prisma.item.findUnique({
          where: { itemCode: barcode.toUpperCase() },
          include: ITEM_INCLUDE,
        });
    if (!row) throw new NotFoundError('Item');
    if (!row.isActive)
      throw new BusinessRuleError('This item is inactive and cannot be used', [
        { field: 'barcode', message: `${row.itemCode} is inactive` },
      ]);
    return toItemDto(row);
  }

  async create(auth: AuthContext, body: unknown): Promise<Item> {
    const input = CreateItemRequestSchema.parse(body);
    const hsn = await this.assertReferences(input);
    const taxRate = input.taxRate ?? (hsn?.gstRate ? hsn.gstRate.toFixed(2) : null);
    try {
      return await this.transactions.run(async (tx) => {
        const barcode = input.generateBarcode ? await this.nextBarcode(tx) : input.barcode;
        const row = await tx.item.create({
          data: {
            itemCode: input.itemCode,
            name: input.name,
            categoryId: input.categoryId,
            unitCode: input.unitCode,
            hsnCode: input.hsnCode,
            taxRate,
            reorderLevel: input.reorderLevel,
            isSerialized: input.isSerialized,
            createdBy: auth.userId,
            updatedBy: auth.userId,
            ...(barcode
              ? {
                  itemBarcodes: {
                    create: { barcode, createdBy: auth.userId, updatedBy: auth.userId },
                  },
                }
              : {}),
          },
          include: ITEM_INCLUDE,
        });
        await this.audit.record(tx, {
          action: 'ITEM_CREATED',
          entityType: 'Item',
          entityId: row.id,
          newValue: { ...itemSnapshot(row), barcodes: row.itemBarcodes.map((b) => b.barcode) },
        });
        return toItemDto(row);
      });
    } catch (error) {
      throw await this.explainConflict(error, input.itemCode, input.barcode);
    }
  }

  async update(auth: AuthContext, id: string, body: unknown): Promise<Item> {
    const input = UpdateItemRequestSchema.parse(body);
    await this.assertReferences(input);
    return this.transactions.run(async (tx) => {
      const current = await this.lock(tx, id);
      if (current.rowVersion !== input.rowVersion) throw this.staleVersion();

      const next = {
        name: input.name ?? current.name,
        categoryId: input.categoryId ?? current.categoryId,
        unitCode: input.unitCode ?? current.unitCode,
        hsnCode: input.hsnCode === undefined ? current.hsnCode : input.hsnCode,
        taxRate:
          input.taxRate === undefined
            ? (current.taxRate?.toFixed(2) ?? null)
            : input.taxRate === null
              ? null
              : new Prisma.Decimal(input.taxRate).toFixed(2),
        reorderLevel: input.reorderLevel ?? current.reorderLevel,
        isSerialized: input.isSerialized ?? current.isSerialized,
      };
      const changed =
        next.name !== current.name ||
        next.categoryId !== current.categoryId ||
        next.unitCode !== current.unitCode ||
        next.hsnCode !== current.hsnCode ||
        next.taxRate !== (current.taxRate?.toFixed(2) ?? null) ||
        next.reorderLevel !== current.reorderLevel ||
        next.isSerialized !== current.isSerialized;
      if (!changed) return toItemDto(current);

      if (next.isSerialized !== current.isSerialized && (await this.hasStockHistory(tx, id)))
        throw new BusinessRuleError(
          'Serial tracking cannot change once the item has stock or serial numbers',
          [{ field: 'isSerialized', message: 'This item already has stock history' }],
        );

      await tx.item.update({ where: { id }, data: { ...next, updatedBy: auth.userId } });
      const row = await this.reload(tx, id);
      await this.audit.record(tx, {
        action: 'ITEM_UPDATED',
        entityType: 'Item',
        entityId: id,
        oldValue: itemSnapshot(current),
        newValue: itemSnapshot(row),
      });
      return toItemDto(row);
    });
  }

  async setActive(auth: AuthContext, id: string, active: boolean): Promise<Item> {
    return this.transactions.run(async (tx) => {
      const current = await this.lock(tx, id);
      if (current.isActive === active) return toItemDto(current);
      if (!active) {
        const onHand = await this.stockOnHand(tx, id);
        if (onHand > 0)
          throw new BusinessRuleError('This item cannot be deactivated yet', [
            {
              field: 'isActive',
              message: `${onHand} unit${onHand === 1 ? ' is' : 's are'} still in stock. Transfer, sell or write them off first`,
            },
          ]);
      }
      await tx.item.update({ where: { id }, data: { isActive: active, updatedBy: auth.userId } });
      const row = await this.reload(tx, id);
      await this.audit.record(tx, {
        action: active ? 'ITEM_REACTIVATED' : 'ITEM_DEACTIVATED',
        entityType: 'Item',
        entityId: id,
        oldValue: { isActive: !active },
        newValue: { isActive: active },
      });
      return toItemDto(row);
    });
  }

  async addBarcode(auth: AuthContext, id: string, body: unknown): Promise<Item> {
    const input = AddBarcodeRequestSchema.parse(body);
    let requested: string | undefined;
    try {
      return await this.transactions.run(async (tx) => {
        const current = await this.lock(tx, id);
        if (current.itemBarcodes.length >= MAX_BARCODES_PER_ITEM)
          throw new BusinessRuleError(`An item can have at most ${MAX_BARCODES_PER_ITEM} barcodes`);
        const barcode = 'generate' in input ? await this.nextBarcode(tx) : input.barcode;
        requested = barcode;
        await tx.itemBarcode.create({
          data: { itemId: id, barcode, createdBy: auth.userId, updatedBy: auth.userId },
        });
        const row = await this.reload(tx, id);
        await this.audit.record(tx, {
          action: 'ITEM_BARCODE_ADDED',
          entityType: 'Item',
          entityId: id,
          newValue: { barcode, generated: 'generate' in input },
        });
        return toItemDto(row);
      });
    } catch (error) {
      throw await this.explainConflict(error, null, requested);
    }
  }

  async removeBarcode(auth: AuthContext, id: string, barcodeId: string): Promise<Item> {
    return this.transactions.run(async (tx) => {
      await this.lock(tx, id);
      const barcode = await tx.itemBarcode.findFirst({ where: { id: barcodeId, itemId: id } });
      if (!barcode) throw new NotFoundError('Barcode', barcodeId);
      await tx.itemBarcode.delete({ where: { id: barcodeId } });
      await tx.item.update({ where: { id }, data: { updatedBy: auth.userId } });
      const row = await this.reload(tx, id);
      await this.audit.record(tx, {
        action: 'ITEM_BARCODE_REMOVED',
        entityType: 'Item',
        entityId: id,
        oldValue: { barcode: barcode.barcode },
      });
      return toItemDto(row);
    });
  }

  /** The data for a label run: one entry per label, using the item's scannable barcode. */
  async labels(auth: AuthContext, body: unknown): Promise<LabelResponse> {
    const input = LabelRequestSchema.parse(body);
    const rows = await this.requireUsable(input.items.map((line) => line.itemId));
    const unlabelled = rows.filter((row) => row.itemBarcodes.length === 0);
    if (unlabelled.length > 0)
      throw new BusinessRuleError(
        'Some items have no barcode yet',
        unlabelled.map((row) => ({ field: 'items', message: `${row.itemCode} has no barcode` })),
      );
    const copies = new Map(input.items.map((line) => [line.itemId, line.copies]));
    await this.transactions.run(async (tx) => {
      for (const row of rows) {
        await this.audit.record(tx, {
          action: 'ITEM_LABELS_PRINTED',
          entityType: 'Item',
          entityId: row.id,
          newValue: { copies: copies.get(row.id) ?? 0 },
        });
      }
    });
    return {
      labels: rows.flatMap((row) => {
        const barcode =
          row.itemBarcodes.find((candidate) => isValidEan13(candidate.barcode)) ??
          row.itemBarcodes[0];
        return Array.from({ length: copies.get(row.id) ?? 0 }, () => ({
          itemId: row.id,
          itemCode: row.itemCode,
          name: row.name,
          barcode: barcode?.barcode ?? '',
        }));
      }),
    };
  }

  /** For the modules that sell, receive and move stock: every item must exist and be active. */
  async requireUsable(ids: readonly string[]): Promise<ItemRow[]> {
    const rows = await this.prisma.item.findMany({
      where: { id: { in: [...ids] } },
      include: ITEM_INCLUDE,
    });
    const byId = new Map(rows.map((row) => [row.id, row]));
    const missing = ids.find((id) => !byId.has(id));
    if (missing) throw new NotFoundError('Item', missing);
    const inactive = rows.filter((row) => !row.isActive);
    if (inactive.length > 0)
      throw new BusinessRuleError(
        'Inactive items cannot be used',
        inactive.map((row) => ({ field: 'items', message: `${row.itemCode} is inactive` })),
      );
    return ids.flatMap((id) => byId.get(id) ?? []);
  }

  private async categoryWithDescendants(id: string): Promise<string[]> {
    const all = await this.prisma.itemCategory.findMany({ select: { id: true, parentId: true } });
    const found = new Set([id]);
    let grew = true;
    while (grew) {
      grew = false;
      for (const category of all) {
        if (category.parentId && found.has(category.parentId) && !found.has(category.id)) {
          found.add(category.id);
          grew = true;
        }
      }
    }
    return [...found];
  }

  private async assertReferences(
    refs: References,
  ): Promise<{ gstRate: Prisma.Decimal | null } | null> {
    const problems: ErrorDetail[] = [];
    if (refs.categoryId) {
      const category = await this.prisma.itemCategory.findFirst({
        where: { id: refs.categoryId, isActive: true },
      });
      if (!category) problems.push({ field: 'categoryId', message: 'Choose an active category' });
    }
    if (refs.unitCode) {
      const unit = await this.prisma.unitOfMeasure.findFirst({
        where: { code: refs.unitCode, isActive: true },
      });
      if (!unit) problems.push({ field: 'unitCode', message: 'Choose a unit from the list' });
    }
    if (refs.taxRate) {
      const rate = await this.prisma.gstRate.findFirst({
        where: { rate: refs.taxRate, isActive: true },
      });
      if (!rate) problems.push({ field: 'taxRate', message: 'Choose a GST rate from the list' });
    }
    let hsn: { gstRate: Prisma.Decimal | null } | null = null;
    if (refs.hsnCode) {
      hsn = await this.prisma.hsnCode.findFirst({ where: { code: refs.hsnCode, isActive: true } });
      if (!hsn) problems.push({ field: 'hsnCode', message: 'Choose an HSN code from the list' });
    }
    if (problems.length > 0)
      throw new ValidationFailedError('Some choices are not valid', problems);
    return hsn;
  }

  private async nextBarcode(tx: TxClient): Promise<string> {
    const rows = await tx.$queryRaw<
      { value: bigint }[]
    >`SELECT nextval('item_barcode_seq') AS value`;
    const first = rows[0];
    if (!first) throw new Error('The barcode sequence returned no value');
    return buildInternalEan13(BigInt(first.value));
  }

  private async hasStockHistory(tx: TxClient, id: string): Promise<boolean> {
    const rows = await tx.$queryRaw<
      { found: boolean }[]
    >`SELECT item_has_stock_history(${id}::uuid) AS found`;
    return rows[0]?.found ?? false;
  }

  private async stockOnHand(tx: TxClient, id: string): Promise<number> {
    const rows = await tx.$queryRaw<
      { total: bigint }[]
    >`SELECT item_stock_on_hand(${id}::uuid) AS total`;
    return Number(rows[0]?.total ?? 0);
  }

  private async lock(tx: TxClient, id: string): Promise<ItemRow> {
    const rows = await tx.$queryRaw<
      { id: string }[]
    >`SELECT id FROM items WHERE id = ${id}::uuid FOR UPDATE`;
    if (rows.length === 0) throw new NotFoundError('Item', id);
    return this.reload(tx, id);
  }

  private reload(tx: TxClient, id: string): Promise<ItemRow> {
    return tx.item.findUniqueOrThrow({ where: { id }, include: ITEM_INCLUDE });
  }

  /** Turns a unique-index failure into a message that names the field, whichever index it was. */
  private async explainConflict(
    error: unknown,
    itemCode: string | null,
    barcode: string | undefined,
  ): Promise<Error> {
    const unknownError = error instanceof Error ? error : new Error(String(error));
    if (!(error instanceof Prisma.PrismaClientKnownRequestError) || error.code !== 'P2002')
      return unknownError;
    if (barcode) {
      const owner = await this.prisma.itemBarcode.findUnique({
        where: { barcode },
        include: { item: true },
      });
      if (owner)
        return new ConflictError('This barcode is already in use', [
          { field: 'barcode', message: `Already used by item ${owner.item.itemCode}` },
        ]);
    }
    if (itemCode)
      return new ConflictError('An item with this code already exists', [
        { field: 'itemCode', message: 'This code is already used by another item' },
      ]);
    return unknownError;
  }

  private staleVersion(): ConflictError {
    return new ConflictError('This item was changed by someone else. Reload it and try again');
  }
}
