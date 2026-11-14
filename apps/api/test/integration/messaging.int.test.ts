//apps/api/test/integration/messaging.int.test.ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  BulkPreviewSchema,
  InvoiceSchema,
  MessageCampaignListResponseSchema,
  MessageCampaignSchema,
  MessageOptOutListResponseSchema,
  MessagingStatusSchema,
} from '@erp/contracts';
import type { Invoice, MessageCampaign } from '@erp/contracts';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuthWorld, loggedIn } from '../support/auth-world.js';
import type { AuthWorld, TestClient } from '../support/auth-world.js';
import { createTestApp } from '../support/create-test-app.js';
import { createOwnerPrisma } from '../support/fixtures.js';
import {
  FakeMailClient,
  FakeWhatsAppClient,
  MAIL_CLIENT,
  OutsideWindowError,
  PermanentSendError,
  WHATSAPP_CLIENT,
} from '../../src/features/messaging/clients.js';

describe('messages to customers by WhatsApp and email', () => {
  let app: NestExpressApplication;
  let w: AuthWorld;
  let adminA: TestClient;
  let staffA: TestClient;
  let whatsapp: FakeWhatsAppClient;
  let mail: FakeMailClient;
  let categoryId: string;
  const owner = createOwnerPrisma();
  let counter = 0;
  const unique = (prefix: string): string =>
    `${prefix}${(counter += 1).toString().padStart(4, '0')}`;
  const tenDigits = (): string => `9${(counter += 1).toString().padStart(9, '0')}`;

  const customer = async (over: { name?: string; phone?: string; email?: string | null } = {}) =>
    owner.customer.create({
      data: {
        name: over.name ?? unique('Buyer '),
        phone: over.phone ?? tenDigits(),
        email: over.email === undefined ? null : over.email,
      },
    });
  /** An invoice issued to the customer: they owe its total. */
  const invoiceFor = async (customerId: string, price = '100'): Promise<Invoice> => {
    const item = await owner.item.create({
      data: {
        itemCode: unique('MS'),
        name: 'Msg item',
        categoryId,
        unitCode: 'PCS',
        isSerialized: false,
      },
    });
    await owner.stockBalance.create({
      data: { branchId: w.branchA, itemId: item.id, state: 'AVAILABLE', quantity: 5 },
    });
    const created = await staffA.post('/invoices', {
      customerId,
      type: 'NON_GST',
      lines: [{ itemId: item.id, qty: 1, unitPrice: price }],
    });
    expect(created.status, JSON.stringify(created.body)).toBe(201);
    const draft = InvoiceSchema.parse(created.body);
    const issued = await staffA.post(`/invoices/${draft.id}/issue`, {
      rowVersion: draft.rowVersion,
    });
    expect(issued.status, JSON.stringify(issued.body)).toBe(200);
    return InvoiceSchema.parse(issued.body);
  };
  const created = async (
    client: TestClient,
    body: Record<string, unknown>,
  ): Promise<MessageCampaign> => {
    const response = await client.post('/messages/bulk', body);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return MessageCampaignSchema.parse(response.body);
  };
  const sendAll = async (client: TestClient, id: string): Promise<MessageCampaign> => {
    let latest = MessageCampaignSchema.parse(
      (await client.post(`/messages/campaigns/${id}/send`, {})).body,
    );
    for (let round = 0; round < 10 && latest.pending > 0; round += 1) {
      const next = MessageCampaignSchema.parse(
        (await client.post(`/messages/campaigns/${id}/send`, {})).body,
      );
      if (next.pending === latest.pending && next.sent === latest.sent) break;
      latest = next;
    }
    return latest;
  };
  const selected = (...ids: string[]) => ({ kind: 'SELECTED', customerIds: ids });

  beforeAll(async () => {
    w = await createAuthWorld(owner);
    categoryId = (await owner.itemCategory.findFirstOrThrow({ where: { name: 'Vehicles' } })).id;
    app = await createTestApp();
    adminA = await loggedIn(app, 'admin_a');
    staffA = await loggedIn(app, 'staff_a');
    whatsapp = app.get<FakeWhatsAppClient>(WHATSAPP_CLIENT);
    mail = app.get<FakeMailClient>(MAIL_CLIENT);
    return async () => {
      await app.close();
      await owner.$disconnect();
    };
  });
  beforeEach(() => {
    whatsapp.sent.length = 0;
    whatsapp.failures = [];
    whatsapp.missing.clear();
    mail.sent.length = 0;
    mail.failures = [];
  });

  describe('who may use it', () => {
    it('tells whether WhatsApp and email are set up', async () => {
      const status = MessagingStatusSchema.parse((await staffA.get('/messages/status')).body);
      expect(status).toEqual({
        whatsapp: {
          configured: true,
          templates: { general: true, invoice: true, receipt: true, reminder: true },
        },
        email: { configured: true, from: 'shop@example.com' },
      });
    });

    it('lets staff send a document but not a bulk message, and an Admin do both', async () => {
      const buyer = await customer();
      const body = {
        channel: 'WHATSAPP',
        audience: selected(buyer.id),
        body: 'Hello {{name}}, welcome.',
      };
      expect((await staffA.post('/messages/bulk', body)).status).toBe(403);
      expect((await staffA.post('/messages/bulk/preview', body)).status).toBe(403);
      expect((await staffA.get('/messages/campaigns')).status).toBe(403);
      expect((await adminA.post('/messages/bulk', body)).status).toBe(201);
      expect((await request(app.getHttpServer()).get('/messages/status')).status).toBe(401);
    });
  });

  describe('a bulk message', () => {
    it('counts who it would reach, leaving out those with no usable phone number or email address', async () => {
      const a = await customer({ email: 'a@example.com' });
      const b = await customer({ phone: '123', email: 'b@example.com' });
      const c = await customer();
      const both = selected(a.id, b.id, c.id);
      const phones = BulkPreviewSchema.parse(
        (await adminA.post('/messages/bulk/preview', { channel: 'WHATSAPP', audience: both })).body,
      );
      expect(phones).toMatchObject({ count: 2, withoutContact: 1 });
      expect(phones.sampleNames).toEqual([a.name, c.name].sort());
      const emails = BulkPreviewSchema.parse(
        (await adminA.post('/messages/bulk/preview', { channel: 'EMAIL', audience: both })).body,
      );
      expect(emails).toMatchObject({ count: 2, withoutContact: 1 });
    });

    it('is made first and sent after: each person gets their own message, filled in for them', async () => {
      const a = await customer({ name: 'Ravi Kumar' });
      const b = await customer({ name: 'Asha Rao', phone: '+91 98765-43210' });
      const campaign = await created(adminA, {
        channel: 'WHATSAPP',
        audience: selected(a.id, b.id),
        body: 'Dear {{name}}, {{shop}} is open all week.',
      });
      expect(campaign).toMatchObject({
        kind: 'BULK',
        channel: 'WHATSAPP',
        total: 2,
        pending: 2,
        sent: 0,
      });
      expect(whatsapp.sent).toHaveLength(0);
      const done = await sendAll(adminA, campaign.id);
      expect(done).toMatchObject({ sent: 2, failed: 0, pending: 0 });
      expect(whatsapp.sent.map((m) => [m.kind, m.to, m.text.startsWith('Dear ')]).sort()).toEqual(
        [
          ['TEXT', `91${a.phone}`, true],
          ['TEXT', '919876543210', true],
        ].sort(),
      );
      expect(whatsapp.sent.some((m) => m.text.includes('Dear Ravi Kumar,'))).toBe(true);
      expect(whatsapp.sent.some((m) => m.text.includes('Dear Asha Rao,'))).toBe(true);
      expect(done.deliveries?.every((d) => d.via === 'TEXT' && d.sentAt !== null)).toBe(true);
      const audits = await owner.auditLog.findMany({
        where: { action: 'MESSAGE_BULK_CREATED', entityId: campaign.id },
      });
      expect(audits).toHaveLength(1);
    });

    it('goes out in batches, so a long list never holds one request', async () => {
      const people = await Promise.all(Array.from({ length: 25 }, () => customer()));
      const campaign = await created(adminA, {
        channel: 'WHATSAPP',
        audience: selected(...people.map((p) => p.id)),
        body: 'Sale on this week for {{name}}.',
      });
      const first = MessageCampaignSchema.parse(
        (await adminA.post(`/messages/campaigns/${campaign.id}/send`, {})).body,
      );
      expect(first).toMatchObject({ sent: 20, pending: 5 });
      const second = MessageCampaignSchema.parse(
        (await adminA.post(`/messages/campaigns/${campaign.id}/send`, {})).body,
      );
      expect(second).toMatchObject({ sent: 25, pending: 0 });
      const again = MessageCampaignSchema.parse(
        (await adminA.post(`/messages/campaigns/${campaign.id}/send`, {})).body,
      );
      expect(again.sent).toBe(25);
      expect(whatsapp.sent).toHaveLength(25);
    });

    it('can go to those who owe money, with the amount each owes', async () => {
      const owes = await customer({ name: 'Owes Money' });
      const clear = await customer({ name: 'Owes Nothing' });
      await invoiceFor(owes.id, '1500');
      const preview = BulkPreviewSchema.parse(
        (
          await adminA.post('/messages/bulk/preview', {
            channel: 'WHATSAPP',
            audience: { kind: 'DUES' },
          })
        ).body,
      );
      expect(preview.sampleNames.length).toBeGreaterThan(0);
      const campaign = await created(adminA, {
        channel: 'WHATSAPP',
        audience: { kind: 'DUES' },
        body: 'Dear {{name}}, Rs. {{due}} is due.',
      });
      const done = await sendAll(adminA, campaign.id);
      const names = done.deliveries?.map((d) => d.recipientName) ?? [];
      expect(names).toContain('Owes Money');
      expect(names).not.toContain(clear.name);
      expect(whatsapp.sent.find((m) => m.text.includes('Owes Money'))?.text).toBe(
        'Dear Owes Money, Rs. 1,500.00 is due.',
      );
    });

    it('goes to everyone for an audience of all customers, and a person with two records is messaged once', async () => {
      const phone = tenDigits();
      const first = await customer({ name: 'Twin One', phone });
      await customer({ name: 'Twin Two', phone });
      const campaign = await created(adminA, {
        channel: 'WHATSAPP',
        audience: { kind: 'ALL' },
        body: 'Hello {{name}}, thank you.',
      });
      const done = await sendAll(adminA, campaign.id);
      expect(done.deliveries?.filter((d) => d.toAddress === phone)).toHaveLength(1);
      expect(done.deliveries?.some((d) => d.recipientName === first.name)).toBe(true);
    });

    it('goes as a template to someone who has not written in the last 24 hours, and fails with the reason when there is no template', async () => {
      const a = await customer({ name: 'Outside One' });
      const b = await customer({ name: 'Outside Two' });
      whatsapp.failures = [new OutsideWindowError('More than 24 hours')];
      const withTemplate = await created(adminA, {
        channel: 'WHATSAPP',
        audience: selected(a.id),
        body: 'Hello {{name}}, news.',
      });
      const sent = await sendAll(adminA, withTemplate.id);
      expect(sent.deliveries?.[0]).toMatchObject({ status: 'SENT', via: 'TEMPLATE' });
      expect(whatsapp.sent.map((m) => m.kind)).toEqual(['TEMPLATE']);
      whatsapp.missing.add('GENERAL');
      whatsapp.failures = [new OutsideWindowError('More than 24 hours')];
      const without = await created(adminA, {
        channel: 'WHATSAPP',
        audience: selected(b.id),
        body: 'Hello {{name}}, news.',
      });
      const failed = await sendAll(adminA, without.id);
      expect(failed).toMatchObject({ sent: 0, failed: 1 });
      expect(failed.deliveries?.[0]?.error).toContain('WHATSAPP_TEMPLATE_NAME');
    });

    it('marks a number that can never work as failed at once, and tries a passing problem three times in all', async () => {
      const a = await customer();
      const b = await customer();
      whatsapp.failures = [new PermanentSendError('Not on WhatsApp')];
      const permanent = await created(adminA, {
        channel: 'WHATSAPP',
        audience: selected(a.id),
        body: 'Hello {{name}}, hi.',
      });
      const one = await sendAll(adminA, permanent.id);
      expect(one.deliveries?.[0]).toMatchObject({
        status: 'FAILED',
        error: 'Not on WhatsApp',
        attempts: 1,
      });
      whatsapp.failures = [
        new Error('WhatsApp is busy'),
        new Error('WhatsApp is busy'),
        new Error('WhatsApp is busy'),
      ];
      const passing = await created(adminA, {
        channel: 'WHATSAPP',
        audience: selected(b.id),
        body: 'Hello {{name}}, hi.',
      });
      const first = MessageCampaignSchema.parse(
        (await adminA.post(`/messages/campaigns/${passing.id}/send`, {})).body,
      );
      expect(first).toMatchObject({ pending: 1, failed: 0 });
      await adminA.post(`/messages/campaigns/${passing.id}/send`, {});
      const third = MessageCampaignSchema.parse(
        (await adminA.post(`/messages/campaigns/${passing.id}/send`, {})).body,
      );
      expect(third).toMatchObject({ pending: 0, failed: 1 });
      expect(third.deliveries?.[0]).toMatchObject({ attempts: 3, error: 'WhatsApp is busy' });
    });

    it('can send the failed ones again', async () => {
      const a = await customer();
      whatsapp.failures = [new PermanentSendError('Not on WhatsApp')];
      const campaign = await created(adminA, {
        channel: 'WHATSAPP',
        audience: selected(a.id),
        body: 'Hello {{name}}, hi.',
      });
      expect((await sendAll(adminA, campaign.id)).failed).toBe(1);
      const retry = MessageCampaignSchema.parse(
        (await adminA.post(`/messages/campaigns/${campaign.id}/retry`, {})).body,
      );
      expect(retry).toMatchObject({ failed: 0, pending: 1 });
      expect(retry.deliveries?.[0]).toMatchObject({ attempts: 0, error: null });
      expect(await sendAll(adminA, campaign.id)).toMatchObject({ sent: 1, failed: 0 });
    });

    it('goes by email with a subject to those who have an address', async () => {
      const a = await customer({ name: 'Mail One', email: 'one@example.com' });
      const b = await customer({ name: 'No Mail' });
      expect(
        (
          await adminA.post('/messages/bulk', {
            channel: 'EMAIL',
            audience: selected(a.id),
            body: 'Hello {{name}}, news.',
          })
        ).status,
      ).toBe(400);
      const campaign = await created(adminA, {
        channel: 'EMAIL',
        subject: 'News from the shop',
        audience: selected(a.id, b.id),
        body: 'Hello {{name}}, news.',
      });
      expect(campaign.total).toBe(1);
      expect(await sendAll(adminA, campaign.id)).toMatchObject({ sent: 1 });
      expect(mail.sent).toEqual([
        { to: 'one@example.com', subject: 'News from the shop', text: 'Hello Mail One, news.' },
      ]);
    });

    it('refuses a message with an unknown placeholder, no one to send to, and a missing customer', async () => {
      const noPhone = await customer({ phone: '123' });
      expect(
        (
          await adminA.post('/messages/bulk', {
            channel: 'WHATSAPP',
            audience: selected(noPhone.id),
            body: 'Hello {{nobody}}.',
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await adminA.post('/messages/bulk', {
            channel: 'WHATSAPP',
            audience: selected(noPhone.id),
            body: 'Hello {{name}}, hi.',
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await adminA.post('/messages/bulk', {
            channel: 'WHATSAPP',
            audience: selected('0b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59'),
            body: 'Hello {{name}}, hi.',
          })
        ).status,
      ).toBe(400);
    });

    it('is listed with how it went, and opened to see each person', async () => {
      const a = await customer();
      const campaign = await created(adminA, {
        channel: 'WHATSAPP',
        audience: selected(a.id),
        body: 'Hello {{name}}, hi.',
      });
      await sendAll(adminA, campaign.id);
      const list = MessageCampaignListResponseSchema.parse(
        (await adminA.get('/messages/campaigns?kind=BULK')).body,
      );
      expect(list.items.find((row) => row.id === campaign.id)).toMatchObject({ sent: 1, total: 1 });
      const opened = MessageCampaignSchema.parse(
        (await adminA.get(`/messages/campaigns/${campaign.id}`)).body,
      );
      expect(opened.deliveries).toHaveLength(1);
      expect(
        (await adminA.get('/messages/campaigns/0b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59')).status,
      ).toBe(404);
    });
  });

  describe('the opt-out list', () => {
    it('leaves out a customer who asked to stop, tells how many, and brings them back when removed', async () => {
      const stays = await customer({ name: 'Opt Stays' });
      const leaves = await customer({ name: 'Opt Leaves' });
      const add = await adminA.post('/messages/opt-outs', {
        customerId: leaves.id,
        reason: 'Asked on the phone',
      });
      expect(add.status, JSON.stringify(add.body)).toBe(201);
      expect((await adminA.post('/messages/opt-outs', { customerId: leaves.id })).status).toBe(201);
      const list = MessageOptOutListResponseSchema.parse(
        (await adminA.get('/messages/opt-outs')).body,
      );
      expect(list.items.filter((entry) => entry.customerId === leaves.id)).toHaveLength(1);
      const preview = BulkPreviewSchema.parse(
        (
          await adminA.post('/messages/bulk/preview', {
            channel: 'WHATSAPP',
            audience: selected(stays.id, leaves.id),
          })
        ).body,
      );
      expect(preview).toMatchObject({ count: 1, optedOut: 1 });
      const campaign = await created(adminA, {
        channel: 'WHATSAPP',
        audience: selected(stays.id, leaves.id),
        body: 'Hello {{name}}',
      });
      expect(campaign.deliveries?.map((d) => d.recipientName)).toEqual(['Opt Stays']);
      const only = await adminA.post('/messages/bulk', {
        channel: 'WHATSAPP',
        audience: selected(leaves.id),
        body: 'Hello {{name}}',
      });
      expect(only.status).toBe(422);
      expect((await adminA.delete(`/messages/opt-outs/${leaves.id}`)).status).toBe(200);
      expect((await adminA.delete(`/messages/opt-outs/${leaves.id}`)).status).toBe(404);
      const back = BulkPreviewSchema.parse(
        (
          await adminA.post('/messages/bulk/preview', {
            channel: 'WHATSAPP',
            audience: selected(stays.id, leaves.id),
          })
        ).body,
      );
      expect(back).toMatchObject({ count: 2, optedOut: 0 });
      const actions = await owner.auditLog.findMany({
        where: { entityId: leaves.id, action: { startsWith: 'MESSAGE_OPT_OUT' } },
        orderBy: { createdAt: 'asc' },
      });
      expect(actions.map((a) => a.action)).toEqual([
        'MESSAGE_OPT_OUT_ADDED',
        'MESSAGE_OPT_OUT_REMOVED',
      ]);
    });

    it('is for an Admin only, refuses a missing customer, and still lets an invoice go to someone on the list', async () => {
      const buyer = await customer();
      expect((await staffA.get('/messages/opt-outs')).status).toBe(403);
      expect((await staffA.post('/messages/opt-outs', { customerId: buyer.id })).status).toBe(403);
      expect(
        (
          await adminA.post('/messages/opt-outs', {
            customerId: '0b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59',
          })
        ).status,
      ).toBe(404);
      await adminA.post('/messages/opt-outs', { customerId: buyer.id });
      const invoice = await invoiceFor(buyer.id);
      const sent = MessageCampaignSchema.parse(
        (
          await staffA.post('/messages/documents', {
            kind: 'INVOICE',
            id: invoice.id,
            channel: 'WHATSAPP',
          })
        ).body,
      );
      expect(sent).toMatchObject({ sent: 1, failed: 0 });
    });

    it('sends a reminder to people who owe money with the reminder template', async () => {
      const owes = await customer({ name: 'Reminder Owes' });
      await invoiceFor(owes.id, '700');
      const campaign = await created(adminA, {
        channel: 'WHATSAPP',
        audience: { kind: 'DUES' },
        body: 'Dear {{name}}, Rs. {{due}} is due.',
      });
      expect(campaign.templateKey).toBe('REMINDER');
      whatsapp.missing.add('REMINDER');
      whatsapp.failures = [new OutsideWindowError('More than 24 hours')];
      const done = await sendAll(adminA, campaign.id);
      expect(done.deliveries?.find((d) => d.recipientName === 'Reminder Owes')?.error).toContain(
        'WHATSAPP_TEMPLATE_REMINDER',
      );
    });
  });

  describe('an invoice sent to the customer', () => {
    it('goes by WhatsApp as a PDF with a message that names the customer and the invoice', async () => {
      const buyer = await customer({ name: 'Sajjat Ali' });
      const invoice = await invoiceFor(buyer.id, '2500');
      const response = await staffA.post('/messages/documents', {
        kind: 'INVOICE',
        id: invoice.id,
        channel: 'WHATSAPP',
      });
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      const campaign = MessageCampaignSchema.parse(response.body);
      expect(campaign).toMatchObject({ kind: 'INVOICE', sent: 1, failed: 0 });
      expect(campaign.deliveries?.[0]).toMatchObject({ via: 'DOCUMENT', toAddress: buyer.phone });
      expect(whatsapp.sent).toHaveLength(1);
      expect(whatsapp.sent[0]).toMatchObject({ kind: 'DOCUMENT', to: `91${buyer.phone}` });
      expect(whatsapp.sent[0]?.fileName).toContain(
        (invoice.invoiceNo ?? '').replace(/[^A-Za-z0-9._-]/g, '-'),
      );
      expect(whatsapp.sent[0]?.text).toContain('Sajjat Ali');
      expect(whatsapp.sent[0]?.text).toContain(invoice.invoiceNo ?? 'x');
      expect(whatsapp.sent[0]?.text).toContain('2,500.00');
      expect(
        await owner.auditLog.count({
          where: { action: 'MESSAGE_DOCUMENT_SENT', entityId: campaign.id },
        }),
      ).toBe(1);
    });

    it('goes by email with the PDF attached, to the address given or the customer’s own', async () => {
      const buyer = await customer({ email: 'sajjat@example.com' });
      const invoice = await invoiceFor(buyer.id);
      const own = MessageCampaignSchema.parse(
        (
          await staffA.post('/messages/documents', {
            kind: 'INVOICE',
            id: invoice.id,
            channel: 'EMAIL',
          })
        ).body,
      );
      expect(own.sent).toBe(1);
      expect(mail.sent[0]).toMatchObject({ to: 'sajjat@example.com' });
      expect(mail.sent[0]?.fileName).toMatch(/\.pdf$/);
      expect(mail.sent[0]?.subject).toContain('Invoice');
      await staffA.post('/messages/documents', {
        kind: 'INVOICE',
        id: invoice.id,
        channel: 'EMAIL',
        to: 'accounts@example.com',
        message: 'Please find the invoice attached.',
      });
      expect(mail.sent[1]).toMatchObject({
        to: 'accounts@example.com',
        text: 'Please find the invoice attached.',
      });
    });

    it('can be sent to another number than the customer’s, and says when there is nowhere to send it', async () => {
      const noEmail = await customer();
      const invoice = await invoiceFor(noEmail.id);
      const missing = await staffA.post('/messages/documents', {
        kind: 'INVOICE',
        id: invoice.id,
        channel: 'EMAIL',
      });
      expect(missing.status).toBe(400);
      expect(JSON.stringify(missing.body)).toContain('no email address');
      expect(
        (
          await staffA.post('/messages/documents', {
            kind: 'INVOICE',
            id: invoice.id,
            channel: 'EMAIL',
            to: 'nonsense',
          })
        ).status,
      ).toBe(400);
      expect(
        (
          await staffA.post('/messages/documents', {
            kind: 'INVOICE',
            id: invoice.id,
            channel: 'WHATSAPP',
            to: '12',
          })
        ).status,
      ).toBe(400);
      const other = await staffA.post('/messages/documents', {
        kind: 'INVOICE',
        id: invoice.id,
        channel: 'WHATSAPP',
        to: '98765 43210',
      });
      expect(other.status, JSON.stringify(other.body)).toBe(201);
      expect(whatsapp.sent[0]?.to).toBe('919876543210');
    });

    it('goes as a template message when the customer has not written in 24 hours, saying the PDF is not attached', async () => {
      const buyer = await customer();
      const invoice = await invoiceFor(buyer.id);
      whatsapp.failures = [new OutsideWindowError('More than 24 hours')];
      const campaign = MessageCampaignSchema.parse(
        (
          await staffA.post('/messages/documents', {
            kind: 'INVOICE',
            id: invoice.id,
            channel: 'WHATSAPP',
          })
        ).body,
      );
      expect(campaign.deliveries?.[0]).toMatchObject({ status: 'SENT', via: 'TEMPLATE' });
      whatsapp.missing.add('INVOICE');
      whatsapp.failures = [new OutsideWindowError('More than 24 hours')];
      const noTemplate = MessageCampaignSchema.parse(
        (
          await staffA.post('/messages/documents', {
            kind: 'INVOICE',
            id: invoice.id,
            channel: 'WHATSAPP',
          })
        ).body,
      );
      expect(noTemplate.deliveries?.[0]).toMatchObject({ status: 'FAILED' });
      expect(noTemplate.deliveries?.[0]?.error).toContain('template');
    });

    it('says so when the send fails, and keeps the failed delivery on record', async () => {
      const buyer = await customer();
      const invoice = await invoiceFor(buyer.id);
      mail.failures = [new PermanentSendError('Mailbox does not exist')];
      const failed = MessageCampaignSchema.parse(
        (
          await staffA.post('/messages/documents', {
            kind: 'INVOICE',
            id: invoice.id,
            channel: 'EMAIL',
            to: 'gone@example.com',
          })
        ).body,
      );
      expect(failed).toMatchObject({ sent: 0, failed: 1 });
      expect(failed.deliveries?.[0]?.error).toBe('Mailbox does not exist');
    });

    it('uses the invoice template, and fails naming that setting when it is missing', async () => {
      const buyer = await customer();
      const invoice = await invoiceFor(buyer.id);
      whatsapp.failures = [new OutsideWindowError('More than 24 hours')];
      const sent = MessageCampaignSchema.parse(
        (
          await staffA.post('/messages/documents', {
            kind: 'INVOICE',
            id: invoice.id,
            channel: 'WHATSAPP',
          })
        ).body,
      );
      expect(sent.templateKey).toBe('INVOICE');
      expect(whatsapp.sent[0]).toMatchObject({ kind: 'TEMPLATE', templateKey: 'INVOICE' });
      whatsapp.missing.add('INVOICE');
      whatsapp.failures = [new OutsideWindowError('More than 24 hours')];
      const failed = MessageCampaignSchema.parse(
        (
          await staffA.post('/messages/documents', {
            kind: 'INVOICE',
            id: invoice.id,
            channel: 'WHATSAPP',
          })
        ).body,
      );
      expect(failed.deliveries?.[0]?.error).toContain('WHATSAPP_TEMPLATE_INVOICE');
    });

    it('is refused for an invoice that does not exist', async () => {
      const response = await staffA.post('/messages/documents', {
        kind: 'INVOICE',
        id: '0b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59',
        channel: 'WHATSAPP',
      });
      expect(response.status).toBe(404);
    });
  });
});
