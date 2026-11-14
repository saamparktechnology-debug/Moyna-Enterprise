import { Inject, Injectable } from '@nestjs/common';
import {
  AssemblyListQuerySchema,
  CreateAssemblyRequestSchema,
  ReverseAssemblyRequestSchema,
  todayInIndia,
} from '@erp/contracts';
import type { Assembly, AssemblyListResponse, ErrorDetail, NewFinishedItem } from '@erp/contracts';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service.js';
import { BranchContextService } from '../../common/branch-context/branch-context.service.js';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationFailedError,
} from '../../common/errors/domain-errors.js';
import { buildPage, toSkipTake } from '../../common/pagination/pagination.js';
import type { TxClient } from '../../common/prisma/scoped-prisma.service.js';
import { TransactionService } from '../../common/prisma/transaction.service.js';
import { invoiceNumberAt } from '../billing/invoice-number.js';
import type { AuthContext } from '../auth/auth.types.js';
import { StockPostingService } from '../stock/stock-posting.service.js';

const INCLUDE = {
  reversal: true,
  branch: { select: { code: true } },
  finishedItem: { select: { itemCode: true, name: true } },
  parts: {
    include: {
      item: { select: { itemCode: true, name: true, unitCode: true } },
      serialUnit: { select: { serialNo: true } },
    },
    orderBy: [{ item: { itemCode: 'asc' } }, { id: 'asc' }],
  },
  units: {
    include: { serialUnit: { select: { serialNo: true, chassisNo: true, motorNo: true } } },
    orderBy: { id: 'asc' },
  },
} satisfies Prisma.AssemblyInclude;
type Row = Prisma.AssemblyGetPayload<{ include: typeof INCLUDE }>;

function toDto(
  row: Row,
  creator: string | null,
  viewer: { isSuperAdmin: boolean },
  reversedBy: string | null,
): Assembly {
  // The Super Admin sees what the parts really cost; everyone else sees the cost worked out on the shown prices.
  const cost = viewer.isSuperAdmin ? row.costActual : row.costDisplay;
  const parts = new Map<
    string,
    {
      itemId: string;
      itemCode: string;
      itemName: string;
      unitCode: string;
      qty: number;
      serialNos: string[];
    }
  >();
  for (const part of row.parts) {
    const found = parts.get(part.itemId) ?? {
      itemId: part.itemId,
      itemCode: part.item.itemCode,
      itemName: part.item.name,
      unitCode: part.item.unitCode,
      qty: 0,
      serialNos: [],
    };
    found.qty += part.qty;
    if (part.serialUnit) found.serialNos.push(part.serialUnit.serialNo);
    parts.set(part.itemId, found);
  }
  return {
    id: row.id,
    assemblyNo: row.assemblyNo,
    branchId: row.branchId,
    branchCode: row.branch.code,
    finishedItemId: row.finishedItemId,
    finishedItemCode: row.finishedItem.itemCode,
    finishedItemName: row.finishedItem.name,
    qty: row.qty,
    sellingPrice: row.sellingPrice.toFixed(2),
    note: row.note,
    createdByName: creator,
    createdAt: row.createdAt.toISOString(),
    costTotal: cost?.toFixed(2) ?? null,
    profit: cost ? row.sellingPrice.times(row.qty).minus(cost).toFixed(2) : null,
    reversed: row.reversal
      ? {
          on: row.reversal.createdAt.toISOString(),
          reason: row.reversal.reason,
          byName: reversedBy,
        }
      : null,
    parts: [...parts.values()],
    units: row.units.map((unit) => ({
      serialUnitId: unit.serialUnitId,
      serialNo: unit.serialUnit.serialNo,
      chassisNo: unit.serialUnit.chassisNo,
      motorNo: unit.serialUnit.motorNo,
    })),
  };
}

/**
 * Assembling a product from our own stock. Nothing is costed: the parts go out of stock, the finished product comes in,
 * and the selling price is set on the product. A serial-numbered part (a battery, a motor) becomes INSTALLED so it cannot
 * be sold again, and a battery is recorded as installed in the vehicle that was made. An assembly is never changed.
 */
@Injectable()
export class AssemblyService {
  constructor(
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(BranchContextService) private readonly contexts: BranchContextService,
    @Inject(StockPostingService) private readonly stock: StockPostingService,
  ) {}

  async list(auth: AuthContext, rawQuery: unknown): Promise<AssemblyListResponse> {
    const query = AssemblyListQuerySchema.parse(rawQuery);
    return this.transactions.run(async (tx) => {
      const where: Prisma.AssemblyWhereInput = {
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.search
          ? {
              OR: [
                { assemblyNo: { contains: query.search, mode: 'insensitive' } },
                { finishedItem: { name: { contains: query.search, mode: 'insensitive' } } },
                { finishedItem: { itemCode: { contains: query.search, mode: 'insensitive' } } },
              ],
            }
          : {}),
      };
      const [rows, total] = await Promise.all([
        tx.assembly.findMany({
          where,
          include: INCLUDE,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          ...toSkipTake(query),
        }),
        tx.assembly.count({ where }),
      ]);
      const names = await this.names(
        tx,
        rows.flatMap((row) => [row.createdBy, row.reversal?.reversedBy ?? null]),
      );
      return buildPage(
        rows.map((row) =>
          toDto(
            row,
            row.createdBy ? (names.get(row.createdBy) ?? null) : null,
            auth,
            row.reversal?.reversedBy ? (names.get(row.reversal.reversedBy) ?? null) : null,
          ),
        ),
        total,
        query,
      );
    });
  }

  async get(auth: AuthContext, id: string): Promise<Assembly> {
    return this.transactions.run(async (tx) => {
      const row = await tx.assembly.findUnique({ where: { id }, include: INCLUDE });
      if (!row) throw new NotFoundError('Assembly', id);
      return this.present(tx, auth, row);
    });
  }

  async create(auth: AuthContext, body: unknown): Promise<Assembly> {
    const input = CreateAssemblyRequestSchema.parse(body);
    const branchId = this.resolveBranch(input.branchId);
    return this.transactions.run(async (tx) => {
      const problems: ErrorDetail[] = [];
      let finished = input.finishedItemId
        ? await tx.item.findUnique({ where: { id: input.finishedItemId } })
        : null;
      if (input.newItem) finished = await this.createItem(tx, auth, input.newItem);
      if (!finished || !finished.isActive)
        throw new ValidationFailedError('Choose the product being made', [
          { field: 'finishedItemId', message: 'Choose an active item' },
        ]);
      if (finished.isSerialized) {
        if (input.qty !== 1)
          problems.push({
            field: 'qty',
            message: 'A vehicle or other numbered product is made one at a time',
          });
        if (!input.units || input.units.length !== 1)
          problems.push({
            field: 'units',
            message: 'Enter the serial number of the product being made',
          });
      } else if (input.units && input.units.length > 0)
        problems.push({ field: 'units', message: 'This product is not tracked by serial number' });

      const partItems = await tx.item.findMany({
        where: { id: { in: input.parts.map((part) => part.itemId) } },
      });
      const itemById = new Map(partItems.map((item) => [item.id, item]));
      const allUnitIds = input.parts.flatMap((part) => part.serialUnitIds ?? []);
      const units = await tx.serialUnit.findMany({ where: { id: { in: allUnitIds } } });
      const unitById = new Map(units.map((unit) => [unit.id, unit]));
      input.parts.forEach((part, index) => {
        const item = itemById.get(part.itemId);
        const at = (field: string, message: string) =>
          problems.push({ field: `parts.${index}.${field}`, message });
        if (!item || !item.isActive) return at('itemId', 'Choose an active item');
        if (item.isSerialized && !part.serialUnitIds)
          at('serialUnitIds', `Choose the serial numbers of ${item.itemCode}`);
        if (!item.isSerialized && part.serialUnitIds)
          at('serialUnitIds', `${item.itemCode} is not tracked by serial number`);
        for (const unitId of part.serialUnitIds ?? []) {
          const unit = unitById.get(unitId);
          if (!unit || unit.itemId !== item.id || unit.branchId !== branchId)
            at('serialUnitIds', 'This serial number is not in stock in this branch');
          else if (unit.state !== 'AVAILABLE')
            at(
              'serialUnitIds',
              `Serial number ${unit.serialNo} is ${unit.state.toLowerCase()}, not available`,
            );
        }
      });
      if (problems.length > 0)
        throw new ValidationFailedError('The assembly has problems', problems);

      // What the parts cost, as the items' purchase prices stand now. Empty when a part has no price.
      const costWith = (
        pick: 'actualPurchasePrice' | 'displayPurchasePrice',
      ): Prisma.Decimal | null => {
        let total = new Prisma.Decimal(0);
        for (const part of input.parts) {
          const price = itemById.get(part.itemId)?.[pick];
          if (!price) return null;
          total = total.plus(price.times(part.qty));
        }
        return total;
      };
      const assemblyNo = await this.nextNumber(tx, branchId);
      const created = await tx.assembly.create({
        data: {
          branchId,
          assemblyNo,
          finishedItemId: finished.id,
          qty: input.qty,
          sellingPrice: input.sellingPrice,
          costActual: costWith('actualPurchasePrice'),
          costDisplay: costWith('displayPurchasePrice'),
          previousSellingPrice: finished.sellingPrice,
          note: input.note ?? null,
          createdBy: auth.userId,
          updatedBy: auth.userId,
        },
      });

      // Parts out of stock, always in the same order so two assemblies cannot wait on each other.
      const ordered = [...input.parts].sort((a, b) => a.itemId.localeCompare(b.itemId));
      const batteryUnitIds: string[] = [];
      for (const part of ordered) {
        const item = itemById.get(part.itemId) as (typeof partItems)[number];
        if (item.isSerialized) {
          for (const unitId of [...(part.serialUnitIds ?? [])].sort()) {
            await this.stock.moveSerialUnit(tx, {
              unitId,
              branchId,
              from: ['AVAILABLE'],
              to: 'INSTALLED',
            });
            await this.stock.post(tx, {
              branchId,
              itemId: item.id,
              state: 'AVAILABLE',
              qtyDelta: -1,
              movementType: 'ASSEMBLY_USED',
              serialUnitId: unitId,
              sourceDocId: created.id,
              sourceDocType: 'ASSEMBLY',
            });
            await tx.assemblyPart.create({
              data: {
                branchId,
                assemblyId: created.id,
                itemId: item.id,
                qty: 1,
                serialUnitId: unitId,
                createdBy: auth.userId,
                updatedBy: auth.userId,
              },
            });
            batteryUnitIds.push(unitId);
          }
        } else {
          await this.stock.post(tx, {
            branchId,
            itemId: item.id,
            state: 'AVAILABLE',
            qtyDelta: -part.qty,
            movementType: 'ASSEMBLY_USED',
            sourceDocId: created.id,
            sourceDocType: 'ASSEMBLY',
          });
          await tx.assemblyPart.create({
            data: {
              branchId,
              assemblyId: created.id,
              itemId: item.id,
              qty: part.qty,
              createdBy: auth.userId,
              updatedBy: auth.userId,
            },
          });
        }
      }

      // The finished product comes into stock.
      if (finished.isSerialized) {
        const unit = input.units?.[0];
        if (!unit) throw new Error('A numbered product has no serial number');
        const unitId = await this.stock.createSerialUnit(tx, {
          branchId,
          itemId: finished.id,
          serialNo: unit.serialNo,
          chassisNo: unit.chassisNo,
          state: 'AVAILABLE',
        });
        if (unit.motorNo)
          try {
            await tx.serialUnit.update({ where: { id: unitId }, data: { motorNo: unit.motorNo } });
          } catch (error) {
            if (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
              throw new ConflictError('This motor number already exists', [
                { field: 'units', message: 'Another unit already has this motor number' },
              ]);
            throw error;
          }
        await this.stock.post(tx, {
          branchId,
          itemId: finished.id,
          state: 'AVAILABLE',
          qtyDelta: 1,
          movementType: 'ASSEMBLY_MADE',
          serialUnitId: unitId,
          sourceDocId: created.id,
          sourceDocType: 'ASSEMBLY',
        });
        await tx.assemblyUnit.create({
          data: {
            branchId,
            assemblyId: created.id,
            serialUnitId: unitId,
            createdBy: auth.userId,
            updatedBy: auth.userId,
          },
        });
        // A battery that went in is now installed in the vehicle, so its warranty and history follow the vehicle.
        await tx.battery.updateMany({
          where: { serialUnitId: { in: batteryUnitIds } },
          data: {
            installedInSerialUnitId: unitId,
            installedOn: new Date(`${todayInIndia()}T00:00:00.000Z`),
          },
        });
      } else {
        await this.stock.post(tx, {
          branchId,
          itemId: finished.id,
          state: 'AVAILABLE',
          qtyDelta: input.qty,
          movementType: 'ASSEMBLY_MADE',
          sourceDocId: created.id,
          sourceDocType: 'ASSEMBLY',
        });
      }

      await tx.item.update({
        where: { id: finished.id },
        data: { sellingPrice: input.sellingPrice, updatedBy: auth.userId },
      });
      await this.audit.record(tx, {
        action: 'ASSEMBLY_CREATED',
        entityType: 'Assembly',
        entityId: created.id,
        branchId,
        newValue: {
          assemblyNo,
          finishedItem: finished.itemCode,
          qty: input.qty,
          sellingPrice: input.sellingPrice,
          oldSellingPrice: finished.sellingPrice?.toFixed(2) ?? null,
          parts: input.parts.map((part) => ({
            item: itemById.get(part.itemId)?.itemCode,
            qty: part.qty,
          })),
        },
      });
      const row = await tx.assembly.findUniqueOrThrow({
        where: { id: created.id },
        include: INCLUDE,
      });
      return this.present(tx, auth, row);
    });
  }

  /**
   * Takes an assembly apart again, with a reason. The product leaves stock (it must still be there: one already sold or
   * moved cannot be taken back), the parts come back, a numbered part is available again, a battery is no longer
   * recorded as installed, and the product's selling price goes back to what it was if nobody changed it since.
   */
  async reverse(auth: AuthContext, id: string, body: unknown): Promise<Assembly> {
    const input = ReverseAssemblyRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      await tx.$queryRaw`SELECT id FROM assemblies WHERE id = ${id}::uuid FOR UPDATE`;
      const row = await tx.assembly.findUnique({ where: { id }, include: INCLUDE });
      if (!row) throw new NotFoundError('Assembly', id);
      if (row.reversal)
        throw new ConflictError('This assembly was already reversed', [
          { field: 'reason', message: 'It was reversed already' },
        ]);
      const branchId = row.branchId;

      // The product leaves stock.
      if (row.units.length > 0) {
        for (const made of row.units) {
          const current = await tx.serialUnit.findUnique({
            where: { id: made.serialUnitId },
            select: { state: true, serialNo: true },
          });
          if (!current || current.state !== 'AVAILABLE')
            throw new BusinessRuleError(
              `The product ${current?.serialNo ?? ''} has already been sold or moved, so this assembly cannot be reversed`,
            );
          await this.stock.moveSerialUnit(tx, {
            unitId: made.serialUnitId,
            branchId,
            from: ['AVAILABLE'],
            to: 'SCRAPPED',
          });
          await this.stock.post(tx, {
            branchId,
            itemId: row.finishedItemId,
            state: 'AVAILABLE',
            qtyDelta: -1,
            movementType: 'ASSEMBLY_UNMADE',
            serialUnitId: made.serialUnitId,
            sourceDocId: row.id,
            sourceDocType: 'ASSEMBLY',
          });
          await tx.battery.updateMany({
            where: { installedInSerialUnitId: made.serialUnitId },
            data: { installedInSerialUnitId: null, installedOn: null },
          });
        }
      } else {
        await this.stock.post(tx, {
          branchId,
          itemId: row.finishedItemId,
          state: 'AVAILABLE',
          qtyDelta: -row.qty,
          movementType: 'ASSEMBLY_UNMADE',
          sourceDocId: row.id,
          sourceDocType: 'ASSEMBLY',
        });
      }

      // The parts come back.
      for (const part of [...row.parts].sort((a, b) => a.itemId.localeCompare(b.itemId))) {
        if (part.serialUnitId) {
          await this.stock.moveSerialUnit(tx, {
            unitId: part.serialUnitId,
            branchId,
            from: ['INSTALLED'],
            to: 'AVAILABLE',
          });
          await this.stock.post(tx, {
            branchId,
            itemId: part.itemId,
            state: 'AVAILABLE',
            qtyDelta: 1,
            movementType: 'ASSEMBLY_RETURNED',
            serialUnitId: part.serialUnitId,
            sourceDocId: row.id,
            sourceDocType: 'ASSEMBLY',
          });
        } else {
          await this.stock.post(tx, {
            branchId,
            itemId: part.itemId,
            state: 'AVAILABLE',
            qtyDelta: part.qty,
            movementType: 'ASSEMBLY_RETURNED',
            sourceDocId: row.id,
            sourceDocType: 'ASSEMBLY',
          });
        }
      }

      const item = await tx.item.findUnique({
        where: { id: row.finishedItemId },
        select: { sellingPrice: true },
      });
      if (item?.sellingPrice?.equals(row.sellingPrice))
        await tx.item.update({
          where: { id: row.finishedItemId },
          data: { sellingPrice: row.previousSellingPrice, updatedBy: auth.userId },
        });
      await tx.assemblyReversal.create({
        data: {
          branchId,
          assemblyId: row.id,
          reason: input.reason,
          reversedBy: auth.userId,
          createdBy: auth.userId,
          updatedBy: auth.userId,
        },
      });
      await this.audit.record(tx, {
        action: 'ASSEMBLY_REVERSED',
        entityType: 'Assembly',
        entityId: row.id,
        branchId,
        newValue: { assemblyNo: row.assemblyNo, reason: input.reason },
      });
      const again = await tx.assembly.findUniqueOrThrow({ where: { id }, include: INCLUDE });
      return this.present(tx, auth, again);
    });
  }

  /** Makes the product on the spot: only for someone who may create items. The item is made in the same transaction. */
  private async createItem(tx: TxClient, auth: AuthContext, input: NewFinishedItem) {
    if (!auth.permissions.includes('items.manage'))
      throw new ForbiddenError('You cannot create items. Choose a product that already exists');
    const wanted = {
      itemCode: input.itemCode,
      name: input.name,
      categoryId: input.categoryId,
      unitCode: input.unitCode,
      isSerialized: input.isSerialized ?? false,
      hsnCode: input.hsnCode ?? null,
      taxRate: input.taxRate ?? null,
    };
    if (wanted.hsnCode)
      await tx.hsnCode.createMany({
        data: [
          {
            code: wanted.hsnCode,
            description: `Added with item ${wanted.name}`.slice(0, 200),
            gstRate: wanted.taxRate,
            createdBy: auth.userId,
            updatedBy: auth.userId,
          },
        ],
        skipDuplicates: true,
      });
    try {
      return await tx.item.create({
        data: { ...wanted, createdBy: auth.userId, updatedBy: auth.userId },
      });
    } catch (error) {
      if (error instanceof Prisma.PrismaClientKnownRequestError) {
        if (error.code === 'P2002')
          throw new ConflictError('An item with this code already exists', [
            { field: 'newItem.itemCode', message: 'Choose another code' },
          ]);
        if (error.code === 'P2003')
          throw new ValidationFailedError('The new product has problems', [
            { field: 'newItem.categoryId', message: 'Choose a category and a unit from the lists' },
          ]);
      }
      throw error;
    }
  }

  private async present(tx: TxClient, auth: AuthContext, row: Row): Promise<Assembly> {
    const names = await this.names(tx, [row.createdBy, row.reversal?.reversedBy ?? null]);
    return toDto(
      row,
      row.createdBy ? (names.get(row.createdBy) ?? null) : null,
      auth,
      row.reversal?.reversedBy ? (names.get(row.reversal.reversedBy) ?? null) : null,
    );
  }

  /** An assembly is numbered like an invoice: AS and the date and time, taking the next free minute if one is used. */
  private async nextNumber(tx: TxClient, branchId: string): Promise<string> {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`assembly-number:${branchId}`}))`;
    let when = new Date();
    for (let attempt = 0; attempt < 240; attempt += 1) {
      const assemblyNo = invoiceNumberAt('AS', when);
      const taken = await tx.assembly.findFirst({
        where: { branchId, assemblyNo },
        select: { id: true },
      });
      if (!taken) return assemblyNo;
      when = new Date(when.getTime() + 60_000);
    }
    throw new BusinessRuleError('Could not find a free assembly number. Try again in a moment');
  }

  private resolveBranch(requested: string | undefined): string {
    if (requested) return requested;
    const context = this.contexts.require();
    const only = context.branchIds[0];
    if (!context.isSuperAdmin && context.branchIds.length === 1 && only) return only;
    throw new ValidationFailedError('Choose the branch', [
      { field: 'branchId', message: 'Choose a branch' },
    ]);
  }

  private async names(tx: TxClient, ids: readonly (string | null)[]): Promise<Map<string, string>> {
    const wanted = [...new Set(ids.filter((id): id is string => Boolean(id)))];
    if (wanted.length === 0) return new Map();
    const users = await tx.user.findMany({
      where: { id: { in: wanted } },
      select: { id: true, fullName: true },
    });
    return new Map(users.map((user) => [user.id, user.fullName]));
  }
}
