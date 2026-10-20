import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  BatteryAlertsSchema,
  BatteryListResponseSchema,
  BatterySchema,
  StockAdjustmentSchema,
  todayInIndia,
} from '@erp/contracts';
import type { Battery } from '@erp/contracts';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { BranchContextService } from '../../src/common/branch-context/branch-context.service.js';
import { TransactionService } from '../../src/common/prisma/transaction.service.js';
import { BatteriesService } from '../../src/features/batteries/batteries.service.js';
import { createTestApp } from '../support/create-test-app.js';
import { createOwnerPrisma } from '../support/fixtures.js';
import { createAuthWorld, loggedIn, ORIGIN, SUPER_PASSWORD } from '../support/auth-world.js';
import type { AuthWorld, TestClient } from '../support/auth-world.js';

const DAY_MS = 86_400_000;
const plusDays = (days: number): string =>
  new Date(Date.parse(`${todayInIndia()}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);

describe('batteries', () => {
  let app: NestExpressApplication;
  let w: AuthWorld;
  let superAdmin: TestClient;
  let adminA: TestClient;
  let staffA: TestClient;
  let staffB: TestClient;
  let batteryItemId: string;
  let vehicleItemId: string;
  const owner = createOwnerPrisma();
  let counter = 0;
  const unique = (prefix: string): string =>
    `${prefix}${(counter += 1).toString().padStart(4, '0')}`;

  const decide = (client: TestClient, id: string, rowVersion: number) =>
    client.post(`/stock/adjustments/${id}/approve`, { rowVersion });

  /** A battery arrives the way the business receives it: Staff asks, a Super Admin approves. */
  const receive = async (
    over: {
      itemId?: string;
      serialNo?: string;
      manufacturedOn?: string;
      expiryOn?: string;
      warrantyMonths?: number;
      client?: TestClient;
    } = {},
  ): Promise<{ id: string; serialNo: string }> => {
    const serialNo = over.serialNo ?? unique('BAT');
    const { client = staffA, itemId = batteryItemId, ...dates } = over;
    const ask = await client.post('/stock/adjustments', {
      itemId,
      kind: 'IN',
      qty: 1,
      serialNo,
      reason: 'Received',
      ...dates,
    });
    expect(ask.status, JSON.stringify(ask.body)).toBe(201);
    const adjustment = StockAdjustmentSchema.parse(ask.body);
    const approved = await decide(superAdmin, adjustment.id, adjustment.rowVersion);
    expect(approved.status, JSON.stringify(approved.body)).toBe(200);
    const unit = await owner.serialUnit.findUniqueOrThrow({ where: { serialNo } });
    return { id: unit.id, serialNo };
  };
  const vehicle = (client: TestClient = staffA) => receive({ itemId: vehicleItemId, client });
  const quantity = async (itemId: string, branchId: string, state: string): Promise<number> =>
    (
      await owner.stockBalance.findUnique({
        where: { branchId_itemId_state: { branchId, itemId, state: state as 'AVAILABLE' } },
      })
    )?.quantity ?? 0;
  const drift = (itemId: string) =>
    owner.$queryRaw<
      { branch_id: string }[]
    >`SELECT branch_id FROM stock_balance_drift() WHERE item_id = ${itemId}::uuid`;
  const audits = (action: string, entityId: string) =>
    owner.auditLog.findMany({ where: { action, entityId } });
  const get = async (client: TestClient, id: string): Promise<Battery> => {
    const response = await client.get(`/batteries/${id}`);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return BatterySchema.parse(response.body);
  };

  beforeAll(async () => {
    w = await createAuthWorld(owner);
    const categoryId = (await owner.itemCategory.findFirstOrThrow({ where: { name: 'Vehicles' } }))
      .id;
    const make = (code: string) =>
      owner.item
        .create({
          data: { itemCode: code, name: code, categoryId, unitCode: 'PCS', isSerialized: true },
        })
        .then((item) => item.id);
    batteryItemId = await make('BATTERY-12V');
    vehicleItemId = await make('TOTO-FRAME');
    app = await createTestApp();
    superAdmin = await loggedIn(app, 'superadmin', SUPER_PASSWORD);
    adminA = await loggedIn(app, 'admin_a');
    staffA = await loggedIn(app, 'staff_a');
    staffB = await loggedIn(app, 'staff_b');
    return async () => {
      await app.close();
      await owner.$disconnect();
    };
  });

  describe('who may call what', () => {
    it('answers every endpoint with 401 when signed out', async () => {
      const id = w.serialA;
      const http = () => request(app.getHttpServer());
      const post = (path: string) => http().post(path).set('Origin', ORIGIN).send({});
      const attempts = [
        http().get('/batteries'),
        http().get('/batteries/alerts'),
        http().get(`/batteries/${id}`),
        http().patch(`/batteries/${id}`).set('Origin', ORIGIN).send({}),
        post(`/batteries/${id}/install`),
        post(`/batteries/${id}/uninstall`),
        post(`/batteries/${id}/sale-check`),
      ];
      for (const response of await Promise.all(attempts)) expect(response.status).toBe(401);
    });

    it('keeps a branch away from another branch’s batteries', async () => {
      const mine = await receive({ expiryOn: plusDays(100) });
      expect((await staffB.get(`/batteries/${mine.id}`)).status).toBe(404);
      const listed = BatteryListResponseSchema.parse(
        (await staffB.get(`/batteries?search=${mine.serialNo}`)).body,
      );
      expect(listed.items).toEqual([]);
      expect((await staffB.post(`/batteries/${mine.id}/sale-check`, {})).status).toBe(404);
      expect(
        (
          await staffB.patch(`/batteries/${mine.id}`, {
            manufacturedOn: null,
            expiryOn: null,
            warrantyMonths: null,
            warrantyEnd: null,
          })
        ).status,
      ).toBe(404);
    });
  });

  describe('a battery arriving with its dates', () => {
    it('creates the battery with the stock when the incoming request is approved', async () => {
      const made = plusDays(-30);
      const expires = plusDays(335);
      const unit = await receive({ manufacturedOn: made, expiryOn: expires, warrantyMonths: 18 });
      const battery = await get(staffA, unit.id);
      expect(battery).toMatchObject({
        serialNo: unit.serialNo,
        manufacturedOn: made,
        expiryOn: expires,
        warrantyMonths: 18,
        warrantyEnd: null,
        warrantyStatus: 'NONE',
        expiryStatus: 'OK',
        installedInSerialUnitId: null,
        state: 'AVAILABLE',
      });
    });

    it('makes no battery row when no dates were given', async () => {
      const unit = await receive();
      expect(await owner.battery.findUnique({ where: { serialUnitId: unit.id } })).toBeNull();
      expect(await get(staffA, unit.id)).toMatchObject({ expiryStatus: 'NONE', rowVersion: null });
    });

    it('refuses dates that make no sense, before anything is recorded', async () => {
      const ask = (over: object) =>
        staffA.post('/stock/adjustments', {
          itemId: batteryItemId,
          kind: 'IN',
          qty: 1,
          serialNo: unique('BAT'),
          reason: 'Received',
          ...over,
        });
      expect((await ask({ manufacturedOn: '2026-05-01', expiryOn: '2026-05-01' })).status).toBe(
        400,
      );
      expect((await ask({ manufacturedOn: '2026-05-01', expiryOn: '2026-04-01' })).status).toBe(
        400,
      );
      expect((await ask({ expiryOn: '2026-02-30' })).status).toBe(400);
      expect((await ask({ expiryOn: 'tomorrow' })).status).toBe(400);
      expect((await ask({ warrantyMonths: 121 })).status).toBe(400);
      expect((await ask({ warrantyMonths: -1 })).status).toBe(400);
      const noSerial = await staffA.post('/stock/adjustments', {
        itemId: batteryItemId,
        kind: 'IN',
        qty: 1,
        expiryOn: plusDays(5),
        reason: 'Received',
      });
      expect(noSerial.status).toBe(400);
    });

    it('refuses a serial number that already exists, and leaves the first battery alone', async () => {
      const first = await receive({ expiryOn: plusDays(200) });
      const again = await staffA.post('/stock/adjustments', {
        itemId: batteryItemId,
        kind: 'IN',
        qty: 1,
        serialNo: first.serialNo,
        expiryOn: plusDays(10),
        reason: 'Received twice',
      });
      expect(again.status).toBe(409);
      expect((await get(staffA, first.id)).expiryOn).toBe(plusDays(200));
    });
  });

  describe('recording and changing details', () => {
    it('records the dates once, then needs the version to change them, and audits both', async () => {
      const unit = await receive();
      const dates = {
        manufacturedOn: plusDays(-10),
        expiryOn: plusDays(355),
        warrantyMonths: 12,
        warrantyEnd: null,
      };
      const first = await staffA.patch(`/batteries/${unit.id}`, dates);
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      const recorded = BatterySchema.parse(first.body);
      expect(recorded).toMatchObject({ expiryOn: plusDays(355), warrantyMonths: 12 });
      expect(recorded.rowVersion).toBeGreaterThan(0);
      expect(await audits('BATTERY_DETAILS_RECORDED', unit.id)).toHaveLength(1);

      const noVersion = await staffA.patch(`/batteries/${unit.id}`, dates);
      expect(noVersion.status).toBe(409);
      const changed = await staffA.patch(`/batteries/${unit.id}`, {
        ...dates,
        expiryOn: plusDays(300),
        rowVersion: recorded.rowVersion,
      });
      expect(changed.status).toBe(200);
      expect(changed.body.expiryOn).toBe(plusDays(300));
      const [entry] = await audits('BATTERY_DETAILS_UPDATED', unit.id);
      expect(entry?.oldValue).toMatchObject({ expiryOn: plusDays(355) });
      expect(entry?.newValue).toMatchObject({ expiryOn: plusDays(300) });
      const stale = await staffA.patch(`/batteries/${unit.id}`, {
        ...dates,
        rowVersion: recorded.rowVersion,
      });
      expect(stale.status).toBe(409);
    });

    it('lets only one of two parallel first recordings succeed', async () => {
      const unit = await receive();
      const dates = {
        manufacturedOn: null,
        expiryOn: plusDays(90),
        warrantyMonths: null,
        warrantyEnd: null,
      };
      const results = await Promise.all([
        staffA.patch(`/batteries/${unit.id}`, dates),
        staffA.patch(`/batteries/${unit.id}`, dates),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 409]);
    });

    it('refuses impossible dates and clears dates that are set to null', async () => {
      const unit = await receive();
      const patch = (body: object) => staffA.patch(`/batteries/${unit.id}`, body);
      const base = {
        manufacturedOn: null,
        expiryOn: null,
        warrantyMonths: null,
        warrantyEnd: null,
      };
      expect(
        (await patch({ ...base, manufacturedOn: '2026-06-01', expiryOn: '2026-06-01' })).status,
      ).toBe(400);
      expect(
        (await patch({ ...base, manufacturedOn: '2026-06-01', warrantyEnd: '2026-05-31' })).status,
      ).toBe(400);
      expect((await patch({ ...base, warrantyMonths: 121 })).status).toBe(400);
      const set = await patch({ ...base, expiryOn: plusDays(40), warrantyEnd: plusDays(400) });
      const cleared = await patch({ ...base, rowVersion: set.body.rowVersion });
      expect(cleared.status).toBe(200);
      expect(cleared.body).toMatchObject({
        expiryOn: null,
        expiryStatus: 'NONE',
        warrantyEnd: null,
      });
    });

    it('answers 404 for an unknown unit', async () => {
      const response = await staffA.patch('/batteries/00000000-0000-4000-8000-000000000000', {
        manufacturedOn: null,
        expiryOn: null,
        warrantyMonths: null,
        warrantyEnd: null,
      });
      expect(response.status).toBe(404);
    });
  });

  describe('expiry and warranty status', () => {
    it('judges expiry and warranty by the calendar day in India, counting the last day as valid', async () => {
      const make = (expiryOn: string | null, warrantyEnd: string | null) =>
        receive().then(async (unit) => {
          await staffA.patch(`/batteries/${unit.id}`, {
            manufacturedOn: null,
            expiryOn,
            warrantyMonths: null,
            warrantyEnd,
          });
          return get(staffA, unit.id);
        });
      expect(await make(plusDays(-1), plusDays(-1))).toMatchObject({
        expiryStatus: 'EXPIRED',
        daysToExpiry: -1,
        warrantyStatus: 'ENDED',
      });
      expect(await make(plusDays(0), plusDays(0))).toMatchObject({
        expiryStatus: 'EXPIRING',
        daysToExpiry: 0,
        warrantyStatus: 'ACTIVE',
      });
      expect(await make(plusDays(30), null)).toMatchObject({
        expiryStatus: 'EXPIRING',
        daysToExpiry: 30,
      });
      expect(await make(plusDays(31), null)).toMatchObject({
        expiryStatus: 'OK',
        daysToExpiry: 31,
      });
      expect(await make(null, null)).toMatchObject({ expiryStatus: 'NONE', daysToExpiry: null });
    });
  });

  describe('the list and the alerts', () => {
    const tag = unique('LST');
    const ids: Record<string, string> = {};

    beforeAll(async () => {
      const spec: [string, string | null, string | null, number | null][] = [
        ['EXPIRED', plusDays(-5), plusDays(-2), 12],
        ['SOON', plusDays(10), plusDays(100), 12],
        ['LATER', plusDays(200), plusDays(300), null],
        ['PLAIN', null, null, null],
      ];
      for (const [name, expiryOn, warrantyEnd, months] of spec) {
        const unit = await receive({ serialNo: `${tag}-${name}` });
        await staffA.patch(`/batteries/${unit.id}`, {
          manufacturedOn: null,
          expiryOn,
          warrantyMonths: months,
          warrantyEnd,
        });
        ids[name] = unit.id;
      }
    });

    const serials = async (query: string): Promise<string[]> =>
      BatteryListResponseSchema.parse(
        (await staffA.get(`/batteries?search=${tag}&${query}`)).body,
      ).items.map((b) => b.serialNo.replace(`${tag}-`, ''));

    it('lists only units that have battery details, with batteries that have no expiry date always last', async () => {
      expect(await serials('')).toEqual(['EXPIRED', 'SOON', 'LATER', 'PLAIN']);
      expect(await serials('sortBy=expiryOn&sortOrder=desc')).toEqual([
        'LATER',
        'SOON',
        'EXPIRED',
        'PLAIN',
      ]);
      expect(await serials('sortBy=serialNo&sortOrder=asc')).toEqual([
        'EXPIRED',
        'LATER',
        'PLAIN',
        'SOON',
      ]);
    });

    it('filters by expiry, warranty and how far ahead to look', async () => {
      expect(await serials('expiry=expired')).toEqual(['EXPIRED']);
      expect(await serials('expiry=expiring')).toEqual(['SOON']);
      expect(await serials('expiry=expiring&withinDays=7')).toEqual([]);
      expect(await serials('expiry=expiring&withinDays=250')).toEqual(['SOON', 'LATER']);
      expect(await serials('expiry=ok')).toEqual(['LATER']);
      expect(await serials('expiry=none')).toEqual(['PLAIN']);
      expect(await serials('warranty=active')).toEqual(['SOON', 'LATER']);
      expect(await serials('warranty=ended')).toEqual(['EXPIRED']);
      expect(await serials('warranty=none')).toEqual(['PLAIN']);
    });

    it('filters by item, branch and state, and pages', async () => {
      expect(await serials(`itemId=${batteryItemId}&branchId=${w.branchA}`)).toHaveLength(4);
      expect(await serials(`branchId=${w.branchB}`)).toEqual([]);
      expect(await serials('state=SOLD')).toEqual([]);
      const page = BatteryListResponseSchema.parse(
        (await staffA.get(`/batteries?search=${tag}&pageSize=3&page=2`)).body,
      );
      expect(page).toMatchObject({ total: 4, totalPages: 2 });
      expect(page.items).toHaveLength(1);
    });

    it('treats % in a search as a plain character and rejects bad queries', async () => {
      expect(await serials('')).not.toEqual([]);
      const percent = BatteryListResponseSchema.parse(
        (await staffA.get('/batteries?search=%25')).body,
      );
      expect(percent.items).toEqual([]);
      expect((await staffA.get('/batteries?sortBy=password')).status).toBe(400);
      expect((await staffA.get('/batteries?expiry=soonish')).status).toBe(400);
      expect((await staffA.get('/batteries?withinDays=0')).status).toBe(400);
      expect((await staffA.get('/batteries?pageSize=1000')).status).toBe(400);
    });

    it('counts expired and expiring batteries still in stock, not sold ones, and only in the branches the user sees', async () => {
      const before = BatteryAlertsSchema.parse((await staffA.get('/batteries/alerts')).body);
      expect(before.withinDays).toBe(30);
      expect(before.expired).toBeGreaterThanOrEqual(1);
      await owner.serialUnit.update({
        where: { id: ids['EXPIRED'] ?? '' },
        data: { state: 'SOLD' },
      });
      const after = BatteryAlertsSchema.parse((await staffA.get('/batteries/alerts')).body);
      expect(after.expired).toBe(before.expired - 1);
      const wider = BatteryAlertsSchema.parse(
        (await staffA.get('/batteries/alerts?withinDays=250')).body,
      );
      const stockStates = [
        'AVAILABLE',
        'RESERVED',
        'IN_TRANSIT',
        'DAMAGED',
        'RETURNED',
        'QUARANTINE',
      ] as const;
      const midRange = await owner.battery.count({
        where: {
          expiryOn: {
            gt: new Date(`${plusDays(30)}T00:00:00Z`),
            lte: new Date(`${plusDays(250)}T00:00:00Z`),
          },
          serialUnit: { branchId: w.branchA, state: { in: [...stockStates] } },
        },
      });
      expect(midRange).toBeGreaterThanOrEqual(1);
      expect(wider.expiring).toBe(after.expiring + midRange);
      const other = BatteryAlertsSchema.parse((await staffB.get('/batteries/alerts')).body);
      expect(other).toMatchObject({ expired: 0, expiring: 0 });
    });
  });

  describe('selling an expired battery', () => {
    const expired = async () => {
      const unit = await receive({ expiryOn: plusDays(-3) });
      return unit.id;
    };

    it('passes a battery that is fine, has no dates, or expires today', async () => {
      const fine = await receive({ expiryOn: plusDays(100) });
      const bare = await receive();
      const today = await receive({ expiryOn: plusDays(0) });
      for (const unit of [fine, bare, today]) {
        const response = await staffA.post(`/batteries/${unit.id}/sale-check`, {});
        expect(response.status, JSON.stringify(response.body)).toBe(200);
        expect(response.body).toMatchObject({ ok: true, overridden: false });
      }
    });

    it('refuses an expired battery without an override and says when it expired', async () => {
      const id = await expired();
      const response = await staffA.post(`/batteries/${id}/sale-check`, {});
      expect(response.status).toBe(422);
      expect(response.body.message).toMatch(new RegExp(`expired on ${plusDays(-3)}`));
      expect(response.body.details[0].field).toBe('overrideReason');
    });

    it('lets Staff ask for an override but only a manager grant it, with a reason on record', async () => {
      const id = await expired();
      const staff = await staffA.post(`/batteries/${id}/sale-check`, {
        overrideReason: 'Customer insists',
      });
      expect(staff.status).toBe(403);
      expect(await audits('BATTERY_EXPIRY_OVERRIDDEN', id)).toHaveLength(0);
      const short = await adminA.post(`/batteries/${id}/sale-check`, { overrideReason: 'x' });
      expect(short.status).toBe(400);
      const manager = await adminA.post(`/batteries/${id}/sale-check`, {
        overrideReason: 'Sold at a discount to a scrap dealer',
      });
      expect(manager.status).toBe(200);
      expect(manager.body).toMatchObject({ overridden: true, expiryOn: plusDays(-3) });
      const [entry] = await audits('BATTERY_EXPIRY_OVERRIDDEN', id);
      expect(entry?.newValue).toMatchObject({
        reason: 'Sold at a discount to a scrap dealer',
        purpose: 'sold',
      });
      expect(entry?.actorId).toBe(w.users.adminA);
    });

    it('records no override when the battery was fine anyway', async () => {
      const unit = await receive({ expiryOn: plusDays(50) });
      const response = await adminA.post(`/batteries/${unit.id}/sale-check`, {
        overrideReason: 'Just in case',
      });
      expect(response.body.overridden).toBe(false);
      expect(await audits('BATTERY_EXPIRY_OVERRIDDEN', unit.id)).toHaveLength(0);
    });

    it('answers 404 for an unknown unit', async () => {
      expect(
        (await staffA.post('/batteries/00000000-0000-4000-8000-000000000000/sale-check', {}))
          .status,
      ).toBe(404);
    });
  });

  describe('warranty dates', () => {
    const run = <T>(
      work: (
        service: BatteriesService,
        tx: Parameters<Parameters<TransactionService['run']>[0]>[0],
      ) => Promise<T>,
    ): Promise<T> =>
      app
        .get(BranchContextService)
        .runAsSystem(() =>
          app.get(TransactionService).run((tx) => work(app.get(BatteriesService), tx)),
        );

    it('ends the warranty a number of calendar months after the sale, using the last day of a short month', async () => {
      const unit = await receive({ warrantyMonths: 1 });
      expect(await run((service, tx) => service.startWarranty(tx, unit.id, '2026-01-31'))).toBe(
        '2026-02-28',
      );
      expect((await get(staffA, unit.id)).warrantyEnd).toBe('2026-02-28');
      expect(await run((service, tx) => service.startWarranty(tx, unit.id, '2028-01-31'))).toBe(
        '2028-02-29',
      );
      const twelve = await receive({ warrantyMonths: 12 });
      expect(await run((service, tx) => service.startWarranty(tx, twelve.id, '2028-02-29'))).toBe(
        '2029-02-28',
      );
      const zero = await receive({ warrantyMonths: 0 });
      expect(await run((service, tx) => service.startWarranty(tx, zero.id, '2026-05-10'))).toBe(
        '2026-05-10',
      );
    });

    it('does nothing for a battery with no warranty months or no details', async () => {
      const none = await receive({ expiryOn: plusDays(10) });
      const bare = await receive();
      expect(
        await run((service, tx) => service.startWarranty(tx, none.id, '2026-05-10')),
      ).toBeNull();
      expect(
        await run((service, tx) => service.startWarranty(tx, bare.id, '2026-05-10')),
      ).toBeNull();
    });
  });

  describe('installing in a vehicle', () => {
    it('reserves the battery for the vehicle with a pair of ledger rows and records where it is', async () => {
      const battery = await receive({ expiryOn: plusDays(200) });
      const frame = await vehicle();
      const response = await staffA.post(`/batteries/${battery.id}/install`, {
        vehicleSerialUnitId: frame.id,
        installedOn: '2026-10-01',
      });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(BatterySchema.parse(response.body)).toMatchObject({
        state: 'RESERVED',
        installedInSerialUnitId: frame.id,
        installedInSerialNo: frame.serialNo,
        installedOn: '2026-10-01',
      });
      expect(await quantity(batteryItemId, w.branchA, 'RESERVED')).toBeGreaterThanOrEqual(1);
      const ledger = await owner.stockLedger.findMany({
        where: { serialUnitId: battery.id, movementType: 'STATE_CHANGE' },
      });
      expect(ledger.map((row) => [row.state, row.qtyDelta]).sort()).toEqual([
        ['AVAILABLE', -1],
        ['RESERVED', 1],
      ]);
      expect(ledger.every((row) => row.sourceDocType === 'BATTERY_INSTALLATION')).toBe(true);
      expect(await drift(batteryItemId)).toEqual([]);
      expect(await audits('BATTERY_INSTALLED', battery.id)).toHaveLength(1);
    });

    it('works for a battery that had no dates recorded, and defaults the date to today', async () => {
      const battery = await receive();
      const frame = await vehicle();
      const response = await staffA.post(`/batteries/${battery.id}/install`, {
        vehicleSerialUnitId: frame.id,
      });
      expect(response.status).toBe(200);
      expect(response.body.installedOn).toBe(todayInIndia());
    });

    it('refuses a battery that is already installed, installing in itself, and an unknown vehicle', async () => {
      const battery = await receive();
      const frame = await vehicle();
      await staffA.post(`/batteries/${battery.id}/install`, { vehicleSerialUnitId: frame.id });
      const second = await vehicle();
      const again = await staffA.post(`/batteries/${battery.id}/install`, {
        vehicleSerialUnitId: second.id,
      });
      expect(again.status).toBe(422);
      const self = await staffA.post(`/batteries/${battery.id}/install`, {
        vehicleSerialUnitId: battery.id,
      });
      expect(self.status).toBe(400);
      const ghost = await receive();
      const unknown = await staffA.post(`/batteries/${ghost.id}/install`, {
        vehicleSerialUnitId: '00000000-0000-4000-8000-000000000000',
      });
      expect(unknown.status).toBe(404);
      expect(
        (await staffA.post(`/batteries/${ghost.id}/install`, { vehicleSerialUnitId: 'nope' }))
          .status,
      ).toBe(400);
    });

    it('refuses a vehicle in another branch, a sold vehicle, and a battery that is not available', async () => {
      const battery = await receive();
      const elsewhere = await vehicle(staffB);
      expect(
        (
          await staffA.post(`/batteries/${battery.id}/install`, {
            vehicleSerialUnitId: elsewhere.id,
          })
        ).status,
      ).toBe(404);
      const crossBranch = await superAdmin.post(`/batteries/${battery.id}/install`, {
        vehicleSerialUnitId: elsewhere.id,
      });
      expect(crossBranch.status).toBe(422);
      expect(crossBranch.body.message).toMatch(/same branch/);

      const sold = await vehicle();
      await owner.serialUnit.update({ where: { id: sold.id }, data: { state: 'SOLD' } });
      expect(
        (await staffA.post(`/batteries/${battery.id}/install`, { vehicleSerialUnitId: sold.id }))
          .status,
      ).toBe(422);

      const damaged = await receive();
      await owner.serialUnit.update({ where: { id: damaged.id }, data: { state: 'DAMAGED' } });
      const frame = await vehicle();
      expect(
        (await staffA.post(`/batteries/${damaged.id}/install`, { vehicleSerialUnitId: frame.id }))
          .status,
      ).toBe(422);
      expect(await drift(batteryItemId)).toEqual([]);
    });

    it('needs a manager override to install an expired battery, and leaves stock alone when refused', async () => {
      const battery = await receive({ expiryOn: plusDays(-1) });
      const frame = await vehicle();
      const refused = await staffA.post(`/batteries/${battery.id}/install`, {
        vehicleSerialUnitId: frame.id,
      });
      expect(refused.status).toBe(422);
      expect((await get(staffA, battery.id)).state).toBe('AVAILABLE');
      const staffTry = await staffA.post(`/batteries/${battery.id}/install`, {
        vehicleSerialUnitId: frame.id,
        overrideReason: 'Needed today',
      });
      expect(staffTry.status).toBe(403);
      const manager = await adminA.post(`/batteries/${battery.id}/install`, {
        vehicleSerialUnitId: frame.id,
        overrideReason: 'Approved by the owner for a demo vehicle',
      });
      expect(manager.status, JSON.stringify(manager.body)).toBe(200);
      const [entry] = await audits('BATTERY_EXPIRY_OVERRIDDEN', battery.id);
      expect(entry?.newValue).toMatchObject({ purpose: 'installed' });
    });

    it('lets only one of two parallel installs of the same battery win', async () => {
      const battery = await receive();
      const one = await vehicle();
      const two = await vehicle();
      const results = await Promise.all([
        staffA.post(`/batteries/${battery.id}/install`, { vehicleSerialUnitId: one.id }),
        staffA.post(`/batteries/${battery.id}/install`, { vehicleSerialUnitId: two.id }),
      ]);
      expect(results.map((r) => r.status).sort()).toEqual([200, 422]);
      expect(await drift(batteryItemId)).toEqual([]);
      const rows = await owner.stockLedger.findMany({
        where: { serialUnitId: battery.id, movementType: 'STATE_CHANGE' },
      });
      expect(rows).toHaveLength(2);
    });
  });

  describe('taking a battery out of a vehicle', () => {
    it('puts it back in available stock with a pair of ledger rows', async () => {
      const battery = await receive();
      const frame = await vehicle();
      await staffA.post(`/batteries/${battery.id}/install`, { vehicleSerialUnitId: frame.id });
      const response = await staffA.post(`/batteries/${battery.id}/uninstall`, {});
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(BatterySchema.parse(response.body)).toMatchObject({
        state: 'AVAILABLE',
        installedInSerialUnitId: null,
        installedOn: null,
      });
      const rows = await owner.stockLedger.findMany({
        where: { serialUnitId: battery.id, movementType: 'STATE_CHANGE' },
      });
      expect(rows).toHaveLength(4);
      expect(await drift(batteryItemId)).toEqual([]);
      expect(await audits('BATTERY_UNINSTALLED', battery.id)).toHaveLength(1);
      const again = await staffA.post(`/batteries/${battery.id}/uninstall`, {});
      expect(again.status).toBe(422);
    });

    it('refuses a battery that is not installed, and one that has already been sold', async () => {
      const loose = await receive();
      expect((await staffA.post(`/batteries/${loose.id}/uninstall`, {})).status).toBe(422);
      const battery = await receive();
      const frame = await vehicle();
      await staffA.post(`/batteries/${battery.id}/install`, { vehicleSerialUnitId: frame.id });
      await owner.serialUnit.update({ where: { id: battery.id }, data: { state: 'SOLD' } });
      const response = await staffA.post(`/batteries/${battery.id}/uninstall`, {});
      expect(response.status).toBe(422);
      expect(response.body.message).toMatch(/left stock/);
    });
  });

  describe('database guards', () => {
    it('refuses battery rows that contradict themselves, even for the owner', async () => {
      const unit = await receive();
      const other = await receive();
      await expect(
        owner.battery.create({
          data: { serialUnitId: unit.id, installedOn: new Date('2026-10-01') },
        }),
      ).rejects.toThrow();
      await owner.battery.deleteMany({ where: { serialUnitId: unit.id } });
      await expect(
        owner.battery.create({
          data: {
            serialUnitId: unit.id,
            installedInSerialUnitId: unit.id,
            installedOn: new Date('2026-10-01'),
          },
        }),
      ).rejects.toThrow();
      await expect(
        owner.battery.create({ data: { serialUnitId: other.id, warrantyMonths: 121 } }),
      ).rejects.toThrow();
      await expect(
        owner.battery.create({
          data: {
            serialUnitId: other.id,
            manufacturedOn: new Date('2026-06-01'),
            expiryOn: new Date('2026-06-01'),
          },
        }),
      ).rejects.toThrow();
    });
  });
});
