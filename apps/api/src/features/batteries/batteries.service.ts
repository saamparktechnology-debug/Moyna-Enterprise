import { Inject, Injectable } from '@nestjs/common';
import {
  BATTERY_SORT_FIELDS,
  BatteryAlertsQuerySchema,
  BatteryListQuerySchema,
  InstallBatteryRequestSchema,
  SaleCheckRequestSchema,
  SetBatteryDetailsRequestSchema,
  addMonths,
  daysBetween,
  expiryStatus,
  todayInIndia,
  warrantyStatus,
} from '@erp/contracts';
import type {
  Battery,
  BatteryAlerts,
  BatteryListResponse,
  SaleCheckResponse,
} from '@erp/contracts';
import { Prisma } from '@prisma/client';
import { AuditService } from '../../common/audit/audit.service.js';
import {
  BusinessRuleError,
  ConflictError,
  ForbiddenError,
  NotFoundError,
  ValidationFailedError,
} from '../../common/errors/domain-errors.js';
import { buildPage, escapeLike, toSkipTake } from '../../common/pagination/pagination.js';
import type { TxClient } from '../../common/prisma/scoped-prisma.service.js';
import { TransactionService } from '../../common/prisma/transaction.service.js';
import type { AuthContext } from '../auth/auth.types.js';
import { StockPostingService } from '../stock/stock-posting.service.js';

const DAY_MS = 86_400_000;
const INSTALLATION_DOC = 'BATTERY_INSTALLATION';
const IN_STOCK_STATES = [
  'AVAILABLE',
  'RESERVED',
  'IN_TRANSIT',
  'DAMAGED',
  'RETURNED',
  'QUARANTINE',
] as const;

const UNIT_INCLUDE = {
  item: true,
  branch: true,
  battery: { include: { installedIn: true } },
} satisfies Prisma.SerialUnitInclude;
type UnitRow = Prisma.SerialUnitGetPayload<{ include: typeof UNIT_INCLUDE }>;

const asDay = (value: Date | null): string | null =>
  value ? value.toISOString().slice(0, 10) : null;
const asDate = (value: string | null | undefined): Date | null =>
  value ? new Date(`${value}T00:00:00.000Z`) : null;
const utcDay = (value: string): Date => new Date(`${value}T00:00:00.000Z`);

function toDto(unit: UnitRow, today: string): Battery {
  const battery = unit.battery;
  const expiryOn = asDay(battery?.expiryOn ?? null);
  const warrantyEnd = asDay(battery?.warrantyEnd ?? null);
  return {
    serialUnitId: unit.id,
    serialNo: unit.serialNo,
    chassisNo: unit.chassisNo,
    itemId: unit.itemId,
    itemCode: unit.item.itemCode,
    itemName: unit.item.name,
    branchId: unit.branchId,
    branchCode: unit.branch.code,
    state: unit.state,
    manufacturedOn: asDay(battery?.manufacturedOn ?? null),
    expiryOn,
    expiryStatus: expiryStatus(expiryOn, today),
    daysToExpiry: expiryOn ? daysBetween(today, expiryOn) : null,
    warrantyMonths: battery?.warrantyMonths ?? null,
    warrantyEnd,
    warrantyStatus: warrantyStatus(warrantyEnd, today),
    installedInSerialUnitId: battery?.installedInSerialUnitId ?? null,
    installedInSerialNo: battery?.installedIn?.serialNo ?? null,
    installedOn: asDay(battery?.installedOn ?? null),
    rowVersion: battery?.rowVersion ?? null,
  };
}

function expiryCondition(
  kind: 'expired' | 'expiring' | 'ok' | 'none',
  today: string,
  withinDays: number,
): Prisma.BatteryWhereInput {
  const start = utcDay(today);
  const end = new Date(start.getTime() + withinDays * DAY_MS);
  switch (kind) {
    case 'expired':
      return { expiryOn: { lt: start } };
    case 'expiring':
      return { expiryOn: { gte: start, lte: end } };
    case 'ok':
      return { expiryOn: { gt: end } };
    case 'none':
      return { expiryOn: null };
  }
}

@Injectable()
export class BatteriesService {
  constructor(
    @Inject(TransactionService) private readonly transactions: TransactionService,
    @Inject(AuditService) private readonly audit: AuditService,
    @Inject(StockPostingService) private readonly posting: StockPostingService,
  ) {}

  async list(rawQuery: unknown): Promise<BatteryListResponse> {
    const query = BatteryListQuerySchema.parse(rawQuery);
    const today = todayInIndia();
    const filters: Prisma.BatteryWhereInput[] = [];
    const unit: Prisma.SerialUnitWhereInput = {
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.itemId ? { itemId: query.itemId } : {}),
      ...(query.state ? { state: query.state } : {}),
    };
    const search = query.search?.trim();
    if (search) {
      const like = { contains: escapeLike(search), mode: 'insensitive' as const };
      unit.OR = [{ serialNo: like }, { item: { itemCode: like } }, { item: { name: like } }];
    }
    filters.push({ serialUnit: unit });
    if (query.expiry !== 'any')
      filters.push(expiryCondition(query.expiry, today, query.withinDays));
    if (query.warranty !== 'any') {
      const start = utcDay(today);
      filters.push(
        query.warranty === 'active'
          ? { warrantyEnd: { gte: start } }
          : query.warranty === 'ended'
            ? { warrantyEnd: { lt: start } }
            : { warrantyEnd: null },
      );
    }
    if (query.installed !== 'any')
      filters.push({ installedInSerialUnitId: query.installed === 'yes' ? { not: null } : null });

    const field = query.sortBy ?? 'expiryOn';
    if (!(BATTERY_SORT_FIELDS as readonly string[]).includes(field))
      throw new ValidationFailedError('Unsupported sort field', [
        { field: 'sortBy', message: `Sort by one of: ${BATTERY_SORT_FIELDS.join(', ')}` },
      ]);
    const order = query.sortBy ? query.sortOrder : 'asc';
    const orderBy: Prisma.BatteryOrderByWithRelationInput[] = [
      field === 'serialNo'
        ? { serialUnit: { serialNo: order } }
        : { [field]: { sort: order, nulls: 'last' } },
      { serialUnitId: 'asc' },
    ];
    const where: Prisma.BatteryWhereInput = { AND: filters };

    return this.transactions.run(async (tx) => {
      const [rows, total] = await Promise.all([
        tx.battery.findMany({
          where,
          orderBy,
          include: { serialUnit: { include: UNIT_INCLUDE } },
          ...toSkipTake(query),
        }),
        tx.battery.count({ where }),
      ]);
      return buildPage(
        rows.map((row) => toDto(row.serialUnit, today)),
        total,
        query,
      );
    });
  }

  async get(serialUnitId: string): Promise<Battery> {
    return this.transactions.run(async (tx) =>
      toDto(await this.unit(tx, serialUnitId), todayInIndia()),
    );
  }

  async alerts(rawQuery: unknown): Promise<BatteryAlerts> {
    const query = BatteryAlertsQuerySchema.parse(rawQuery);
    const today = todayInIndia();
    const inStock: Prisma.BatteryWhereInput = {
      serialUnit: {
        state: { in: [...IN_STOCK_STATES] },
        ...(query.branchId ? { branchId: query.branchId } : {}),
      },
    };
    return this.transactions.run(async (tx) => {
      const [expired, expiring] = await Promise.all([
        tx.battery.count({
          where: { AND: [inStock, expiryCondition('expired', today, query.withinDays)] },
        }),
        tx.battery.count({
          where: { AND: [inStock, expiryCondition('expiring', today, query.withinDays)] },
        }),
      ]);
      return { withinDays: query.withinDays, expired, expiring };
    });
  }

  /** Records or changes the dates of a battery. The first time needs no version; after that the version must match. */
  async setDetails(auth: AuthContext, serialUnitId: string, body: unknown): Promise<Battery> {
    const input = SetBatteryDetailsRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      await this.lockUnits(tx, [serialUnitId]);
      const current = await this.unit(tx, serialUnitId);
      const existing = current.battery;
      if (existing && input.rowVersion === undefined)
        throw new ConflictError('This battery already has details. Reload it and change them');
      if (existing && existing.rowVersion !== input.rowVersion)
        throw new ConflictError(
          'These battery details were changed by someone else. Reload them and try again',
        );
      const data = {
        manufacturedOn: asDate(input.manufacturedOn),
        expiryOn: asDate(input.expiryOn),
        warrantyMonths: input.warrantyMonths,
        warrantyEnd: asDate(input.warrantyEnd),
      };
      if (existing) await tx.battery.update({ where: { serialUnitId }, data });
      else await tx.battery.create({ data: { serialUnitId, ...data } });
      await this.audit.record(tx, {
        action: existing ? 'BATTERY_DETAILS_UPDATED' : 'BATTERY_DETAILS_RECORDED',
        entityType: 'SerialUnit',
        entityId: serialUnitId,
        branchId: current.branchId,
        oldValue: existing
          ? {
              manufacturedOn: asDay(existing.manufacturedOn),
              expiryOn: asDay(existing.expiryOn),
              warrantyMonths: existing.warrantyMonths,
              warrantyEnd: asDay(existing.warrantyEnd),
            }
          : null,
        newValue: {
          manufacturedOn: input.manufacturedOn,
          expiryOn: input.expiryOn,
          warrantyMonths: input.warrantyMonths,
          warrantyEnd: input.warrantyEnd,
        },
      });
      return toDto(await this.unit(tx, serialUnitId), todayInIndia());
    });
  }

  /** Installing reserves the battery for the vehicle: it leaves available stock but is not sold. */
  async install(auth: AuthContext, serialUnitId: string, body: unknown): Promise<Battery> {
    const input = InstallBatteryRequestSchema.parse(body);
    if (input.vehicleSerialUnitId === serialUnitId)
      throw new ValidationFailedError('A battery cannot be installed in itself', [
        { field: 'vehicleSerialUnitId', message: 'Choose the vehicle, not the battery' },
      ]);
    return this.transactions.run(async (tx) => {
      await this.lockUnits(tx, [serialUnitId, input.vehicleSerialUnitId]);
      const battery = await this.unit(tx, serialUnitId);
      const vehicle = await tx.serialUnit
        .findUnique({ where: { id: input.vehicleSerialUnitId } })
        .then((found) => {
          if (!found) throw new NotFoundError('Vehicle', input.vehicleSerialUnitId);
          return found;
        });
      if (battery.battery?.installedInSerialUnitId)
        throw new BusinessRuleError('This battery is already installed in a vehicle');
      if (vehicle.branchId !== battery.branchId)
        throw new BusinessRuleError('The battery and the vehicle must be in the same branch');
      if (vehicle.state !== 'AVAILABLE' && vehicle.state !== 'RESERVED')
        throw new BusinessRuleError(
          'The vehicle is not in stock, so a battery cannot be installed in it',
        );
      const decision = await this.assertUsable(
        tx,
        auth,
        battery,
        'installed',
        input.overrideReason,
      );

      await this.posting.moveSerialUnit(tx, {
        unitId: serialUnitId,
        branchId: battery.branchId,
        from: ['AVAILABLE'],
        to: 'RESERVED',
      });
      await this.postStateChange(tx, battery, 'AVAILABLE', 'RESERVED');
      const installedOn = asDate(input.installedOn ?? todayInIndia());
      await tx.battery.upsert({
        where: { serialUnitId },
        create: { serialUnitId, installedInSerialUnitId: vehicle.id, installedOn },
        update: { installedInSerialUnitId: vehicle.id, installedOn },
      });
      await this.audit.record(tx, {
        action: 'BATTERY_INSTALLED',
        entityType: 'SerialUnit',
        entityId: serialUnitId,
        branchId: battery.branchId,
        newValue: {
          vehicleSerialNo: vehicle.serialNo,
          installedOn: input.installedOn ?? todayInIndia(),
          expiryOverridden: decision.overridden,
        },
      });
      return toDto(await this.unit(tx, serialUnitId), todayInIndia());
    });
  }

  async uninstall(auth: AuthContext, serialUnitId: string): Promise<Battery> {
    void auth;
    return this.transactions.run(async (tx) => {
      await this.lockUnits(tx, [serialUnitId]);
      const battery = await this.unit(tx, serialUnitId);
      const installedIn = battery.battery?.installedIn;
      if (!battery.battery?.installedInSerialUnitId || !installedIn)
        throw new BusinessRuleError('This battery is not installed in a vehicle');
      if (battery.state !== 'RESERVED')
        throw new BusinessRuleError(
          'This battery has already left stock, so it cannot be taken out of the vehicle here',
        );
      await this.posting.moveSerialUnit(tx, {
        unitId: serialUnitId,
        branchId: battery.branchId,
        from: ['RESERVED'],
        to: 'AVAILABLE',
      });
      await this.postStateChange(tx, battery, 'RESERVED', 'AVAILABLE');
      await tx.battery.update({
        where: { serialUnitId },
        data: { installedInSerialUnitId: null, installedOn: null },
      });
      await this.audit.record(tx, {
        action: 'BATTERY_UNINSTALLED',
        entityType: 'SerialUnit',
        entityId: serialUnitId,
        branchId: battery.branchId,
        oldValue: { vehicleSerialNo: installedIn.serialNo },
      });
      return toDto(await this.unit(tx, serialUnitId), todayInIndia());
    });
  }

  /** The question billing asks before it sells a battery. */
  async saleCheck(
    auth: AuthContext,
    serialUnitId: string,
    body: unknown,
  ): Promise<SaleCheckResponse> {
    const input = SaleCheckRequestSchema.parse(body);
    return this.transactions.run(async (tx) => {
      const unit = await this.unit(tx, serialUnitId);
      const decision = await this.assertUsable(tx, auth, unit, 'sold', input.overrideReason);
      return {
        ok: true as const,
        overridden: decision.overridden,
        expiryOn: asDay(unit.battery?.expiryOn ?? null),
      };
    });
  }

  /**
   * For billing (module 4.7): checked inside the sale's own transaction. An expired battery is refused unless the
   * caller may override and gave a reason; the override is audited. Units that are not batteries pass.
   */
  async assertSellable(
    tx: TxClient,
    auth: AuthContext,
    serialUnitId: string,
    overrideReason: string | undefined,
  ): Promise<{ overridden: boolean }> {
    const unit = await this.unit(tx, serialUnitId);
    return this.assertUsable(tx, auth, unit, 'sold', overrideReason);
  }

  /** For billing: a cancelled sale takes the warranty back, because the battery has not been sold. */
  async clearWarranty(tx: TxClient, serialUnitId: string): Promise<void> {
    await tx.battery.updateMany({ where: { serialUnitId }, data: { warrantyEnd: null } });
  }

  /**
   * For billing (module 4.7): starts the warranty on the sale date. The end is the sale date plus the warranty months,
   * counted in calendar months. Does nothing when the battery has no warranty months.
   */
  async startWarranty(tx: TxClient, serialUnitId: string, startOn: string): Promise<string | null> {
    const battery = await tx.battery.findUnique({ where: { serialUnitId } });
    if (!battery || battery.warrantyMonths === null) return null;
    const end = addMonths(startOn, battery.warrantyMonths);
    await tx.battery.update({ where: { serialUnitId }, data: { warrantyEnd: asDate(end) } });
    return end;
  }

  /** Billing asks this for every battery it sells, including batteries sold with the vehicle they are installed in. */
  async authorizeSale(
    tx: TxClient,
    auth: AuthContext,
    serialUnitId: string,
    overrideReason: string | undefined,
  ): Promise<{ overridden: boolean }> {
    return this.assertUsable(tx, auth, await this.unit(tx, serialUnitId), 'sold', overrideReason);
  }

  /** An expired battery may be sold or installed only with a reason from someone who holds the override permission. */
  async assertUsable(
    tx: TxClient,
    auth: AuthContext,
    unit: UnitRow,
    purpose: 'sold' | 'installed',
    overrideReason: string | undefined,
  ): Promise<{ overridden: boolean }> {
    const expiryOn = asDay(unit.battery?.expiryOn ?? null);
    if (expiryStatus(expiryOn, todayInIndia()) !== 'EXPIRED') return { overridden: false };
    if (!overrideReason)
      throw new BusinessRuleError(
        `Battery ${unit.serialNo} expired on ${expiryOn} and cannot be ${purpose} without an override`,
        [{ field: 'overrideReason', message: 'A manager must override this and give a reason' }],
      );
    if (!auth.permissions.includes('batteries.override_expiry'))
      throw new ForbiddenError('You may not sell or install an expired battery');
    await this.audit.record(tx, {
      action: 'BATTERY_EXPIRY_OVERRIDDEN',
      entityType: 'SerialUnit',
      entityId: unit.id,
      branchId: unit.branchId,
      newValue: { purpose, expiryOn, reason: overrideReason },
    });
    return { overridden: true };
  }

  private async unit(tx: TxClient, id: string): Promise<UnitRow> {
    const unit = await tx.serialUnit.findUnique({ where: { id }, include: UNIT_INCLUDE });
    if (!unit) throw new NotFoundError('Serial unit', id);
    return unit;
  }

  private async lockUnits(tx: TxClient, ids: string[]): Promise<void> {
    const found = await tx.$queryRaw<{ id: string }[]>`
      SELECT id FROM serial_units WHERE id IN (${Prisma.join(ids.map((id) => Prisma.sql`${id}::uuid`))})
      ORDER BY id FOR UPDATE`;
    const missing = ids.find((id) => !found.some((row) => row.id === id));
    if (missing) throw new NotFoundError('Serial unit', missing);
  }

  private async postStateChange(
    tx: TxClient,
    unit: UnitRow,
    from: 'AVAILABLE' | 'RESERVED',
    to: 'AVAILABLE' | 'RESERVED',
  ): Promise<void> {
    const base = {
      branchId: unit.branchId,
      itemId: unit.itemId,
      serialUnitId: unit.id,
      movementType: 'STATE_CHANGE' as const,
      sourceDocId: unit.id,
      sourceDocType: INSTALLATION_DOC,
    };
    await this.posting.post(tx, { ...base, state: from, qtyDelta: -1 });
    await this.posting.post(tx, { ...base, state: to, qtyDelta: 1 });
  }
}
