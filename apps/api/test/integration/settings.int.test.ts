import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  AuditFacetsSchema,
  AuditLogResponseSchema,
  DocumentSeriesListResponseSchema,
  GstRateAdminListResponseSchema,
  SETTING_KEYS,
  SettingListResponseSchema,
  UserActivitySchema,
} from '@erp/contracts';
import type { AuditLogResponse, Setting } from '@erp/contracts';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createAuthWorld, loggedIn } from '../support/auth-world.js';
import type { AuthWorld, TestClient } from '../support/auth-world.js';
import { createTestApp } from '../support/create-test-app.js';
import { createOwnerPrisma } from '../support/fixtures.js';
import { testEnv } from '../support/test-env.js';

describe('settings and admin', () => {
  let app: NestExpressApplication;
  let w: AuthWorld;
  let superAdmin: TestClient;
  let adminA: TestClient;
  let adminB: TestClient;
  let staffA: TestClient;
  const owner = createOwnerPrisma();
  const ids: Record<string, string> = {};

  const settings = async (client = superAdmin): Promise<Setting[]> => {
    const response = await client.get('/settings');
    expect(response.status, JSON.stringify(response.body)).toBe(200);
    return SettingListResponseSchema.parse(response.body);
  };
  const setting = async (key: string): Promise<Setting> =>
    (await settings()).find((entry) => entry.key === key)!;
  const auditRows = (action: string) =>
    owner.auditLog.findMany({ where: { action }, orderBy: { createdAt: 'asc' } });

  beforeAll(async () => {
    app = await createTestApp();
    w = await createAuthWorld(owner);
    superAdmin = await loggedIn(app, 'superadmin', 'super admin passphrase 42');
    adminA = await loggedIn(app, 'admin_a');
    adminB = await loggedIn(app, 'admin_b');
    staffA = await loggedIn(app, 'staff_a');
  });

  beforeEach(async () => {
    await owner.appSetting.deleteMany();
  });

  describe('company details and approval limits', () => {
    it('lists every setting with its default and where the value comes from', async () => {
      const all = await settings();
      expect(all.map((entry) => entry.key)).toEqual(SETTING_KEYS);
      const adjustment = all.find((entry) => entry.key === 'approvals.adjustment_admin_limit')!;
      expect(adjustment).toMatchObject({
        value: 10,
        defaultValue: 10,
        source: 'DEFAULT',
        rowVersion: null,
      });
      expect(all.find((entry) => entry.key === 'company.name')).toMatchObject({
        value: null,
        source: 'DEFAULT',
      });
      expect(all.find((entry) => entry.key === 'approvals.exchange_admin_limit')!.value).toBeNull();
    });

    it('saves a value, then needs the version to change it again', async () => {
      const first = await superAdmin
        .put('/settings/company.name')
        .send({ value: '  Sharma Motors  ' });
      expect(first.status, JSON.stringify(first.body)).toBe(200);
      expect(first.body).toMatchObject({
        value: 'Sharma Motors',
        source: 'SETTING',
        rowVersion: 1,
      });

      const blind = await superAdmin.put('/settings/company.name').send({ value: 'Other' });
      expect(blind.status).toBe(409);
      const stale = await superAdmin
        .put('/settings/company.name')
        .send({ value: 'Other', rowVersion: 7 });
      expect(stale.status).toBe(409);
      const second = await superAdmin
        .put('/settings/company.name')
        .send({ value: 'Sharma Motors Pvt Ltd', rowVersion: 1 });
      expect(second.body).toMatchObject({ value: 'Sharma Motors Pvt Ltd', rowVersion: 2 });
      expect((await setting('company.name')).value).toBe('Sharma Motors Pvt Ltd');
    });

    it('refuses a first save that claims a version, as the setting does not exist yet', async () => {
      const response = await superAdmin
        .put('/settings/company.name')
        .send({ value: 'X Motors', rowVersion: 1 });
      expect(response.status).toBe(409);
    });

    it('records who changed what, from and to', async () => {
      await superAdmin.put('/settings/company.phone').send({ value: '022 2345 6789' });
      await superAdmin
        .put('/settings/company.phone')
        .send({ value: '022 9999 0000', rowVersion: 1 });
      const rows = await auditRows('SETTING_CHANGED');
      const last = rows.at(-1)!;
      expect(last).toMatchObject({ entityType: 'AppSetting', actorId: w.users.super });
      expect(last.oldValue).toEqual({ key: 'company.phone', value: '022 2345 6789' });
      expect(last.newValue).toEqual({ key: 'company.phone', value: '022 9999 0000' });
    });

    it.each([
      ['company.gstin', '27ABCDE1234F1Z5', '27abcde1234f1z5'],
      ['company.email', 'accounts@example.com', 'not an email'],
      ['company.phone', '+91 98100 00001', 'abc'],
      ['approvals.exchange_admin_limit', '50000.50', '-5'],
      ['approvals.adjustment_admin_limit', 25, 0],
    ] as const)('checks %s: accepts a good value and refuses a bad one', async (key, good, bad) => {
      const ok = await superAdmin.put(`/settings/${key}`).send({ value: good });
      expect(ok.status, `${key} ${JSON.stringify(ok.body)}`).toBe(200);
      if (key === 'company.gstin') expect(ok.body.value).toBe('27ABCDE1234F1Z5');
      const refused = await superAdmin
        .put(`/settings/${key}`)
        .send({ value: bad, rowVersion: ok.body.rowVersion });
      if (key === 'company.gstin')
        expect(refused.status).toBe(200); // lower case is tidied to upper case
      else {
        expect(refused.status, `${key} ${bad}`).toBe(400);
        expect(refused.body.details[0].field).toBe('value');
      }
    });

    it('refuses a GSTIN with a wrong shape, an exchange limit of zero and a text limit', async () => {
      expect(
        (await superAdmin.put('/settings/company.gstin').send({ value: '27ABCDE1234F1Z' })).status,
      ).toBe(400);
      expect(
        (await superAdmin.put('/settings/approvals.exchange_admin_limit').send({ value: '0' }))
          .status,
      ).toBe(400);
      expect(
        (await superAdmin.put('/settings/approvals.adjustment_admin_limit').send({ value: 'many' }))
          .status,
      ).toBe(400);
      expect(
        (await superAdmin.put('/settings/approvals.adjustment_admin_limit').send({ value: 100001 }))
          .status,
      ).toBe(400);
    });

    it('accepts a whole number sent as text for a unit limit', async () => {
      const response = await superAdmin
        .put('/settings/approvals.adjustment_admin_limit')
        .send({ value: '25' });
      expect(response.body.value).toBe(25);
    });

    it('rejects an unknown setting, unknown fields and a missing value', async () => {
      expect((await superAdmin.put('/settings/nope.key').send({ value: 'x' })).status).toBe(404);
      expect(
        (await superAdmin.put('/settings/company.name').send({ value: 'x', extra: 1 })).status,
      ).toBe(400);
      expect((await superAdmin.put('/settings/company.name').send({})).status).toBe(400);
    });

    it('goes back to the default on reset, once, and says nothing is lost', async () => {
      const saved = await superAdmin
        .put('/settings/approvals.adjustment_admin_limit')
        .send({ value: 40 });
      const stale = await superAdmin
        .post('/settings/approvals.adjustment_admin_limit/reset')
        .send({ rowVersion: 9 });
      expect(stale.status).toBe(409);
      const reset = await superAdmin
        .post('/settings/approvals.adjustment_admin_limit/reset')
        .send({ rowVersion: saved.body.rowVersion });
      expect(reset.status).toBe(200);
      expect(reset.body).toMatchObject({ value: 10, source: 'DEFAULT', rowVersion: null });
      const rows = await auditRows('SETTING_RESET');
      expect(rows.at(-1)!.oldValue).toEqual({ key: 'approvals.adjustment_admin_limit', value: 40 });
      const again = await superAdmin
        .post('/settings/approvals.adjustment_admin_limit/reset')
        .send({ rowVersion: 1 });
      expect(again.status).toBe(200);
    });

    it('is for company-level users only', async () => {
      for (const client of [adminA, staffA]) {
        expect((await client.get('/settings')).status).toBe(403);
        expect((await client.put('/settings/company.name').send({ value: 'X' })).status).toBe(403);
        expect((await client.get('/settings/document-series')).status).toBe(403);
        expect((await client.get('/settings/gst-rates')).status).toBe(403);
      }
      expect((await request(app.getHttpServer()).get('/settings')).status).toBe(401);
    });

    it('does not let a database row for an unknown key exist', async () => {
      await expect(
        owner.appSetting.create({ data: { key: 'rogue.key', value: 1 } }),
      ).rejects.toThrow();
    });
  });

  describe('the limits actually decide who may approve', () => {
    let adjustmentId: string;

    beforeEach(async () => {
      const categoryId = (await owner.itemCategory.findFirstOrThrow()).id;
      const item = await owner.item.create({
        data: {
          itemCode: `ST${Date.now().toString().slice(-8)}`,
          name: 'Limit item',
          categoryId,
          unitCode: 'PCS',
        },
      });
      await owner.stockBalance.create({
        data: { branchId: w.branchA, itemId: item.id, state: 'AVAILABLE', quantity: 100 },
      });
      adjustmentId = (
        await owner.stockAdjustment.create({
          data: {
            branchId: w.branchA,
            itemId: item.id,
            kind: 'OUT',
            state: 'AVAILABLE',
            qty: 15,
            reason: 'Stock found damaged',
            status: 'PENDING',
            requestedBy: w.users.staffA,
          },
        })
      ).id;
    });

    it('an Admin cannot approve 15 units while the limit is 10', async () => {
      const response = await adminA
        .post(`/stock/adjustments/${adjustmentId}/approve`)
        .send({ rowVersion: 1 });
      expect(response.status).toBe(422);
      expect(response.body.message).toContain('more than 10 units');
    });

    it('an Admin can once a Super Admin raises the limit, and not after it is lowered again', async () => {
      const saved = await superAdmin
        .put('/settings/approvals.adjustment_admin_limit')
        .send({ value: 20 });
      expect(saved.status).toBe(200);
      const lowered = await superAdmin
        .put('/settings/approvals.adjustment_admin_limit')
        .send({ value: 12, rowVersion: saved.body.rowVersion });
      const blocked = await adminA
        .post(`/stock/adjustments/${adjustmentId}/approve`)
        .send({ rowVersion: 1 });
      expect(blocked.status).toBe(422);
      expect(blocked.body.message).toContain('more than 12 units');
      await superAdmin
        .put('/settings/approvals.adjustment_admin_limit')
        .send({ value: 20, rowVersion: lowered.body.rowVersion });
      const allowed = await adminA
        .post(`/stock/adjustments/${adjustmentId}/approve`)
        .send({ rowVersion: 1 });
      expect(allowed.status, JSON.stringify(allowed.body)).toBe(200);
    });

    it('a Super Admin is never limited', async () => {
      const response = await superAdmin
        .post(`/stock/adjustments/${adjustmentId}/approve`)
        .send({ rowVersion: 1 });
      expect(response.status).toBe(200);
    });

    it('the exchange limit starts from the server setting and can be overridden by a saved one', async () => {
      const second = await createTestApp({
        env: testEnv({ EXCHANGE_ADMIN_APPROVAL_LIMIT: '50000' }),
      });
      try {
        const client = await loggedIn(second, 'superadmin', 'super admin passphrase 42');
        const before = (await client.get('/settings')).body as Setting[];
        const limit = before.find((entry) => entry.key === 'approvals.exchange_admin_limit')!;
        expect(limit).toMatchObject({ value: '50000', defaultValue: '50000', source: 'DEFAULT' });
        const saved = await client
          .put('/settings/approvals.exchange_admin_limit')
          .send({ value: '1000' });
        expect(saved.body).toMatchObject({
          value: '1000',
          defaultValue: '50000',
          source: 'SETTING',
        });
      } finally {
        await second.close();
      }
    });
  });

  describe('document number series', () => {
    beforeAll(async () => {
      await owner.documentSequence.deleteMany();
      const make = (
        branchId: string,
        docType: 'INVOICE_GST' | 'QUOTATION' | 'TRANSFER',
        prefix: string,
        next: number,
        fy = '2026-27',
      ) =>
        owner.documentSequence.create({
          data: { branchId, docType, financialYear: fy, prefix, nextNumber: next },
        });
      ids.seriesA = (await make(w.branchA, 'INVOICE_GST', 'AA', 5)).id;
      ids.seriesLong = (await make(w.branchA, 'QUOTATION', 'ABCDEFGHIJ', 3)).id;
      ids.seriesB = (await make(w.branchB, 'INVOICE_GST', 'BB', 12)).id;
      await make(w.branchA, 'INVOICE_GST', 'AA', 90, '2025-26');
    });

    const list = async (query = '') => {
      const response = await superAdmin.get(`/settings/document-series${query}`);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      return DocumentSeriesListResponseSchema.parse(response.body);
    };

    it('lists every series with what the next number will look like', async () => {
      const all = await list();
      expect(all.total).toBe(4);
      const a = all.items.find((row) => row.id === ids.seriesA)!;
      expect(a).toMatchObject({
        branchCode: 'AA',
        docType: 'INVOICE_GST',
        nextNumber: 5,
        nextExample: 'AA/2627/00005',
      });
    });

    it('filters by branch, type and year, sorts and pages', async () => {
      expect((await list(`?branchId=${w.branchB}`)).items.map((row) => row.id)).toEqual([
        ids.seriesB,
      ]);
      expect((await list('?docType=QUOTATION')).items).toHaveLength(1);
      expect((await list('?financialYear=2025-26')).items).toHaveLength(1);
      const sorted = await list('?sortBy=nextNumber&sortOrder=desc');
      expect(sorted.items.map((row) => row.nextNumber)).toEqual([90, 12, 5, 3]);
      const page = await list('?pageSize=1&page=2&sortBy=nextNumber&sortOrder=desc');
      expect(page.items.map((row) => row.nextNumber)).toEqual([12]);
      expect(page.totalPages).toBe(4);
      expect((await superAdmin.get('/settings/document-series?sortBy=__nope__')).status).toBe(400);
      expect((await superAdmin.get('/settings/document-series?financialYear=2026')).status).toBe(
        400,
      );
    });

    it('moves the next number forward, records why and how many were skipped', async () => {
      const response = await superAdmin
        .post(`/settings/document-series/${ids.seriesA}/advance`)
        .send({ nextNumber: 101, reason: 'Paper book used up to 100', rowVersion: 1 });
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      expect(response.body).toMatchObject({
        nextNumber: 101,
        nextExample: 'AA/2627/00101',
        rowVersion: 2,
      });
      const row = await owner.documentSequence.findUniqueOrThrow({ where: { id: ids.seriesA } });
      expect(row.nextNumber).toBe(101);
      const audit = (await auditRows('DOCUMENT_SERIES_ADVANCED')).at(-1)!;
      expect(audit).toMatchObject({ entityId: ids.seriesA, branchId: w.branchA });
      expect(audit.oldValue).toEqual({ nextNumber: 5 });
      expect(audit.newValue).toMatchObject({
        nextNumber: 101,
        skipped: 96,
        reason: 'Paper book used up to 100',
      });
    });

    it('never moves a number back or stands still, and refuses a stale view', async () => {
      const back = await superAdmin
        .post(`/settings/document-series/${ids.seriesB}/advance`)
        .send({ nextNumber: 12, reason: 'Back to where it was', rowVersion: 1 });
      expect(back.status).toBe(422);
      expect(back.body.message).toBe('Numbers only move forward');
      const stale = await superAdmin
        .post(`/settings/document-series/${ids.seriesB}/advance`)
        .send({ nextNumber: 20, reason: 'A stale view of it', rowVersion: 5 });
      expect(stale.status).toBe(409);
    });

    it('refuses a jump of more than 10,000 and a number too long for GST', async () => {
      const jump = await superAdmin
        .post(`/settings/document-series/${ids.seriesB}/advance`)
        .send({ nextNumber: 20_000, reason: 'A typo, perhaps', rowVersion: 1 });
      expect(jump.status).toBe(422);
      const long = await superAdmin
        .post(`/settings/document-series/${ids.seriesLong}/advance`)
        .send({ nextNumber: 50, reason: 'Prefix is long', rowVersion: 1 });
      expect(long.status).toBe(422);
      expect(long.body.details[0].message).toContain('16 characters');
      const row = await owner.documentSequence.findUniqueOrThrow({ where: { id: ids.seriesB } });
      expect(row.nextNumber).toBe(12);
    });

    it('needs a reason, a valid id and a real series', async () => {
      const path = `/settings/document-series/${ids.seriesB}/advance`;
      expect((await superAdmin.post(path).send({ nextNumber: 30, rowVersion: 1 })).status).toBe(
        400,
      );
      expect(
        (await superAdmin.post(path).send({ nextNumber: 30, reason: 'ok', rowVersion: 1 })).status,
      ).toBe(400);
      expect(
        (await superAdmin.post('/settings/document-series/not-a-uuid/advance').send({})).status,
      ).toBe(400);
      const missing = await superAdmin
        .post('/settings/document-series/00000000-0000-4000-8000-000000000000/advance')
        .send({ nextNumber: 30, reason: 'Does not exist', rowVersion: 1 });
      expect(missing.status).toBe(404);
    });
  });

  describe('tax rates', () => {
    const list = async () => {
      const response = await superAdmin.get('/settings/gst-rates');
      expect(response.status).toBe(200);
      return GstRateAdminListResponseSchema.parse(response.body);
    };

    it('lists every rate, with how many active items use it', async () => {
      const rates = await list();
      const five = rates.find((rate) => rate.rate === '5.00')!;
      expect(five.itemsUsing).toBeGreaterThanOrEqual(1);
      expect(rates.map((rate) => Number(rate.rate))).toEqual(
        [...rates.map((rate) => Number(rate.rate))].sort((a, b) => a - b),
      );
    });

    it('adds a rate, refuses a duplicate and a bad percentage, and records it', async () => {
      const created = await superAdmin
        .post('/settings/gst-rates')
        .send({ rate: '7.5', label: 'GST 7.5%' });
      expect(created.status, JSON.stringify(created.body)).toBe(201);
      expect(created.body).toMatchObject({
        rate: '7.50',
        label: 'GST 7.5%',
        isActive: true,
        itemsUsing: 0,
      });
      ids.rate = created.body.id;
      expect(
        (await superAdmin.post('/settings/gst-rates').send({ rate: '7.50', label: 'again' }))
          .status,
      ).toBe(409);
      for (const rate of ['41', '-1', 'abc', '5.555', '']) {
        const refused = await superAdmin.post('/settings/gst-rates').send({ rate, label: 'x' });
        expect(refused.status, rate).toBe(400);
      }
      expect((await superAdmin.post('/settings/gst-rates').send({ rate: '9' })).status).toBe(400);
      expect((await auditRows('GST_RATE_CREATED')).at(-1)!.newValue).toEqual({
        rate: '7.50',
        label: 'GST 7.5%',
      });
    });

    it('offers a switched-off rate nowhere, and a switched-on one again', async () => {
      const off = await superAdmin
        .patch(`/settings/gst-rates/${ids.rate}`)
        .send({ isActive: false, rowVersion: 1 });
      expect(off.status, JSON.stringify(off.body)).toBe(200);
      const offered = async () =>
        ((await superAdmin.get('/reference/gst-rates')).body as { rate: string }[]).map(
          (r) => r.rate,
        );
      expect(await offered()).not.toContain('7.50');
      const on = await superAdmin
        .patch(`/settings/gst-rates/${ids.rate}`)
        .send({ isActive: true, label: 'GST 7.5 percent', rowVersion: off.body.rowVersion });
      expect(on.body).toMatchObject({ isActive: true, label: 'GST 7.5 percent' });
      expect(await offered()).toContain('7.50');
    });

    it('will not switch off a rate that active items still use, and says how many', async () => {
      const five = (await list()).find((rate) => rate.rate === '5.00')!;
      const response = await superAdmin
        .patch(`/settings/gst-rates/${five.id}`)
        .send({ isActive: false, rowVersion: five.rowVersion });
      expect(response.status).toBe(422);
      expect(response.body.details[0].message).toMatch(/^\d+ active items? uses? 5.00%/);
      expect((await list()).find((rate) => rate.rate === '5.00')!.isActive).toBe(true);
    });

    it('never changes the percentage itself, and refuses a stale or empty change', async () => {
      const rates = await list();
      const rate = rates.find((r) => r.id === ids.rate)!;
      expect(
        (
          await superAdmin
            .patch(`/settings/gst-rates/${rate.id}`)
            .send({ rate: '9', rowVersion: rate.rowVersion })
        ).status,
      ).toBe(400);
      expect(
        (
          await superAdmin
            .patch(`/settings/gst-rates/${rate.id}`)
            .send({ label: 'x', rowVersion: 99 })
        ).status,
      ).toBe(409);
      expect(
        (
          await superAdmin
            .patch(`/settings/gst-rates/${rate.id}`)
            .send({ rowVersion: rate.rowVersion })
        ).status,
      ).toBe(400);
      expect(
        (
          await superAdmin
            .patch('/settings/gst-rates/00000000-0000-4000-8000-000000000000')
            .send({ label: 'x', rowVersion: 1 })
        ).status,
      ).toBe(404);
    });
  });

  describe('the audit log viewer', () => {
    beforeAll(async () => {
      const row = (over: Record<string, unknown>) =>
        owner.auditLog.create({
          data: { action: 'TEST_ACTION', entityType: 'TestThing', ...over } as never,
        });
      ids.entity = '00000000-0000-4000-8000-0000000000aa';
      await row({
        actorId: w.users.adminA,
        branchId: w.branchA,
        action: 'REFUND_PAID',
        entityType: 'CustomerRefund',
        entityId: ids.entity,
        createdAt: new Date('2026-09-15T08:00:00Z'),
      });
      await row({
        actorId: w.users.adminA,
        branchId: w.branchA,
        action: 'REFUND_PAID',
        entityType: 'CustomerRefund',
        createdAt: new Date('2026-09-30T19:00:00Z'),
      });
      await row({
        actorId: w.users.adminB,
        branchId: w.branchB,
        action: 'INVOICE_CANCELLED',
        entityType: 'Invoice',
        createdAt: new Date('2026-09-16T08:00:00Z'),
      });
      await row({
        actorId: w.users.staffA,
        branchId: w.branchA,
        action: 'LEAD_CREATED',
        entityType: 'Lead',
        createdAt: new Date('2026-09-17T08:00:00Z'),
      });
      await row({
        actorId: null,
        branchId: null,
        action: 'LOGIN_FAILED',
        entityType: 'User',
        createdAt: new Date('2026-09-18T08:00:00Z'),
      });
    });

    const view = async (client: TestClient, query = ''): Promise<AuditLogResponse> => {
      const response = await client.get(`/audit-log?pageSize=100${query ? `&${query}` : ''}`);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      return AuditLogResponseSchema.parse(response.body);
    };
    const actions = (page: AuditLogResponse): string[] => page.items.map((item) => item.action);

    it('shows a Super Admin everything, with who did it and in which branch', async () => {
      const all = await view(superAdmin, 'action=REFUND_PAID');
      expect(all.total).toBe(2);
      expect(all.items[0]).toMatchObject({
        actorName: 'Person admin_a',
        branchCode: 'AA',
        entityType: 'CustomerRefund',
      });
      expect(actions(await view(superAdmin, 'action=LOGIN_FAILED'))).toEqual(['LOGIN_FAILED']);
    });

    it("shows a branch user only their own branches' entries, never branch-less ones", async () => {
      const mine = await view(adminA);
      expect(mine.items.every((item) => item.branchId === w.branchA)).toBe(true);
      expect(actions(mine)).not.toContain('INVOICE_CANCELLED');
      expect(actions(mine)).not.toContain('LOGIN_FAILED');
      const theirs = await view(adminB);
      expect(theirs.items.every((item) => item.branchId === w.branchB)).toBe(true);
      expect(actions(theirs)).toContain('INVOICE_CANCELLED');
    });

    it('refuses to filter by a branch the person does not work in', async () => {
      expect((await adminA.get(`/audit-log?branchId=${w.branchB}`)).status).toBe(403);
      expect(
        (await view(superAdmin, `branchId=${w.branchB}`)).items.every(
          (i) => i.branchId === w.branchB,
        ),
      ).toBe(true);
    });

    it('filters by person, action, record type, record and text', async () => {
      expect(actions(await view(superAdmin, `actorId=${w.users.adminB}`))).toContain(
        'INVOICE_CANCELLED',
      );
      expect(
        (await view(superAdmin, `actorId=${w.users.adminB}`)).items.every(
          (i) => i.actorId === w.users.adminB,
        ),
      ).toBe(true);
      expect((await view(superAdmin, 'entityType=Lead')).items.map((i) => i.action)).toEqual([
        'LEAD_CREATED',
      ]);
      expect((await view(superAdmin, `entityId=${ids.entity}`)).total).toBe(1);
      const text = await view(superAdmin, 'q=refund');
      expect(
        text.items.every((i) => /refund/i.test(i.action) || /refund/i.test(i.entityType)),
      ).toBe(true);
      expect(text.total).toBeGreaterThanOrEqual(2);
      expect((await view(superAdmin, 'q=%25%25')).total).toBe(0);
    });

    it('filters by date in India time, counting the whole of both end days', async () => {
      // 19:00 UTC on 30 September is 00:30 on 1 October in India.
      const october = await view(superAdmin, 'action=REFUND_PAID&from=2026-10-01&to=2026-10-01');
      expect(october.total).toBe(1);
      const september = await view(superAdmin, 'action=REFUND_PAID&from=2026-09-01&to=2026-09-30');
      expect(september.total).toBe(1);
      expect(
        (await view(superAdmin, 'action=REFUND_PAID&from=2026-09-15&to=2026-10-01')).total,
      ).toBe(2);
    });

    it('sorts, pages and offers lists of actions and record types to filter by', async () => {
      const asc = await view(superAdmin, 'sortBy=createdAt&sortOrder=asc&action=REFUND_PAID');
      expect(asc.items.map((i) => i.createdAt)).toEqual(
        [...asc.items.map((i) => i.createdAt)].sort(),
      );
      const desc = await view(superAdmin, 'action=REFUND_PAID');
      expect(desc.items.map((i) => i.createdAt)).toEqual(
        [...asc.items.map((i) => i.createdAt)].reverse(),
      );
      const page = await superAdmin.get('/audit-log?pageSize=2&page=2');
      expect(page.body.items.length).toBeLessThanOrEqual(2);
      const facets = AuditFacetsSchema.parse((await superAdmin.get('/audit-log/facets')).body);
      expect(facets.actions).toEqual(
        expect.arrayContaining(['REFUND_PAID', 'LEAD_CREATED', 'SETTING_CHANGED']),
      );
      expect(facets.entityTypes).toEqual(
        expect.arrayContaining(['CustomerRefund', 'Lead', 'AppSetting']),
      );
    });

    it('rejects a bad filter, a bad sort and an oversized page', async () => {
      for (const query of [
        'actorId=x',
        'from=yesterday',
        'sortBy=__nope__',
        'pageSize=101',
        'page=0',
        'q=a',
        'extra=1',
      ])
        expect((await superAdmin.get(`/audit-log?${query}`)).status, query).toBe(400);
    });

    it('answers 401 without a session', async () => {
      expect((await request(app.getHttpServer()).get('/audit-log')).status).toBe(401);
      expect((await request(app.getHttpServer()).get('/audit-log/facets')).status).toBe(401);
    });

    it('cannot be changed through the application', async () => {
      const before = await owner.auditLog.count();
      for (const method of ['post', 'put', 'patch'] as const) {
        const response = await superAdmin[method]('/audit-log');
        expect([404, 405], method).toContain(response.status);
      }
      expect(await owner.auditLog.count()).toBe(before);
    });
  });

  describe('a person’s activity', () => {
    it('summarises when they last signed in, their open sessions and what they have been doing', async () => {
      await loggedIn(app, 'admin_a');
      const response = await superAdmin.get(`/audit-log/users/${w.users.adminA}`);
      expect(response.status, JSON.stringify(response.body)).toBe(200);
      const activity = UserActivitySchema.parse(response.body);
      expect(activity).toMatchObject({
        userId: w.users.adminA,
        username: 'admin_a',
        status: 'ACTIVE',
      });
      expect(activity.activeSessions).toBeGreaterThanOrEqual(1);
      expect(activity.lastLoginAt).not.toBeNull();
      expect(activity.actionsLast30Days).toBeGreaterThanOrEqual(0);
    });

    it('counts recent actions and names the commonest first', async () => {
      const now = new Date();
      await owner.auditLog.createMany({
        data: [
          {
            actorId: w.users.staffB,
            branchId: w.branchB,
            action: 'COMMON',
            entityType: 'T',
            createdAt: now,
          },
          {
            actorId: w.users.staffB,
            branchId: w.branchB,
            action: 'COMMON',
            entityType: 'T',
            createdAt: now,
          },
          {
            actorId: w.users.staffB,
            branchId: w.branchB,
            action: 'RARE',
            entityType: 'T',
            createdAt: now,
          },
          {
            actorId: w.users.staffB,
            branchId: w.branchB,
            action: 'OLD',
            entityType: 'T',
            createdAt: new Date(Date.now() - 40 * 86_400_000),
          },
        ],
      });
      const activity = UserActivitySchema.parse(
        (await superAdmin.get(`/audit-log/users/${w.users.staffB}`)).body,
      );
      expect(activity.actionsLast30Days).toBe(3);
      expect(activity.topActions).toEqual([
        { action: 'COMMON', count: 2 },
        { action: 'RARE', count: 1 },
      ]);
    });

    it("only counts what the viewer may see, so a branch user cannot learn about another branch's work", async () => {
      const seenByA = UserActivitySchema.parse(
        (await adminA.get(`/audit-log/users/${w.users.staffB}`)).body,
      );
      expect(seenByA.actionsLast30Days).toBe(0);
    });

    it('says so for a person who does not exist and rejects a bad id', async () => {
      expect(
        (await superAdmin.get('/audit-log/users/00000000-0000-4000-8000-000000000000')).status,
      ).toBe(404);
      expect((await superAdmin.get('/audit-log/users/not-a-uuid')).status).toBe(400);
      expect(
        (await request(app.getHttpServer()).get(`/audit-log/users/${w.users.adminA}`)).status,
      ).toBe(401);
    });
  });
});
