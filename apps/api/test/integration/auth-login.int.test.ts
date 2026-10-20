import type { NestExpressApplication } from '@nestjs/platform-express';
import argon2 from 'argon2';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { SessionResponseSchema } from '@erp/contracts';
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

describe('login, sessions and logout', () => {
  let app: NestExpressApplication;
  let w: AuthWorld;
  const owner = createOwnerPrisma();
  const login = (client: TestClient, username: string, password = PASSWORD) =>
    client.login(username, password);
  const failuresCleared = () => owner.auditLog.deleteMany({ where: { action: 'LOGIN_FAILED' } });
  const cookieOf = (response: request.Response): string =>
    String(response.headers['set-cookie']?.[0] ?? '');
  const tokenOf = (response: request.Response): string =>
    /erp_session=([^;]+)/.exec(cookieOf(response))?.[1] ?? '';

  beforeAll(async () => {
    w = await createAuthWorld(owner);
    app = await createTestApp();
    return async () => {
      await app.close();
      await owner.$disconnect();
    };
  });
  beforeEach(async () => {
    await failuresCleared();
    await owner.user.updateMany({ data: { failedLoginCount: 0, lockedUntil: null } });
  });

  describe('signing in', () => {
    it('returns the session, sets a secure cookie and records the login', async () => {
      const response = await login(new TestClient(app), 'staff_a');

      expect(response.status).toBe(200);
      const body = SessionResponseSchema.parse(response.body);
      expect(body.user).toMatchObject({
        username: 'staff_a',
        roles: ['STAFF'],
        isSuperAdmin: false,
        mustChangePassword: false,
      });
      expect(body.user.branches.map((b) => b.id)).toEqual([w.branchA]);
      expect(body.user.permissions).toContain('invoices.create');
      expect(body.user.permissions).not.toContain('users.manage');
      expect(JSON.stringify(response.body)).not.toMatch(/passwordHash|argon2/);
      expect(cookieOf(response)).toMatch(
        /^erp_session=[^;]+; Max-Age=\d+; Path=\/; Expires=[^;]+; HttpOnly; SameSite=Lax$/,
      );
      expect(response.headers['cache-control']).toBe('no-store');

      const audit = await owner.auditLog.findFirstOrThrow({
        where: { action: 'LOGIN', entityId: w.users.staffA },
      });
      expect(audit.actorId).toBe(w.users.staffA);
      expect(
        (await owner.user.findUniqueOrThrow({ where: { id: w.users.staffA } })).lastLoginAt,
      ).not.toBeNull();
    });

    it('stores only a hash of the cookie token and gives every login a new session', async () => {
      const first = await login(new TestClient(app), 'staff_a');
      const second = await login(new TestClient(app), 'staff_a');
      expect(tokenOf(first)).not.toBe(tokenOf(second));
      const sessions = await owner.session.findMany({ where: { userId: w.users.staffA } });
      expect(sessions.length).toBeGreaterThanOrEqual(2);
      for (const session of sessions) expect(session.tokenHash).not.toBe(tokenOf(first));
      expect(sessions.some((s) => s.tokenHash.length === 64)).toBe(true);
    });

    it('signs in regardless of the case of the username, and gives a Super Admin every branch', async () => {
      const response = await login(new TestClient(app), 'SuperAdmin', SUPER_PASSWORD);
      expect(response.status).toBe(200);
      expect(response.body.user.isSuperAdmin).toBe(true);
      expect(response.body.user.branches.map((b: { id: string }) => b.id)).toEqual(
        expect.arrayContaining([w.branchA, w.branchB, w.branchC]),
      );
    });

    it('answers a wrong password and an unknown user identically', async () => {
      const wrong = await login(new TestClient(app), 'staff_a', 'not the password at all');
      const unknown = await login(new TestClient(app), 'nobody_here', 'not the password at all');
      expect(wrong.status).toBe(401);
      expect(unknown.status).toBe(401);
      expect({ ...wrong.body, requestId: '' }).toEqual({ ...unknown.body, requestId: '' });
      expect(wrong.body).toMatchObject({
        code: 'UNAUTHENTICATED',
        message: 'Invalid username or password',
      });
      expect(cookieOf(wrong)).toBe('');
    });

    it('treats a deactivated user like an unknown one', async () => {
      const response = await login(new TestClient(app), 'inactive_user');
      expect(response.status).toBe(401);
      expect(response.body.message).toBe('Invalid username or password');
    });

    it('records failures without storing what was typed, and counts them', async () => {
      await login(new TestClient(app), 'staff_a', 'wrong one');
      await login(new TestClient(app), 'nobody_here', 'wrong two');
      const rows = await owner.auditLog.findMany({
        where: { action: 'LOGIN_FAILED' },
        orderBy: { createdAt: 'asc' },
      });
      expect(rows.map((r) => r.newValue)).toEqual([
        { reason: 'wrong_password' },
        { reason: 'unknown_user' },
      ]);
      expect(JSON.stringify(rows)).not.toMatch(/wrong one|wrong two|nobody_here/);
      expect(
        (await owner.user.findUniqueOrThrow({ where: { id: w.users.staffA } })).failedLoginCount,
      ).toBe(1);
    });

    it('rejects a malformed request with field details', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/login')
        .set('Origin', ORIGIN)
        .send({ username: '', password: '' });
      expect(response.status).toBe(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
      expect(response.body.details.map((d: { field: string }) => d.field).sort()).toEqual([
        'password',
        'username',
      ]);
    });

    it('refuses a sign-in that does not come from the application origin', async () => {
      const send = (origin?: string) => {
        const req = request(app.getHttpServer()).post('/auth/login');
        return (origin ? req.set('Origin', origin) : req).send({
          username: 'staff_a',
          password: PASSWORD,
        });
      };
      expect((await send()).status).toBe(403);
      expect((await send('https://evil.example')).status).toBe(403);
      expect((await send(`${ORIGIN}.evil.example`)).status).toBe(403);
      expect((await send(`${ORIGIN}/`)).status).toBe(200);
    });
  });

  describe('lockout and throttling', () => {
    it('locks the account after five failures, even for the right password, then recovers', async () => {
      for (let i = 0; i < 5; i += 1)
        expect((await login(new TestClient(app), 'staff_a2', `wrong ${i}`)).status).toBe(401);
      const locked = await login(new TestClient(app), 'staff_a2');
      expect(locked.status).toBe(429);
      expect(locked.body).toMatchObject({ code: 'RATE_LIMITED' });
      expect(locked.body.message).toMatch(/Try again in \d+ minutes?/);
      expect(cookieOf(locked)).toBe('');

      await owner.user.update({
        where: { id: w.users.staffA2 },
        data: { lockedUntil: new Date(Date.now() - 1000) },
      });
      const recovered = await login(new TestClient(app), 'staff_a2');
      expect(recovered.status).toBe(200);
      expect(
        (await owner.user.findUniqueOrThrow({ where: { id: w.users.staffA2 } })).failedLoginCount,
      ).toBe(0);
    });

    it('does not let a few failures spread across successes lock the account', async () => {
      for (let i = 0; i < 3; i += 1) await login(new TestClient(app), 'staff_b', `wrong ${i}`);
      expect((await login(new TestClient(app), 'staff_b')).status).toBe(200);
      for (let i = 0; i < 3; i += 1) await login(new TestClient(app), 'staff_b', `wrong ${i}`);
      expect((await login(new TestClient(app), 'staff_b')).status).toBe(200);
    });

    it('stops one address from guessing many accounts', async () => {
      await login(new TestClient(app), 'nobody_1', 'guess');
      const ip = (await owner.auditLog.findFirstOrThrow({ where: { action: 'LOGIN_FAILED' } }))
        .ipAddress;
      await owner.auditLog.createMany({
        data: Array.from({ length: 19 }, () => ({
          action: 'LOGIN_FAILED',
          entityType: 'User',
          ipAddress: ip,
        })),
      });

      const blocked = await login(new TestClient(app), 'staff_a');
      expect(blocked.status).toBe(429);
      expect(blocked.body.message).toMatch(/from this address/);

      await owner.auditLog.updateMany({
        where: { action: 'LOGIN_FAILED' },
        data: { createdAt: new Date(Date.now() - 16 * 60_000) },
      });
      expect((await login(new TestClient(app), 'staff_a')).status).toBe(200);
    });
  });

  describe('using a session', () => {
    it('returns the current session and fresh CSRF token to a signed-in user', async () => {
      const client = await loggedIn(app, 'admin_a');
      const response = await client.get('/auth/session');
      expect(response.status).toBe(200);
      expect(response.body.user.username).toBe('admin_a');
      expect(response.body.csrfToken).toBe(client.csrf);
    });

    it('answers an unauthenticated request with 401 and the standard error shape', async () => {
      const response = await request(app.getHttpServer()).get('/auth/session');
      expect(response.status).toBe(401);
      expect(response.body).toMatchObject({ code: 'UNAUTHENTICATED', details: [] });
    });

    it('rejects a forged, tampered or foreign cookie and clears it', async () => {
      const login1 = await new TestClient(app).login('staff_a');
      const token = tokenOf(login1);
      const attempts = [
        'erp_session=not-a-real-token',
        `erp_session=${token}x`,
        `erp_session=${token.slice(0, -1)}${token.endsWith('A') ? 'B' : 'A'}`,
        `erp_session=${token.toUpperCase()}`,
        'erp_session=',
        `other=${token}`,
      ];
      for (const cookie of attempts) {
        const response = await request(app.getHttpServer())
          .get('/auth/session')
          .set('Cookie', cookie);
        expect(response.status, cookie).toBe(401);
      }
      expect(
        (
          await request(app.getHttpServer())
            .get('/auth/session')
            .set('Cookie', `erp_session=${token}`)
        ).status,
      ).toBe(200);
    });

    it('rejects a session after its absolute lifetime', async () => {
      const client = await loggedIn(app, 'staff_a');
      expect((await client.get('/auth/session')).status).toBe(200);
      await owner.session.updateMany({
        where: { userId: w.users.staffA },
        data: {
          createdAt: new Date(Date.now() - 13 * 3_600_000),
          expiresAt: new Date(Date.now() - 1000),
        },
      });
      expect((await client.get('/auth/session')).status).toBe(401);
    });

    it('rejects a session that has been idle for 30 minutes, but keeps an active one alive', async () => {
      const idle = await loggedIn(app, 'staff_a2');
      await owner.session.updateMany({
        where: { userId: w.users.staffA2 },
        data: { lastSeenAt: new Date(Date.now() - 31 * 60_000) },
      });
      expect((await idle.get('/auth/session')).status).toBe(401);

      const active = await loggedIn(app, 'staff_b');
      await owner.session.updateMany({
        where: { userId: w.users.staffB },
        data: { lastSeenAt: new Date(Date.now() - 20 * 60_000) },
      });
      expect((await active.get('/auth/session')).status).toBe(200);
      const refreshed = await owner.session.findFirstOrThrow({
        where: { userId: w.users.staffB },
        orderBy: { createdAt: 'desc' },
      });
      expect(Date.now() - refreshed.lastSeenAt.getTime()).toBeLessThan(60_000);
    });

    it('cuts off a user who is deactivated while signed in', async () => {
      const client = await loggedIn(app, 'staff_b');
      expect((await client.get('/auth/session')).status).toBe(200);
      await owner.user.update({ where: { id: w.users.staffB }, data: { status: 'INACTIVE' } });
      expect((await client.get('/auth/session')).status).toBe(401);
      await owner.user.update({ where: { id: w.users.staffB }, data: { status: 'ACTIVE' } });
    });
  });

  describe('signing out', () => {
    it('revokes the session, clears the cookie and records the logout', async () => {
      const client = await loggedIn(app, 'admin_b');
      const response = await client.post('/auth/logout');
      expect(response.status).toBe(200);
      expect(response.body).toEqual({ ok: true });
      expect(cookieOf(response)).toMatch(/erp_session=;/);
      expect((await client.get('/auth/session')).status).toBe(401);
      expect(
        await owner.auditLog.count({ where: { action: 'LOGOUT', entityId: w.users.adminB } }),
      ).toBe(1);
      expect(
        (await owner.session.findMany({ where: { userId: w.users.adminB } })).every(
          (s) => s.revokedAt !== null,
        ),
      ).toBe(true);
    });

    it('cannot reuse a token after logout', async () => {
      const first = await new TestClient(app).login('admin_b');
      const token = tokenOf(first);
      const client = new TestClient(app);
      await client.agent
        .post('/auth/logout')
        .set('Origin', ORIGIN)
        .set('Cookie', `erp_session=${token}`)
        .send();
      const reuse = await request(app.getHttpServer())
        .get('/auth/session')
        .set('Cookie', `erp_session=${token}`);
      expect(reuse.status).toBe(401);
    });

    it('succeeds quietly when there is no session at all', async () => {
      const response = await request(app.getHttpServer())
        .post('/auth/logout')
        .set('Origin', ORIGIN)
        .send();
      expect(response.status).toBe(200);
      expect(await owner.auditLog.count({ where: { action: 'LOGOUT', actorId: null } })).toBe(0);
    });

    it('does not let another site log a user out', async () => {
      expect(
        (
          await request(app.getHttpServer())
            .post('/auth/logout')
            .set('Origin', 'https://evil.example')
            .send()
        ).status,
      ).toBe(403);
    });
  });

  it('hashes new passwords with Argon2id', async () => {
    const user = await owner.user.findFirstOrThrow({ where: { username: 'superadmin' } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await argon2.verify(user.passwordHash, SUPER_PASSWORD)).toBe(true);
  });
});
