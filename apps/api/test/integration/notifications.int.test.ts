import type { NestExpressApplication } from '@nestjs/platform-express';
import { NotificationListResponseSchema } from '@erp/contracts';
import { Prisma } from '@prisma/client';
import { pino } from 'pino';
import pg from 'pg';
import request from 'supertest';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { loadWorkerEnv } from '../../../worker/src/config.js';
import { runReminders } from '../../../worker/src/jobs/reminders.js';
import {
  deliverNotification,
  MAX_DELIVERY_ATTEMPTS,
} from '../../../worker/src/notifications/deliver.js';
import { startWorker } from '../../../worker/src/worker.js';
import {
  FakeProvider,
  PermanentDeliveryError,
} from '../../../worker/src/notifications/provider.js';
import { createAuthWorld, loggedIn } from '../support/auth-world.js';
import type { AuthWorld, TestClient } from '../support/auth-world.js';
import { createTestApp } from '../support/create-test-app.js';
import { createOwnerPrisma } from '../support/fixtures.js';
import { connectApp, sqlState } from '../support/pg.js';
import { TEST_WORKER_DATABASE_URL } from '../support/test-env.js';

const logger = pino({ level: process.env['DEBUG_WORKER'] ? 'debug' : 'silent' });
const day = 86_400_000;

describe('notifications', () => {
  let app: NestExpressApplication;
  let w: AuthWorld;
  let pool: pg.Pool;
  const owner = createOwnerPrisma();
  let n = 0;
  const unique = (prefix: string): string => `${prefix}${(n += 1).toString().padStart(4, '0')}`;
  const phone = (): string => `7${(n += 1).toString().padStart(9, '0')}`;
  const clients: Record<string, TestClient> = {};

  const run = (options: { channels?: ('EMAIL' | 'SMS' | 'WHATSAPP')[]; now?: Date } = {}) =>
    runReminders(pool, logger, {
      channels: options.channels ?? [],
      ...(options.now ? { now: options.now } : {}),
    });

  const forUser = (userId: string, kind?: string) =>
    owner.notification.findMany({
      where: { userId, channel: 'IN_APP', ...(kind ? { kind } : {}) },
    });

  beforeAll(async () => {
    app = await createTestApp();
    w = await createAuthWorld(owner);
    pool = new pg.Pool({ connectionString: TEST_WORKER_DATABASE_URL, max: 3 });
    for (const name of ['superadmin', 'admin_a', 'admin_b', 'staff_a', 'staff_b']) {
      clients[name] = await loggedIn(
        app,
        name,
        ...(name === 'superadmin' ? (['super admin passphrase 42'] as const) : []),
      );
    }

    const categoryId = (await owner.itemCategory.findFirstOrThrow()).id;
    // Low stock in branch A.
    const item = await owner.item.create({
      data: {
        itemCode: unique('RMI'),
        name: 'Reminder item',
        categoryId,
        unitCode: 'PCS',
        reorderLevel: 5,
      },
    });
    await owner.stockBalance.create({
      data: { branchId: w.branchA, itemId: item.id, state: 'AVAILABLE', quantity: 1 },
    });
    // An overdue invoice in branch A.
    await owner.invoice.create({
      data: {
        branchId: w.branchA,
        customerId: w.customerId,
        type: 'GST',
        invoiceNo: unique('RM/INV/'),
        status: 'ISSUED',
        subtotal: '100.00',
        taxableValue: '100.00',
        cgstAmount: '2.50',
        sgstAmount: '2.50',
        total: '105.00',
        placeOfSupply: '27',
        issuedOn: new Date('2024-12-01'),
        dueDate: new Date('2025-01-01'),
      },
    });
    // An expired battery in branch A.
    const unit = await owner.serialUnit.create({
      data: { branchId: w.branchA, itemId: w.itemId, serialNo: unique('RMSN'), state: 'AVAILABLE' },
    });
    await owner.battery.create({
      data: { serialUnitId: unit.id, expiryOn: new Date(Date.now() - 2 * day) },
    });
    // A KYC document waiting for review.
    await owner.kycDocument.create({
      data: {
        customerId: w.customerId,
        docType: 'AADHAAR',
        objectKey: unique('kyc/'),
        fileName: 'a.pdf',
        mimeType: 'application/pdf',
        sizeBytes: 10,
        status: 'PENDING',
      },
    });
    // An open receiving mismatch in branch A (on the transfer the world already has).
    const line = await owner.transferLine.findFirstOrThrow({ where: { transferId: w.transferAB } });
    await owner.discrepancy.create({
      data: { branchId: w.branchA, transferLineId: line.id, type: 'SHORT', qty: 1 },
    });
    // A follow-up due, on a lead assigned to staff A.
    const lead = await owner.lead.create({
      data: {
        branchId: w.branchA,
        name: unique('Lead '),
        phone: phone(),
        source: 'WALK_IN',
        stage: 'NEW',
        assignedTo: w.users.staffA,
      },
    });
    await owner.leadFollowup.create({
      data: { branchId: w.branchA, leadId: lead.id, dueAt: new Date(Date.now() - day) },
    });
    // Commission waiting to be paid in branch A.
    const broker = await owner.broker.create({ data: { name: 'Reminder broker', phone: phone() } });
    const rule = await owner.commissionRule.create({
      data: { brokerId: broker.id, type: 'PERCENT', value: '2.00', isActive: true },
    });
    const invoice = await owner.invoice.create({
      data: {
        branchId: w.branchA,
        customerId: w.customerId,
        brokerId: broker.id,
        type: 'GST',
        invoiceNo: unique('RM/INV/'),
        status: 'ISSUED',
        subtotal: '100.00',
        taxableValue: '100.00',
        cgstAmount: '2.50',
        sgstAmount: '2.50',
        total: '105.00',
        placeOfSupply: '27',
        issuedOn: new Date(),
      },
    });
    await owner.commission.create({
      data: {
        branchId: w.branchA,
        brokerId: broker.id,
        invoiceId: invoice.id,
        ruleId: rule.id,
        amount: '2.00',
        baseAmount: '100.00',
        status: 'PAYABLE',
      },
    });
  });

  beforeEach(async () => {
    await owner.outboxEvent.deleteMany();
    await owner.notification.deleteMany();
  });

  afterAll(async () => {
    await pool.end();
  });

  describe('the daily reminders', () => {
    it('look for every kind of thing that needs attention', async () => {
      const result = await run();
      expect(Object.keys(result.byKind).sort()).toEqual(
        [
          'BATTERY_EXPIRY',
          'FOLLOWUP_DUE',
          'LOW_STOCK',
          'PAYMENT_DUE',
          'PENDING_KYC',
          'PENDING_TRANSFER',
          'PURCHASE_MISMATCH',
          'UNPAID_COMMISSION',
        ].sort(),
      );
      expect(result.created).toBeGreaterThan(0);
    });

    it('tell the people in the branch who can act on it, and nobody else', async () => {
      await run();
      const kindsFor = async (userId: string) =>
        [...new Set((await forUser(userId)).map((row) => row.kind))].sort();

      // Branch A: stock, payments, batteries, mismatches, commission and transfers to approve.
      const adminA = await kindsFor(w.users.adminA);
      expect(adminA).toEqual(
        expect.arrayContaining(['LOW_STOCK', 'PAYMENT_DUE', 'BATTERY_EXPIRY']),
      );
      // Branch B users never hear about branch A's payments, batteries, mismatches or commission, and every
      // notification they do get is about branch B (or the whole company).
      const adminB = await kindsFor(w.users.adminB);
      for (const kind of [
        'PAYMENT_DUE',
        'BATTERY_EXPIRY',
        'PURCHASE_MISMATCH',
        'UNPAID_COMMISSION',
      ])
        expect(adminB).not.toContain(kind);
      for (const row of await forUser(w.users.adminB))
        if (row.branchId) expect(row.branchId).toBe(w.branchB);
      // A Super Admin hears about every kind except follow-ups, which go to the person the lead is assigned to.
      const superKinds = await kindsFor(w.users.super);
      expect(superKinds).toHaveLength(7);
      expect(superKinds).not.toContain('FOLLOWUP_DUE');
      // An inactive user hears about nothing.
      expect(await forUser(w.users.inactive)).toHaveLength(0);
    });

    it('send a follow-up reminder to the person the lead is assigned to', async () => {
      await run();
      const mine = await forUser(w.users.staffA, 'FOLLOWUP_DUE');
      expect(mine).toHaveLength(1);
      expect(mine[0]?.message).toContain('1 follow-up is due');
      expect(mine[0]?.message).toContain('1 of them already overdue');
      expect(await forUser(w.users.staffA2, 'FOLLOWUP_DUE')).toHaveLength(0);
      expect(await forUser(w.users.adminA, 'FOLLOWUP_DUE')).toHaveLength(0);
    });

    it('say what is owed and where to go', async () => {
      await run();
      const [due] = await forUser(w.users.adminA, 'PAYMENT_DUE');
      expect(due).toMatchObject({ title: 'Payments due', link: '/payments', branchId: w.branchA });
      expect(due?.message).toContain('₹105.00');
      expect(due?.message).toContain('1 invoice overdue');
      const [commission] = await forUser(w.users.super, 'UNPAID_COMMISSION');
      expect(commission?.message).toContain('₹2.00');
    });

    it('notify once a day: running again creates nothing, and tomorrow starts afresh', async () => {
      const now = new Date();
      const first = await run({ now });
      const again = await run({ now });
      expect(again.created).toBe(0);
      expect(again.duplicates).toBe(first.created);
      expect(await owner.notification.count()).toBe(first.created);

      const tomorrow = await run({ now: new Date(now.getTime() + day) });
      expect(tomorrow.created).toBe(first.created);
    });

    it('create in-app notifications as already delivered, and queue nothing without other channels', async () => {
      await run();
      expect(await owner.notification.count({ where: { status: { not: 'SENT' } } })).toBe(0);
      expect(await owner.outboxEvent.count()).toBe(0);
    });

    it('queue one outbox event for each external message, in the same step', async () => {
      const result = await run({ channels: ['EMAIL'] });
      const inApp = await owner.notification.count({ where: { channel: 'IN_APP' } });
      const email = await owner.notification.findMany({ where: { channel: 'EMAIL' } });
      expect(inApp).toBe(email.length);
      expect(result.created).toBe(inApp + email.length);
      expect(email.every((row) => row.status === 'PENDING')).toBe(true);
      const events = await owner.outboxEvent.findMany({
        where: { eventType: 'notification.deliver' },
      });
      expect(events).toHaveLength(email.length);
      expect(
        new Set(events.map((e) => (e.payload as { notificationId: string }).notificationId)),
      ).toEqual(new Set(email.map((row) => row.id)));
    });
  });

  describe('sending email, SMS and WhatsApp', () => {
    const makeEmail = async (): Promise<{ id: string; userId: string }> => {
      await run({ channels: ['EMAIL'] });
      const row = await owner.notification.findFirstOrThrow({
        where: { channel: 'EMAIL', userId: w.users.adminA },
      });
      return { id: row.id, userId: row.userId };
    };

    it('sends through the provider and marks the notification sent', async () => {
      const provider = new FakeProvider();
      const { id, userId } = await makeEmail();
      expect(
        await deliverNotification(pool, provider, logger, { notificationId: id, userId }),
      ).toBe('sent');
      expect(provider.sent).toHaveLength(1);
      expect(provider.sent[0]).toMatchObject({ channel: 'EMAIL', to: 'admin_a@example.com' });
      expect(await owner.notification.findUniqueOrThrow({ where: { id } })).toMatchObject({
        status: 'SENT',
        attempts: 1,
        lastError: null,
      });
    });

    it('does nothing the second time the same event arrives', async () => {
      const provider = new FakeProvider();
      const { id, userId } = await makeEmail();
      await deliverNotification(pool, provider, logger, { notificationId: id, userId });
      expect(
        await deliverNotification(pool, provider, logger, { notificationId: id, userId }),
      ).toBe('skipped');
      expect(provider.sent).toHaveLength(1);
    });

    it('does not send a notification that belongs to someone else', async () => {
      const provider = new FakeProvider();
      const { id } = await makeEmail();
      expect(
        await deliverNotification(pool, provider, logger, {
          notificationId: id,
          userId: w.users.adminB,
        }),
      ).toBe('skipped');
      expect(provider.sent).toHaveLength(0);
    });

    it('retries a temporary failure, then gives up after the attempt limit and says why', async () => {
      const provider = new FakeProvider();
      const { id, userId } = await makeEmail();
      for (let attempt = 1; attempt < MAX_DELIVERY_ATTEMPTS; attempt += 1) {
        provider.failures.push(new Error('Mail server unavailable'));
        await expect(
          deliverNotification(pool, provider, logger, { notificationId: id, userId }),
        ).rejects.toThrow('will retry');
        expect(await owner.notification.findUniqueOrThrow({ where: { id } })).toMatchObject({
          status: 'PENDING',
          attempts: attempt,
        });
      }
      provider.failures.push(new Error('Mail server unavailable'));
      expect(
        await deliverNotification(pool, provider, logger, { notificationId: id, userId }),
      ).toBe('failed');
      expect(await owner.notification.findUniqueOrThrow({ where: { id } })).toMatchObject({
        status: 'FAILED',
        attempts: MAX_DELIVERY_ATTEMPTS,
        lastError: 'Mail server unavailable',
      });
    });

    it('fails at once, without retrying, when the message can never be delivered', async () => {
      const provider = new FakeProvider();
      const { id, userId } = await makeEmail();
      provider.failures.push(new PermanentDeliveryError('Mailbox does not exist'));
      expect(
        await deliverNotification(pool, provider, logger, { notificationId: id, userId }),
      ).toBe('failed');
      expect((await owner.notification.findUniqueOrThrow({ where: { id } })).status).toBe('FAILED');
    });

    it('fails an SMS at once, because no phone numbers are held for users', async () => {
      const provider = new FakeProvider();
      await run({ channels: ['SMS'] });
      const row = await owner.notification.findFirstOrThrow({
        where: { channel: 'SMS', userId: w.users.adminA },
      });
      expect(
        await deliverNotification(pool, provider, logger, {
          notificationId: row.id,
          userId: row.userId,
        }),
      ).toBe('failed');
      expect(provider.sent).toHaveLength(0);
      expect(
        (await owner.notification.findUniqueOrThrow({ where: { id: row.id } })).lastError,
      ).toContain('phone');
    });
  });

  describe('what the worker may do to the database', () => {
    it('can read what the reminders look at but not money or customer records', async () => {
      const client = await pool.connect();
      try {
        expect(await sqlState(client.query('SELECT count(*) FROM payments'))).toBe('42501');
        expect(await sqlState(client.query('SELECT count(*) FROM audit_log'))).toBe('42501');
      } finally {
        client.release();
      }
    });

    it('cannot delete notifications or change what they say', async () => {
      await run();
      const client = await pool.connect();
      try {
        expect(await sqlState(client.query('DELETE FROM notifications'))).toBe('42501');
        expect(await sqlState(client.query("UPDATE notifications SET message = 'x'"))).toBe(
          '42501',
        );
      } finally {
        client.release();
      }
    });

    it('cannot write outbox events itself, only ask for a delivery of a notification that exists', async () => {
      await run();
      const client = await pool.connect();
      try {
        expect(
          await sqlState(
            client.query("INSERT INTO outbox_events (event_type, payload) VALUES ('forged', '{}')"),
          ),
        ).toBe('42501');
        const inApp = await owner.notification.findFirstOrThrow({ where: { channel: 'IN_APP' } });
        await client.query('SELECT worker_enqueue_delivery($1::uuid, $2::uuid)', [
          inApp.id,
          inApp.userId,
        ]);
        await client.query('SELECT worker_enqueue_delivery($1::uuid, $2::uuid)', [
          w.branchA,
          w.users.adminA,
        ]);
        expect(await owner.outboxEvent.count()).toBe(0);
      } finally {
        client.release();
      }
    });

    it('is the only role that can call the reminder functions', async () => {
      const app = await connectApp();
      try {
        expect(await sqlState(app.query('SELECT * FROM worker_alert_low_stock()'))).toBe('42501');
        expect(
          await sqlState(
            app.query('SELECT * FROM worker_recipients(NULL, $1, NULL)', ['stock.view']),
          ),
        ).toBe('42501');
      } finally {
        await app.end();
      }
    });

    it('never names an inactive user as a recipient', async () => {
      const { rows } = await pool.query<{ user_id: string }>(
        'SELECT user_id FROM worker_recipients(NULL, $1, NULL)',
        ['stock.view'],
      );
      expect(rows.map((row) => row.user_id)).not.toContain(w.users.inactive);
      const named = await pool.query('SELECT user_id FROM worker_recipients($1::uuid, $2, NULL)', [
        w.users.inactive,
        'stock.view',
      ]);
      expect(named.rows.map((row) => row.user_id)).not.toContain(w.users.inactive);
    });
  });

  describe('the notification inbox', () => {
    const list = async (client: TestClient, query = '') => {
      const response = await client.get(`/notifications${query}`);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      return NotificationListResponseSchema.parse(response.body);
    };

    it('shows a person only their own notifications, newest first, with the unread count', async () => {
      await run();
      const mine = await list(clients['staff_a']!);
      expect(mine.items.length).toBeGreaterThan(0);
      expect(mine.total).toBe(
        await owner.notification.count({ where: { userId: w.users.staffA, channel: 'IN_APP' } }),
      );
      expect(mine.unreadCount).toBe(mine.total);
      const dates = mine.items.map((item) => item.createdAt);
      expect([...dates].sort().reverse()).toEqual(dates);
      const ids = new Set(
        (await owner.notification.findMany({ where: { userId: w.users.staffA } })).map((r) => r.id),
      );
      expect(mine.items.every((item) => ids.has(item.id))).toBe(true);
    });

    it('never shows email or SMS rows in the inbox', async () => {
      await run({ channels: ['EMAIL'] });
      const mine = await list(clients['admin_a']!);
      expect(mine.total).toBe(
        await owner.notification.count({ where: { userId: w.users.adminA, channel: 'IN_APP' } }),
      );
    });

    it('filters by unread and kind, and pages', async () => {
      await run();
      const all = await list(clients['superadmin']!, '?pageSize=3');
      expect(all.items).toHaveLength(3);
      expect(all.totalPages).toBeGreaterThan(1);
      const kind = await list(clients['superadmin']!, '?kind=LOW_STOCK');
      expect(kind.items.every((item) => item.kind === 'LOW_STOCK')).toBe(true);
      expect(kind.total).toBeGreaterThan(0);
      const first = all.items[0]!;
      await clients['superadmin']!.post(`/notifications/${first.id}/read`);
      const unread = await list(clients['superadmin']!, '?unread=true&pageSize=100');
      expect(unread.items.some((item) => item.id === first.id)).toBe(false);
      expect(unread.total).toBe(all.total - 1);
      const read = await list(clients['superadmin']!, '?unread=false');
      expect(read.items.map((item) => item.id)).toEqual([first.id]);
    });

    it('marks one notification read, and again without harm', async () => {
      await run();
      const [item] = (await list(clients['admin_a']!)).items;
      const first = await clients['admin_a']!.post(`/notifications/${item!.id}/read`);
      expect(first.status).toBe(200);
      expect(first.body.read).toBe(true);
      const second = await clients['admin_a']!.post(`/notifications/${item!.id}/read`);
      expect(second.status).toBe(200);
      const stored = await owner.notification.findUniqueOrThrow({ where: { id: item!.id } });
      expect(stored.status).toBe('READ');
      expect(stored.readAt).not.toBeNull();
    });

    it("will not read or mark someone else's notification", async () => {
      await run();
      const theirs = await owner.notification.findFirstOrThrow({
        where: { userId: w.users.adminA, channel: 'IN_APP' },
      });
      const response = await clients['admin_b']!.post(`/notifications/${theirs.id}/read`);
      expect(response.status).toBe(404);
      expect(
        (await owner.notification.findUniqueOrThrow({ where: { id: theirs.id } })).status,
      ).toBe('SENT');
    });

    it('marks everything read at once and counts what is unread', async () => {
      await run();
      const before = await clients['staff_a']!.get('/notifications/unread-count');
      expect(before.body.unreadCount).toBeGreaterThan(0);
      const done = await clients['staff_a']!.post('/notifications/read-all');
      expect(done.body.updated).toBe(before.body.unreadCount);
      expect((await clients['staff_a']!.get('/notifications/unread-count')).body.unreadCount).toBe(
        0,
      );
      // Nobody else's were touched.
      expect(
        (await clients['admin_a']!.get('/notifications/unread-count')).body.unreadCount,
      ).toBeGreaterThan(0);
    });

    it('needs a session', async () => {
      for (const path of ['/notifications', '/notifications/unread-count']) {
        expect((await request(app.getHttpServer()).get(path)).status).toBe(401);
      }
      expect((await request(app.getHttpServer()).post('/notifications/read-all')).status).toBe(401);
    });

    it('rejects a bad id, a bad filter and an oversized page', async () => {
      expect((await clients['admin_a']!.post('/notifications/not-a-uuid/read')).status).toBe(400);
      expect((await clients['admin_a']!.get('/notifications?kind=NOPE')).status).toBe(400);
      expect((await clients['admin_a']!.get('/notifications?pageSize=1000')).status).toBe(400);
      expect((await clients['admin_a']!.get('/notifications?unread=maybe')).status).toBe(400);
    });

    it('is empty, not broken, when there is nothing', async () => {
      const mine = await list(clients['staff_b']!);
      expect(mine).toMatchObject({ items: [], total: 0, totalPages: 0, unreadCount: 0 });
    });
  });

  describe('the running worker', () => {
    it('relays the outbox, sends the email through the provider and schedules the daily reminders', async () => {
      const provider = new FakeProvider();
      const env = loadWorkerEnv({
        WORKER_DATABASE_URL: TEST_WORKER_DATABASE_URL,
        OUTBOX_POLL_INTERVAL_MS: '50',
        NOTIFICATION_CHANNELS: 'email',
      });
      expect(env.NOTIFICATION_CHANNELS).toEqual(['EMAIL']);
      // Jobs left in the queue by earlier runs would only slow this test down.
      await owner.$executeRaw`DELETE FROM pgboss.job WHERE name = 'domain-events'`.catch(
        () => undefined,
      );
      await run({ channels: env.NOTIFICATION_CHANNELS });
      const email = await owner.notification.findMany({ where: { channel: 'EMAIL' } });
      expect(email.length).toBeGreaterThan(0);

      const worker = await startWorker(env, logger, { consumers: true, provider });
      try {
        const deadline = Date.now() + 15_000;
        for (;;) {
          const pending = await owner.notification.count({
            where: { channel: 'EMAIL', status: 'PENDING' },
          });
          if (pending === 0) break;
          if (Date.now() > deadline) throw new Error('Emails were not sent in time');
          await new Promise((resolve) => setTimeout(resolve, 100));
        }
        expect(provider.sent).toHaveLength(email.length);
        expect(
          await owner.notification.count({ where: { channel: 'EMAIL', status: 'SENT' } }),
        ).toBe(email.length);
        const schedules = await owner.$queryRaw<{ name: string; cron: string; timezone: string }[]>`
          SELECT name, cron, timezone FROM pgboss.schedule WHERE name = 'reminders'`;
        expect(schedules).toEqual([
          { name: 'reminders', cron: '0 8 * * *', timezone: 'Asia/Kolkata' },
        ]);
      } finally {
        await worker.stop('test');
      }
    });
  });

  describe('when nothing needs attention', () => {
    it('says nothing about it', async () => {
      await owner.discrepancy.deleteMany();
      await owner.kycDocument.deleteMany();
      await owner.commission.deleteMany();
      await owner.leadFollowup.updateMany({
        data: { completedAt: new Date(), completedBy: w.users.adminA },
      });
      const result = await run();
      for (const kind of ['PENDING_KYC', 'PURCHASE_MISMATCH', 'UNPAID_COMMISSION', 'FOLLOWUP_DUE'])
        expect(result.byKind[kind]).toBeUndefined();
    });
  });

  it('keeps its numbers in step with Prisma (decimal sanity)', () => {
    expect(new Prisma.Decimal('105').toFixed(2)).toBe('105.00');
  });
});
