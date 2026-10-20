import type { NestExpressApplication } from '@nestjs/platform-express';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { PermissionGroupsResponseSchema, RoleListResponseSchema, RoleSchema } from '@erp/contracts';
import { PERMISSION_CODES, ROLE_PRESETS } from '@erp/permissions';
import { createTestApp } from '../support/create-test-app.js';
import { createOwnerPrisma } from '../support/fixtures.js';
import {
  addUser,
  createAuthWorld,
  loggedIn,
  ORIGIN,
  roleId,
  SUPER_PASSWORD,
  TestClient,
} from '../support/auth-world.js';
import type { AuthWorld } from '../support/auth-world.js';

describe('roles and permissions', () => {
  let app: NestExpressApplication;
  let w: AuthWorld;
  const owner = createOwnerPrisma();
  const superLogin = () => loggedIn(app, 'superadmin', SUPER_PASSWORD);
  const patch = (client: TestClient, id: string, body: object) =>
    client.agent
      .patch(`/roles/${id}`)
      .set('Origin', ORIGIN)
      .set('X-CSRF-Token', client.csrf)
      .send(body);
  const create = (client: TestClient, body: object) =>
    client.post('/roles', {
      name: 'Store Keeper',
      description: 'Looks after stock',
      tier: 'STAFF',
      permissionCodes: ['stock.view', 'items.view'],
      ...body,
    });
  const codesOf = async (id: string) =>
    (await owner.rolePermission.findMany({ where: { roleId: id }, include: { permission: true } }))
      .map((r) => r.permission.code)
      .sort();

  beforeAll(async () => {
    w = await createAuthWorld(owner);
    app = await createTestApp();
    return async () => {
      await app.close();
      await owner.$disconnect();
    };
  });

  describe('who may call what', () => {
    it('answers every roles endpoint with 401 when signed out', async () => {
      const server = request(app.getHttpServer());
      for (const [method, path] of [
        ['get', '/roles'],
        ['get', '/permissions'],
        ['post', '/roles'],
        ['patch', '/roles/00000000-0000-4000-8000-000000000000'],
      ] as const) {
        expect((await server[method](path).set('Origin', ORIGIN).send({})).status, path).toBe(401);
      }
    });

    it('lets only a Super Admin create or edit roles', async () => {
      const admin = await loggedIn(app, 'admin_a');
      expect((await create(admin, {})).status).toBe(403);
      expect(
        (
          await patch(admin, await roleId(owner, 'STAFF'), {
            name: 'STAFF',
            description: null,
            permissionCodes: [],
            rowVersion: 1,
          })
        ).status,
      ).toBe(403);
      expect(await owner.role.count({ where: { name: 'Store Keeper' } })).toBe(0);
    });

    it('requires the CSRF token', async () => {
      const client = await superLogin();
      const response = await client.agent
        .post('/roles')
        .set('Origin', ORIGIN)
        .send({ name: 'No Token', tier: 'STAFF', permissionCodes: [] });
      expect(response.status).toBe(403);
    });
  });

  describe('reading', () => {
    it('shows a Super Admin every role with its permissions and user count', async () => {
      const response = await (await superLogin()).get('/roles');
      const roles = RoleListResponseSchema.parse(response.body);
      expect(roles.map((r) => r.name)).toEqual(
        expect.arrayContaining(['ADMIN', 'STAFF', 'SUPER_ADMIN']),
      );
      const byName = Object.fromEntries(roles.map((r) => [r.name, r]));
      expect(byName['SUPER_ADMIN']).toMatchObject({
        tier: 'SUPER_ADMIN',
        isSystem: true,
        editable: false,
        userCount: 1,
      });
      expect(byName['SUPER_ADMIN']!.permissionCodes).toEqual([...PERMISSION_CODES].sort());
      expect(byName['STAFF']).toMatchObject({ tier: 'STAFF', editable: true });
      expect(byName['STAFF']!.permissionCodes).toEqual([...ROLE_PRESETS.STAFF].sort());
      expect(byName['STAFF']!.userCount).toBeGreaterThanOrEqual(4);
    });

    it('shows an Admin only the roles they may hand out, and Staff none', async () => {
      const adminRoles = (await (await loggedIn(app, 'admin_a')).get('/roles')).body.map(
        (r: { name: string }) => r.name,
      );
      expect(adminRoles).toContain('STAFF');
      expect(adminRoles).not.toContain('ADMIN');
      expect(adminRoles).not.toContain('SUPER_ADMIN');
      expect((await (await loggedIn(app, 'staff_a')).get('/roles')).body).toEqual([]);
    });

    it('hides a role the viewer cannot hand out, as not found', async () => {
      const admin = await loggedIn(app, 'admin_a');
      expect((await admin.get(`/roles/${await roleId(owner, 'SUPER_ADMIN')}`)).status).toBe(404);
      expect((await admin.get(`/roles/${await roleId(owner, 'STAFF')}`)).status).toBe(200);
      expect((await admin.get('/roles/not-a-uuid')).status).toBe(400);
    });

    it('lists permissions grouped by module and marks the reserved ones', async () => {
      const groups = PermissionGroupsResponseSchema.parse(
        (await (await loggedIn(app, 'admin_a')).get('/permissions')).body,
      );
      expect(groups.flatMap((g) => g.permissions).length).toBe(PERMISSION_CODES.length);
      const flat = Object.fromEntries(groups.flatMap((g) => g.permissions).map((p) => [p.code, p]));
      expect(flat['roles.manage']?.reserved).toBe(true);
      expect(flat['branches.manage']?.reserved).toBe(true);
      expect(flat['stock.view']?.reserved).toBe(false);
      expect(groups.map((g) => g.module)).toEqual([...groups.map((g) => g.module)].sort());
    });
  });

  describe('creating', () => {
    it('creates a custom role with its permissions and records it', async () => {
      const response = await create(await superLogin(), {});
      expect(response.status).toBe(201);
      expect(RoleSchema.parse(response.body)).toMatchObject({
        name: 'Store Keeper',
        tier: 'STAFF',
        isSystem: false,
        editable: true,
        userCount: 0,
        permissionCodes: ['items.view', 'stock.view'],
      });
      const audit = await owner.auditLog.findFirstOrThrow({
        where: { action: 'ROLE_CREATED', entityId: response.body.id },
      });
      expect(audit.actorId).toBe(w.users.super);
      expect(audit.newValue).toMatchObject({
        name: 'Store Keeper',
        permissionCodes: ['items.view', 'stock.view'],
      });
    });

    it('allows a role with no permissions at all', async () => {
      expect(
        (await create(await superLogin(), { name: 'Observer', permissionCodes: [] })).status,
      ).toBe(201);
    });

    it('refuses a name that is already taken, in any letter case, including the system roles', async () => {
      const client = await superLogin();
      for (const name of ['store keeper', 'STORE KEEPER', 'staff', 'Admin', 'super_admin']) {
        const response = await create(client, { name });
        expect(response.status, name).toBe(409);
        expect(response.body.details).toEqual([
          { field: 'name', message: 'A role with this name already exists' },
        ]);
      }
    });

    it('refuses the permissions only a Super Admin may hold, and unknown ones', async () => {
      const client = await superLogin();
      const reserved = await create(client, {
        name: 'Sneaky',
        permissionCodes: ['stock.view', 'roles.manage'],
      });
      expect(reserved.status).toBe(400);
      expect(reserved.body.details[0]).toMatchObject({
        field: 'permissionCodes',
        message: expect.stringContaining('roles.manage'),
      });
      expect(
        (await create(client, { name: 'Sneaky 2', permissionCodes: ['branches.manage'] })).status,
      ).toBe(400);
      const unknown = await create(client, {
        name: 'Sneaky 3',
        permissionCodes: ['stock.teleport'],
      });
      expect(unknown.body.details[0].message).toContain('stock.teleport');
      expect(await owner.role.count({ where: { name: { startsWith: 'Sneaky' } } })).toBe(0);
    });

    it('never creates a role at Super Admin level, and rejects malformed input', async () => {
      const client = await superLogin();
      expect((await create(client, { name: 'Another Boss', tier: 'SUPER_ADMIN' })).status).toBe(
        400,
      );
      const bad = await client.post('/roles', { name: '<b>', tier: 'GOD', permissionCodes: 'all' });
      expect(bad.status).toBe(400);
      expect(bad.body.details.map((d: { field: string }) => d.field).sort()).toEqual([
        'name',
        'permissionCodes',
        'tier',
      ]);
    });

    it('lets exactly one of several simultaneous creations with the same name succeed', async () => {
      const client = await superLogin();
      const outcomes = await Promise.all(
        Array.from({ length: 4 }, () => create(client, { name: 'Racing Role' })),
      );
      expect(outcomes.filter((r) => r.status === 201)).toHaveLength(1);
      expect(await owner.role.count({ where: { name: 'Racing Role' } })).toBe(1);
    });
  });

  describe('editing', () => {
    it('changes permissions, records what was added and removed, and bumps the version', async () => {
      const client = await superLogin();
      const made = (
        await create(client, {
          name: 'Editable Role',
          permissionCodes: ['stock.view', 'items.view'],
        })
      ).body;
      const response = await patch(client, made.id, {
        name: 'Editable Role',
        description: 'Updated',
        permissionCodes: ['stock.view', 'customers.view'],
        rowVersion: made.rowVersion,
      });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        description: 'Updated',
        permissionCodes: ['customers.view', 'stock.view'],
        rowVersion: made.rowVersion + 1,
      });
      expect(await codesOf(made.id)).toEqual(['customers.view', 'stock.view']);
      const audit = await owner.auditLog.findFirstOrThrow({
        where: { action: 'ROLE_UPDATED', entityId: made.id },
      });
      expect(audit.newValue).toMatchObject({
        permissionsAdded: ['customers.view'],
        permissionsRemoved: ['items.view'],
      });
    });

    it('applies a change to the people holding the role on their very next request', async () => {
      const client = await superLogin();
      const role = (
        await create(client, { name: 'Branch Viewer', permissionCodes: ['branches.view'] })
      ).body;
      await addUser(owner, {
        username: 'viewer_one',
        role: 'Branch Viewer',
        branchIds: [w.branchA],
      });
      const person = await loggedIn(app, 'viewer_one');
      expect((await person.get('/branches')).status).toBe(200);

      await patch(client, role.id, {
        name: 'Branch Viewer',
        description: null,
        permissionCodes: ['stock.view'],
        rowVersion: role.rowVersion,
      });
      expect((await person.get('/branches')).status).toBe(403);

      const current = (await client.get(`/roles/${role.id}`)).body;
      await patch(client, role.id, {
        name: 'Branch Viewer',
        description: null,
        permissionCodes: ['branches.view'],
        rowVersion: current.rowVersion,
      });
      expect((await person.get('/branches')).status).toBe(200);
    });

    it('does nothing, and records nothing, when nothing changes', async () => {
      const client = await superLogin();
      const made = (await create(client, { name: 'Steady Role' })).body;
      const response = await patch(client, made.id, {
        name: 'Steady Role',
        description: made.description,
        permissionCodes: made.permissionCodes,
        rowVersion: made.rowVersion,
      });
      expect(response.status).toBe(200);
      expect(response.body.rowVersion).toBe(made.rowVersion);
      expect(
        await owner.auditLog.count({ where: { action: 'ROLE_UPDATED', entityId: made.id } }),
      ).toBe(0);
    });

    it('refuses a stale edit, and applies only one of several simultaneous ones', async () => {
      const client = await superLogin();
      const made = (await create(client, { name: 'Contested Role' })).body;
      const body = (n: number) => ({
        name: 'Contested Role',
        description: `Edit ${n}`,
        permissionCodes: made.permissionCodes,
        rowVersion: made.rowVersion,
      });
      const outcomes = await Promise.all([1, 2, 3].map((n) => patch(client, made.id, body(n))));
      expect(outcomes.filter((r) => r.status === 200)).toHaveLength(1);
      expect(outcomes.filter((r) => r.status === 409)).toHaveLength(2);
    });

    it('lets the Admin and Staff presets be tuned, but not renamed, and never touches the Super Admin role', async () => {
      const client = await superLogin();
      const staff = (await client.get(`/roles/${await roleId(owner, 'STAFF')}`)).body;
      const without = staff.permissionCodes.filter((c: string) => c !== 'leads.manage');
      const tuned = await patch(client, staff.id, {
        name: 'STAFF',
        description: staff.description,
        permissionCodes: without,
        rowVersion: staff.rowVersion,
      });
      expect(tuned.status).toBe(200);
      expect(tuned.body.permissionCodes).not.toContain('leads.manage');
      const restored = await patch(client, staff.id, {
        name: 'STAFF',
        description: staff.description,
        permissionCodes: staff.permissionCodes,
        rowVersion: tuned.body.rowVersion,
      });
      expect(restored.status).toBe(200);

      const rename = await patch(client, staff.id, {
        name: 'WORKERS',
        description: null,
        permissionCodes: staff.permissionCodes,
        rowVersion: restored.body.rowVersion,
      });
      expect(rename.status).toBe(400);
      expect(rename.body.details).toEqual([
        { field: 'name', message: 'System roles cannot be renamed' },
      ]);

      const superRole = (await client.get(`/roles/${await roleId(owner, 'SUPER_ADMIN')}`)).body;
      const attempt = await patch(client, superRole.id, {
        name: 'SUPER_ADMIN',
        description: null,
        permissionCodes: [],
        rowVersion: superRole.rowVersion,
      });
      expect(attempt.status).toBe(403);
      expect(await codesOf(superRole.id)).toEqual([...PERMISSION_CODES].sort());
    });

    it('never gives a role the reserved permissions, and never changes its tier', async () => {
      const client = await superLogin();
      const made = (await create(client, { name: 'Tier Test', tier: 'STAFF' })).body;
      const reserved = await patch(client, made.id, {
        name: 'Tier Test',
        description: null,
        permissionCodes: ['roles.manage'],
        rowVersion: made.rowVersion,
      });
      expect(reserved.status).toBe(400);
      const promoted = await patch(client, made.id, {
        name: 'Tier Test',
        description: null,
        permissionCodes: made.permissionCodes,
        tier: 'ADMIN',
        description2: 'x',
        rowVersion: made.rowVersion,
      });
      expect(promoted.status).toBe(200);
      expect(promoted.body.tier).toBe('STAFF');
      expect((await owner.role.findUniqueOrThrow({ where: { id: made.id } })).tier).toBe('STAFF');
    });

    it('answers an unknown role with 404 and refuses a name that another role has', async () => {
      const client = await superLogin();
      expect(
        (
          await patch(client, '00000000-0000-4000-8000-000000000000', {
            name: 'Ghost',
            description: null,
            permissionCodes: [],
            rowVersion: 1,
          })
        ).status,
      ).toBe(404);
      const a = (await create(client, { name: 'First Name' })).body;
      const clash = await patch(client, a.id, {
        name: 'staff',
        description: null,
        permissionCodes: a.permissionCodes,
        rowVersion: a.rowVersion,
      });
      expect(clash.status).toBe(409);
    });
  });

  describe('custom roles and the hierarchy', () => {
    it('lets an Admin-tier custom role manage Staff when it holds users.manage, and never a Staff-tier one', async () => {
      const client = await superLogin();
      const adminTier = (
        await create(client, {
          name: 'Branch Lead',
          tier: 'ADMIN',
          permissionCodes: ['users.view', 'users.manage', 'roles.view'],
        })
      ).body;
      const staffTier = (
        await create(client, {
          name: 'Shift Lead',
          tier: 'STAFF',
          permissionCodes: ['users.view', 'users.manage', 'roles.view'],
        })
      ).body;
      await addUser(owner, {
        username: 'branch_lead',
        role: 'Branch Lead',
        branchIds: [w.branchA],
      });
      await addUser(owner, { username: 'shift_lead', role: 'Shift Lead', branchIds: [w.branchA] });
      const staffRoleId = await roleId(owner, 'STAFF');
      const newcomer = (username: string) => ({
        username,
        fullName: 'Some One',
        email: `${username}@example.com`,
        roleId: staffRoleId,
        branchIds: [w.branchA],
      });

      const lead = await loggedIn(app, 'branch_lead');
      expect((await lead.post('/users', newcomer('made.by.lead'))).status).toBe(201);
      expect(
        (await lead.post('/users', { ...newcomer('made.admin'), roleId: adminTier.id })).status,
      ).toBe(403);

      const shift = await loggedIn(app, 'shift_lead');
      expect((await shift.post('/users', newcomer('made.by.shift'))).status).toBe(403);
      expect(staffTier.tier).toBe('STAFF');
    });

    it('lets an Admin give Staff a custom Staff-tier role but not an Admin-tier one', async () => {
      const client = await superLogin();
      const custom = (
        await create(client, { name: 'Cashier', permissionCodes: ['payments.create'] })
      ).body;
      const adminTier = (
        await create(client, { name: 'Floor Manager', tier: 'ADMIN', permissionCodes: [] })
      ).body;
      const admin = await loggedIn(app, 'admin_a');
      const make = (username: string, role: string) =>
        admin.post('/users', {
          username,
          fullName: 'Some One',
          email: `${username}@example.com`,
          roleId: role,
          branchIds: [w.branchA],
        });
      expect((await make('the.cashier', custom.id)).status).toBe(201);
      expect((await make('the.manager', adminTier.id)).status).toBe(403);
    });
  });
});
