import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  DueListResponseSchema,
  InvoiceSchema,
  QuotationListResponseSchema,
  QuotationSchema,
} from '@erp/contracts';
import type { Invoice, Quotation } from '@erp/contracts';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { addUser, createAuthWorld, loggedIn, SUPER_PASSWORD } from '../support/auth-world.js';
import type { AuthWorld, TestClient } from '../support/auth-world.js';
import { createTestApp } from '../support/create-test-app.js';
import { createOwnerPrisma } from '../support/fixtures.js';

describe('quotations and custom orders', () => {
  let app: NestExpressApplication;
  let w: AuthWorld;
  let superAdmin: TestClient;
  let adminA: TestClient;
  let staffA: TestClient;
  let staffB: TestClient;
  let viewer: TestClient;
  let noPay: TestClient;
  let categoryId: string;
  const owner = createOwnerPrisma();
  let counter = 0;
  const unique = (prefix: string): string =>
    `${prefix}${(counter += 1).toString().padStart(4, '0')}`;
  const today = (): string => new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 10);
  const inDays = (days: number): string =>
    new Date(Date.now() + 330 * 60_000 + days * 86_400_000).toISOString().slice(0, 10);
  let keyCounter = 0;
  const key = (): string => `quote-key-${Date.now()}-${(keyCounter += 1)}`;

  const newCustomer = async (): Promise<string> =>
    (
      await owner.customer.create({
        data: { name: unique('Orderer '), phone: `6${(counter += 1).toString().padStart(9, '0')}` },
      })
    ).id;
  const newItem = (serialized: boolean) =>
    owner.item.create({
      data: {
        itemCode: unique('QT'),
        name: serialized ? 'Custom TOTO' : 'Spare part',
        categoryId,
        unitCode: 'PCS',
        isSerialized: serialized,
      },
    });
  const seedUnit = async (itemId: string, branchId: string) => {
    const unit = await owner.serialUnit.create({
      data: { branchId, itemId, serialNo: unique('VIN'), state: 'AVAILABLE' },
    });
    await owner.stockBalance.upsert({
      where: { branchId_itemId_state: { branchId, itemId, state: 'AVAILABLE' } },
      create: { branchId, itemId, state: 'AVAILABLE', quantity: 1 },
      update: { quantity: { increment: 1 } },
    });
    await owner.stockLedger.create({
      data: {
        branchId,
        itemId,
        serialUnitId: unit.id,
        state: 'AVAILABLE',
        qtyDelta: 1,
        movementType: 'OPENING_BALANCE',
      },
    });
    return unit;
  };
  const seedPlain = async (itemId: string, branchId: string, qty: number) => {
    await owner.stockBalance.upsert({
      where: { branchId_itemId_state: { branchId, itemId, state: 'AVAILABLE' } },
      create: { branchId, itemId, state: 'AVAILABLE', quantity: qty },
      update: { quantity: { increment: qty } },
    });
    await owner.stockLedger.create({
      data: {
        branchId,
        itemId,
        state: 'AVAILABLE',
        qtyDelta: qty,
        movementType: 'OPENING_BALANCE',
      },
    });
  };
  const newBroker = async (): Promise<string> => {
    const created = await adminA.post('/brokers', { name: unique('Broker ') });
    await adminA.post(`/brokers/${created.body.id}/rules`, { type: 'PERCENT', value: '2' });
    return created.body.id;
  };

  interface Opts {
    itemId?: string;
    custom?: boolean;
    price?: string;
    qty?: number;
    discount?: string;
    brokerId?: string | null;
    validUntil?: string;
    client?: TestClient;
    branchId?: string;
    serialized?: boolean;
  }
  const body = async (customerId: string, o: Opts = {}) => {
    const serialized = o.serialized ?? true;
    const item = o.itemId ? { id: o.itemId } : await newItem(serialized);
    if (!serialized && !o.itemId) await seedPlain(item.id, o.branchId ?? w.branchA, 50);
    return {
      itemId: item.id,
      payload: {
        customerId,
        type: 'NON_GST',
        validUntil: o.validUntil ?? inDays(30),
        brokerId: o.brokerId ?? null,
        isCustomBuild: o.custom ?? false,
        specification: o.custom ? 'Red body, 60V motor, two batteries' : null,
        lines: [
          {
            itemId: item.id,
            qty: o.qty ?? 1,
            unitPrice: o.price ?? '95000.00',
            discountAmount: o.discount ?? '0.00',
          },
        ],
      },
    };
  };
  const draft = async (o: Opts = {}): Promise<Quotation> => {
    const client = o.client ?? staffA;
    const { payload } = await body(await newCustomer(), o);
    const response = await client.post('/quotations', payload);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return QuotationSchema.parse(response.body);
  };
  const act = (
    client: TestClient,
    q: Quotation,
    action: string,
    extra: Record<string, unknown> = {},
  ) => client.post(`/quotations/${q.id}/${action}`, { rowVersion: q.rowVersion, ...extra });
  const parsed = async (
    response: { status: number; body: unknown },
    expected = 200,
  ): Promise<Quotation> => {
    expect(response.status, JSON.stringify(response.body)).toBe(expected);
    return QuotationSchema.parse(response.body);
  };
  const fetchQ = async (id: string, client: TestClient = staffA) =>
    QuotationSchema.parse((await client.get(`/quotations/${id}`)).body);
  const sent = async (o: Opts = {}, sender: TestClient = staffA) =>
    parsed(await act(sender, await draft(o), 'send'));
  const accepted = async (o: Opts = {}) => parsed(await act(staffA, await sent(o), 'accept'));
  const advance = (
    client: TestClient,
    q: Quotation,
    amount: string,
    extra: Record<string, unknown> = {},
  ) =>
    client.post(`/quotations/${q.id}/advance`, {
      mode: 'CASH',
      amount,
      paidOn: today(),
      idempotencyKey: key(),
      ...extra,
    });
  const take = async (q: Quotation, amount: string) =>
    parsed(await advance(staffA, q, amount), 201);
  const assign = (
    q: Quotation,
    unitId: string,
    extra: Record<string, unknown> = {},
    client: TestClient = staffA,
  ) =>
    client.post(`/quotations/${q.id}/lines/${q.lines[0]?.id}/unit`, {
      serialUnitId: unitId,
      rowVersion: q.rowVersion,
      ...extra,
    });
  const convert = (client: TestClient, q: Quotation, extra: Record<string, unknown> = {}) =>
    client.post('/invoices/from-quotation', {
      quotationId: q.id,
      rowVersion: q.rowVersion,
      ...extra,
    });
  const issue = (client: TestClient, invoice: Invoice, extra: Record<string, unknown> = {}) =>
    client.post(`/invoices/${invoice.id}/issue`, { rowVersion: invoice.rowVersion, ...extra });
  const audits = (action: string, entityId: string) =>
    owner.auditLog.findMany({ where: { action, entityId } });
  const backdate = (id: string, to: string) =>
    owner.$transaction(async (tx) => {
      await tx.$executeRaw`SET LOCAL session_replication_role = replica`;
      await tx.$executeRaw`UPDATE quotations SET valid_until = ${to}::date WHERE id = ${id}::uuid`;
    });

  /** An accepted custom order with its vehicle set aside and the build ready, ready to deliver. */
  const readyOrder = async (o: Opts = {}) => {
    let q = await accepted({ custom: true, ...o });
    const unit = await seedUnit(q.lines[0]?.itemId ?? '', q.branchId);
    q = await parsed(await assign(q, unit.id, { chassisNo: unique('CH'), motorNo: unique('MT') }));
    q = await parsed(await act(staffA, q, 'build', { stage: 'READY' }));
    return { q, unit };
  };

  beforeAll(async () => {
    w = await createAuthWorld(owner);
    categoryId = (await owner.itemCategory.findFirstOrThrow({ where: { name: 'Vehicles' } })).id;
    app = await createTestApp();
    superAdmin = await loggedIn(app, 'superadmin', SUPER_PASSWORD);
    adminA = await loggedIn(app, 'admin_a');
    staffA = await loggedIn(app, 'staff_a');
    staffB = await loggedIn(app, 'staff_b');
    const roleOf = async (name: string, permissionCodes: string[]) =>
      expect(
        (await superAdmin.post('/roles', { name, tier: 'STAFF', permissionCodes })).status,
      ).toBe(201);
    await roleOf('Quote Viewer', ['quotations.view']);
    await roleOf('Quote No Pay', [
      'quotations.view',
      'quotations.manage',
      'customers.view',
      'items.view',
    ]);
    await addUser(owner, {
      username: 'quote_viewer',
      role: 'Quote Viewer',
      branchIds: [w.branchA],
    });
    await addUser(owner, { username: 'quote_nopay', role: 'Quote No Pay', branchIds: [w.branchA] });
    viewer = await loggedIn(app, 'quote_viewer');
    noPay = await loggedIn(app, 'quote_nopay');
    return async () => {
      await app.close();
      await owner.$disconnect();
    };
  });

  describe('who may call what', () => {
    it('answers every endpoint with 401 when signed out', async () => {
      const origin = 'http://localhost:5173';
      const http = () => request(app.getHttpServer());
      const id = w.customerId;
      const attempts = [
        http().get('/quotations'),
        http().get(`/quotations/${id}`),
        http().post('/quotations').set('Origin', origin).send({}),
        http().patch(`/quotations/${id}`).set('Origin', origin).send({}),
        http().post(`/quotations/${id}/send`).set('Origin', origin).send({}),
        http().post(`/quotations/${id}/accept`).set('Origin', origin).send({}),
        http().post(`/quotations/${id}/cancel`).set('Origin', origin).send({}),
        http().post(`/quotations/${id}/advance`).set('Origin', origin).send({}),
        http().post(`/quotations/${id}/build`).set('Origin', origin).send({}),
        http().post(`/quotations/${id}/lines/${id}/unit`).set('Origin', origin).send({}),
        http().post('/invoices/from-quotation').set('Origin', origin).send({}),
      ];
      for (const response of await Promise.all(attempts)) expect(response.status).toBe(401);
    });

    it('lets a viewer read but not write, and a worker who cannot take payments cannot take an advance', async () => {
      const q = await accepted();
      expect((await viewer.get('/quotations')).status).toBe(200);
      expect((await viewer.get(`/quotations/${q.id}`)).status).toBe(200);
      const { payload } = await body(await newCustomer());
      expect((await viewer.post('/quotations', payload)).status).toBe(403);
      expect((await act(viewer, q, 'cancel', { reason: 'Nope nope' })).status).toBe(403);
      expect((await advance(viewer, q, '100.00')).status).toBe(403);
      expect((await advance(noPay, q, '100.00')).status).toBe(403);
      expect((await convert(viewer, q)).status).toBe(403);
    });
  });

  describe('writing a quotation', () => {
    it('works out the totals, numbers it and audits it', async () => {
      const q = await draft({ price: '47500.00', qty: 2, discount: '2000.00' });
      expect(q).toMatchObject({
        status: 'DRAFT',
        type: 'NON_GST',
        subtotal: '95000.00',
        discountTotal: '2000.00',
        total: '93000.00',
        balanceDue: '93000.00',
        advancePaid: '0.00',
        isCustomBuild: false,
        buildStage: 'NOT_STARTED',
      });
      expect(q.quotationNo).toMatch(/QT\/\d{4}\/\d{5}$/);
      expect(q.lines[0]).toMatchObject({
        lineNo: 1,
        qty: 2,
        unitPrice: '47500.00',
        discountAmount: '2000.00',
        amount: '93000.00',
        unit: null,
      });
      expect((await audits('QUOTATION_CREATED', q.id)).length).toBe(1);
    });

    it('refuses a past validity date, an unknown item or customer, a custom order with no description, and too big a discount', async () => {
      const customerId = await newCustomer();
      const { payload } = await body(customerId);
      const post = (over: Record<string, unknown>) =>
        staffA.post('/quotations', { ...payload, ...over });
      expect((await post({ validUntil: inDays(-1) })).status).toBe(400);
      expect((await post({ customerId: '0b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59' })).status).toBe(400);
      expect(
        (
          await post({
            lines: [{ itemId: '0b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59', qty: 1, unitPrice: '10' }],
          })
        ).status,
      ).toBe(400);
      expect((await post({ isCustomBuild: true, specification: null })).status).toBe(400);
      const big = await post({ lines: [{ ...payload.lines[0], discountAmount: '95000.01' }] });
      expect(big.status).toBe(400);
      expect(JSON.stringify(big.body.details)).toContain('more than the line is worth');
      const bare = await adminA.post('/brokers', { name: unique('Bare ') });
      const noRule = await post({ brokerId: bare.body.id });
      expect(noRule.status).toBe(400);
      expect(noRule.body.details[0].field).toBe('brokerId');
    });

    it('edits a draft, refuses a stale edit, and carries the broker', async () => {
      const brokerId = await newBroker();
      const q = await draft();
      const { payload } = await body(q.lines.length ? await newCustomer() : '', {
        brokerId,
        price: '50000.00',
      });
      const edited = await parsed(
        await staffA.patch(`/quotations/${q.id}`, { ...payload, rowVersion: q.rowVersion }),
      );
      expect(edited).toMatchObject({ total: '50000.00', brokerId });
      expect(edited.lines).toHaveLength(1);
      expect(
        (await staffA.patch(`/quotations/${q.id}`, { ...payload, rowVersion: q.rowVersion }))
          .status,
      ).toBe(409);
      expect((await audits('QUOTATION_UPDATED', q.id)).length).toBe(1);
    });

    it('fixes a quotation once it is sent: its prices cannot change, not even in the database', async () => {
      const q = await sent();
      const { payload } = await body(q.customerId);
      const edit = await staffA.patch(`/quotations/${q.id}`, {
        ...payload,
        rowVersion: q.rowVersion,
      });
      expect(edit.status).toBe(409);
      await expect(
        owner.$executeRaw`UPDATE quotations SET total = 1 WHERE id = ${q.id}::uuid`,
      ).rejects.toThrow(/cannot be changed/);
      await expect(
        owner.$executeRaw`UPDATE quotation_lines SET unit_price = 1 WHERE quotation_id = ${q.id}::uuid`,
      ).rejects.toThrow(/cannot be changed/);
      await expect(
        owner.$executeRaw`DELETE FROM quotation_lines WHERE quotation_id = ${q.id}::uuid`,
      ).rejects.toThrow(/cannot be removed/);
      await expect(
        owner.quotationLine.create({
          data: {
            branchId: q.branchId,
            quotationId: q.id,
            lineNo: 9,
            itemId: q.lines[0]?.itemId ?? '',
            qty: 1,
            unitPrice: '1',
          },
        }),
      ).rejects.toThrow(/draft quotation/);
    });
  });

  describe('sending, accepting, expiring and cancelling', () => {
    it('follows draft, sent, accepted, and refuses steps out of order', async () => {
      const q = await draft();
      expect((await act(staffA, q, 'accept')).status).toBe(409);
      const s = await parsed(await act(staffA, q, 'send'));
      expect(s.sentAt).not.toBeNull();
      expect((await act(staffA, s, 'send')).status).toBe(409);
      const a = await parsed(await act(staffA, s, 'accept'));
      expect(a).toMatchObject({ status: 'ACCEPTED' });
      expect(a.acceptedAt).not.toBeNull();
      expect((await act(staffA, a, 'accept')).status).toBe(409);
      expect((await audits('QUOTATION_SENT', q.id)).length).toBe(1);
      expect((await audits('QUOTATION_ACCEPTED', q.id)).length).toBe(1);
    });

    it('needs a manager to send a quotation with a discount above the staff limit', async () => {
      const q = await draft({ price: '100000.00', discount: '10000.00' });
      const refused = await act(staffA, q, 'send');
      expect(refused.status).toBe(403);
      expect((await fetchQ(q.id)).status).toBe('DRAFT');
      expect((await sent({ price: '100000.00', discount: '5000.00' })).status).toBe('SENT');
      expect((await sent({ price: '100000.00', discount: '10000.00' }, adminA)).status).toBe(
        'SENT',
      );
    });

    it('refuses to send a quotation whose validity date has passed', async () => {
      const q = await draft();
      await backdate(q.id, inDays(-1));
      const refused = await act(staffA, q, 'send');
      expect(refused.status).toBe(400);
      expect(refused.body.details[0].field).toBe('validUntil');
    });

    it('lets a quotation nobody has paid for lapse after its last day, and refuses to accept it', async () => {
      const q = await sent();
      await backdate(q.id, inDays(-1));
      const expired = await fetchQ(q.id);
      expect(expired.status).toBe('EXPIRED');
      expect((await act(staffA, expired, 'accept')).status).toBe(409);
      const listed = QuotationListResponseSchema.parse(
        (await staffA.get(`/quotations?status=EXPIRED&search=${q.quotationNo}`)).body,
      );
      expect(listed.items.map((i) => i.id)).toEqual([q.id]);
    });

    it('never lapses once an advance is paid, because the customer has paid for the quoted price', async () => {
      const q = await take(await accepted(), '10000.00');
      await backdate(q.id, inDays(-5));
      expect((await fetchQ(q.id)).status).toBe('ACCEPTED');
      await expect(
        owner.$executeRaw`UPDATE quotations SET status = 'EXPIRED' WHERE id = ${q.id}::uuid`,
      ).rejects.toThrow(/does not expire/);
    });

    it('cancels with a reason, and refuses while an advance is held or an invoice stands', async () => {
      const q = await accepted();
      expect((await act(staffA, q, 'cancel', { reason: 'no' })).status).toBe(400);
      const withAdvance = await take(q, '5000.00');
      const blocked = await act(staffA, withAdvance, 'cancel', { reason: 'Customer withdrew' });
      expect(blocked.status).toBe(422);
      expect(JSON.stringify(blocked.body.details)).toContain('Reverse the advance');
      await expect(
        owner.$executeRaw`UPDATE quotations SET status = 'CANCELLED', cancel_reason = 'x' WHERE id = ${q.id}::uuid`,
      ).rejects.toThrow(/Reverse the advance/);
      const payment = withAdvance.advances[0]?.paymentId ?? '';
      expect(
        (await adminA.post(`/payments/${payment}/reverse`, { reason: 'Refunded to the customer' }))
          .status,
      ).toBe(200);
      const free = await fetchQ(q.id);
      expect(free).toMatchObject({ advancePaid: '0.00', balanceDue: free.total });
      const done = await parsed(await act(staffA, free, 'cancel', { reason: 'Customer withdrew' }));
      expect(done).toMatchObject({ status: 'CANCELLED', cancelReason: 'Customer withdrew' });
      expect((await audits('QUOTATION_CANCELLED', q.id)).length).toBe(1);
      expect((await act(staffA, done, 'cancel', { reason: 'Again please' })).status).toBe(409);

      const other = await accepted({ serialized: false });
      const invoice = InvoiceSchema.parse((await convert(staffA, other)).body);
      const stands = await act(staffA, other, 'cancel', { reason: 'Customer withdrew' });
      expect(stands.status).toBe(422);
      expect(invoice.status).toBe('DRAFT');
    });

    it('is protected by the database: a quotation cannot skip a status', async () => {
      const q = await draft();
      await expect(
        owner.$executeRaw`UPDATE quotations SET status = 'ACCEPTED' WHERE id = ${q.id}::uuid`,
      ).rejects.toThrow(/cannot move from/);
      await expect(
        owner.$executeRaw`UPDATE quotations SET status = 'CONVERTED' WHERE id = ${q.id}::uuid`,
      ).rejects.toThrow(/cannot move from/);
    });
  });

  describe('advance payments', () => {
    it('takes an advance only for an accepted quotation, and records it as a payment against it', async () => {
      const q = await sent();
      expect((await advance(staffA, q, '1000.00')).status).toBe(409);
      const a = await accepted();
      const paid = await take(a, '30000.00');
      expect(paid).toMatchObject({ advancePaid: '30000.00', balanceDue: '65000.00' });
      expect(paid.advances).toHaveLength(1);
      expect(paid.advances[0]).toMatchObject({
        amount: '30000.00',
        status: 'ACTIVE',
        modeName: 'Cash',
      });
      const row = await owner.payment.findFirstOrThrow({ where: { quotationId: a.id } });
      expect(row.customerId).toBe(a.customerId);
      expect(await owner.paymentAllocation.count({ where: { paymentId: row.id } })).toBe(0);
      expect((await audits('QUOTATION_ADVANCE_TAKEN', a.id)).length).toBe(1);
    });

    it('allows partial advances that add up, and refuses more than the quotation is worth', async () => {
      const a = await accepted({ price: '10000.00' });
      const one = await take(a, '4000.00');
      const two = await take(one, '5000.00');
      expect(two).toMatchObject({ advancePaid: '9000.00', balanceDue: '1000.00' });
      const over = await advance(staffA, two, '1000.01');
      expect(over.status).toBe(400);
      expect(over.body.details[0].field).toBe('amount');
      expect(over.body.details[0].message).toContain('1000.00');
      const full = await take(two, '1000.00');
      expect(full).toMatchObject({ advancePaid: '10000.00', balanceDue: '0.00' });
      expect((await advance(staffA, full, '1.00')).status).toBe(422);
      expect((await advance(staffA, full, '0')).status).toBe(400);
    });

    it('takes an advance once however often the same form is sent', async () => {
      const a = await accepted({ price: '10000.00' });
      const retry = key();
      const results = await Promise.all(
        Array.from({ length: 4 }, () => advance(staffA, a, '6000.00', { idempotencyKey: retry })),
      );
      for (const r of results) expect(r.status, JSON.stringify(r.body)).toBe(201);
      expect(await owner.payment.count({ where: { quotationId: a.id } })).toBe(1);
      expect((await fetchQ(a.id)).advancePaid).toBe('6000.00');
    });

    it('never lets two advances at once add up to more than the quotation', async () => {
      const a = await accepted({ price: '10000.00' });
      const results = await Promise.all([
        advance(staffA, a, '6000.00'),
        advance(staffA, a, '6000.00'),
        advance(adminA, a, '6000.00'),
      ]);
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect((await fetchQ(a.id)).advancePaid).toBe('6000.00');
    });

    it("is protected by the database: an advance is the quotation's customer's, in its branch, once accepted", async () => {
      const a = await accepted();
      const sentOnly = await sent();
      const make = (q: Quotation, over: Record<string, unknown>) =>
        owner.payment.create({
          data: {
            branchId: q.branchId,
            receiptNo: unique('ADV/'),
            customerId: q.customerId,
            mode: 'CASH',
            amount: '1',
            paidOn: new Date(),
            quotationId: q.id,
            ...over,
          } as never,
        });
      await expect(make(a, { customerId: await newCustomer() })).rejects.toThrow(/customer/);
      await expect(make(a, { branchId: w.branchB })).rejects.toThrow(
        /customer's, in the quotation's branch/,
      );
      await expect(make(sentOnly, {})).rejects.toThrow(/accepted quotation/);
    });
  });

  describe('tracking the build', () => {
    it('keeps a history, moves forward, back from quality check, and not out of ready', async () => {
      const q = await accepted({ custom: true });
      const stage = (cur: Quotation, to: string, note?: string) =>
        act(staffA, cur, 'build', { stage: to, ...(note ? { note } : {}) });
      const building = await parsed(await stage(q, 'IN_BUILD', 'Chassis welded'));
      expect(building.buildStage).toBe('IN_BUILD');
      expect((await stage(building, 'NOT_STARTED')).status).toBe(409);
      expect((await stage(building, 'IN_BUILD')).status).toBe(409);
      const checking = await parsed(await stage(building, 'QUALITY_CHECK'));
      const redo = await parsed(await stage(checking, 'IN_BUILD', 'Brake fault found'));
      expect(redo.buildStage).toBe('IN_BUILD');
      expect(redo.buildUpdates.map((u) => [u.stage, u.note])).toEqual([
        ['IN_BUILD', 'Brake fault found'],
        ['QUALITY_CHECK', null],
        ['IN_BUILD', 'Chassis welded'],
      ]);
      expect((await audits('QUOTATION_BUILD_UPDATED', q.id)).length).toBe(3);
    });

    it('is only for an accepted custom order', async () => {
      const plain = await accepted();
      const refused = await act(staffA, plain, 'build', { stage: 'IN_BUILD' });
      expect(refused.status).toBe(422);
      const custom = await sent({ custom: true });
      expect((await act(staffA, custom, 'build', { stage: 'IN_BUILD' })).status).toBe(409);
      expect(
        (await act(staffA, await accepted({ custom: true }), 'build', { stage: 'DONE' })).status,
      ).toBe(400);
    });

    it('is protected by the database: the history is never changed, and the stages follow their order', async () => {
      const q = await accepted({ custom: true });
      const built = await parsed(await act(staffA, q, 'build', { stage: 'IN_BUILD' }));
      const update = await owner.quotationBuildUpdate.findFirstOrThrow({
        where: { quotationId: q.id },
      });
      await expect(
        owner.$executeRaw`UPDATE quotation_build_updates SET stage = 'READY' WHERE id = ${update.id}::uuid`,
      ).rejects.toThrow(/cannot be changed/);
      await expect(
        owner.$executeRaw`DELETE FROM quotation_build_updates WHERE id = ${update.id}::uuid`,
      ).rejects.toThrow(/cannot be changed/);
      await expect(
        owner.$executeRaw`UPDATE quotations SET build_stage = 'NOT_STARTED' WHERE id = ${q.id}::uuid`,
      ).rejects.toThrow(/cannot move from/);
      expect(built.buildStage).toBe('IN_BUILD');
      const plain = await accepted();
      await expect(
        owner.$executeRaw`UPDATE quotations SET build_stage = 'IN_BUILD' WHERE id = ${plain.id}::uuid`,
      ).rejects.toThrow();
    });
  });

  describe('the vehicle, with its chassis and motor numbers', () => {
    it('sets a vehicle aside, records its numbers and lists the batteries that go with it', async () => {
      const q = await accepted({ custom: true });
      const unit = await seedUnit(q.lines[0]?.itemId ?? '', q.branchId);
      const batteryItem = await newItem(true);
      const battery = await seedUnit(batteryItem.id, q.branchId);
      await owner.battery.create({
        data: {
          serialUnitId: battery.id,
          installedInSerialUnitId: unit.id,
          installedOn: new Date(),
        },
      });
      const withUnit = await parsed(
        await assign(q, unit.id, { chassisNo: 'MD2A12CY5RWK12345', motorNo: 'MTR-60V/0042' }),
      );
      expect(withUnit.lines[0]?.unit).toMatchObject({
        id: unit.id,
        serialNo: unit.serialNo,
        chassisNo: 'MD2A12CY5RWK12345',
        motorNo: 'MTR-60V/0042',
        batteries: [{ id: battery.id, serialNo: battery.serialNo }],
      });
      expect(await owner.serialUnit.findUniqueOrThrow({ where: { id: unit.id } })).toMatchObject({
        chassisNo: 'MD2A12CY5RWK12345',
        motorNo: 'MTR-60V/0042',
      });
      expect((await audits('QUOTATION_VEHICLE_ASSIGNED', q.id)).length).toBe(1);
      const again = await parsed(
        await assign(withUnit, unit.id, { chassisNo: 'MD2A12CY5RWK12345' }),
      );
      expect(again.lines[0]?.unit?.chassisNo).toBe('MD2A12CY5RWK12345');
    });

    it('refuses a number already on another vehicle, or a different number than the one recorded', async () => {
      const q = await accepted({ custom: true });
      const unit = await seedUnit(q.lines[0]?.itemId ?? '', q.branchId);
      const other = await seedUnit(q.lines[0]?.itemId ?? '', q.branchId);
      await owner.serialUnit.update({
        where: { id: other.id },
        data: { chassisNo: 'TAKEN-CHASSIS-1', motorNo: 'TAKEN-MOTOR-1' },
      });
      const clash = await assign(q, unit.id, {
        chassisNo: 'TAKEN-CHASSIS-1',
        motorNo: 'TAKEN-MOTOR-1',
      });
      expect(clash.status).toBe(409);
      expect(clash.body.details.map((d: { field: string }) => d.field).sort()).toEqual([
        'chassisNo',
        'motorNo',
      ]);
      const set = await parsed(await assign(q, unit.id, { chassisNo: unique('CH') }));
      const change = await assign(set, unit.id, { chassisNo: 'A-DIFFERENT-ONE' });
      expect(change.status).toBe(409);
      expect(change.body.details[0].message).toContain('already recorded as');
    });

    it('refuses the wrong item, a vehicle in another branch, one that is not in stock, and one promised elsewhere', async () => {
      const q = await accepted({ custom: true });
      const wrongItem = await seedUnit((await newItem(true)).id, q.branchId);
      const otherBranch = await seedUnit(q.lines[0]?.itemId ?? '', w.branchB);
      const sold = await seedUnit(q.lines[0]?.itemId ?? '', q.branchId);
      await owner.serialUnit.update({ where: { id: sold.id }, data: { state: 'SOLD' } });
      for (const [unit, status] of [
        [wrongItem, 400],
        [otherBranch, 400],
        [sold, 422],
      ] as const)
        expect((await assign(q, unit.id)).status, unit.serialNo).toBe(status);
      const good = await seedUnit(q.lines[0]?.itemId ?? '', q.branchId);
      const first = await parsed(await assign(q, good.id));
      const rival = await accepted({ custom: true, itemId: q.lines[0]?.itemId });
      const taken = await assign(rival, good.id);
      expect(taken.status).toBe(409);
      expect(taken.body.details[0].message).toContain(q.quotationNo);
      expect(first.lines[0]?.unit?.id).toBe(good.id);
      const plain = await accepted({ serialized: false });
      expect((await assign(plain, good.id)).status).toBe(422);
    });

    it('will not let the build be marked ready until every vehicle has its numbers', async () => {
      const q = await accepted({ custom: true });
      const none = await act(staffA, q, 'build', { stage: 'READY' });
      expect(none.status).toBe(422);
      expect(JSON.stringify(none.body.details)).toContain('Choose the vehicle');
      const unit = await seedUnit(q.lines[0]?.itemId ?? '', q.branchId);
      const noNumbers = await parsed(await assign(q, unit.id));
      const partial = await act(staffA, noNumbers, 'build', { stage: 'READY' });
      expect(partial.status).toBe(422);
      expect(JSON.stringify(partial.body.details)).toContain('chassis and motor numbers');
      const full = await parsed(
        await assign(noNumbers, unit.id, { chassisNo: unique('CH'), motorNo: unique('MT') }),
      );
      expect((await parsed(await act(staffA, full, 'build', { stage: 'READY' }))).buildStage).toBe(
        'READY',
      );
    });
  });

  describe('turning a quotation into an invoice', () => {
    it('makes a draft invoice at the quoted prices, with the vehicle, the broker and the link back', async () => {
      const brokerId = await newBroker();
      const { q, unit } = await readyOrder({ brokerId, price: '95000.00' });
      const response = await convert(staffA, q, { dueDate: inDays(10) });
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      const invoice = InvoiceSchema.parse(response.body);
      expect(invoice).toMatchObject({
        status: 'DRAFT',
        quotationId: q.id,
        quotationNo: q.quotationNo,
        brokerId,
        total: '95000.00',
        customerId: q.customerId,
      });
      expect(invoice.lines[0]).toMatchObject({ unitPrice: '95000.00', serialUnitId: unit.id });
      const standing = await fetchQ(q.id);
      expect(standing).toMatchObject({
        status: 'ACCEPTED',
        invoiceId: invoice.id,
        invoiceStatus: 'DRAFT',
      });
      expect((await audits('INVOICE_DRAFT_FROM_QUOTATION', invoice.id)).length).toBe(1);
    });

    it('needs an accepted quotation, a ready build and a vehicle on every serialized line', async () => {
      const draftOnly = await draft();
      expect((await convert(staffA, draftOnly)).status).toBe(409);
      const building = await accepted({ custom: true });
      const notReady = await convert(staffA, building);
      expect(notReady.status).toBe(422);
      expect(JSON.stringify(notReady.body.details)).toContain('not marked ready');
      const noUnit = await accepted();
      const missing = await convert(staffA, noUnit);
      expect(missing.status).toBe(422);
      expect(JSON.stringify(missing.body.details)).toContain('Choose the vehicle');
      expect(
        (await convert(staffA, { ...(await accepted()), rowVersion: 99 } as Quotation)).status,
      ).toBe(409);
    });

    it('allows one invoice at a time, and another once the draft is discarded', async () => {
      const q = await accepted({ serialized: false });
      const first = InvoiceSchema.parse((await convert(staffA, q)).body);
      const second = await convert(staffA, await fetchQ(q.id));
      expect(second.status).toBe(409);
      const discarded = await staffA.post(`/invoices/${first.id}/discard`, {
        rowVersion: first.rowVersion,
      });
      expect(discarded.status, JSON.stringify(discarded.body)).toBeLessThan(300);
      expect((await convert(staffA, await fetchQ(q.id))).status).toBe(201);
    });

    it('converts a quotation once when two requests arrive together', async () => {
      const q = await accepted({ serialized: false });
      const results = await Promise.all([convert(staffA, q), convert(adminA, q)]);
      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await owner.invoice.count({ where: { quotationId: q.id } })).toBe(1);
    });

    it('keeps the quoted prices on the draft: the customer, items, quantities, prices and broker cannot be changed', async () => {
      const q = await accepted({ serialized: false, price: '1000.00', qty: 3 });
      const invoice = InvoiceSchema.parse((await convert(staffA, q)).body);
      const lineOf = (over: Record<string, unknown>) => ({
        customerId: invoice.customerId,
        type: invoice.type,
        brokerId: null,
        dueDate: null,
        rowVersion: invoice.rowVersion,
        lines: [
          {
            itemId: invoice.lines[0]?.itemId,
            qty: 3,
            unitPrice: '1000.00',
            discountAmount: '0.00',
            ...over,
          },
        ],
      });
      for (const over of [{ unitPrice: '900.00' }, { qty: 2 }, { discountAmount: '10.00' }]) {
        const refused = await staffA.patch(`/invoices/${invoice.id}`, lineOf(over));
        expect(refused.status, JSON.stringify(over)).toBe(422);
        expect(JSON.stringify(refused.body.details)).toContain(q.quotationNo);
      }
      const otherCustomer = await staffA.patch(`/invoices/${invoice.id}`, {
        ...lineOf({}),
        customerId: await newCustomer(),
      });
      expect(otherCustomer.status).toBe(422);
      const sameAgain = await staffA.patch(`/invoices/${invoice.id}`, {
        ...lineOf({}),
        dueDate: inDays(7),
      });
      expect(sameAgain.status, JSON.stringify(sameAgain.body)).toBe(200);
    });
  });

  describe('delivering the order: paid for, or on credit', () => {
    it('refuses to deliver an order that is not fully paid, and says how much is missing', async () => {
      const { q } = await readyOrder({ price: '95000.00' });
      const partial = await take(q, '40000.00');
      const invoice = InvoiceSchema.parse((await convert(staffA, partial)).body);
      const refused = await issue(staffA, invoice);
      expect(refused.status).toBe(422);
      expect(JSON.stringify(refused.body.details)).toContain('40000.00 of 95000.00');
      expect(await owner.invoice.findUniqueOrThrow({ where: { id: invoice.id } })).toMatchObject({
        status: 'DRAFT',
        invoiceNo: null,
      });
      expect((await fetchQ(q.id)).status).toBe('ACCEPTED');
    });

    it('applies the advances and marks the quotation converted when the order is fully paid', async () => {
      const brokerId = await newBroker();
      const { q, unit } = await readyOrder({ price: '95000.00', brokerId });
      const paid = await take(await take(q, '30000.00'), '65000.00');
      const invoice = InvoiceSchema.parse((await convert(staffA, paid)).body);
      const done = await issue(staffA, invoice);
      expect(done.status, JSON.stringify(done.body)).toBe(200);
      const issued = InvoiceSchema.parse(done.body);
      expect(issued.status).toBe('ISSUED');
      const after = await fetchQ(q.id);
      expect(after).toMatchObject({
        status: 'CONVERTED',
        invoiceId: invoice.id,
        invoiceStatus: 'ISSUED',
        balanceDue: '0.00',
      });
      const due = DueListResponseSchema.parse(
        (await staffA.get(`/dues?scope=all&customerId=${q.customerId}`)).body,
      ).items.find((d) => d.invoiceId === invoice.id);
      expect(due).toMatchObject({ paid: '95000.00', outstanding: '0.00', status: 'PAID' });
      expect(await owner.paymentAllocation.count({ where: { invoiceId: invoice.id } })).toBe(2);
      expect((await owner.serialUnit.findUniqueOrThrow({ where: { id: unit.id } })).state).toBe(
        'SOLD',
      );
      expect(await owner.commission.count({ where: { invoiceId: invoice.id } })).toBe(1);
      expect((await audits('QUOTATION_CONVERTED', q.id)).length).toBe(1);
      expect(
        await owner.outboxEvent.count({
          where: {
            eventType: 'quotation.converted',
            payload: { path: ['quotationId'], equals: q.id },
          },
        }),
      ).toBe(1);
      expect((await act(staffA, after, 'cancel', { reason: 'Too late now' })).status).toBe(409);
    });

    it('lets only someone who may deliver on credit do it, with a reason, and records it', async () => {
      const { q } = await readyOrder({ price: '95000.00' });
      const partial = await take(q, '25000.00');
      const invoice = InvoiceSchema.parse((await convert(staffA, partial)).body);
      expect(
        (await issue(staffA, invoice, { unpaidDeliveryReason: 'Pays on Friday' })).status,
      ).toBe(422);
      const noReason = await issue(adminA, invoice);
      expect(noReason.status).toBe(400);
      expect(noReason.body.details[0].field).toBe('unpaidDeliveryReason');
      const done = await issue(adminA, invoice, {
        unpaidDeliveryReason: 'Pays the rest on Friday',
      });
      expect(done.status, JSON.stringify(done.body)).toBe(200);
      const due = DueListResponseSchema.parse(
        (await adminA.get(`/dues?scope=all&customerId=${q.customerId}`)).body,
      ).items.find((d) => d.invoiceId === invoice.id);
      expect(due).toMatchObject({ paid: '25000.00', outstanding: '70000.00', status: 'PARTIAL' });
      const note = await audits('QUOTATION_DELIVERED_UNPAID', q.id);
      expect(note).toHaveLength(1);
      expect(note[0]?.newValue).toMatchObject({
        unpaid: '70000.00',
        reason: 'Pays the rest on Friday',
      });
      expect((await fetchQ(q.id)).status).toBe('CONVERTED');
    });

    it('delivers an order with no advance on credit only the same way', async () => {
      const q = await accepted({ serialized: false, price: '2000.00' });
      const invoice = InvoiceSchema.parse((await convert(staffA, q)).body);
      expect((await issue(staffA, invoice)).status).toBe(422);
      expect(
        (
          await issue(superAdmin, invoice, {
            unpaidDeliveryReason: 'Trusted customer, pays on delivery note',
          })
        ).status,
      ).toBe(200);
    });

    it('refuses to deliver a lapsed quotation nobody paid for, but honours one that has an advance', async () => {
      const lapsed = await accepted({ serialized: false });
      const draftInvoice = InvoiceSchema.parse((await convert(staffA, lapsed)).body);
      await backdate(lapsed.id, inDays(-1));
      const refused = await issue(adminA, draftInvoice, {
        unpaidDeliveryReason: 'Customer insists on it',
      });
      expect(refused.status).toBe(422);
      expect(JSON.stringify(refused.body.details)).toContain('validity date');

      const honoured = await take(
        await accepted({ serialized: false, price: '2000.00' }),
        '2000.00',
      );
      const second = InvoiceSchema.parse((await convert(staffA, honoured)).body);
      await backdate(honoured.id, inDays(-30));
      expect((await issue(staffA, second)).status).toBe(200);
      expect((await fetchQ(honoured.id)).status).toBe('CONVERTED');
    });

    it('applies the staff discount limit when the invoice is issued, as it does for every invoice', async () => {
      const approved = await parsed(
        await act(
          staffA,
          await sent({ serialized: false, price: '10000.00', discount: '1500.00' }, adminA),
          'accept',
        ),
      );
      const full = await take(approved, '8500.00');
      const invoice = InvoiceSchema.parse((await convert(staffA, full)).body);
      const refused = await issue(staffA, invoice);
      expect(refused.status).toBe(403);
      expect(JSON.stringify(refused.body)).toContain('above what staff may give');
      expect((await issue(adminA, invoice)).status).toBe(200);
    });

    it('reopens the quotation when the invoice is cancelled, once the advances are reversed', async () => {
      const q = await take(await accepted({ serialized: false, price: '3000.00' }), '3000.00');
      const invoice = InvoiceSchema.parse((await convert(staffA, q)).body);
      const issued = InvoiceSchema.parse((await issue(staffA, invoice)).body);
      const blocked = await adminA.post(`/invoices/${issued.id}/cancel`, {
        rowVersion: issued.rowVersion,
        reason: 'Customer changed mind',
      });
      expect(blocked.status).toBe(422);
      expect(
        (
          await adminA.post(`/payments/${q.advances[0]?.paymentId}/reverse`, {
            reason: 'Refunded to customer',
          })
        ).status,
      ).toBe(200);
      const cancelled = await adminA.post(`/invoices/${issued.id}/cancel`, {
        rowVersion: issued.rowVersion,
        reason: 'Customer changed mind',
      });
      expect(cancelled.status, JSON.stringify(cancelled.body)).toBe(200);
      const reopened = await fetchQ(q.id);
      expect(reopened).toMatchObject({ status: 'ACCEPTED', invoiceId: null, advancePaid: '0.00' });
      expect((await audits('QUOTATION_REOPENED', q.id)).length).toBe(1);
      expect((await advance(staffA, reopened, '500.00')).status).toBe(201);
    });

    it('keeps the link when an invoice is cancelled and re-issued as a draft', async () => {
      const q = await accepted({ serialized: false, price: '3000.00' });
      const invoice = InvoiceSchema.parse((await convert(staffA, q)).body);
      const done = InvoiceSchema.parse(
        (await issue(superAdmin, invoice, { unpaidDeliveryReason: 'Pays on delivery' })).body,
      );
      const again = await adminA.post(`/invoices/${done.id}/reissue`, {
        rowVersion: done.rowVersion,
        reason: 'Wrong address',
      });
      expect(again.status, JSON.stringify(again.body)).toBe(201);
      expect(InvoiceSchema.parse(again.body)).toMatchObject({ quotationId: q.id, status: 'DRAFT' });
      expect((await fetchQ(q.id)).status).toBe('ACCEPTED');
    });
  });

  describe('finding quotations', () => {
    it('filters by status, custom orders and search, and pages the result', async () => {
      const a = await sent({ custom: true });
      const b = await draft();
      const ids = async (qs: string) =>
        QuotationListResponseSchema.parse((await staffA.get(`/quotations?${qs}`)).body).items.map(
          (i) => i.id,
        );
      expect(await ids(`search=${a.quotationNo}`)).toEqual([a.id]);
      expect(await ids(`status=SENT&search=${a.quotationNo}`)).toEqual([a.id]);
      expect(await ids(`status=DRAFT&search=${a.quotationNo}`)).toEqual([]);
      expect(await ids(`status=open&search=${b.quotationNo}`)).toEqual([b.id]);
      expect(await ids(`customOnly=true&search=${b.quotationNo}`)).toEqual([]);
      expect(await ids(`customOnly=true&search=${a.quotationNo}`)).toEqual([a.id]);
      const paged = QuotationListResponseSchema.parse(
        (await staffA.get('/quotations?pageSize=1&page=2&sortBy=quotationNo&sortOrder=asc')).body,
      );
      expect(paged.page).toBe(2);
      expect((await staffA.get('/quotations?sortBy=specification')).status).toBe(400);
      expect((await staffA.get('/quotations?status=LOST')).status).toBe(400);
    });

    it('shows the advance paid on each quotation in the list', async () => {
      const q = await take(await accepted({ price: '8000.00' }), '3000.00');
      const row = QuotationListResponseSchema.parse(
        (await staffA.get(`/quotations?search=${q.quotationNo}`)).body,
      ).items[0];
      expect(row).toMatchObject({ id: q.id, total: '8000.00', advancePaid: '3000.00' });
    });
  });

  describe('branch isolation', () => {
    it("hides a branch's quotations from another branch and refuses every change", async () => {
      const q = await take(await accepted({ custom: true }), '1000.00');
      expect((await staffB.get(`/quotations/${q.id}`)).status).toBe(404);
      expect(
        QuotationListResponseSchema.parse(
          (await staffB.get(`/quotations?search=${q.quotationNo}`)).body,
        ).items,
      ).toHaveLength(0);
      const attempts = [
        act(staffB, q, 'cancel', { reason: 'Hijacked order' }),
        advance(staffB, q, '100.00'),
        act(staffB, q, 'build', { stage: 'IN_BUILD' }),
        convert(staffB, q),
        assign(q, w.customerId, {}, staffB),
      ];
      for (const response of await Promise.all(attempts)) expect(response.status).toBe(404);
      expect((await adminA.get(`/quotations/${q.id}`)).status).toBe(200);
      expect(await fetchQ(q.id)).toMatchObject({ status: 'ACCEPTED', advancePaid: '1000.00' });
    });

    it('refuses writing in a branch the user does not work in, and makes a Super Admin choose', async () => {
      const { payload } = await body(await newCustomer());
      expect((await staffA.post('/quotations', { ...payload, branchId: w.branchB })).status).toBe(
        403,
      );
      expect((await superAdmin.post('/quotations', payload)).status).toBe(400);
      const chosen = await superAdmin.post('/quotations', {
        ...payload,
        branchId: w.branchB,
        lines: [{ ...payload.lines[0], unitPrice: '1000.00' }],
      });
      expect(chosen.status, JSON.stringify(chosen.body)).toBe(201);
      expect((await staffB.get(`/quotations/${chosen.body.id}`)).status).toBe(200);
      expect((await staffA.get(`/quotations/${chosen.body.id}`)).status).toBe(404);
    });
  });
});
