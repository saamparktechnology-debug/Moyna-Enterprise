//apps/api/test/integration/broker-commission.int.test.ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import { BrokerSchema, CommissionListResponseSchema, InvoiceSchema } from '@erp/contracts';
import type { Broker, Commission, Invoice } from '@erp/contracts';
import { beforeAll, describe, expect, it } from 'vitest';
import { createAuthWorld, loggedIn, ORIGIN } from '../support/auth-world.js';
import type { AuthWorld, TestClient } from '../support/auth-world.js';
import { createTestApp } from '../support/create-test-app.js';
import { createOwnerPrisma } from '../support/fixtures.js';

const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.from('tiny picture'),
]);
const PDF = Buffer.from('%PDF-1.4 tiny document');

describe('broker details and commission agreed on the invoice', () => {
  let app: NestExpressApplication;
  let w: AuthWorld;
  let adminA: TestClient;
  let staffA: TestClient;
  let categoryId: string;
  const owner = createOwnerPrisma();
  let counter = 0;
  const unique = (prefix: string): string =>
    `${prefix}${(counter += 1).toString().padStart(4, '0')}`;
  const phone = (): string => `8${(counter += 1).toString().padStart(9, '0')}`;

  const upload = (
    client: TestClient,
    path: string,
    bytes: Buffer,
    fileName: string,
    contentType = 'image/png',
    extra: Record<string, string> = {},
  ) =>
    client.agent
      .post(path)
      .query({ fileName, ...extra })
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', client.csrf)
      .set('Content-Type', contentType)
      .send(bytes);
  const remove = (client: TestClient, path: string) =>
    client.agent.delete(path).set('Origin', ORIGIN).set('X-CSRF-Token', client.csrf);

  const newBroker = async (body: object = {}): Promise<Broker> => {
    const created = await adminA.post('/brokers', {
      name: unique('Broker '),
      phone: phone(),
      ...body,
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    return BrokerSchema.parse(created.body);
  };
  const withRule = async (broker: Broker, type: string, value: string): Promise<Broker> => {
    const ruled = await adminA.post(`/brokers/${broker.id}/rules`, { type, value });
    expect(ruled.status, JSON.stringify(ruled.body)).toBe(201);
    return BrokerSchema.parse(ruled.body);
  };
  const newCustomer = async (): Promise<string> =>
    (
      await owner.customer.create({
        data: { name: unique('Buyer '), phone: `7${(counter += 1).toString().padStart(9, '0')}` },
      })
    ).id;
  const stockedItemId = async (): Promise<string> => {
    const item = await owner.item.create({
      data: {
        itemCode: unique('BC'),
        name: 'Commission test item',
        categoryId,
        unitCode: 'PCS',
        isSerialized: false,
      },
    });
    await owner.stockBalance.create({
      data: { branchId: w.branchA, itemId: item.id, state: 'AVAILABLE', quantity: 50 },
    });
    await owner.stockLedger.create({
      data: {
        branchId: w.branchA,
        itemId: item.id,
        state: 'AVAILABLE',
        qtyDelta: 50,
        movementType: 'OPENING_BALANCE',
      },
    });
    return item.id;
  };
  const draft = async (
    brokerId: string | null,
    commission: object | undefined,
    price = '1000',
    itemId?: string,
  ) => {
    const response = await staffA.post('/invoices', {
      customerId: await newCustomer(),
      type: 'NON_GST',
      brokerId,
      ...(commission ? { commission } : {}),
      lines: [{ itemId: itemId ?? (await stockedItemId()), qty: 1, unitPrice: price }],
    });
    return response;
  };
  const draftOk = async (
    brokerId: string | null,
    commission: object | undefined,
    price = '1000',
    itemId?: string,
  ): Promise<Invoice> => {
    const response = await draft(brokerId, commission, price, itemId);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return InvoiceSchema.parse(response.body);
  };
  const issue = async (invoice: Invoice): Promise<Invoice> => {
    const response = await staffA.post(`/invoices/${invoice.id}/issue`, {
      rowVersion: invoice.rowVersion,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return InvoiceSchema.parse(response.body);
  };
  const commissionOf = async (invoiceId: string): Promise<Commission | undefined> =>
    CommissionListResponseSchema.parse(
      (await adminA.get('/commissions?pageSize=100')).body,
    ).items.find((item) => item.invoiceId === invoiceId);

  beforeAll(async () => {
    w = await createAuthWorld(owner);
    categoryId = (await owner.itemCategory.findFirstOrThrow({ where: { name: 'Vehicles' } })).id;
    app = await createTestApp();
    adminA = await loggedIn(app, 'admin_a');
    staffA = await loggedIn(app, 'staff_a');
    return async () => {
      await app.close();
      await owner.$disconnect();
    };
  });

  describe('broker address, photo and documents', () => {
    it('keeps an address, shows it in the list, and lets it be changed or cleared', async () => {
      const broker = await newBroker({ address: '12 Station Road, Howrah' });
      expect(broker.address).toBe('12 Station Road, Howrah');
      expect(broker.hasPhoto).toBe(false);
      const changed = await adminA.patch(`/brokers/${broker.id}`, {
        address: 'New address',
        rowVersion: broker.rowVersion,
      });
      expect(BrokerSchema.parse(changed.body).address).toBe('New address');
      const cleared = await adminA.patch(`/brokers/${broker.id}`, {
        address: null,
        rowVersion: BrokerSchema.parse(changed.body).rowVersion,
      });
      expect(BrokerSchema.parse(cleared.body).address).toBeNull();
      const bad = await adminA.post('/brokers', { name: unique('Broker '), address: ' ' });
      expect(bad.status).toBe(400);
    });

    it('stores one photo, replaces it, serves it and removes it', async () => {
      const broker = await newBroker();
      const first = await upload(adminA, `/brokers/${broker.id}/photo`, PNG, 'face.png');
      expect(first.status, JSON.stringify(first.body)).toBe(201);
      const afterFirst = BrokerSchema.parse(first.body);
      expect(afterFirst.photo?.fileName).toBe('face.png');
      expect(afterFirst.hasPhoto).toBe(true);
      const served = await adminA.get(`/brokers/${broker.id}/photo`);
      expect(served.status).toBe(200);
      expect(served.headers['content-type']).toContain('image/png');
      expect(served.headers['x-content-type-options']).toBe('nosniff');

      const jpeg = Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.from('jpeg')]);
      const second = await upload(
        adminA,
        `/brokers/${broker.id}/photo`,
        jpeg,
        'new.jpg',
        'image/jpeg',
      );
      expect(BrokerSchema.parse(second.body).photo?.fileName).toBe('new.jpg');
      expect(await owner.brokerFile.count({ where: { brokerId: broker.id, kind: 'PHOTO' } })).toBe(
        1,
      );

      const removed = await remove(adminA, `/brokers/${broker.id}/photo`);
      expect(BrokerSchema.parse(removed.body).photo).toBeNull();
      expect((await adminA.get(`/brokers/${broker.id}/photo`)).status).toBe(404);
    });

    it('refuses a photo that is a PDF, not a picture, or too large, and a staff member who may not manage brokers', async () => {
      const broker = await newBroker();
      expect(
        (await upload(adminA, `/brokers/${broker.id}/photo`, PDF, 'a.pdf', 'application/pdf'))
          .status,
      ).toBe(400);
      expect(
        (await upload(adminA, `/brokers/${broker.id}/photo`, Buffer.from('not a picture'), 'a.png'))
          .status,
      ).toBe(400);
      const wrongType = await upload(
        adminA,
        `/brokers/${broker.id}/photo`,
        PNG,
        'a.png',
        'image/jpeg',
      );
      expect(wrongType.status).toBe(400);
      const big = Buffer.concat([PNG, Buffer.alloc(5 * 1024 * 1024)]);
      expect((await upload(adminA, `/brokers/${broker.id}/photo`, big, 'big.png')).status).toBe(
        400,
      );
      expect((await upload(staffA, `/brokers/${broker.id}/photo`, PNG, 'a.png')).status).toBe(403);
    });

    it('keeps documents with a label, serves them, and removes them', async () => {
      const broker = await newBroker();
      const added = await upload(
        adminA,
        `/brokers/${broker.id}/documents`,
        PDF,
        'aadhaar.pdf',
        'application/pdf',
        {
          label: 'Aadhaar card',
        },
      );
      expect(added.status, JSON.stringify(added.body)).toBe(201);
      const documents = BrokerSchema.parse(added.body).documents ?? [];
      expect(documents).toHaveLength(1);
      expect(documents[0]).toMatchObject({
        label: 'Aadhaar card',
        fileName: 'aadhaar.pdf',
        kind: 'DOCUMENT',
      });
      const id = documents[0]?.id ?? '';
      const file = await adminA.get(`/brokers/${broker.id}/documents/${id}/file`);
      expect(file.status).toBe(200);
      expect(file.headers['content-disposition']).toContain('attachment');
      expect(
        await owner.auditLog.count({
          where: { action: 'BROKER_DOCUMENT_VIEWED', entityId: broker.id },
        }),
      ).toBe(1);
      const gone = await remove(adminA, `/brokers/${broker.id}/documents/${id}`);
      expect(BrokerSchema.parse(gone.body).documents).toHaveLength(0);
      expect((await adminA.get(`/brokers/${broker.id}/documents/${id}/file`)).status).toBe(404);
      expect(
        (await upload(staffA, `/brokers/${broker.id}/documents`, PDF, 'x.pdf', 'application/pdf'))
          .status,
      ).toBe(403);
    });
  });

  describe('commission agreed on the invoice', () => {
    it('records a fixed amount agreed for the sale, whether or not the broker has a standing rule', async () => {
      const broker = await withRule(await newBroker(), 'PERCENT', '10.00');
      const invoice = await issue(await draftOk(broker.id, { type: 'FIXED', amount: '150' }));
      expect(invoice.commission).toMatchObject({
        type: 'FIXED',
        amount: '150.00',
        hasPhoto: false,
      });
      const commission = await commissionOf(invoice.id);
      expect(commission).toMatchObject({
        kind: 'FIXED',
        amount: '150.00',
        ruleType: null,
        ruleValue: null,
        status: 'PAYABLE',
      });
    });

    it('never pays more than the taxable value of the invoice', async () => {
      const broker = await newBroker();
      const invoice = await issue(
        await draftOk(broker.id, { type: 'FIXED', amount: '500' }, '100'),
      );
      expect((await commissionOf(invoice.id))?.amount).toBe('100.00');
    });

    it('pays nothing when "no commission" was agreed, even if the broker has a rule', async () => {
      const broker = await withRule(await newBroker(), 'PERCENT', '10.00');
      const invoice = await issue(await draftOk(broker.id, { type: 'NONE' }));
      expect(invoice.commission?.type).toBe('NONE');
      expect(await commissionOf(invoice.id)).toBeUndefined();
    });

    it('still uses the broker rule when nothing was agreed on an older draft', async () => {
      const broker = await withRule(await newBroker(), 'PERCENT', '10.00');
      const invoice = await issue(await draftOk(broker.id, undefined));
      expect(invoice.commission).toBeNull();
      expect(await commissionOf(invoice.id)).toMatchObject({
        kind: 'RULE',
        amount: '100.00',
        ruleType: 'PERCENT',
      });
    });

    it('records a gift with its name, value and photo, and moves no stock for it', async () => {
      const broker = await newBroker();
      const itemId = await stockedItemId();
      const created = await draftOk(
        broker.id,
        { type: 'GIFT', amount: '800', giftName: 'Mixer grinder' },
        '1000',
        itemId,
      );
      expect(created.commission).toMatchObject({
        type: 'GIFT',
        giftName: 'Mixer grinder',
        amount: '800.00',
        hasPhoto: false,
      });
      const withPhoto = await upload(
        staffA,
        `/invoices/${created.id}/gift-photo`,
        PNG,
        'mixer.png',
      );
      expect(withPhoto.status, JSON.stringify(withPhoto.body)).toBe(201);
      const photoDraft = InvoiceSchema.parse(withPhoto.body);
      expect(photoDraft.commission).toMatchObject({ hasPhoto: true, photoFileName: 'mixer.png' });
      expect((await staffA.get(`/invoices/${created.id}/gift-photo`)).status).toBe(200);

      const invoice = await issue(photoDraft);
      const commission = await commissionOf(invoice.id);
      expect(commission).toMatchObject({
        kind: 'GIFT',
        giftName: 'Mixer grinder',
        amount: '800.00',
        hasGiftPhoto: true,
      });
      const photo = await adminA.get(`/commissions/${commission?.id}/gift-photo`);
      expect(photo.status).toBe(200);
      expect(photo.headers['content-type']).toContain('image/png');
      // the sale is the only movement besides the opening balance: the gift is not stock
      expect(await owner.stockLedger.count({ where: { itemId } })).toBe(2);
    });

    it('lets a gift commission be paid out like any other', async () => {
      const broker = await newBroker();
      const invoice = await issue(
        await draftOk(broker.id, { type: 'GIFT', amount: '300', giftName: 'Wall clock' }),
      );
      const commission = await commissionOf(invoice.id);
      const paid = await adminA.post('/commissions/payout', {
        commissionIds: [commission?.id],
        reference: 'Handed over',
      });
      expect(paid.status, JSON.stringify(paid.body)).toBe(200);
      expect((await commissionOf(invoice.id))?.status).toBe('PAID');
    });

    it('drops the photo when the draft is changed to something other than a gift', async () => {
      const broker = await newBroker();
      const created = await draftOk(broker.id, {
        type: 'GIFT',
        amount: '300',
        giftName: 'Wall clock',
      });
      const photoDraft = InvoiceSchema.parse(
        (await upload(staffA, `/invoices/${created.id}/gift-photo`, PNG, 'c.png')).body,
      );
      const key = (await owner.invoice.findUniqueOrThrow({ where: { id: created.id } }))
        .giftPhotoKey;
      expect(key).not.toBeNull();
      const changed = await staffA.patch(`/invoices/${created.id}`, {
        customerId: created.customerId,
        type: 'NON_GST',
        brokerId: broker.id,
        commission: { type: 'FIXED', amount: '200' },
        lines: created.lines.map((line) => ({
          itemId: line.itemId,
          qty: line.qty,
          unitPrice: line.unitPrice,
        })),
        rowVersion: photoDraft.rowVersion,
      });
      expect(changed.status, JSON.stringify(changed.body)).toBe(200);
      const after = InvoiceSchema.parse(changed.body);
      expect(after.commission).toMatchObject({ type: 'FIXED', hasPhoto: false, giftName: null });
      expect((await staffA.get(`/invoices/${created.id}/gift-photo`)).status).toBe(404);
    });

    it('carries what was agreed, with the photo, onto the reissued draft', async () => {
      const broker = await newBroker();
      const created = await draftOk(broker.id, {
        type: 'GIFT',
        amount: '300',
        giftName: 'Wall clock',
      });
      const photoDraft = InvoiceSchema.parse(
        (await upload(staffA, `/invoices/${created.id}/gift-photo`, PNG, 'c.png')).body,
      );
      const invoice = await issue(photoDraft);
      const reissued = await adminA.post(`/invoices/${invoice.id}/reissue`, {
        rowVersion: invoice.rowVersion,
        reason: 'Wrong customer',
      });
      expect(reissued.status, JSON.stringify(reissued.body)).toBe(201);
      expect(InvoiceSchema.parse(reissued.body).commission).toMatchObject({
        type: 'GIFT',
        giftName: 'Wall clock',
        amount: '300.00',
        hasPhoto: true,
      });
    });

    it('refuses an agreement that makes no sense', async () => {
      const broker = await newBroker();
      expect((await draft(null, { type: 'FIXED', amount: '100' })).status).toBe(400);
      expect((await draft(broker.id, { type: 'FIXED' })).status).toBe(400);
      expect((await draft(broker.id, { type: 'GIFT', amount: '100' })).status).toBe(400);
      expect(
        (await draft(broker.id, { type: 'FIXED', amount: '100', giftName: 'Clock' })).status,
      ).toBe(400);
      expect((await draft(broker.id, { type: 'NONE', amount: '100' })).status).toBe(400);
      expect((await draft(broker.id, { type: 'FIXED', amount: '0' })).status).toBe(400);
    });

    it('accepts a gift photo only for a gift on a draft, and only as a picture', async () => {
      const broker = await newBroker();
      const fixed = await draftOk(broker.id, { type: 'FIXED', amount: '100' });
      expect((await upload(staffA, `/invoices/${fixed.id}/gift-photo`, PNG, 'c.png')).status).toBe(
        400,
      );
      const gift = await draftOk(broker.id, { type: 'GIFT', amount: '100', giftName: 'Clock' });
      expect(
        (await upload(staffA, `/invoices/${gift.id}/gift-photo`, PDF, 'c.pdf', 'application/pdf'))
          .status,
      ).toBe(400);
      const withPhoto = InvoiceSchema.parse(
        (await upload(staffA, `/invoices/${gift.id}/gift-photo`, PNG, 'c.png')).body,
      );
      const issuedGift = await issue(withPhoto);
      expect(
        (await upload(staffA, `/invoices/${issuedGift.id}/gift-photo`, PNG, 'd.png')).status,
      ).toBe(409);
      expect((await remove(staffA, `/invoices/${issuedGift.id}/gift-photo`)).status).toBe(409);
    });

    it('freezes what was agreed once the invoice is issued', async () => {
      const broker = await newBroker();
      const invoice = await issue(await draftOk(broker.id, { type: 'FIXED', amount: '100' }));
      await expect(
        owner.invoice.update({ where: { id: invoice.id }, data: { commissionAmount: '999' } }),
      ).rejects.toThrow();
    });
  });
});
