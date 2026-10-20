import type { NestExpressApplication } from '@nestjs/platform-express';
import argon2 from 'argon2';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { UserListResponseSchema, UserSchema } from '@erp/contracts';
import { createTestApp } from '../support/create-test-app.js';
import { createOwnerPrisma } from '../support/fixtures.js';
import {
  addUser,
  createAuthWorld,
  loggedIn,
  ORIGIN,
  PASSWORD,
  roleId,
  SUPER_PASSWORD,
  TestClient,
} from '../support/auth-world.js';
import type { AuthWorld } from '../support/auth-world.js';

describe('users', () => {
  let app: NestExpressApplication;
  let w: AuthWorld;
  let staffRole: string;
  let adminRole: string;
  let superRole: string;
  const owner = createOwnerPrisma();
  const superLogin = () => loggedIn(app, 'superadmin', SUPER_PASSWORD);
  const row = (id: string) =>
    owner.user.findUniqueOrThrow({
      where: { id },
      include: { userRoles: { include: { role: true } }, userBranches: true },
    });
  const branchesOf = async (id: string) =>
    (await row(id)).userBranches.map((b) => b.branchId).sort();
  const newUser = (over: Record<string, unknown> = {}) => ({
    username: 'new.person',
    fullName: 'New Person',
    email: 'new.person@example.com',
    roleId: staffRole,
    branchIds: [w.branchA],
    ...over,
  });

  beforeAll(async () => {
    w = await createAuthWorld(owner);
    app = await createTestApp();
    [staffRole, adminRole, superRole] = [
      await roleId(owner, 'STAFF'),
      await roleId(owner, 'ADMIN'),
      await roleId(owner, 'SUPER_ADMIN'),
    ];
    return async () => {
      await app.close();
      await owner.$disconnect();
    };
  });

  describe('who may call what', () => {
    it('answers every users endpoint with 401 when signed out', async () => {
      const server = request(app.getHttpServer());
      for (const [method, path] of [
        ['get', '/users'],
        ['get', `/users/${w.users.staffA}`],
        ['post', '/users'],
        ['patch', `/users/${w.users.staffA}`],
        ['post', `/users/${w.users.staffA}/deactivate`],
        ['post', `/users/${w.users.staffA}/reactivate`],
      ] as const) {
        const response = await server[method](path).set('Origin', ORIGIN).send({});
        expect(response.status, `${method} ${path}`).toBe(401);
      }
    });

    it('lets Staff see the people they work with, but not change anyone', async () => {
      const staff = await loggedIn(app, 'staff_a');
      const list = await staff.get('/users');
      expect(list.status).toBe(200);
      expect(list.body.items.map((u: { username: string }) => u.username)).toEqual(
        expect.arrayContaining(['staff_a', 'staff_a2', 'admin_a']),
      );
      expect(list.body.items.every((u: { manageable: boolean }) => !u.manageable)).toBe(true);
      for (const response of [
        await staff.post('/users', newUser()),
        await staff.post(`/users/${w.users.staffA2}/deactivate`),
      ])
        expect(response.status).toBe(403);
    });

    it('requires the CSRF token for every change', async () => {
      const admin = await loggedIn(app, 'admin_a');
      const response = await admin.agent.post('/users').set('Origin', ORIGIN).send(newUser());
      expect(response.status).toBe(403);
    });
  });

  describe('listing and viewing', () => {
    it('shows a Super Admin everyone, and an Admin only people in their own branches', async () => {
      const all = await (await superLogin()).get('/users?pageSize=100');
      expect(UserListResponseSchema.parse(all.body).total).toBeGreaterThanOrEqual(9);
      const names = (
        await (await loggedIn(app, 'admin_a')).get('/users?pageSize=100')
      ).body.items.map((u: { username: string }) => u.username);
      expect(names).toEqual(
        expect.arrayContaining(['admin_a', 'staff_a', 'staff_a2', 'inactive_user']),
      );
      expect(names).not.toEqual(expect.arrayContaining(['staff_b']));
      expect(names).not.toContain('admin_b');
      expect(names).not.toContain('superadmin');
    });

    it('marks who the viewer may manage', async () => {
      const items = (await (await loggedIn(app, 'admin_a')).get('/users?pageSize=100')).body
        .items as { username: string; manageable: boolean }[];
      const flag = (name: string) => items.find((u) => u.username === name)?.manageable;
      expect(flag('staff_a')).toBe(true);
      expect(flag('admin_a')).toBe(false);
      const superItems = (await (await superLogin()).get('/users?pageSize=100')).body.items as {
        username: string;
        manageable: boolean;
      }[];
      expect(superItems.find((u) => u.username === 'admin_b')?.manageable).toBe(true);
      expect(superItems.find((u) => u.username === 'superadmin')?.manageable).toBe(false);
    });

    it('never sends password data', async () => {
      const response = await (await superLogin()).get('/users?pageSize=100');
      expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|argon2|password_hash/);
    });

    it('paginates, searches, filters and sorts', async () => {
      const client = await superLogin();
      const page = await client.get('/users?pageSize=3&page=2&sortBy=username&sortOrder=asc');
      expect(page.body).toMatchObject({ page: 2, pageSize: 3 });
      expect(page.body.items).toHaveLength(3);
      const search = await client.get('/users?search=STAFF_B');
      expect(search.body.items.map((u: { username: string }) => u.username)).toEqual(['staff_b']);
      const inactive = await client.get('/users?status=inactive');
      expect(inactive.body.items.map((u: { username: string }) => u.username)).toEqual([
        'inactive_user',
      ]);
      const byRole = await client.get(`/users?roleId=${superRole}`);
      expect(byRole.body.items.map((u: { username: string }) => u.username)).toEqual([
        'superadmin',
      ]);
      const byBranch = await client.get(
        `/users?branchId=${w.branchB}&sortBy=username&sortOrder=asc`,
      );
      expect(byBranch.body.items.map((u: { username: string }) => u.username)).toEqual(
        expect.arrayContaining(['admin_b', 'staff_b']),
      );
      expect(byBranch.body.items.map((u: { username: string }) => u.username)).not.toContain(
        'staff_a',
      );
    });

    it('treats search text as text', async () => {
      const response = await (
        await superLogin()
      ).get(`/users?search=${encodeURIComponent("'; DROP TABLE users;--")}`);
      expect(response.status).toBe(200);
      expect(response.body.items).toEqual([]);
    });

    it('rejects an unknown sort field, a malformed filter and a huge page', async () => {
      const client = await superLogin();
      for (const query of ['sortBy=passwordHash', 'roleId=nope', 'status=gone', 'pageSize=1000'])
        expect((await client.get(`/users?${query}`)).status, query).toBe(400);
    });

    it('returns one user, and 404 for someone the viewer does not share a branch with', async () => {
      const admin = await loggedIn(app, 'admin_a');
      const own = await admin.get(`/users/${w.users.staffA}`);
      expect(UserSchema.parse(own.body)).toMatchObject({
        username: 'staff_a',
        role: { name: 'STAFF', tier: 'STAFF' },
      });
      expect((await admin.get(`/users/${w.users.staffB}`)).status).toBe(404);
      expect((await admin.get(`/users/${w.users.super}`)).status).toBe(404);
    });
  });

  describe('creating', () => {
    it('lets a Super Admin create an Admin, and gives a one-time password the person must change', async () => {
      const client = await superLogin();
      const response = await client.post(
        '/users',
        newUser({
          username: 'Admin.New',
          email: 'Admin.New@Example.com',
          roleId: adminRole,
          branchIds: [w.branchB, w.branchC],
        }),
      );

      expect(response.status).toBe(201);
      expect(response.headers['cache-control']).toBe('no-store');
      const { user, temporaryPassword } = response.body as {
        user: { id: string; username: string; role: { name: string }; mustChangePassword: boolean };
        temporaryPassword: string;
      };
      expect(user).toMatchObject({
        username: 'admin.new',
        role: { name: 'ADMIN' },
        mustChangePassword: true,
      });
      expect(temporaryPassword).toMatch(/^[A-Za-z0-9]{16}$/);
      const stored = await row(user.id);
      expect(stored.email).toBe('admin.new@example.com');
      expect(await argon2.verify(stored.passwordHash, temporaryPassword)).toBe(true);
      expect(await branchesOf(user.id)).toEqual([w.branchB, w.branchC].sort());

      const audit = await owner.auditLog.findFirstOrThrow({
        where: { action: 'USER_CREATED', entityId: user.id },
      });
      expect(audit.actorId).toBe(w.users.super);
      expect(JSON.stringify(audit)).not.toContain(temporaryPassword);
      expect(JSON.stringify(audit)).not.toMatch(/argon2/);

      const newcomer = new TestClient(app);
      expect(
        (await newcomer.login('admin.new', temporaryPassword)).body.user.mustChangePassword,
      ).toBe(true);
      expect((await newcomer.get('/users')).body.code).toBe('PASSWORD_CHANGE_REQUIRED');
    });

    it('lets an Admin create Staff in their own branch', async () => {
      const response = await (
        await loggedIn(app, 'admin_a')
      ).post('/users', newUser({ username: 'fresh.staff', email: 'fresh.staff@example.com' }));
      expect(response.status).toBe(201);
      expect(response.body.user).toMatchObject({
        role: { name: 'STAFF' },
        branches: [{ id: w.branchA }],
        manageable: true,
      });
    });

    it('never lets anyone create a Super Admin through the screens', async () => {
      const response = await (
        await superLogin()
      ).post(
        '/users',
        newUser({ username: 'second.super', email: 'second.super@example.com', roleId: superRole }),
      );
      expect(response.status).toBe(403);
      expect(await owner.user.count({ where: { username: 'second.super' } })).toBe(0);
    });

    it('stops an Admin creating an Admin, or giving a branch that is not theirs', async () => {
      const admin = await loggedIn(app, 'admin_a');
      expect(
        (
          await admin.post(
            '/users',
            newUser({
              username: 'sneaky.admin',
              email: 'sneaky.admin@example.com',
              roleId: adminRole,
            }),
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await admin.post(
            '/users',
            newUser({
              username: 'other.branch',
              email: 'other.branch@example.com',
              branchIds: [w.branchB],
            }),
          )
        ).status,
      ).toBe(403);
      expect(
        (
          await admin.post(
            '/users',
            newUser({
              username: 'mixed.branch',
              email: 'mixed.branch@example.com',
              branchIds: [w.branchA, w.branchB],
            }),
          )
        ).status,
      ).toBe(403);
      expect(
        await owner.user.count({
          where: { username: { in: ['sneaky.admin', 'other.branch', 'mixed.branch'] } },
        }),
      ).toBe(0);
    });

    it('explains every problem with the field it belongs to', async () => {
      const client = await superLogin();
      const bad = await client.post('/users', {
        username: 'x',
        fullName: '',
        email: 'nope',
        roleId: 'x',
        branchIds: [],
      });
      expect(bad.status).toBe(400);
      expect(bad.body.details.map((d: { field: string }) => d.field).sort()).toEqual([
        'branchIds',
        'email',
        'fullName',
        'roleId',
        'username',
      ]);
      const unknownRole = await client.post(
        '/users',
        newUser({ roleId: '00000000-0000-4000-8000-000000000000' }),
      );
      expect(unknownRole.body.details).toEqual([{ field: 'roleId', message: 'Choose a role' }]);
      const unknownBranch = await client.post(
        '/users',
        newUser({ branchIds: ['00000000-0000-4000-8000-000000000000'] }),
      );
      expect(unknownBranch.body.details[0].field).toBe('branchIds');
    });

    it('refuses a branch that is switched off', async () => {
      await owner.branch.update({ where: { id: w.branchC }, data: { isActive: false } });
      const response = await (
        await superLogin()
      ).post(
        '/users',
        newUser({
          username: 'off.branch',
          email: 'off.branch@example.com',
          branchIds: [w.branchC],
        }),
      );
      expect(response.status).toBe(400);
      await owner.branch.update({ where: { id: w.branchC }, data: { isActive: true } });
    });

    it('refuses a username or email that is taken, however it is written', async () => {
      const client = await superLogin();
      const username = await client.post(
        '/users',
        newUser({ username: 'STAFF_A', email: 'unique.one@example.com' }),
      );
      expect(username.status).toBe(409);
      expect(username.body.details).toEqual([
        { field: 'username', message: 'This username is already taken' },
      ]);
      const email = await client.post(
        '/users',
        newUser({ username: 'unique.two', email: 'Staff_A@EXAMPLE.com' }),
      );
      expect(email.status).toBe(409);
      expect(email.body.details).toEqual([
        { field: 'email', message: 'This email is already used by another account' },
      ]);
    });

    it('lets exactly one of several simultaneous creations of the same person succeed', async () => {
      const client = await superLogin();
      const outcomes = await Promise.all(
        Array.from({ length: 5 }, () =>
          client.post(
            '/users',
            newUser({ username: 'race.person', email: 'race.person@example.com' }),
          ),
        ),
      );
      expect(outcomes.filter((r) => r.status === 201)).toHaveLength(1);
      expect(outcomes.filter((r) => r.status === 409)).toHaveLength(4);
      expect(await owner.user.count({ where: { username: 'race.person' } })).toBe(1);
    });
  });

  describe('editing', () => {
    it('changes name and email, bumps the version and records old and new values', async () => {
      const admin = await loggedIn(app, 'admin_a');
      const before = (await admin.get(`/users/${w.users.staffA}`)).body;
      const response = await admin.agent
        .patch(`/users/${w.users.staffA}`)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', admin.csrf)
        .send({
          fullName: 'Renamed Person',
          email: 'renamed@example.com',
          roleId: staffRole,
          branchIds: [w.branchA],
          rowVersion: before.rowVersion,
        });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        fullName: 'Renamed Person',
        email: 'renamed@example.com',
        rowVersion: before.rowVersion + 1,
      });
      const audit = await owner.auditLog.findFirstOrThrow({
        where: { action: 'USER_UPDATED', entityId: w.users.staffA },
      });
      expect(audit.oldValue).toMatchObject({ fullName: before.fullName, email: before.email });
      expect(audit.newValue).toMatchObject({
        fullName: 'Renamed Person',
        email: 'renamed@example.com',
      });
    });

    const patch = (client: TestClient, id: string, body: object) =>
      client.agent
        .patch(`/users/${id}`)
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', client.csrf)
        .send(body);
    const same = async (id: string) => {
      const u = await row(id);
      return {
        fullName: u.fullName,
        email: u.email,
        roleId: u.userRoles[0]!.roleId,
        branchIds: u.userBranches.map((b) => b.branchId),
        rowVersion: u.rowVersion,
      };
    };

    it('does nothing, and records nothing, when nothing changes', async () => {
      const admin = await loggedIn(app, 'admin_a');
      const body = await same(w.users.staffA2);
      const before = await owner.auditLog.count({
        where: { action: 'USER_UPDATED', entityId: w.users.staffA2 },
      });
      const response = await patch(admin, w.users.staffA2, body);
      expect(response.status).toBe(200);
      expect(response.body.rowVersion).toBe(body.rowVersion);
      expect(
        await owner.auditLog.count({
          where: { action: 'USER_UPDATED', entityId: w.users.staffA2 },
        }),
      ).toBe(before);
    });

    it('refuses an edit made from a stale copy, and applies only one of several simultaneous edits', async () => {
      const admin = await loggedIn(app, 'admin_a');
      const body = await same(w.users.staffA2);
      const outcomes = await Promise.all(
        [1, 2, 3].map((n) => patch(admin, w.users.staffA2, { ...body, fullName: `Edit ${n}` })),
      );
      expect(outcomes.filter((r) => r.status === 200)).toHaveLength(1);
      expect(outcomes.filter((r) => r.status === 409)).toHaveLength(2);
      expect(
        (await patch(admin, w.users.staffA2, { ...body, fullName: 'Stale again' })).status,
      ).toBe(409);
    });

    it("never lets an Admin edit another Admin, a Super Admin or another branch's Staff", async () => {
      const admin = await loggedIn(app, 'admin_a');
      const adminB = await same(w.users.adminB);
      expect((await patch(admin, w.users.adminB, adminB)).status).toBe(404);
      expect(
        (
          await patch(admin, w.users.staffB, {
            ...(await same(w.users.staffB)),
            fullName: 'Hacked',
          })
        ).status,
      ).toBe(404);
      const colleague = await addUser(owner, {
        username: 'admin_a_colleague',
        role: 'ADMIN',
        branchIds: [w.branchA],
      });
      expect(
        (await patch(admin, colleague, { ...(await same(colleague)), fullName: 'Hacked' })).status,
      ).toBe(403);
      expect((await row(w.users.staffB)).fullName).not.toBe('Hacked');
    });

    it('never lets an Admin promote Staff, or hand out a branch that is not theirs', async () => {
      const admin = await loggedIn(app, 'admin_a');
      const body = await same(w.users.staffA);
      expect((await patch(admin, w.users.staffA, { ...body, roleId: adminRole })).status).toBe(403);
      expect(
        (await patch(admin, w.users.staffA, { ...body, branchIds: [w.branchA, w.branchB] })).status,
      ).toBe(403);
      expect((await row(w.users.staffA)).userRoles[0]!.role.name).toBe('STAFF');
    });

    it('lets an Admin change only the memberships that are theirs', async () => {
      const adminAB = await addUser(owner, {
        username: 'admin_ab',
        role: 'ADMIN',
        branchIds: [w.branchA, w.branchB],
      });
      const shared = await addUser(owner, {
        username: 'staff_a_and_c',
        role: 'STAFF',
        branchIds: [w.branchA, w.branchC],
      });
      const client = await loggedIn(app, 'admin_ab');
      expect(adminAB).toBeTruthy();
      const response = await patch(client, shared, {
        ...(await same(shared)),
        branchIds: [w.branchB],
      });
      expect(response.status).toBe(200);
      expect(await branchesOf(shared)).toEqual([w.branchB, w.branchC].sort());
    });

    it('lets a Super Admin move someone between branches and change their role', async () => {
      const client = await superLogin();
      const moved = await addUser(owner, {
        username: 'movable',
        role: 'STAFF',
        branchIds: [w.branchA],
      });
      const response = await patch(client, moved, {
        ...(await same(moved)),
        roleId: adminRole,
        branchIds: [w.branchB, w.branchC],
      });
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({ role: { name: 'ADMIN' } });
      expect(await branchesOf(moved)).toEqual([w.branchB, w.branchC].sort());
    });

    it("applies a role or branch change on the person's very next request", async () => {
      const subject = await addUser(owner, {
        username: 'live.change',
        role: 'STAFF',
        branchIds: [w.branchA, w.branchB],
      });
      const person = await loggedIn(app, 'live.change');
      expect(
        (await person.get('/branches')).body.items.map((b: { id: string }) => b.id).sort(),
      ).toEqual([w.branchA, w.branchB].sort());
      const client = await superLogin();
      await patch(client, subject, { ...(await same(subject)), branchIds: [w.branchB] });
      expect((await person.get('/branches')).body.items.map((b: { id: string }) => b.id)).toEqual([
        w.branchB,
      ]);
    });

    it('lets people change their own name and email but never their own role, branches or status', async () => {
      const client = await superLogin();
      const own = await same(w.users.super);
      expect((await patch(client, w.users.super, { ...own, fullName: 'Chief Admin' })).status).toBe(
        200,
      );
      expect(
        (
          await patch(client, w.users.super, {
            ...own,
            rowVersion: own.rowVersion + 1,
            roleId: adminRole,
          })
        ).status,
      ).toBe(403);
      expect(
        (
          await patch(client, w.users.super, {
            ...own,
            rowVersion: own.rowVersion + 1,
            branchIds: [w.branchA],
          })
        ).status,
      ).toBe(403);
      expect((await client.post(`/users/${w.users.super}/deactivate`)).status).toBe(422);
    });

    it('refuses an email that another account already uses', async () => {
      const admin = await loggedIn(app, 'admin_a');
      const response = await patch(admin, w.users.staffA2, {
        ...(await same(w.users.staffA2)),
        email: 'ADMIN_A@example.com',
      });
      expect(response.status).toBe(409);
      expect(response.body.details).toEqual([
        { field: 'email', message: 'This email is already used by another account' },
      ]);
    });

    it('never changes the username, even if one is sent', async () => {
      const admin = await loggedIn(app, 'admin_a');
      const response = await patch(admin, w.users.staffA2, {
        ...(await same(w.users.staffA2)),
        fullName: 'Same Login',
        username: 'hijacked',
      });
      expect(response.status).toBe(200);
      expect(response.body.username).toBe('staff_a2');
    });
  });

  describe('deactivating and reactivating', () => {
    it('deactivates Staff, ends their sessions at once, and stops them signing in', async () => {
      const victim = await addUser(owner, {
        username: 'leaver',
        role: 'STAFF',
        branchIds: [w.branchA],
      });
      const person = await loggedIn(app, 'leaver');
      expect((await person.get('/auth/session')).status).toBe(200);

      const admin = await loggedIn(app, 'admin_a');
      const response = await admin.post(`/users/${victim}/deactivate`);

      expect(response.status).toBe(200);
      expect(response.body.status).toBe('INACTIVE');
      expect((await person.get('/auth/session')).status).toBe(401);
      expect(
        (await owner.session.findMany({ where: { userId: victim } })).every(
          (s) => s.revokedAt !== null,
        ),
      ).toBe(true);
      const attempt = await new TestClient(app).login('leaver');
      expect(attempt.status).toBe(401);
      expect(attempt.body.message).toBe('Invalid username or password');
      expect(
        await owner.auditLog.count({ where: { action: 'USER_DEACTIVATED', entityId: victim } }),
      ).toBe(1);
      expect((await admin.post(`/users/${victim}/deactivate`)).status).toBe(200);
      expect(
        await owner.auditLog.count({ where: { action: 'USER_DEACTIVATED', entityId: victim } }),
      ).toBe(1);
    });

    it('reactivates, with the same password and a clean slate', async () => {
      const victim = await addUser(owner, {
        username: 'returner',
        role: 'STAFF',
        branchIds: [w.branchA],
        status: 'INACTIVE',
      });
      await owner.user.update({
        where: { id: victim },
        data: { failedLoginCount: 5, lockedUntil: new Date(Date.now() + 600_000) },
      });
      const admin = await loggedIn(app, 'admin_a');
      expect((await admin.post(`/users/${victim}/reactivate`)).body.status).toBe('ACTIVE');
      expect((await new TestClient(app).login('returner')).status).toBe(200);
    });

    it('leaves Staff who also work in another branch to a Super Admin', async () => {
      const shared = await addUser(owner, {
        username: 'two.branches',
        role: 'STAFF',
        branchIds: [w.branchA, w.branchC],
      });
      const response = await (await loggedIn(app, 'admin_a')).post(`/users/${shared}/deactivate`);
      expect(response.status).toBe(403);
      expect(response.body.message).toMatch(/Ask a Super Admin/);
      expect((await (await superLogin()).post(`/users/${shared}/deactivate`)).status).toBe(200);
    });

    it("never lets an Admin deactivate an Admin, a Super Admin, another branch's Staff, or themselves", async () => {
      const admin = await loggedIn(app, 'admin_a');
      expect((await admin.post(`/users/${w.users.staffB}/deactivate`)).status).toBe(404);
      expect((await admin.post(`/users/${w.users.adminB}/deactivate`)).status).toBe(404);
      expect((await admin.post(`/users/${w.users.super}/deactivate`)).status).toBe(404);
      expect((await admin.post(`/users/${w.users.adminA}/deactivate`)).status).toBe(422);
      expect((await row(w.users.staffB)).status).toBe('ACTIVE');
    });

    it('lets a Super Admin deactivate an Admin but never another Super Admin', async () => {
      const second = await addUser(owner, {
        username: 'another.super',
        role: 'SUPER_ADMIN',
        branchIds: [w.branchA],
      });
      const client = await superLogin();
      expect((await client.post(`/users/${second}/deactivate`)).status).toBe(403);
      const admin = await addUser(owner, {
        username: 'retiring.admin',
        role: 'ADMIN',
        branchIds: [w.branchB],
      });
      expect((await client.post(`/users/${admin}/deactivate`)).status).toBe(200);
    });

    it('answers an unknown user with 404 and a malformed id with 400', async () => {
      const client = await superLogin();
      expect(
        (await client.post('/users/00000000-0000-4000-8000-000000000000/deactivate')).status,
      ).toBe(404);
      expect((await client.post('/users/not-a-uuid/deactivate')).status).toBe(400);
    });
  });

  describe('password resets follow the same hierarchy', () => {
    it("lets an Admin reset Staff in their branch, and not an Admin, a Super Admin or other branches' Staff", async () => {
      const admin = await loggedIn(app, 'admin_a');
      expect((await admin.post(`/auth/users/${w.users.staffA}/reset-password`)).status).toBe(200);
      for (const id of [w.users.adminB, w.users.super, w.users.staffB])
        expect((await admin.post(`/auth/users/${id}/reset-password`)).status).toBe(403);
    });

    it('does not let a Super Admin reset another Super Admin', async () => {
      const second = await addUser(owner, {
        username: 'third.super',
        role: 'SUPER_ADMIN',
        branchIds: [w.branchA],
      });
      expect((await (await superLogin()).post(`/auth/users/${second}/reset-password`)).status).toBe(
        403,
      );
    });
  });

  it('keeps passwords out of everything written to the audit trail', async () => {
    const rows = await owner.auditLog.findMany({ where: { action: { startsWith: 'USER_' } } });
    expect(rows.length).toBeGreaterThan(3);
    expect(JSON.stringify(rows)).not.toMatch(new RegExp(`${PASSWORD}|argon2id|temporaryPassword`));
  });
});
