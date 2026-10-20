import type { NestExpressApplication } from '@nestjs/platform-express';
import argon2 from 'argon2';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createTestApp } from '../support/create-test-app.js';
import { createOwnerPrisma } from '../support/fixtures.js';
import {
  createAuthWorld,
  loggedIn,
  ORIGIN,
  PASSWORD,
  SUPER_PASSWORD,
  TestClient,
} from '../support/auth-world.js';
import type { AuthWorld } from '../support/auth-world.js';

const NEW_PASSWORD = 'a brand new passphrase 77';

describe('changing and resetting passwords', () => {
  let app: NestExpressApplication;
  let w: AuthWorld;
  const owner = createOwnerPrisma();
  const userRow = (id: string) => owner.user.findUniqueOrThrow({ where: { id } });
  const change = (client: TestClient, currentPassword: string, newPassword: string) =>
    client.post('/auth/change-password', { currentPassword, newPassword });

  beforeAll(async () => {
    w = await createAuthWorld(owner);
    app = await createTestApp();
    return async () => {
      await app.close();
      await owner.$disconnect();
    };
  });
  beforeEach(async () => {
    await owner.auditLog.deleteMany({ where: { action: 'LOGIN_FAILED' } });
    await owner.user.updateMany({ data: { failedLoginCount: 0, lockedUntil: null } });
  });

  describe('changing your own password', () => {
    it('updates the hash, signs out every other session and keeps this one signed in on a new session', async () => {
      const phone = await loggedIn(app, 'staff_a');
      const laptop = await loggedIn(app, 'staff_a');
      const oldCookie = (
        await owner.session.findMany({ where: { userId: w.users.staffA, revokedAt: null } })
      ).length;
      expect(oldCookie).toBe(2);

      const response = await change(laptop, PASSWORD, NEW_PASSWORD);

      expect(response.status).toBe(200);
      expect(response.body.user.username).toBe('staff_a');
      expect(String(response.headers['set-cookie']?.[0])).toMatch(/^erp_session=/);
      const user = await userRow(w.users.staffA);
      expect(user.passwordHash).toMatch(/^\$argon2id\$/);
      expect(await argon2.verify(user.passwordHash, NEW_PASSWORD)).toBe(true);
      expect(user.passwordChangedAt).not.toBeNull();

      expect((await phone.get('/auth/session')).status).toBe(401);
      laptop.csrf = response.body.csrfToken;
      expect((await laptop.get('/auth/session')).status).toBe(200);
      expect(
        await owner.session.count({ where: { userId: w.users.staffA, revokedAt: null } }),
      ).toBe(1);
      expect(
        await owner.auditLog.count({
          where: { action: 'PASSWORD_CHANGED', entityId: w.users.staffA },
        }),
      ).toBe(1);
    });

    it('stops the old password working and accepts the new one', async () => {
      expect((await new TestClient(app).login('staff_a', PASSWORD)).status).toBe(401);
      expect((await new TestClient(app).login('staff_a', NEW_PASSWORD)).status).toBe(200);
    });

    it('rejects a wrong current password, points at the field, and counts it as a failed attempt', async () => {
      const client = await loggedIn(app, 'staff_a2');
      const response = await change(client, 'not my password', NEW_PASSWORD);
      expect(response.status).toBe(400);
      expect(response.body.details).toEqual([
        { field: 'currentPassword', message: 'Current password is incorrect' },
      ]);
      expect((await userRow(w.users.staffA2)).failedLoginCount).toBe(1);
      expect(await argon2.verify((await userRow(w.users.staffA2)).passwordHash, PASSWORD)).toBe(
        true,
      );
    });

    it.each([
      ['too short', 'short one 1', /at least 12/],
      ['too common', 'password1234', /too common/],
      ['repetitive', 'zzzzzzzzzzzz', /repeated/],
      ['containing the username', 'my staff_a2 secret!', /username or email/],
      ['the same as the current one', PASSWORD, /different/],
    ])('rejects a new password that is %s', async (_label, newPassword, message) => {
      const client = await loggedIn(app, 'staff_a2');
      const response = await change(client, PASSWORD, newPassword);
      expect(response.status).toBe(400);
      expect(response.body.details[0]).toMatchObject({
        field: 'newPassword',
        message: expect.stringMatching(message),
      });
      expect(await argon2.verify((await userRow(w.users.staffA2)).passwordHash, PASSWORD)).toBe(
        true,
      );
    });

    it('needs the CSRF token and a signed-in user', async () => {
      const client = await loggedIn(app, 'staff_a2');
      const noToken = await client.agent
        .post('/auth/change-password')
        .set('Origin', ORIGIN)
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
      expect(noToken.status).toBe(403);
      const signedOut = await request(app.getHttpServer())
        .post('/auth/change-password')
        .set('Origin', ORIGIN)
        .send({ currentPassword: PASSWORD, newPassword: NEW_PASSWORD });
      expect(signedOut.status).toBe(401);
    });

    it('never writes passwords into the audit trail', async () => {
      const rows = await owner.auditLog.findMany({
        where: { action: { in: ['PASSWORD_CHANGED', 'PASSWORD_RESET', 'LOGIN', 'LOGIN_FAILED'] } },
      });
      expect(JSON.stringify(rows)).not.toMatch(new RegExp(`${PASSWORD}|${NEW_PASSWORD}|argon2id`));
    });
  });

  describe('an administrator resetting a password', () => {
    const reset = (client: TestClient, userId: string) =>
      client.post(`/auth/users/${userId}/reset-password`);

    beforeEach(async () => {
      const passwordHash = await argon2.hash(PASSWORD, {
        type: argon2.argon2id,
        memoryCost: 4096,
        timeCost: 1,
        parallelism: 1,
      });
      await owner.user.updateMany({
        where: {
          id: {
            in: [w.users.adminA, w.users.adminB, w.users.staffA, w.users.staffA2, w.users.staffB],
          },
        },
        data: { passwordHash, mustChangePassword: false },
      });
    });

    it('lets a Super Admin reset anyone, with a one-time temporary password and no caching', async () => {
      const superAdmin = await loggedIn(app, 'superadmin', SUPER_PASSWORD);
      const victim = await loggedIn(app, 'admin_a');
      await owner.user.update({ where: { id: w.users.adminA }, data: { failedLoginCount: 4 } });

      const response = await reset(superAdmin, w.users.adminA);

      expect(response.status).toBe(200);
      expect(response.headers['cache-control']).toBe('no-store');
      const { temporaryPassword } = response.body as { temporaryPassword: string };
      expect(temporaryPassword).toMatch(/^[A-Za-z0-9]{16}$/);
      const user = await userRow(w.users.adminA);
      expect(user).toMatchObject({
        mustChangePassword: true,
        failedLoginCount: 0,
        lockedUntil: null,
      });
      expect(await argon2.verify(user.passwordHash, temporaryPassword)).toBe(true);
      expect((await victim.get('/auth/session')).status).toBe(401);

      const audit = await owner.auditLog.findFirstOrThrow({
        where: { action: 'PASSWORD_RESET', entityId: w.users.adminA },
      });
      expect(audit.actorId).toBe(w.users.super);
      expect(JSON.stringify(audit)).not.toContain(temporaryPassword);
    });

    it('forces the person to choose their own password before doing anything else', async () => {
      const superAdmin = await loggedIn(app, 'superadmin', SUPER_PASSWORD);
      const { temporaryPassword } = (await reset(superAdmin, w.users.staffB)).body as {
        temporaryPassword: string;
      };

      const staff = new TestClient(app);
      const signIn = await staff.login('staff_b', temporaryPassword);
      expect(signIn.status).toBe(200);
      expect(signIn.body.user.mustChangePassword).toBe(true);
      expect((await staff.get('/auth/session')).status).toBe(200);

      const blocked = await staff.get('/__nothing-here');
      expect(blocked.status).toBe(404);
      const protectedRoute = await staff.agent.get(
        '/auth/users/00000000-0000-4000-8000-000000000000/reset-password',
      );
      expect([404, 403]).toContain(protectedRoute.status);

      const changed = await change(staff, temporaryPassword, 'my very own new passphrase 5');
      expect(changed.status).toBe(200);
      expect(changed.body.user.mustChangePassword).toBe(false);
      expect((await userRow(w.users.staffB)).mustChangePassword).toBe(false);
    });

    it('unlocks a locked account', async () => {
      await owner.user.update({
        where: { id: w.users.staffA2 },
        data: { failedLoginCount: 5, lockedUntil: new Date(Date.now() + 600_000) },
      });
      const admin = await loggedIn(app, 'admin_a');
      expect((await reset(admin, w.users.staffA2)).status).toBe(200);
      expect(await userRow(w.users.staffA2)).toMatchObject({
        failedLoginCount: 0,
        lockedUntil: null,
      });
    });

    it('lets an Admin reset Staff who share a branch, and nobody else', async () => {
      const adminA = await loggedIn(app, 'admin_a');
      expect((await reset(adminA, w.users.staffA)).status).toBe(200);
      for (const [label, id] of [
        ['Staff of another branch', w.users.staffB],
        ['another Admin', w.users.adminB],
        ['the Super Admin', w.users.super],
      ] as const) {
        const denied = await reset(adminA, id);
        expect(denied.status, label).toBe(403);
        expect(denied.body.code).toBe('FORBIDDEN');
      }
      expect(
        await owner.auditLog.count({
          where: {
            action: 'PASSWORD_RESET',
            entityId: { in: [w.users.staffB, w.users.adminB, w.users.super] },
          },
        }),
      ).toBe(1);
    });

    it('does not let Staff reset anyone, or an Admin reset their own password this way', async () => {
      const staff = await loggedIn(app, 'staff_a2');
      expect((await reset(staff, w.users.staffA)).status).toBe(403);
      const admin = await loggedIn(app, 'admin_b');
      const own = await reset(admin, w.users.adminB);
      expect(own.status).toBe(422);
      expect(own.body.code).toBe('BUSINESS_RULE_VIOLATION');
    });

    it('answers an unknown or malformed user id properly', async () => {
      const superAdmin = await loggedIn(app, 'superadmin', SUPER_PASSWORD);
      expect((await reset(superAdmin, '00000000-0000-4000-8000-000000000000')).status).toBe(404);
      expect((await reset(superAdmin, 'not-a-uuid')).status).toBe(400);
    });

    it('requires the CSRF token', async () => {
      const superAdmin = await loggedIn(app, 'superadmin', SUPER_PASSWORD);
      const response = await superAdmin.agent
        .post(`/auth/users/${w.users.staffA}/reset-password`)
        .set('Origin', ORIGIN)
        .send({});
      expect(response.status).toBe(403);
    });
  });
});
