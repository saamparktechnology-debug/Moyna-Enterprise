//apps/api/test/integration/assembly.int.test.ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AssemblyListResponseSchema, AssemblySchema, ItemSchema } from '@erp/contracts';
import type { Assembly } from '@erp/contracts';
import { beforeAll, describe, expect, it } from 'vitest';
import { addUser, createAuthWorld, loggedIn, SUPER_PASSWORD } from '../support/auth-world.js';
import type { AuthWorld, TestClient } from '../support/auth-world.js';
import { createTestApp } from '../support/create-test-app.js';
import { createOwnerPrisma } from '../support/fixtures.js';

describe('assembling a product from our own stock', () => {
  let app: NestExpressApplication;
  let w: AuthWorld;
  let superAdmin: TestClient;
  let adminA: TestClient;
  let staffA: TestClient;
  let categoryId: string;
  const owner = createOwnerPrisma();
  let counter = 0;
  const unique = (prefix: string): string =>
    `${prefix}${(counter += 1).toString().padStart(4, '0')}`;

  const item = async (over: object = {}): Promise<string> =>
    (
      await owner.item.create({
        data: {
          itemCode: unique('AS'),
          name: 'Assembly test item',
          categoryId,
          unitCode: 'PCS',
          isSerialized: false,
          ...over,
        },
      })
    ).id;
  const stocked = async (itemId: string, qty: number, branchId = w.branchA): Promise<void> => {
    await owner.stockBalance.upsert({
      where: { branchId_itemId_state: { branchId, itemId, state: 'AVAILABLE' } },
      create: { branchId, itemId, state: 'AVAILABLE', quantity: qty },
      update: { quantity: { increment: qty } },
    });
  };
  const unit = async (itemId: string, serialNo: string, battery = false): Promise<string> => {
    const row = await owner.serialUnit.create({
      data: { branchId: w.branchA, itemId, serialNo, state: 'AVAILABLE' },
    });
    await stocked(itemId, 1);
    if (battery) await owner.battery.create({ data: { serialUnitId: row.id } });
    return row.id;
  };
  const available = async (itemId: string, branchId = w.branchA): Promise<number> =>
    (
      await owner.stockBalance.findUnique({
        where: { branchId_itemId_state: { branchId, itemId, state: 'AVAILABLE' } },
      })
    )?.quantity ?? 0;
  const assemble = (client: TestClient, body: Record<string, unknown>) =>
    client.post('/assemblies', { sellingPrice: '95000', ...body });
  const made = async (client: TestClient, body: Record<string, unknown>): Promise<Assembly> => {
    const response = await assemble(client, body);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return AssemblySchema.parse(response.body);
  };

  beforeAll(async () => {
    w = await createAuthWorld(owner);
    categoryId = (await owner.itemCategory.findFirstOrThrow({ where: { name: 'Vehicles' } })).id;
    app = await createTestApp();
    superAdmin = await loggedIn(app, 'superadmin', SUPER_PASSWORD);
    adminA = await loggedIn(app, 'admin_a');
    staffA = await loggedIn(app, 'staff_a');
    return async () => {
      await app.close();
      await owner.$disconnect();
    };
  });

  describe('a product counted by quantity', () => {
    it('takes the parts out of stock, brings the product in, sets its selling price and writes the ledger', async () => {
      const tyre = await item();
      const frame = await item();
      const kit = await item();
      await stocked(tyre, 10);
      await stocked(frame, 3);
      const assembly = await made(superAdmin, {
        finishedItemId: kit,
        qty: 2,
        sellingPrice: '1250.50',
        note: 'Two kits for the weekend',
        parts: [
          { itemId: tyre, qty: 8 },
          { itemId: frame, qty: 2 },
        ],
      });
      expect(assembly.assemblyNo).toMatch(/^AS-\d{12}$/);
      expect(assembly).toMatchObject({ qty: 2, sellingPrice: '1250.50', units: [] });
      expect(assembly.parts.map((part) => part.qty).sort()).toEqual([2, 8]);
      expect(await available(tyre)).toBe(2);
      expect(await available(frame)).toBe(1);
      expect(await available(kit)).toBe(2);
      const ledger = await owner.stockLedger.findMany({
        where: { sourceDocId: assembly.id },
        orderBy: { qtyDelta: 'asc' },
      });
      expect(ledger.map((row) => [row.movementType, row.qtyDelta])).toEqual([
        ['ASSEMBLY_USED', -8],
        ['ASSEMBLY_USED', -2],
        ['ASSEMBLY_MADE', 2],
      ]);
      const priced = await owner.item.findUniqueOrThrow({ where: { id: kit } });
      expect(priced.sellingPrice?.toFixed(2)).toBe('1250.50');
      const audits = await owner.auditLog.findMany({
        where: { action: 'ASSEMBLY_CREATED', entityId: assembly.id },
      });
      expect(audits).toHaveLength(1);
    });

    it('shows the selling price on the item, and lists and finds the assembly', async () => {
      const part = await item();
      const product = await item();
      await stocked(part, 5);
      const assembly = await made(superAdmin, {
        finishedItemId: product,
        sellingPrice: '700',
        parts: [{ itemId: part, qty: 1 }],
      });
      const shown = ItemSchema.parse((await superAdmin.get(`/items/${product}`)).body);
      expect(shown.sellingPrice).toBe('700.00');
      const found = AssemblyListResponseSchema.parse(
        (await superAdmin.get(`/assemblies?search=${encodeURIComponent(assembly.assemblyNo)}`))
          .body,
      );
      expect(found.items.map((row) => row.id)).toEqual([assembly.id]);
      const detail = AssemblySchema.parse(
        (await superAdmin.get(`/assemblies/${assembly.id}`)).body,
      );
      expect(detail.parts[0]).toMatchObject({ itemId: part, qty: 1 });
    });

    it('changes nothing when a part is short: no stock moves, no assembly, no price', async () => {
      const part = await item();
      const other = await item();
      const product = await item();
      await stocked(part, 5);
      await stocked(other, 1);
      const response = await assemble(superAdmin, {
        finishedItemId: product,
        parts: [
          { itemId: part, qty: 2 },
          { itemId: other, qty: 4 },
        ],
      });
      expect(response.status).toBe(422);
      expect(await available(part)).toBe(5);
      expect(await available(other)).toBe(1);
      expect(await available(product)).toBe(0);
      expect(await owner.assembly.count({ where: { finishedItemId: product } })).toBe(0);
      expect(
        (await owner.item.findUniqueOrThrow({ where: { id: product } })).sellingPrice,
      ).toBeNull();
    });
  });

  describe('a vehicle tracked by serial number', () => {
    it('is made one at a time with its numbers, the numbered parts become installed, and a battery is recorded in it', async () => {
      const batteryItem = await item({ isSerialized: true });
      const motorItem = await item({ isSerialized: true });
      const tyre = await item();
      const vehicle = await item({ isSerialized: true });
      const battery = await unit(batteryItem, unique('BAT-'), true);
      const motor = await unit(motorItem, unique('MTR-'));
      await stocked(tyre, 4);
      const serialNo = unique('CH-');
      const assembly = await made(superAdmin, {
        finishedItemId: vehicle,
        sellingPrice: '150000',
        units: [{ serialNo, chassisNo: serialNo, motorNo: unique('MN-') }],
        parts: [
          { itemId: batteryItem, qty: 1, serialUnitIds: [battery] },
          { itemId: motorItem, qty: 1, serialUnitIds: [motor] },
          { itemId: tyre, qty: 4 },
        ],
      });
      expect(assembly.units).toHaveLength(1);
      expect(assembly.units[0]).toMatchObject({ serialNo, chassisNo: serialNo });
      expect(assembly.parts.find((part) => part.itemId === batteryItem)?.serialNos).toHaveLength(1);
      const newUnit = await owner.serialUnit.findFirstOrThrow({ where: { serialNo } });
      expect(newUnit.state).toBe('AVAILABLE');
      expect(newUnit.motorNo).not.toBeNull();
      expect(await available(vehicle)).toBe(1);
      for (const id of [battery, motor])
        expect((await owner.serialUnit.findUniqueOrThrow({ where: { id } })).state).toBe(
          'INSTALLED',
        );
      expect(await available(batteryItem)).toBe(0);
      const installed = await owner.battery.findUniqueOrThrow({ where: { serialUnitId: battery } });
      expect(installed.installedInSerialUnitId).toBe(newUnit.id);
      expect(installed.installedOn).not.toBeNull();
    });

    it('refuses a numbered product made in twos, one with no number, a number already used, and a numbered part with no unit chosen', async () => {
      const vehicle = await item({ isSerialized: true });
      const part = await item();
      const batteryItem = await item({ isSerialized: true });
      await stocked(part, 10);
      const twice = await assemble(superAdmin, {
        finishedItemId: vehicle,
        qty: 2,
        units: [{ serialNo: unique('CH-') }],
        parts: [{ itemId: part, qty: 1 }],
      });
      expect(twice.status).toBe(400);
      const none = await assemble(superAdmin, {
        finishedItemId: vehicle,
        parts: [{ itemId: part, qty: 1 }],
      });
      expect(none.status).toBe(400);
      const taken = unique('CH-');
      await made(superAdmin, {
        finishedItemId: vehicle,
        units: [{ serialNo: taken }],
        parts: [{ itemId: part, qty: 1 }],
      });
      const again = await assemble(superAdmin, {
        finishedItemId: vehicle,
        units: [{ serialNo: taken }],
        parts: [{ itemId: part, qty: 1 }],
      });
      expect(again.status).toBe(409);
      const stockBefore = await available(part);
      const noUnit = await assemble(superAdmin, {
        finishedItemId: vehicle,
        units: [{ serialNo: unique('CH-') }],
        parts: [{ itemId: batteryItem, qty: 1 }],
      });
      expect(noUnit.status).toBe(400);
      expect(await available(part)).toBe(stockBefore);
    });

    it('cannot use a serial unit twice, one that is not in stock, or one in another branch', async () => {
      const batteryItem = await item({ isSerialized: true });
      const part = await item();
      await stocked(part, 10);
      const used = await unit(batteryItem, unique('BAT-'));
      await made(superAdmin, {
        finishedItemId: await item(),
        parts: [{ itemId: batteryItem, qty: 1, serialUnitIds: [used] }],
      });
      const reuse = await assemble(superAdmin, {
        finishedItemId: await item(),
        parts: [{ itemId: batteryItem, qty: 1, serialUnitIds: [used] }],
      });
      expect(reuse.status).toBe(400);
      const elsewhere = await owner.serialUnit.create({
        data: {
          branchId: w.branchB,
          itemId: batteryItem,
          serialNo: unique('BAT-'),
          state: 'AVAILABLE',
        },
      });
      const wrongBranch = await assemble(superAdmin, {
        finishedItemId: await item(),
        parts: [{ itemId: batteryItem, qty: 1, serialUnitIds: [elsewhere.id] }],
      });
      expect(wrongBranch.status).toBe(400);
    });

    it('never sells an installed unit again', async () => {
      const batteryItem = await item({ isSerialized: true });
      const part = await item();
      await stocked(part, 3);
      const battery = await unit(batteryItem, unique('BAT-'));
      await made(superAdmin, {
        finishedItemId: await item(),
        parts: [
          { itemId: part, qty: 1 },
          { itemId: batteryItem, qty: 1, serialUnitIds: [battery] },
        ],
      });
      const customer = await owner.customer.create({
        data: { name: unique('Buyer '), phone: `7${(counter += 1).toString().padStart(9, '0')}` },
      });
      const sold = await staffA.post('/invoices', {
        customerId: customer.id,
        type: 'NON_GST',
        lines: [{ itemId: batteryItem, qty: 1, unitPrice: '1000', serialUnitId: battery }],
      });
      expect(sold.status).toBe(400);
    });
  });

  describe('the rules for what may be assembled', () => {
    it('refuses a product made from itself, a part listed twice, no parts, no price and unknown items', async () => {
      const part = await item();
      const product = await item();
      await stocked(part, 5);
      const same = await assemble(superAdmin, {
        finishedItemId: part,
        parts: [{ itemId: part, qty: 1 }],
      });
      expect(same.status).toBe(400);
      const twice = await assemble(superAdmin, {
        finishedItemId: product,
        parts: [
          { itemId: part, qty: 1 },
          { itemId: part, qty: 1 },
        ],
      });
      expect(twice.status).toBe(400);
      expect((await assemble(superAdmin, { finishedItemId: product, parts: [] })).status).toBe(400);
      for (const sellingPrice of ['0', '', 'abc', '-5']) {
        const response = await assemble(superAdmin, {
          finishedItemId: product,
          sellingPrice,
          parts: [{ itemId: part, qty: 1 }],
        });
        expect(response.status, sellingPrice).toBe(400);
      }
      const ghost = await assemble(superAdmin, {
        finishedItemId: '0b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59',
        parts: [{ itemId: part, qty: 1 }],
      });
      expect(ghost.status).toBe(400);
      expect(await available(part)).toBe(5);
    });

    it('cannot use a switched-off item as a part or as the product', async () => {
      const off = await item({ isActive: false });
      const part = await item();
      await stocked(part, 2);
      const asPart = await assemble(superAdmin, {
        finishedItemId: await item(),
        parts: [{ itemId: off, qty: 1 }],
      });
      expect(asPart.status).toBe(400);
      const asProduct = await assemble(superAdmin, {
        finishedItemId: off,
        parts: [{ itemId: part, qty: 1 }],
      });
      expect(asProduct.status).toBe(400);
    });

    it('stays in one branch: a Super Admin chooses it, and parts in another branch do not count', async () => {
      const part = await item();
      const product = await item();
      await stocked(part, 5, w.branchB);
      const refused = await assemble(superAdmin, {
        branchId: w.branchA,
        finishedItemId: product,
        parts: [{ itemId: part, qty: 1 }],
      });
      expect(refused.status).toBe(422);
      const done = await made(superAdmin, {
        branchId: w.branchB,
        finishedItemId: product,
        parts: [{ itemId: part, qty: 2 }],
      });
      expect(done.branchId).toBe(w.branchB);
      expect(await available(part, w.branchB)).toBe(3);
      expect(await available(product, w.branchB)).toBe(1);
      expect(await available(product, w.branchA)).toBe(0);
    });
  });

  describe('who may assemble', () => {
    it('is for the Super Admin: an Admin and staff are refused until a role is given the permission', async () => {
      const part = await item();
      const product = await item();
      await stocked(part, 20);
      const body = { finishedItemId: product, parts: [{ itemId: part, qty: 1 }] };
      expect((await assemble(adminA, body)).status).toBe(403);
      expect((await adminA.get('/assemblies')).status).toBe(403);
      expect((await assemble(staffA, body)).status).toBe(403);

      const role = await owner.role.findFirstOrThrow({ where: { name: 'ADMIN' } });
      const permission = await owner.permission.findFirstOrThrow({
        where: { code: 'manufacturing.manage' },
      });
      await owner.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
      try {
        const allowed = await loggedIn(app, 'admin_a');
        const response = await assemble(allowed, body);
        expect(response.status, JSON.stringify(response.body)).toBe(201);
        expect((await allowed.get('/assemblies')).status).toBe(200);
        expect((await assemble(staffA, body)).status).toBe(403);
      } finally {
        await owner.rolePermission.delete({
          where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        });
      }
    });
  });

  describe('what the parts cost, and the profit', () => {
    it('adds up the parts at their purchase prices: the real ones for a Super Admin, the shown ones for everyone else', async () => {
      const tyre = await item({ actualPurchasePrice: '300', displayPurchasePrice: '400' });
      const frame = await item({ actualPurchasePrice: '1000', displayPurchasePrice: '1500' });
      const kit = await item();
      await stocked(tyre, 10);
      await stocked(frame, 10);
      const assembly = await made(superAdmin, {
        finishedItemId: kit,
        qty: 2,
        sellingPrice: '5000',
        parts: [
          { itemId: tyre, qty: 4 },
          { itemId: frame, qty: 1 },
        ],
      });
      // real: 4 x 300 + 1000 = 2200, profit 2 x 5000 - 2200 = 7800
      expect(assembly).toMatchObject({ costTotal: '2200.00', profit: '7800.00' });
      const role = await owner.role.findFirstOrThrow({ where: { name: 'ADMIN' } });
      const permission = await owner.permission.findFirstOrThrow({
        where: { code: 'manufacturing.manage' },
      });
      await owner.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
      try {
        const allowed = await loggedIn(app, 'admin_a');
        const shown = AssemblySchema.parse((await allowed.get(`/assemblies/${assembly.id}`)).body);
        // shown: 4 x 400 + 1500 = 3100, profit 10000 - 3100 = 6900
        expect(shown).toMatchObject({ costTotal: '3100.00', profit: '6900.00' });
        expect(JSON.stringify(shown)).not.toContain('2200.00');
      } finally {
        await owner.rolePermission.delete({
          where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
        });
      }
    });

    it('gives no cost or profit when a part has no purchase price', async () => {
      const priced = await item({ actualPurchasePrice: '300', displayPurchasePrice: '400' });
      const bare = await item();
      await stocked(priced, 5);
      await stocked(bare, 5);
      const assembly = await made(superAdmin, {
        finishedItemId: await item(),
        sellingPrice: '900',
        parts: [
          { itemId: priced, qty: 1 },
          { itemId: bare, qty: 1 },
        ],
      });
      expect(assembly.costTotal).toBeNull();
      expect(assembly.profit).toBeNull();
    });

    it('keeps the cost as it was, when a purchase price changes later', async () => {
      const part = await item({ actualPurchasePrice: '100', displayPurchasePrice: '120' });
      await stocked(part, 5);
      const assembly = await made(superAdmin, {
        finishedItemId: await item(),
        sellingPrice: '500',
        parts: [{ itemId: part, qty: 2 }],
      });
      await owner.item.update({
        where: { id: part },
        data: { actualPurchasePrice: '999', displayPurchasePrice: '999' },
      });
      const again = AssemblySchema.parse((await superAdmin.get(`/assemblies/${assembly.id}`)).body);
      expect(again.costTotal).toBe('200.00');
    });
  });

  describe('making the product on the spot', () => {
    const newItem = (over: object = {}) => ({
      itemCode: unique('nw-'),
      name: 'Brand new kit',
      categoryId,
      unitCode: 'PCS',
      ...over,
    });

    it('creates the item and assembles it in one go', async () => {
      const part = await item();
      await stocked(part, 5);
      const spec = newItem({ hsnCode: '8703', taxRate: '5' });
      const assembly = await made(superAdmin, {
        newItem: spec,
        sellingPrice: '2000',
        parts: [{ itemId: part, qty: 2 }],
      });
      expect(assembly.finishedItemCode).toBe(spec.itemCode.toUpperCase());
      const created = await owner.item.findFirstOrThrow({
        where: { itemCode: spec.itemCode.toUpperCase() },
      });
      expect(created).toMatchObject({ isSerialized: false, hsnCode: '8703' });
      expect(created.sellingPrice?.toFixed(2)).toBe('2000.00');
      expect(await available(created.id)).toBe(1);
    });

    it('creates a numbered product too, made one at a time with its number', async () => {
      const part = await item();
      await stocked(part, 5);
      const spec = newItem({ isSerialized: true });
      const serialNo = unique('CH-');
      const assembly = await made(superAdmin, {
        newItem: spec,
        sellingPrice: '90000',
        units: [{ serialNo }],
        parts: [{ itemId: part, qty: 1 }],
      });
      expect(assembly.units[0]?.serialNo).toBe(serialNo);
    });

    it('creates nothing when the assembly fails, and refuses a code that exists', async () => {
      const part = await item();
      await stocked(part, 1);
      const spec = newItem();
      const short = await assemble(superAdmin, {
        newItem: spec,
        parts: [{ itemId: part, qty: 9 }],
      });
      expect(short.status).toBe(422);
      expect(await owner.item.count({ where: { itemCode: spec.itemCode.toUpperCase() } })).toBe(0);
      const taken = await owner.item.create({
        data: { itemCode: unique('TK'), name: 'Taken', categoryId, unitCode: 'PCS' },
      });
      const clash = await assemble(superAdmin, {
        newItem: newItem({ itemCode: taken.itemCode }),
        parts: [{ itemId: part, qty: 1 }],
      });
      expect(clash.status).toBe(409);
    });

    it('needs either an existing product or a new one, not both and not neither', async () => {
      const part = await item();
      await stocked(part, 5);
      const parts = [{ itemId: part, qty: 1 }];
      expect((await assemble(superAdmin, { parts })).status).toBe(400);
      expect(
        (await assemble(superAdmin, { finishedItemId: await item(), newItem: newItem(), parts }))
          .status,
      ).toBe(400);
      expect(
        (await assemble(superAdmin, { newItem: newItem({ categoryId: 'x' }), parts })).status,
      ).toBe(400);
    });

    it('is only for someone who may create items', async () => {
      const part = await item();
      await stocked(part, 5);
      expect(
        (
          await superAdmin.post('/roles', {
            name: 'Assembler',
            tier: 'STAFF',
            permissionCodes: ['manufacturing.manage', 'items.view', 'stock.view'],
          })
        ).status,
      ).toBe(201);
      await addUser(owner, { username: 'assembler_1', role: 'Assembler', branchIds: [w.branchA] });
      const assembler = await loggedIn(app, 'assembler_1');
      const refused = await assemble(assembler, {
        newItem: newItem(),
        parts: [{ itemId: part, qty: 1 }],
      });
      expect(refused.status).toBe(403);
      const existing = await assemble(assembler, {
        finishedItemId: await item(),
        parts: [{ itemId: part, qty: 1 }],
      });
      expect(existing.status, JSON.stringify(existing.body)).toBe(201);
    });
  });

  describe('reversing an assembly', () => {
    const reverse = (client: TestClient, id: string, reason = 'Made by mistake') =>
      client.post(`/assemblies/${id}/reverse`, { reason });

    it('puts the parts back, takes the product out, restores the price and marks the assembly reversed', async () => {
      const part = await item();
      const product = await item({ sellingPrice: '400' });
      await stocked(part, 10);
      const assembly = await made(superAdmin, {
        finishedItemId: product,
        qty: 2,
        sellingPrice: '900',
        parts: [{ itemId: part, qty: 6 }],
      });
      expect(await available(part)).toBe(4);
      const response = await reverse(superAdmin, assembly.id);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const done = AssemblySchema.parse(response.body);
      expect(done.reversed).toMatchObject({ reason: 'Made by mistake' });
      expect(await available(part)).toBe(10);
      expect(await available(product)).toBe(0);
      expect(
        (await owner.item.findUniqueOrThrow({ where: { id: product } })).sellingPrice?.toFixed(2),
      ).toBe('400.00');
      const ledger = await owner.stockLedger.findMany({
        where: {
          sourceDocId: assembly.id,
          movementType: { in: ['ASSEMBLY_RETURNED', 'ASSEMBLY_UNMADE'] },
        },
      });
      expect(ledger.map((row) => [row.movementType, row.qtyDelta]).sort()).toEqual([
        ['ASSEMBLY_RETURNED', 6],
        ['ASSEMBLY_UNMADE', -2],
      ]);
      const audits = await owner.auditLog.findMany({
        where: { action: 'ASSEMBLY_REVERSED', entityId: assembly.id },
      });
      expect(audits).toHaveLength(1);
    });

    it('cannot be reversed twice, without a reason, or by someone who may not assemble', async () => {
      const part = await item();
      await stocked(part, 5);
      const assembly = await made(superAdmin, {
        finishedItemId: await item(),
        parts: [{ itemId: part, qty: 1 }],
      });
      expect((await reverse(superAdmin, assembly.id, '')).status).toBe(400);
      expect((await reverse(adminA, assembly.id)).status).toBe(403);
      expect((await reverse(superAdmin, assembly.id)).status).toBe(200);
      expect((await reverse(superAdmin, assembly.id)).status).toBe(409);
      expect(await available(part)).toBe(5);
    });

    it('is refused once the product has been used: no stock moves', async () => {
      const part = await item();
      const product = await item();
      await stocked(part, 5);
      const assembly = await made(superAdmin, {
        finishedItemId: product,
        qty: 2,
        parts: [{ itemId: part, qty: 3 }],
      });
      await owner.stockBalance.update({
        where: {
          branchId_itemId_state: { branchId: w.branchA, itemId: product, state: 'AVAILABLE' },
        },
        data: { quantity: 1 },
      });
      const response = await reverse(superAdmin, assembly.id);
      expect(response.status).toBe(422);
      expect(await available(part)).toBe(2);
      expect(await owner.assemblyReversal.count({ where: { assemblyId: assembly.id } })).toBe(0);
    });

    it('takes a numbered product and its numbered parts apart: the vehicle is scrapped, the parts are available and the battery is no longer installed', async () => {
      const batteryItem = await item({ isSerialized: true });
      const vehicle = await item({ isSerialized: true });
      const part = await item();
      await stocked(part, 2);
      const battery = await unit(batteryItem, unique('BAT-'), true);
      const serialNo = unique('CH-');
      const assembly = await made(superAdmin, {
        finishedItemId: vehicle,
        units: [{ serialNo }],
        parts: [
          { itemId: part, qty: 1 },
          { itemId: batteryItem, qty: 1, serialUnitIds: [battery] },
        ],
      });
      const response = await reverse(superAdmin, assembly.id);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect((await owner.serialUnit.findFirstOrThrow({ where: { serialNo } })).state).toBe(
        'SCRAPPED',
      );
      expect((await owner.serialUnit.findUniqueOrThrow({ where: { id: battery } })).state).toBe(
        'AVAILABLE',
      );
      const installed = await owner.battery.findUniqueOrThrow({ where: { serialUnitId: battery } });
      expect(installed.installedInSerialUnitId).toBeNull();
      expect(await available(batteryItem)).toBe(1);
      expect(await available(vehicle)).toBe(0);
    });

    it('is refused when the vehicle made has been sold', async () => {
      const vehicle = await item({ isSerialized: true });
      const part = await item();
      await stocked(part, 2);
      const serialNo = unique('CH-');
      const assembly = await made(superAdmin, {
        finishedItemId: vehicle,
        units: [{ serialNo }],
        parts: [{ itemId: part, qty: 1 }],
      });
      await owner.serialUnit.updateMany({ where: { serialNo }, data: { state: 'SOLD' } });
      const response = await reverse(superAdmin, assembly.id);
      expect(response.status).toBe(422);
      expect(response.body.message).toContain('already been sold or moved');
      expect(await available(part)).toBe(1);
    });

    it('leaves a price someone changed since alone', async () => {
      const part = await item();
      const product = await item();
      await stocked(part, 2);
      const assembly = await made(superAdmin, {
        finishedItemId: product,
        sellingPrice: '900',
        parts: [{ itemId: part, qty: 1 }],
      });
      await owner.item.update({ where: { id: product }, data: { sellingPrice: '1100' } });
      await reverse(superAdmin, assembly.id);
      expect(
        (await owner.item.findUniqueOrThrow({ where: { id: product } })).sellingPrice?.toFixed(2),
      ).toBe('1100.00');
    });
  });
});
