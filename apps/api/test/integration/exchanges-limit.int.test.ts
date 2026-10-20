import type { NestExpressApplication } from '@nestjs/platform-express';
import { ExchangeSchema, InvoiceSchema, todayInIndia } from '@erp/contracts';
import { beforeAll, describe, expect, it } from 'vitest';
import { addUser, createAuthWorld, loggedIn, SUPER_PASSWORD } from '../support/auth-world.js';
import type { AuthWorld, TestClient } from '../support/auth-world.js';
import { createTestApp } from '../support/create-test-app.js';
import { createOwnerPrisma } from '../support/fixtures.js';
import { testEnv } from '../support/test-env.js';

const LIMIT = '30000';

describe('the approval limit on exchanges', () => {
  let app: NestExpressApplication;
  let w: AuthWorld;
  let superAdmin: TestClient;
  let adminA: TestClient;
  let adminA2: TestClient;
  let staffA: TestClient;
  const owner = createOwnerPrisma();
  let counter = 0;
  const unique = (prefix: string): string =>
    `${prefix}${Date.now().toString(36)}${(counter += 1)}`.toUpperCase();
  let categoryId = '';

  /** A customer who bought a vehicle for 60000 and is now buying another; returns what an exchange needs. */
  const scene = async () => {
    const customerId = (
      await owner.customer.create({
        data: { name: unique('Owner '), phone: `9${Date.now().toString().slice(-9)}` },
      })
    ).id;
    const model = await owner.item.create({
      data: {
        itemCode: unique('LIM-'),
        name: 'Limit test vehicle',
        categoryId,
        unitCode: 'PCS',
        isSerialized: true,
      },
    });
    const unit = async () => {
      const made = await owner.serialUnit.create({
        data: { branchId: w.branchA, itemId: model.id, serialNo: unique('SN'), state: 'AVAILABLE' },
      });
      await owner.stockBalance.upsert({
        where: {
          branchId_itemId_state: { branchId: w.branchA, itemId: model.id, state: 'AVAILABLE' },
        },
        create: { branchId: w.branchA, itemId: model.id, state: 'AVAILABLE', quantity: 1 },
        update: { quantity: { increment: 1 } },
      });
      await owner.stockLedger.create({
        data: {
          branchId: w.branchA,
          itemId: model.id,
          serialUnitId: made.id,
          state: 'AVAILABLE',
          qtyDelta: 1,
          movementType: 'OPENING_BALANCE',
        },
      });
      return made;
    };
    const sell = async (serialUnitId: string, price: string) => {
      const created = await staffA.post('/invoices', {
        customerId,
        type: 'NON_GST',
        lines: [
          { itemId: model.id, qty: 1, unitPrice: price, discountAmount: '0.00', serialUnitId },
        ],
      });
      const draft = InvoiceSchema.parse(created.body);
      return InvoiceSchema.parse(
        (await staffA.post(`/invoices/${draft.id}/issue`, { rowVersion: draft.rowVersion })).body,
      );
    };
    const oldUnit = await unit();
    const newUnit = await unit();
    await sell(oldUnit.id, '60000.00');
    const delivery = await sell(newUnit.id, '90000.00');
    return { oldUnit, newUnit, delivery };
  };
  const ask = async (s: Awaited<ReturnType<typeof scene>>, valuationAmount: string) => {
    const response = await staffA.post('/exchanges', {
      invoiceId: s.delivery.id,
      newSerialUnitId: s.newUnit.id,
      oldSerialUnitId: s.oldUnit.id,
      kind: 'OLD_FOR_NEW',
      valuationAmount,
      disposition: 'STOCK',
      reason: 'Customer wants the newer model',
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return ExchangeSchema.parse(response.body);
  };
  const approve = (client: TestClient, e: { id: string; rowVersion: number }) =>
    client.post(`/exchanges/${e.id}/approve`, { rowVersion: e.rowVersion });

  beforeAll(async () => {
    w = await createAuthWorld(owner);
    categoryId = (await owner.itemCategory.findFirstOrThrow({ where: { name: 'Vehicles' } })).id;
    app = await createTestApp({ env: { ...testEnv(), EXCHANGE_ADMIN_APPROVAL_LIMIT: LIMIT } });
    superAdmin = await loggedIn(app, 'superadmin', SUPER_PASSWORD);
    adminA = await loggedIn(app, 'admin_a');
    staffA = await loggedIn(app, 'staff_a');
    await addUser(owner, { username: 'limit_admin2', role: 'ADMIN', branchIds: [w.branchA] });
    adminA2 = await loggedIn(app, 'limit_admin2');
    void todayInIndia;
    return async () => {
      await app.close();
      await owner.$disconnect();
    };
  });

  it('lets an Admin approve an exchange valued at or under the limit', async () => {
    const s = await scene();
    const exchange = await ask(s, LIMIT);
    const response = await approve(adminA, exchange);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    expect((await owner.serialUnit.findUniqueOrThrow({ where: { id: s.oldUnit.id } })).state).toBe(
      'RETURNED',
    );
  });

  it('refuses an Admin above the limit, naming it, and changes nothing', async () => {
    const s = await scene();
    const exchange = await ask(s, '30000.01');
    for (const admin of [adminA, adminA2]) {
      const refused = await approve(admin, exchange);
      expect(refused.status).toBe(403);
      expect(refused.body.message).toContain(`above ${LIMIT}`);
      expect(refused.body.message).toContain('30000.01');
    }
    expect((await owner.serialUnit.findUniqueOrThrow({ where: { id: s.oldUnit.id } })).state).toBe(
      'SOLD',
    );
    expect(await owner.payment.count({ where: { reference: exchange.exchangeNo } })).toBe(0);
    expect(ExchangeSchema.parse((await adminA.get(`/exchanges/${exchange.id}`)).body).status).toBe(
      'PENDING',
    );
  });

  it('lets a Super Admin approve above the limit, and an Admin still reject', async () => {
    const big = await ask(await scene(), '55000.00');
    const response = await approve(superAdmin, big);
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    const other = await ask(await scene(), '58000.00');
    const rejected = await adminA.post(`/exchanges/${other.id}/reject`, {
      rowVersion: other.rowVersion,
      note: 'Too high',
    });
    expect(rejected.status).toBe(200);
  });
});
