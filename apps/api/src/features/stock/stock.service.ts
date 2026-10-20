import { LOW_STOCK_SORT_FIELDS, MOVEMENT_SORT_FIELDS } from '@erp/contracts';
import { Inject, Injectable } from '@nestjs/common';
import {
  LowStockQuerySchema,
  MovementQuerySchema,
  SERIAL_UNIT_SORT_FIELDS,
  STOCK_BALANCE_SORT_FIELDS,
  SerialUnitQuerySchema,
  StockBalanceQuerySchema,
} from '@erp/contracts';
import type {
  LowStockListResponse,
  MovementListResponse,
  SerialUnitListResponse,
  StockBalanceListResponse,
} from '@erp/contracts';
import { Prisma } from '@prisma/client';
import { BranchContextService } from '../../common/branch-context/branch-context.service.js';
import {
  buildPage,
  dateRange,
  escapeLike,
  toOrderBy,
  toSkipTake,
} from '../../common/pagination/pagination.js';
import { PrismaService } from '../../common/prisma/prisma.service.js';
import { ScopedPrismaService } from '../../common/prisma/scoped-prisma.service.js';
import { TransactionService } from '../../common/prisma/transaction.service.js';

interface BalanceRow {
  branch_id: string;
  branch_code: string;
  item_id: string;
  item_code: string;
  item_name: string;
  unit_code: string;
  is_serialized: boolean;
  reorder_level: number;
  available: number;
  reserved: number;
  in_transit: number;
  damaged: number;
  returned: number;
  quarantine: number;
  total: number;
}

interface LowRow {
  branch_id: string;
  branch_code: string;
  item_id: string;
  item_code: string;
  item_name: string;
  unit_code: string;
  reorder_level: number;
  available: number;
}

const BALANCE_ORDER: Record<(typeof STOCK_BALANCE_SORT_FIELDS)[number], Prisma.Sql> = {
  itemCode: Prisma.sql`item_code`,
  name: Prisma.sql`item_name`,
  available: Prisma.sql`available`,
  branch: Prisma.sql`branch_code`,
};

const LOW_STOCK_ORDER: Record<(typeof LOW_STOCK_SORT_FIELDS)[number], Prisma.Sql> = {
  shortfall: Prisma.sql`(reorder_level - available)`,
  available: Prisma.sql`available`,
  itemCode: Prisma.sql`item_code`,
  branch: Prisma.sql`branch_code`,
};

const countIn = (state: string) =>
  Prisma.sql`coalesce(sum(CASE WHEN sb.state = ${Prisma.raw(`'${state}'`)}::"StockState" THEN sb.quantity ELSE 0 END), 0)::int`;

@Injectable()
export class StockService {
  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(ScopedPrismaService) private readonly scoped: ScopedPrismaService,
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(BranchContextService) private readonly contexts: BranchContextService,
  ) {}

  /** The branches this request may see: all of them for a Super Admin, otherwise the user's current choice. */
  private visibleBranches(): Prisma.Sql {
    const context = this.contexts.require();
    return context.isSuperAdmin
      ? Prisma.empty
      : Prisma.sql`AND b.id = ANY(${[...context.branchIds]}::uuid[])`;
  }

  async balances(rawQuery: unknown): Promise<StockBalanceListResponse> {
    const query = StockBalanceQuerySchema.parse(rawQuery);
    const [ordering] = toOrderBy(STOCK_BALANCE_SORT_FIELDS, query, {
      field: 'itemCode',
      order: 'asc',
    });
    const [sortKey, sortOrder] = Object.entries(ordering ?? {})[0] ?? ['itemCode', 'asc'];
    const column = BALANCE_ORDER[sortKey as keyof typeof BALANCE_ORDER];
    const direction = sortOrder === 'desc' ? Prisma.sql`DESC` : Prisma.sql`ASC`;
    const search = query.search?.trim();
    const like = search ? `%${escapeLike(search)}%` : null;

    const base = Prisma.sql`
      SELECT b.id AS branch_id, b.code AS branch_code, i.id AS item_id, i.item_code, i.name AS item_name,
             i.unit_code, i.is_serialized, i.reorder_level,
             ${countIn('AVAILABLE')} AS available, ${countIn('RESERVED')} AS reserved,
             ${countIn('IN_TRANSIT')} AS in_transit, ${countIn('DAMAGED')} AS damaged,
             ${countIn('RETURNED')} AS returned, ${countIn('QUARANTINE')} AS quarantine,
             coalesce(sum(sb.quantity), 0)::int AS total
      FROM stock_balances sb
      JOIN branches b ON b.id = sb.branch_id
      JOIN items i ON i.id = sb.item_id
      WHERE true ${this.visibleBranches()}
        ${query.branchId ? Prisma.sql`AND b.id = ${query.branchId}::uuid` : Prisma.empty}
        ${query.categoryId ? Prisma.sql`AND i.category_id = ${query.categoryId}::uuid` : Prisma.empty}
        ${like ? Prisma.sql`AND (i.item_code ILIKE ${like} ESCAPE '\\' OR i.name ILIKE ${like} ESCAPE '\\')` : Prisma.empty}
      GROUP BY b.id, b.code, i.id, i.item_code, i.name, i.unit_code, i.is_serialized, i.reorder_level
      ${query.lowOnly ? Prisma.sql`HAVING i.reorder_level > 0 AND ${countIn('AVAILABLE')} <= i.reorder_level` : Prisma.empty}`;
    const { skip, take } = toSkipTake(query);

    return this.transactions.run(async (tx) => {
      const rows = await tx.$queryRaw<BalanceRow[]>`
        SELECT * FROM (${base}) g ORDER BY ${column} ${direction}, branch_code ASC, item_id ASC
        LIMIT ${take} OFFSET ${skip}`;
      const counted = await tx.$queryRaw<
        { n: number }[]
      >`SELECT count(*)::int AS n FROM (${base}) g`;
      return buildPage(
        rows.map((row) => ({
          branchId: row.branch_id,
          branchCode: row.branch_code,
          itemId: row.item_id,
          itemCode: row.item_code,
          itemName: row.item_name,
          unitCode: row.unit_code,
          isSerialized: row.is_serialized,
          reorderLevel: row.reorder_level,
          available: row.available,
          reserved: row.reserved,
          inTransit: row.in_transit,
          damaged: row.damaged,
          returned: row.returned,
          quarantine: row.quarantine,
          total: row.total,
          isLow: row.reorder_level > 0 && row.available <= row.reorder_level,
        })),
        counted[0]?.n ?? 0,
        query,
      );
    });
  }

  /** Active items whose available stock in an active branch is at or below the reorder level, including items with no stock row at all. */
  async lowStock(rawQuery: unknown): Promise<LowStockListResponse> {
    const query = LowStockQuerySchema.parse(rawQuery);
    const [lowOrdering] = toOrderBy(LOW_STOCK_SORT_FIELDS, query, {
      field: 'shortfall',
      order: 'desc',
    });
    const [lowKey, lowDirection] = Object.entries(lowOrdering ?? {})[0] ?? ['shortfall', 'desc'];
    const lowColumn = LOW_STOCK_ORDER[lowKey as keyof typeof LOW_STOCK_ORDER];
    const lowDir = lowDirection === 'asc' ? Prisma.sql`ASC` : Prisma.sql`DESC`;
    const base = Prisma.sql`
      SELECT b.id AS branch_id, b.code AS branch_code, i.id AS item_id, i.item_code, i.name AS item_name,
             i.unit_code, i.reorder_level, coalesce(sb.quantity, 0)::int AS available
      FROM branches b
      CROSS JOIN items i
      LEFT JOIN stock_balances sb ON sb.branch_id = b.id AND sb.item_id = i.id AND sb.state = 'AVAILABLE'
      WHERE b.is_active AND i.is_active AND i.reorder_level > 0
        AND coalesce(sb.quantity, 0) <= i.reorder_level ${this.visibleBranches()}
        ${query.branchId ? Prisma.sql`AND b.id = ${query.branchId}::uuid` : Prisma.empty}`;
    const { skip, take } = toSkipTake(query);
    return this.transactions.run(async (tx) => {
      const rows = await tx.$queryRaw<LowRow[]>`
        SELECT * FROM (${base}) g ORDER BY ${lowColumn} ${lowDir}, branch_code ASC, item_code ASC
        LIMIT ${take} OFFSET ${skip}`;
      const counted = await tx.$queryRaw<
        { n: number }[]
      >`SELECT count(*)::int AS n FROM (${base}) g`;
      return buildPage(
        rows.map((row) => ({
          branchId: row.branch_id,
          branchCode: row.branch_code,
          itemId: row.item_id,
          itemCode: row.item_code,
          itemName: row.item_name,
          unitCode: row.unit_code,
          available: row.available,
          reorderLevel: row.reorder_level,
          shortBy: row.reorder_level - row.available,
        })),
        counted[0]?.n ?? 0,
        query,
      );
    });
  }

  async movements(rawQuery: unknown): Promise<MovementListResponse> {
    const query = MovementQuerySchema.parse(rawQuery);
    const where: Prisma.StockLedgerWhereInput = {
      ...(query.itemId ? { itemId: query.itemId } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.movementType ? { movementType: query.movementType } : {}),
      ...(query.serialNo ? { serialUnit: { serialNo: query.serialNo.toUpperCase() } } : {}),
      ...(dateRange('createdAt', { from: query.from, to: query.to }) ?? {}),
    };
    const [rows, total] = await Promise.all([
      this.scoped.client.stockLedger.findMany({
        where,
        orderBy: toOrderBy(MOVEMENT_SORT_FIELDS, query, { field: 'createdAt', order: 'desc' }),
        include: { item: true, branch: true, serialUnit: true },
        ...toSkipTake(query),
      }),
      this.scoped.client.stockLedger.count({ where }),
    ]);
    const userIds = [...new Set(rows.flatMap((row) => (row.createdBy ? [row.createdBy] : [])))];
    const users = await this.prisma.user.findMany({
      where: { id: { in: userIds } },
      select: { id: true, fullName: true },
    });
    const names = new Map(users.map((user) => [user.id, user.fullName]));
    return buildPage(
      rows.map((row) => ({
        id: row.id,
        createdAt: row.createdAt.toISOString(),
        branchId: row.branchId,
        branchCode: row.branch.code,
        itemId: row.itemId,
        itemCode: row.item.itemCode,
        itemName: row.item.name,
        serialNo: row.serialUnit?.serialNo ?? null,
        state: row.state,
        qtyDelta: row.qtyDelta,
        movementType: row.movementType,
        sourceDocType: row.sourceDocType,
        sourceDocId: row.sourceDocId,
        createdByName: row.createdBy ? (names.get(row.createdBy) ?? null) : null,
      })),
      total,
      query,
    );
  }

  async serialUnits(rawQuery: unknown): Promise<SerialUnitListResponse> {
    const query = SerialUnitQuerySchema.parse(rawQuery);
    const search = query.search?.trim();
    const where: Prisma.SerialUnitWhereInput = {
      ...(query.itemId ? { itemId: query.itemId } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.state ? { state: query.state } : {}),
      ...(search
        ? {
            OR: [
              { serialNo: { contains: escapeLike(search), mode: 'insensitive' as const } },
              { chassisNo: { contains: escapeLike(search), mode: 'insensitive' as const } },
            ],
          }
        : {}),
    };
    const orderBy = toOrderBy(SERIAL_UNIT_SORT_FIELDS, query, { field: 'serialNo', order: 'asc' });
    const [rows, total] = await Promise.all([
      this.scoped.client.serialUnit.findMany({
        where,
        orderBy,
        include: { item: true, branch: true },
        ...toSkipTake(query),
      }),
      this.scoped.client.serialUnit.count({ where }),
    ]);
    return buildPage(
      rows.map((row) => ({
        id: row.id,
        branchId: row.branchId,
        branchCode: row.branch.code,
        itemId: row.itemId,
        itemCode: row.item.itemCode,
        itemName: row.item.name,
        serialNo: row.serialNo,
        chassisNo: row.chassisNo,
        state: row.state,
      })),
      total,
      query,
    );
  }
}
