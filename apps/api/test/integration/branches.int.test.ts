import type { NestExpressApplication } from '@nestjs/platform-express';
import {
  BranchListResponseSchema,
  BranchSchema,
  StateListResponseSchema,
  gstinCheckCharacter,
  toOpenApiSchema,
} from '@erp/contracts';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from '../support/create-test-app.js';
import { createOwnerPrisma } from '../support/fixtures.js';
import {
  createAuthWorld,
  loggedIn,
  ORIGIN,
  SUPER_PASSWORD,
  TestClient,
} from '../support/auth-world.js';
import type { AuthWorld } from '../support/auth-world.js';

const gstinFor = (state: string, suffix = 'AAPFU0939F1Z') =>
  `${state}${suffix}${gstinCheckCharacter(`${state}${suffix}`)}`;

describe('branches', () => {
  let app: NestExpressApplication;
  let w: AuthWorld;
  let superAdmin: TestClient;
  let adminA: TestClient;
  let staffA: TestClient;
  const owner = createOwnerPrisma();
  let counter = 0;
  const nextCode = (): string =>
    `Z${(counter += 1).toString(36).toUpperCase().padStart(2, '0')}`.slice(0, 4);
  const create = (client: TestClient, body: object) => client.post('/branches', body);
  const body = (over: object = {}) => ({
    code: nextCode(),
    name: 'Test Branch',
    stateCode: '27',
    gstin: null,
    ...over,
  });
  const fresh = async (over: { stateCode?: string } = {}) =>
    (await create(superAdmin, body(over))).body as { id: string; code: string; rowVersion: number };

  beforeAll(async () => {
    w = await createAuthWorld(owner);
    app = await createTestApp();
    superAdmin = await loggedIn(app, 'superadmin', SUPER_PASSWORD);
    adminA = await loggedIn(app, 'admin_a');
    staffA = await loggedIn(app, 'staff_a');
    return async () => {
      await app.close();
      await owner.$disconnect();
    };
  });
  beforeEach(async () => {
    await owner.auditLog.deleteMany({ where: { action: 'LOGIN_FAILED' } });
  });

  describe('who may call what', () => {
    it('answers every branch endpoint with 401 when signed out', async () => {
      const id = w.branchA;
      const attempts = [
        request(app.getHttpServer()).get('/branches'),
        request(app.getHttpServer()).get(`/branches/${id}`),
        request(app.getHttpServer()).post('/branches').set('Origin', ORIGIN).send({}),
        request(app.getHttpServer()).patch(`/branches/${id}`).set('Origin', ORIGIN).send({}),
        request(app.getHttpServer())
          .post(`/branches/${id}/deactivate`)
          .set('Origin', ORIGIN)
          .send({}),
        request(app.getHttpServer())
          .post(`/branches/${id}/reactivate`)
          .set('Origin', ORIGIN)
          .send({}),
        request(app.getHttpServer()).get('/reference/states'),
      ];
      for (const response of await Promise.all(attempts)) expect(response.status).toBe(401);
    });

    it('lets Admin and Staff read their branches but not change any', async () => {
      for (const client of [adminA, staffA]) {
        expect((await client.get('/branches')).status).toBe(200);
        expect((await create(client, body())).status).toBe(403);
        expect(
          (
            await client.agent
              .patch(`/branches/${w.branchA}`)
              .set('Origin', ORIGIN)
              .set('X-CSRF-Token', client.csrf)
              .send({ name: 'Hacked', rowVersion: 1 })
          ).status,
        ).toBe(403);
        expect((await client.post(`/branches/${w.branchA}/deactivate`)).status).toBe(403);
        expect((await client.post(`/branches/${w.branchA}/reactivate`)).status).toBe(403);
      }
      expect((await owner.branch.findUniqueOrThrow({ where: { id: w.branchA } })).name).toBe(
        'Branch AA',
      );
    });

    it('requires the CSRF token to change a branch', async () => {
      const response = await superAdmin.agent.post('/branches').set('Origin', ORIGIN).send(body());
      expect(response.status).toBe(403);
    });
  });

  describe('listing and viewing', () => {
    it('shows a Super Admin every active branch, with the state name', async () => {
      const response = await superAdmin.get('/branches?pageSize=100');
      expect(response.status).toBe(200);
      const page = BranchListResponseSchema.parse(response.body);
      expect(page.items.map((b) => b.code)).toEqual(
        expect.arrayContaining(['HQ', 'AA', 'BB', 'CC']),
      );
      expect(page.items.find((b) => b.code === 'AA')).toMatchObject({
        stateCode: '27',
        stateName: 'Maharashtra',
        isActive: true,
      });
      expect([...page.items].map((b) => b.code)).toEqual([...page.items].map((b) => b.code).sort());
    });

    it('shows an Admin or Staff user only the branches they work in', async () => {
      for (const client of [adminA, staffA]) {
        const page = BranchListResponseSchema.parse((await client.get('/branches')).body);
        expect(page.items.map((b) => b.code)).toEqual(['AA']);
        expect(page.total).toBe(1);
      }
      const multi = await owner.userBranch.create({
        data: { userId: w.users.staffA2, branchId: w.branchB },
      });
      const staff2 = await loggedIn(app, 'staff_a2');
      expect(
        BranchListResponseSchema.parse((await staff2.get('/branches')).body).items.map(
          (b) => b.code,
        ),
      ).toEqual(['AA', 'BB']);
      await owner.userBranch.delete({
        where: { userId_branchId: { userId: multi.userId, branchId: multi.branchId } },
      });
    });

    it('paginates on the server and reports the totals', async () => {
      const first = (await superAdmin.get('/branches?pageSize=2&page=1')).body;
      const second = (await superAdmin.get('/branches?pageSize=2&page=2')).body;
      expect(first).toMatchObject({ page: 1, pageSize: 2 });
      expect(first.items).toHaveLength(2);
      expect(first.totalPages).toBe(Math.ceil(first.total / 2));
      expect(second.items.map((b: { id: string }) => b.id)).not.toEqual(
        expect.arrayContaining(first.items.map((b: { id: string }) => b.id)),
      );
      expect((await superAdmin.get('/branches?page=999')).body.items).toEqual([]);
    });

    it('searches by code or name without regard to case, and sorts', async () => {
      expect(
        (await superAdmin.get('/branches?search=branch%20bb')).body.items.map(
          (b: { code: string }) => b.code,
        ),
      ).toEqual(['BB']);
      expect(
        (await superAdmin.get('/branches?search=hq')).body.items.map(
          (b: { code: string }) => b.code,
        ),
      ).toEqual(['HQ']);
      expect((await superAdmin.get('/branches?search=zzzz-none')).body).toMatchObject({
        items: [],
        total: 0,
        totalPages: 0,
      });
      const byNameDesc = (
        await superAdmin.get('/branches?sortBy=name&sortOrder=desc&pageSize=100')
      ).body.items.map((b: { name: string }) => b.name);
      expect(byNameDesc).toEqual([...byNameDesc].sort().reverse());
    });

    it('treats search text as text, never as a pattern or SQL', async () => {
      for (const search of ["'; DROP TABLE branches; --", '%', '_', '\\']) {
        const response = await superAdmin.get(`/branches?search=${encodeURIComponent(search)}`);
        expect(response.status, search).toBe(200);
        expect(response.body.items).toEqual([]);
      }
      expect((await superAdmin.get('/branches')).body.total).toBeGreaterThan(0);
    });

    it('rejects an unknown sort field, a huge page and an unknown status with field details', async () => {
      const sort = await superAdmin.get('/branches?sortBy=passwordHash');
      expect(sort.status).toBe(400);
      expect(sort.body.details[0].field).toBe('sortBy');
      expect((await superAdmin.get('/branches?pageSize=101')).status).toBe(400);
      expect((await superAdmin.get('/branches?status=deleted')).status).toBe(400);
    });

    it('hides inactive branches unless asked', async () => {
      const branch = await fresh();
      await superAdmin.post(`/branches/${branch.id}/deactivate`);
      expect((await superAdmin.get(`/branches?search=${branch.code}`)).body.total).toBe(0);
      expect(
        (await superAdmin.get(`/branches?search=${branch.code}&status=inactive`)).body.total,
      ).toBe(1);
      expect((await superAdmin.get(`/branches?search=${branch.code}&status=all`)).body.total).toBe(
        1,
      );
    });

    it('returns one branch, and 404 rather than 403 for a branch the user does not work in', async () => {
      expect(BranchSchema.parse((await adminA.get(`/branches/${w.branchA}`)).body).code).toBe('AA');
      expect((await adminA.get(`/branches/${w.branchB}`)).status).toBe(404);
      expect((await superAdmin.get(`/branches/${w.branchB}`)).status).toBe(200);
      expect((await superAdmin.get('/branches/00000000-0000-4000-8000-000000000000')).status).toBe(
        404,
      );
      expect((await superAdmin.get('/branches/not-a-uuid')).status).toBe(400);
    });

    it('lists the active states for the form', async () => {
      const response = await staffA.get('/reference/states');
      const states = StateListResponseSchema.parse(response.body);
      expect(states.find((s) => s.code === '27')).toEqual({ code: '27', name: 'Maharashtra' });
      expect(states.map((s) => s.code)).toEqual([...states.map((s) => s.code)].sort());
      await owner.state.update({ where: { code: '99' }, data: { isActive: false } });
      expect(
        (await staffA.get('/reference/states')).body.map((s: { code: string }) => s.code),
      ).not.toContain('99');
      await owner.state.update({ where: { code: '99' }, data: { isActive: true } });
    });
  });

  describe('creating', () => {
    it('creates a branch, normalises it and records who did it', async () => {
      const gstin = gstinFor('19', 'ABCDE1234F1Z');
      const response = await create(superAdmin, {
        code: ' kol ',
        name: '  Kolkata  ',
        stateCode: '19',
        gstin: gstin.toLowerCase(),
      });

      expect(response.status).toBe(201);
      const created = BranchSchema.parse(response.body);
      expect(created).toMatchObject({
        code: 'KOL',
        name: 'Kolkata',
        stateCode: '19',
        stateName: 'West Bengal',
        gstin,
        isActive: true,
        rowVersion: 1,
      });
      const row = await owner.branch.findUniqueOrThrow({ where: { id: created.id } });
      expect(row.createdBy).toBe(w.users.super);
      const audit = await owner.auditLog.findFirstOrThrow({
        where: { action: 'BRANCH_CREATED', entityId: created.id },
      });
      expect(audit).toMatchObject({ actorId: w.users.super, branchId: created.id });
      expect(audit.newValue).toMatchObject({ code: 'KOL', name: 'Kolkata', gstin });
    });

    it('allows a branch with no GSTIN', async () => {
      const response = await create(superAdmin, body({ gstin: null }));
      expect(response.status).toBe(201);
      expect(response.body.gstin).toBeNull();
    });

    it('explains every problem with the field it belongs to', async () => {
      const bad = await create(superAdmin, {
        code: 'toolong',
        name: ' ',
        stateCode: 'xx',
        gstin: 'NOTAGSTIN',
      });
      expect(bad.status).toBe(400);
      expect(bad.body.details.map((d: { field: string }) => d.field).sort()).toEqual([
        'code',
        'gstin',
        'name',
        'stateCode',
      ]);
      expect((await create(superAdmin, {})).status).toBe(400);
    });

    it('rejects a GSTIN with a typo or from another state', async () => {
      const typo = gstinFor('27').slice(0, 14) + (gstinFor('27').endsWith('A') ? 'B' : 'A');
      expect((await create(superAdmin, body({ gstin: typo }))).body.details[0]).toMatchObject({
        field: 'gstin',
        message: expect.stringMatching(/check character/),
      });
      const mismatch = await create(superAdmin, body({ stateCode: '29', gstin: gstinFor('27') }));
      expect(mismatch.status).toBe(400);
      expect(mismatch.body.details[0]).toMatchObject({
        field: 'gstin',
        message: 'The GSTIN must start with the state code 29',
      });
    });

    it('rejects a state that does not exist or is switched off', async () => {
      expect((await create(superAdmin, body({ stateCode: '98' }))).body.details[0].field).toBe(
        'stateCode',
      );
      await owner.state.update({ where: { code: '30' }, data: { isActive: false } });
      expect((await create(superAdmin, body({ stateCode: '30' }))).status).toBe(400);
      await owner.state.update({ where: { code: '30' }, data: { isActive: true } });
    });

    it('refuses a duplicate code, however it is written', async () => {
      const first = await fresh();
      for (const code of [first.code, first.code.toLowerCase(), ` ${first.code} `]) {
        const response = await create(superAdmin, body({ code }));
        expect(response.status, code).toBe(409);
        expect(response.body).toMatchObject({ code: 'CONFLICT', details: [{ field: 'code' }] });
      }
    });

    it('lets exactly one of several simultaneous creations with the same code succeed', async () => {
      const code = nextCode();
      const results = await Promise.all(
        Array.from({ length: 6 }, () => create(superAdmin, body({ code }))),
      );
      expect(results.filter((r) => r.status === 201)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(5);
      expect(await owner.branch.count({ where: { code } })).toBe(1);
    });
  });

  describe('editing', () => {
    const patch = (client: TestClient, id: string, payload: object) =>
      client.agent
        .patch(`/branches/${id}`)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', client.csrf)
        .send(payload);

    it('changes the name, bumps the version and records old and new values', async () => {
      const branch = await fresh();
      const response = await patch(superAdmin, branch.id, {
        name: 'Renamed Branch',
        rowVersion: branch.rowVersion,
      });

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        name: 'Renamed Branch',
        rowVersion: branch.rowVersion + 1,
        code: branch.code,
      });
      const audit = await owner.auditLog.findFirstOrThrow({
        where: { action: 'BRANCH_UPDATED', entityId: branch.id },
      });
      expect(audit.oldValue).toMatchObject({ name: 'Test Branch' });
      expect(audit.newValue).toMatchObject({ name: 'Renamed Branch' });
    });

    it('never changes the code, even if one is sent', async () => {
      const branch = await fresh();
      const response = await patch(superAdmin, branch.id, {
        name: 'Same Code Branch',
        code: 'ZZZZ',
        rowVersion: branch.rowVersion,
      });
      expect(response.status).toBe(200);
      expect(response.body.code).toBe(branch.code);
    });

    it('refuses an edit made from a stale copy, so two people cannot overwrite each other', async () => {
      const branch = await fresh();
      expect(
        (await patch(superAdmin, branch.id, { name: 'First edit', rowVersion: branch.rowVersion }))
          .status,
      ).toBe(200);
      const stale = await patch(superAdmin, branch.id, {
        name: 'Second edit',
        rowVersion: branch.rowVersion,
      });
      expect(stale.status).toBe(409);
      expect(stale.body.message).toMatch(/changed by someone else/);
      expect((await owner.branch.findUniqueOrThrow({ where: { id: branch.id } })).name).toBe(
        'First edit',
      );
    });

    it('applies only one of several simultaneous edits made from the same version', async () => {
      const branch = await fresh();
      const results = await Promise.all(
        Array.from({ length: 5 }, (_, i) =>
          patch(superAdmin, branch.id, { name: `Edit number ${i}`, rowVersion: branch.rowVersion }),
        ),
      );
      expect(results.filter((r) => r.status === 200)).toHaveLength(1);
      expect(results.filter((r) => r.status === 409)).toHaveLength(4);
    });

    it('does nothing, and records nothing, when nothing changes', async () => {
      const branch = await fresh();
      const before = await owner.auditLog.count({
        where: { action: 'BRANCH_UPDATED', entityId: branch.id },
      });
      const response = await patch(superAdmin, branch.id, {
        name: 'Test Branch',
        rowVersion: branch.rowVersion,
      });
      expect(response.status).toBe(200);
      expect(response.body.rowVersion).toBe(branch.rowVersion);
      expect(
        await owner.auditLog.count({ where: { action: 'BRANCH_UPDATED', entityId: branch.id } }),
      ).toBe(before);
    });

    it('lets the state and GSTIN change together while no invoice has been issued', async () => {
      const branch = await fresh();
      const gstin = gstinFor('29', 'AAACR5055K1Z');
      const response = await patch(superAdmin, branch.id, {
        stateCode: '29',
        gstin,
        rowVersion: branch.rowVersion,
      });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ stateCode: '29', gstin, stateName: 'Karnataka' });
      const removed = await patch(superAdmin, branch.id, {
        gstin: null,
        rowVersion: response.body.rowVersion,
      });
      expect(removed.body.gstin).toBeNull();
    });

    it('rejects a state change that no longer matches the GSTIN, and a GSTIN from the wrong state', async () => {
      const branch = await fresh();
      const withGstin = await patch(superAdmin, branch.id, {
        gstin: gstinFor('27'),
        rowVersion: branch.rowVersion,
      });
      const mismatch = await patch(superAdmin, branch.id, {
        stateCode: '29',
        rowVersion: withGstin.body.rowVersion,
      });
      expect(mismatch.status).toBe(400);
      expect(mismatch.body.details[0]).toMatchObject({ field: 'gstin' });
      const wrong = await patch(superAdmin, branch.id, {
        gstin: gstinFor('29'),
        rowVersion: withGstin.body.rowVersion,
      });
      expect(wrong.status).toBe(400);
    });

    it('freezes the state and GSTIN once the branch has issued invoices, but still allows a rename', async () => {
      const blocked = await patch(superAdmin, w.branchA, { gstin: gstinFor('27'), rowVersion: 1 });
      expect(blocked.status).toBe(422);
      expect(blocked.body).toMatchObject({
        code: 'BUSINESS_RULE_VIOLATION',
        message: expect.stringMatching(/issued invoices/),
      });
      const current = (await superAdmin.get(`/branches/${w.branchA}`)).body;
      const renamed = await patch(superAdmin, w.branchA, {
        name: 'Branch AA (Pune)',
        rowVersion: current.rowVersion,
      });
      expect(renamed.status).toBe(200);
    });

    it('answers an unknown branch with 404 and an empty change with 400', async () => {
      expect(
        (
          await patch(superAdmin, '00000000-0000-4000-8000-000000000000', {
            name: 'Nobody',
            rowVersion: 1,
          })
        ).status,
      ).toBe(404);
      const branch = await fresh();
      expect((await patch(superAdmin, branch.id, { rowVersion: branch.rowVersion })).status).toBe(
        400,
      );
    });
  });

  describe('deactivating and reactivating', () => {
    it('deactivates an empty branch, records it, and takes it away from its users while they stay signed in', async () => {
      const branch = await fresh();
      const role = await owner.role.findUniqueOrThrow({ where: { name: 'STAFF' } });
      const user = await owner.user.create({
        data: {
          username: `u_${branch.code.toLowerCase()}`,
          email: `${branch.code}@example.com`,
          fullName: 'Branch Person',
          passwordHash: (await owner.user.findUniqueOrThrow({ where: { id: w.users.staffA } }))
            .passwordHash,
          userRoles: { create: { roleId: role.id } },
          userBranches: { create: { branchId: branch.id } },
        },
      });
      const person = await loggedIn(app, user.username);
      expect(
        (await person.get('/auth/session')).body.user.branches.map((b: { id: string }) => b.id),
      ).toEqual([branch.id]);

      const response = await superAdmin.post(`/branches/${branch.id}/deactivate`);

      expect(response.status).toBe(200);
      expect(response.body.isActive).toBe(false);
      expect((await person.get('/auth/session')).body.user.branches).toEqual([]);
      expect(
        await owner.auditLog.count({
          where: { action: 'BRANCH_DEACTIVATED', entityId: branch.id },
        }),
      ).toBe(1);
    });

    it('refuses to deactivate a branch that still holds stock or has open transfers, and says why', async () => {
      const response = await superAdmin.post(`/branches/${w.branchA}/deactivate`);
      expect(response.status).toBe(422);
      expect(response.body.message).toBe('This branch cannot be deactivated yet');
      const messages = response.body.details.map((d: { message: string }) => d.message).join(' | ');
      expect(messages).toMatch(/5 units of stock/);
      expect(messages).toMatch(/1 stock transfer is still open/);
      expect((await owner.branch.findUniqueOrThrow({ where: { id: w.branchA } })).isActive).toBe(
        true,
      );
    });

    it('allows it once the stock is gone and the transfers are finished', async () => {
      const branch = await fresh();
      await owner.stockBalance.create({
        data: { branchId: branch.id, itemId: w.itemId, state: 'AVAILABLE', quantity: 3 },
      });
      const transfer = await owner.transfer.create({
        data: {
          transferNo: `${branch.code}TRF/2627/00001`,
          fromBranchId: branch.id,
          toBranchId: w.branchB,
        },
      });
      expect((await superAdmin.post(`/branches/${branch.id}/deactivate`)).status).toBe(422);
      await owner.stockBalance.updateMany({
        where: { branchId: branch.id },
        data: { quantity: 0 },
      });
      expect(
        (await superAdmin.post(`/branches/${branch.id}/deactivate`)).body.details[0].message,
      ).toMatch(/transfer/);
      await owner.transfer.update({ where: { id: transfer.id }, data: { status: 'RECEIVED' } });
      expect((await superAdmin.post(`/branches/${branch.id}/deactivate`)).status).toBe(200);
    });

    it('never deactivates the last active branch', async () => {
      const others = await owner.branch.findMany({ where: { isActive: true } });
      const keep = others[0]!;
      await owner.branch.updateMany({ where: { id: { not: keep.id } }, data: { isActive: false } });
      const response = await superAdmin.post(`/branches/${keep.id}/deactivate`);
      await owner.branch.updateMany({
        where: { id: { in: others.map((b) => b.id) } },
        data: { isActive: true },
      });
      expect(response.status).toBe(422);
      expect(response.body.message).toBe('The last active branch cannot be deactivated');
    });

    it('does nothing the second time, and reactivates a branch', async () => {
      const branch = await fresh();
      await superAdmin.post(`/branches/${branch.id}/deactivate`);
      const again = await superAdmin.post(`/branches/${branch.id}/deactivate`);
      expect(again.status).toBe(200);
      expect(
        await owner.auditLog.count({
          where: { action: 'BRANCH_DEACTIVATED', entityId: branch.id },
        }),
      ).toBe(1);

      const back = await superAdmin.post(`/branches/${branch.id}/reactivate`);
      expect(back.body.isActive).toBe(true);
      expect(
        await owner.auditLog.count({
          where: { action: 'BRANCH_REACTIVATED', entityId: branch.id },
        }),
      ).toBe(1);
      expect((await superAdmin.post(`/branches/${branch.id}/reactivate`)).status).toBe(200);
      expect(
        await owner.auditLog.count({
          where: { action: 'BRANCH_REACTIVATED', entityId: branch.id },
        }),
      ).toBe(1);
    });

    it('answers an unknown branch with 404', async () => {
      expect(
        (await superAdmin.post('/branches/00000000-0000-4000-8000-000000000000/deactivate')).status,
      ).toBe(404);
      expect(
        (await superAdmin.post('/branches/00000000-0000-4000-8000-000000000000/reactivate')).status,
      ).toBe(404);
    });
  });

  describe('documentation', () => {
    it('lists every branch endpoint in the OpenAPI document with the shared schemas', async () => {
      const paths = (await request(app.getHttpServer()).get('/docs-json')).body.paths;
      const schemaOf = (path: string, method: string, status: string) =>
        paths[path]?.[method]?.responses?.[status]?.content?.['application/json']?.schema;
      expect(schemaOf('/branches', 'get', '200')).toEqual(
        toOpenApiSchema(BranchListResponseSchema),
      );
      expect(schemaOf('/branches', 'post', '201')).toEqual(toOpenApiSchema(BranchSchema));
      expect(schemaOf('/branches/{id}', 'get', '200')).toEqual(toOpenApiSchema(BranchSchema));
      expect(schemaOf('/branches/{id}', 'patch', '200')).toEqual(toOpenApiSchema(BranchSchema));
      expect(schemaOf('/branches/{id}/deactivate', 'post', '200')).toEqual(
        toOpenApiSchema(BranchSchema),
      );
      expect(schemaOf('/branches/{id}/reactivate', 'post', '200')).toEqual(
        toOpenApiSchema(BranchSchema),
      );
      expect(schemaOf('/reference/states', 'get', '200')).toEqual(
        toOpenApiSchema(StateListResponseSchema),
      );
    });
  });
});
