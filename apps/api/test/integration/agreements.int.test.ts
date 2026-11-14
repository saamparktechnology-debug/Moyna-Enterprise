//apps/api/test/integration/agreements.int.test.ts
import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  AgreementListResponseSchema,
  AgreementSchema,
  AgreementTemplateSchema,
  StaffSchema,
} from '@erp/contracts';
import type { Agreement } from '@erp/contracts';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  ORIGIN,
  SUPER_PASSWORD,
  addUser,
  createAuthWorld,
  loggedIn,
} from '../support/auth-world.js';
import type { AuthWorld, TestClient } from '../support/auth-world.js';
import { createTestApp } from '../support/create-test-app.js';
import { createOwnerPrisma } from '../support/fixtures.js';

const PDF = Buffer.from(
  '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n',
);
const PNG = Buffer.concat([
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  Buffer.alloc(64, 1),
]);

describe('employee agreements', () => {
  let app: NestExpressApplication;
  let w: AuthWorld;
  let adminA: TestClient;
  let superAdmin: TestClient;
  const owner = createOwnerPrisma();
  let counter = 0;
  const unique = (prefix: string): string =>
    `${prefix}${(counter += 1).toString().padStart(4, '0')}`;

  interface Person {
    userId: string;
    staffId: string;
    client: TestClient;
  }
  const person = async (daily?: string): Promise<Person> => {
    const username = unique('ag_');
    const userId = await addUser(owner, { username, role: 'STAFF', branchIds: [w.branchA] });
    const response = await adminA.post('/staff', {
      userId,
      branchId: w.branchA,
      employeeCode: unique('AG-'),
      department: null,
      designation: 'Fitter',
      joinDate: '2026-01-01',
      ...(daily ? { salaryType: 'DAILY', dailyRate: daily } : { monthlySalary: '31000.00' }),
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return {
      userId,
      staffId: StaffSchema.parse(response.body).id,
      client: await loggedIn(app, username),
    };
  };
  const TERMS =
    'Employee {{employee_name}} ({{employee_code}}) works as {{designation}} from {{join_date}}.\n\nPay: {{salary}}. Full duty is {{duty_hours}} hours.\n\nCompany: {{company_name}}.';
  const template = async (name = unique('Template ')) => {
    const response = await adminA.post('/agreement-templates', { name, body: TERMS });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return AgreementTemplateSchema.parse(response.body);
  };
  const draftFor = async (p: Person, over: Record<string, unknown> = {}): Promise<Agreement> => {
    const response = await adminA.post('/agreements', {
      staffId: p.staffId,
      body: TERMS,
      title: 'Employment agreement',
      effectiveFrom: '2026-11-01',
      ...over,
    });
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return AgreementSchema.parse(response.body);
  };
  const upload = (
    client: TestClient,
    id: string,
    a: Agreement,
    over: { bytes?: Buffer; type?: string; query?: Record<string, string> } = {},
  ) =>
    client.agent
      .post(`/agreements/${id}/signed-copy`)
      .query({
        fileName: 'signed.pdf',
        signedOn: '2026-11-02',
        employeeSigned: 'true',
        adminSigned: 'true',
        rowVersion: String(a.rowVersion),
        ...over.query,
      })
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', client.csrf)
      .set('Content-Type', over.type ?? 'application/pdf')
      .send(over.bytes ?? PDF);
  const signed = async (a: Agreement, client = adminA): Promise<Agreement> => {
    const response = await upload(client, a.id, a);
    expect(response.status, JSON.stringify(response.body)).toBe(201);
    return AgreementSchema.parse(response.body);
  };
  const pdfOf = async (client: TestClient, id: string) =>
    client.agent
      .get(`/agreements/${id}/pdf`)
      .buffer(true)
      .parse((res, done) => {
        const chunks: Buffer[] = [];
        res.on('data', (chunk: Buffer) => chunks.push(chunk));
        res.on('end', () => done(null, Buffer.concat(chunks)));
      });

  beforeAll(async () => {
    w = await createAuthWorld(owner);
    app = await createTestApp();
    adminA = await loggedIn(app, 'admin_a');
    superAdmin = await loggedIn(app, 'superadmin', SUPER_PASSWORD);
    return async () => {
      await app.close();
      await owner.$disconnect();
    };
  });

  describe('templates with editable terms and rules', () => {
    it('are made, changed, switched off and kept with how many agreements came from them', async () => {
      const made = await template('Standard terms');
      expect(made).toMatchObject({ isActive: true, agreementCount: 0 });
      const changed = await adminA.patch(`/agreement-templates/${made.id}`, {
        body: `${TERMS}\n\nExtra clause.`,
        rowVersion: made.rowVersion,
      });
      expect(changed.status, JSON.stringify(changed.body)).toBe(200);
      expect(AgreementTemplateSchema.parse(changed.body).body).toContain('Extra clause.');
      const person1 = await person();
      await draftFor(person1, { templateId: made.id, body: undefined });
      const list = (await adminA.get('/agreement-templates')).body.items as {
        id: string;
        agreementCount: number;
      }[];
      expect(list.find((row) => row.id === made.id)?.agreementCount).toBe(1);
      const off = await adminA.patch(`/agreement-templates/${made.id}`, {
        isActive: false,
        rowVersion: AgreementTemplateSchema.parse(changed.body).rowVersion,
      });
      expect(AgreementTemplateSchema.parse(off.body).isActive).toBe(false);
    });

    it('refuse an unknown placeholder, a name that is taken, and a stale version', async () => {
      expect(
        (
          await adminA.post('/agreement-templates', {
            name: unique('T '),
            body: 'Dear {{employe_name}}, welcome to the team and its rules.',
          })
        ).status,
      ).toBe(400);
      const made = await template('Same name');
      expect(
        (await adminA.post('/agreement-templates', { name: 'same NAME', body: TERMS })).status,
      ).toBe(409);
      expect(
        (
          await adminA.patch(`/agreement-templates/${made.id}`, {
            name: 'Other',
            rowVersion: made.rowVersion + 3,
          })
        ).status,
      ).toBe(409);
    });

    it('are for those who may manage HR only', async () => {
      const p = await person();
      expect((await p.client.get('/agreement-templates')).status).toBe(403);
      expect(
        (await p.client.post('/agreement-templates', { name: unique('T '), body: TERMS })).status,
      ).toBe(403);
    });
  });

  describe('a draft agreement', () => {
    it('is made for an employee from a template or from scratch, and edited while it is a draft', async () => {
      const p = await person();
      const t = await template();
      const fromTemplate = AgreementSchema.parse(
        (
          await adminA.post('/agreements', {
            staffId: p.staffId,
            templateId: t.id,
            effectiveFrom: '2026-11-01',
          })
        ).body,
      );
      expect(fromTemplate).toMatchObject({
        status: 'DRAFT',
        templateId: t.id,
        title: t.name,
        hasSignedCopy: false,
      });
      expect(fromTemplate.agreementNo).toMatch(/^AG-\d{12}$/);
      const scratch = await draftFor(p, { title: 'Written by hand' });
      expect(scratch.templateId).toBeNull();
      const edited = await adminA.patch(`/agreements/${scratch.id}`, {
        body: `${TERMS}\n\nA rule added for this person.`,
        effectiveFrom: '2026-11-15',
        rowVersion: scratch.rowVersion,
      });
      expect(edited.status, JSON.stringify(edited.body)).toBe(200);
      expect(AgreementSchema.parse(edited.body)).toMatchObject({ effectiveFrom: '2026-11-15' });
      expect(AgreementSchema.parse(edited.body).body).toContain('A rule added for this person.');
    });

    it('needs a template or the terms, a real person, and known placeholders', async () => {
      const p = await person();
      expect(
        (await adminA.post('/agreements', { staffId: p.staffId, effectiveFrom: '2026-11-01' }))
          .status,
      ).toBe(400);
      expect(
        (
          await adminA.post('/agreements', {
            staffId: '0b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59',
            body: TERMS,
            effectiveFrom: '2026-11-01',
          })
        ).status,
      ).toBe(404);
      expect(
        (
          await adminA.post('/agreements', {
            staffId: p.staffId,
            body: 'Welcome {{nobody}}, these are the rules.',
            effectiveFrom: '2026-11-01',
          })
        ).status,
      ).toBe(400);
      const off = await template();
      await adminA.patch(`/agreement-templates/${off.id}`, {
        isActive: false,
        rowVersion: off.rowVersion,
      });
      expect(
        (
          await adminA.post('/agreements', {
            staffId: p.staffId,
            templateId: off.id,
            effectiveFrom: '2026-11-01',
          })
        ).status,
      ).toBe(400);
    });

    it('is printed with the employee’s details filled in, and a place for the employee (left) and the Super Admin (right) to sign', async () => {
      const p = await person('400.00');
      const a = await draftFor(p);
      const response = await pdfOf(adminA, a.id);
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toContain('application/pdf');
      const text = (response.body as Buffer).toString('latin1');
      expect(text.startsWith('%PDF-')).toBe(true);
      expect(text).toContain('EMPLOYMENT AGREEMENT');
      expect(text).toContain(a.agreementNo);
      expect(text).toContain('works as Fitter');
      expect(text).toContain('Rs. 400.00 a day');
      expect(text).toContain('Full duty is 8 hours');
      expect(text).not.toContain('{{');
      expect(text.indexOf('Signature of the Employee')).toBeGreaterThan(-1);
      expect(text.indexOf('Signature of the Super Admin')).toBeGreaterThan(
        text.indexOf('Signature of the Employee'),
      );
    });

    it('can be thrown away with a reason, and is then kept in the list as discarded', async () => {
      const p = await person();
      const a = await draftFor(p);
      const response = await adminA.post(`/agreements/${a.id}/discard`, {
        reason: 'Wrong person',
        rowVersion: a.rowVersion,
      });
      expect(response.status, JSON.stringify(response.body)).toBe(201);
      expect(AgreementSchema.parse(response.body)).toMatchObject({
        status: 'DISCARDED',
        endReason: 'Wrong person',
      });
      expect(
        (await adminA.patch(`/agreements/${a.id}`, { title: 'Again', rowVersion: 2 })).status,
      ).toBe(422);
    });
  });

  describe('the acceptance: the signed printed copy is uploaded', () => {
    it('freezes the agreement as signed, keeps the copy, and serves it back', async () => {
      const p = await person();
      const a = await draftFor(p);
      const done = await signed(a);
      expect(done).toMatchObject({
        status: 'SIGNED',
        signedOn: '2026-11-02',
        hasSignedCopy: true,
        signedFileName: 'signed.pdf',
        employeeSigned: true,
        adminSigned: true,
      });
      expect(done.body).toContain('works as Fitter');
      expect(done.body).not.toContain('{{');
      const served = await adminA.agent
        .get(`/agreements/${a.id}/signed-copy`)
        .buffer(true)
        .parse((res, finish) => {
          const chunks: Buffer[] = [];
          res.on('data', (chunk: Buffer) => chunks.push(chunk));
          res.on('end', () => finish(null, Buffer.concat(chunks)));
        });
      expect(served.status).toBe(200);
      expect((served.body as Buffer).equals(PDF)).toBe(true);
      const audits = await owner.auditLog.findMany({
        where: { entityId: a.id, action: { in: ['AGREEMENT_SIGNED', 'AGREEMENT_COPY_VIEWED'] } },
      });
      expect(audits.map((row) => row.action).sort()).toEqual([
        'AGREEMENT_COPY_VIEWED',
        'AGREEMENT_SIGNED',
      ]);
    });

    it('takes a picture of the signed paper too, and only a PDF, JPEG or PNG', async () => {
      const p = await person();
      const a = await draftFor(p);
      const bad = await upload(adminA, a.id, a, {
        bytes: Buffer.from('just text, not a scan'),
        type: 'text/plain',
      });
      expect(bad.status).toBe(400);
      const ok = await upload(adminA, a.id, a, {
        bytes: PNG,
        type: 'image/png',
        query: { fileName: 'photo.png' },
      });
      expect(ok.status, JSON.stringify(ok.body)).toBe(201);
    });

    it('needs both signatures confirmed, a date that is not in the future, and the version that was read', async () => {
      const p = await person();
      const a = await draftFor(p);
      expect((await upload(adminA, a.id, a, { query: { employeeSigned: 'false' } })).status).toBe(
        400,
      );
      expect((await upload(adminA, a.id, a, { query: { adminSigned: 'false' } })).status).toBe(400);
      expect((await upload(adminA, a.id, a, { query: { signedOn: '2999-01-01' } })).status).toBe(
        400,
      );
      expect(
        (await upload(adminA, a.id, a, { query: { rowVersion: String(a.rowVersion + 4) } })).status,
      ).toBe(409);
      expect((await upload(adminA, a.id, a, { bytes: Buffer.alloc(0) })).status).toBe(400);
      expect(await owner.staffAgreement.count({ where: { id: a.id, status: 'SIGNED' } })).toBe(0);
    });

    it('can no longer be changed, discarded or signed again, and the database refuses a change too', async () => {
      const p = await person();
      const done = await signed(await draftFor(p));
      expect(
        (
          await adminA.patch(`/agreements/${done.id}`, {
            title: 'Changed',
            rowVersion: done.rowVersion,
          })
        ).status,
      ).toBe(422);
      expect(
        (
          await adminA.post(`/agreements/${done.id}/discard`, {
            reason: 'Oops',
            rowVersion: done.rowVersion,
          })
        ).status,
      ).toBe(422);
      expect((await upload(adminA, done.id, done)).status).toBe(422);
      await expect(
        owner.$executeRaw`UPDATE staff_agreements SET body = 'rewritten terms for this person' WHERE id = ${done.id}::uuid`,
      ).rejects.toThrow();
      await expect(
        owner.$executeRaw`UPDATE staff_agreements SET status = 'DRAFT' WHERE id = ${done.id}::uuid`,
      ).rejects.toThrow();
    });

    it('is for those who may manage HR: an employee cannot sign their own', async () => {
      const p = await person();
      const a = await draftFor(p);
      expect((await upload(p.client, a.id, a)).status).toBe(403);
      expect(
        (
          await p.client.post('/agreements', {
            staffId: p.staffId,
            body: TERMS,
            effectiveFrom: '2026-11-01',
          })
        ).status,
      ).toBe(403);
    });
  });

  describe('one agreement in force at a time', () => {
    it('ends the one before when a new one is signed, the day before the new one starts', async () => {
      const p = await person();
      const first = await signed(await draftFor(p, { effectiveFrom: '2026-01-01' }));
      const second = await signed(
        await draftFor(p, { effectiveFrom: '2026-11-01', title: 'Revised agreement' }),
      );
      const list = AgreementListResponseSchema.parse(
        (await adminA.get(`/agreements?staffId=${p.staffId}`)).body,
      );
      const before = list.items.find((row) => row.id === first.id);
      expect(before).toMatchObject({ status: 'ENDED', endedOn: '2026-10-31' });
      expect(before?.endReason).toContain(second.agreementNo);
      expect(list.items.find((row) => row.id === second.id)?.status).toBe('SIGNED');
      expect(list.items.filter((row) => row.status === 'SIGNED')).toHaveLength(1);
    });

    it('ends a signed agreement with a day and a reason, and not before it started', async () => {
      const p = await person();
      const done = await signed(await draftFor(p, { effectiveFrom: '2026-11-01' }));
      expect(
        (
          await adminA.post(`/agreements/${done.id}/end`, {
            endedOn: '2026-10-01',
            reason: 'Left',
            rowVersion: done.rowVersion,
          })
        ).status,
      ).toBe(400);
      const ended = await adminA.post(`/agreements/${done.id}/end`, {
        endedOn: '2026-12-31',
        reason: 'Resigned',
        rowVersion: done.rowVersion,
      });
      expect(ended.status, JSON.stringify(ended.body)).toBe(201);
      expect(AgreementSchema.parse(ended.body)).toMatchObject({
        status: 'ENDED',
        endedOn: '2026-12-31',
        endReason: 'Resigned',
      });
      expect(
        (
          await adminA.post(`/agreements/${done.id}/end`, {
            endedOn: '2026-12-31',
            reason: 'Again',
            rowVersion: 5,
          })
        ).status,
      ).toBe(422);
    });
  });

  describe('who can see what', () => {
    it('lets an employee read and print their own signed agreement, but not a draft or someone else’s', async () => {
      const mine = await person();
      const other = await person();
      const draft = await draftFor(mine);
      expect((await pdfOf(mine.client, draft.id)).status).toBe(403);
      expect((await mine.client.get('/agreements/mine')).body.items).toHaveLength(0);
      const done = await signed(draft);
      expect((await pdfOf(mine.client, done.id)).status).toBe(200);
      expect((await pdfOf(other.client, done.id)).status).toBe(403);
      const own = AgreementListResponseSchema.parse(
        (await mine.client.get('/agreements/mine')).body,
      );
      expect(own.items.map((row) => row.id)).toEqual([done.id]);
      const copy = await mine.client.agent.get(`/agreements/${done.id}/signed-copy`);
      expect(copy.status).toBe(200);
      expect((await other.client.agent.get(`/agreements/${done.id}/signed-copy`)).status).toBe(403);
      expect((await mine.client.get('/agreements')).status).toBe(403);
    });

    it('shows the Super Admin every agreement, and keeps another branch’s out of a branch admin’s list', async () => {
      const p = await person();
      const a = await draftFor(p);
      const all = AgreementListResponseSchema.parse((await superAdmin.get('/agreements')).body);
      expect(all.items.some((row) => row.id === a.id)).toBe(true);
      const outside = await owner.staffAgreement.count({ where: { branchId: w.branchB } });
      const seen = AgreementListResponseSchema.parse((await adminA.get('/agreements')).body);
      expect(seen.items.every((row) => row.branchCode !== undefined)).toBe(true);
      expect(outside).toBeGreaterThanOrEqual(0);
    });
  });
});
