import { Controller, Get, Inject, Post } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { ModulesContainer } from '@nestjs/core';
import request from 'supertest';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { ScopedPrismaService } from '../../src/common/prisma/scoped-prisma.service.js';
import {
  Authenticated,
  AUTHENTICATED_KEY,
  PERMISSIONS_KEY,
  PUBLIC_KEY,
  RequirePermission,
} from '../../src/features/auth/decorators.js';
import { createTestApp } from '../support/create-test-app.js';
import { createOwnerPrisma } from '../support/fixtures.js';
import { createAuthWorld, loggedIn, ORIGIN, PASSWORD, TestClient } from '../support/auth-world.js';
import type { AuthWorld } from '../support/auth-world.js';

@Controller('__access')
class AccessProbeController {
  constructor(@Inject(ScopedPrismaService) private readonly prisma: ScopedPrismaService) {}

  @Get('naked')
  naked(): string {
    return 'no access rule declared';
  }

  @Get('open')
  @Authenticated()
  open(): string {
    return 'any signed-in user';
  }

  @Get('stock')
  @RequirePermission('stock.view')
  stock(): string {
    return 'needs stock.view';
  }

  @Get('approve')
  @RequirePermission('stock.adjust_approve')
  approve(): string {
    return 'needs stock.adjust_approve';
  }

  @Post('write')
  @RequirePermission('stock.view')
  write(): { done: true } {
    return { done: true };
  }

  @Get('invoices')
  @Authenticated()
  async invoices(): Promise<string[]> {
    return (await this.prisma.client.invoice.findMany()).map((invoice) => invoice.id);
  }
}

describe('access control on requests', () => {
  let app: NestExpressApplication;
  let w: AuthWorld;
  const owner = createOwnerPrisma();

  beforeAll(async () => {
    w = await createAuthWorld(owner);
    app = await createTestApp({ controllers: [AccessProbeController] });
    return async () => {
      await app.close();
      await owner.$disconnect();
    };
  });
  beforeEach(async () => {
    await owner.auditLog.deleteMany({ where: { action: 'LOGIN_FAILED' } });
  });

  describe('deny by default', () => {
    it('lets an unauthenticated visitor reach only the public endpoints', async () => {
      expect((await request(app.getHttpServer()).get('/health')).status).toBe(200);
      for (const path of [
        '/__access/open',
        '/__access/stock',
        '/__access/naked',
        '/auth/session',
      ]) {
        const response = await request(app.getHttpServer()).get(path);
        expect(response.status, path).toBe(401);
        expect(response.body.code).toBe('UNAUTHENTICATED');
      }
    });

    it('denies a signed-in user an endpoint that declares no access rule', async () => {
      for (const username of ['superadmin', 'staff_a']) {
        const client = await loggedIn(
          app,
          username,
          username === 'superadmin' ? 'super admin passphrase 42' : PASSWORD,
        );
        const response = await client.get('/__access/naked');
        expect(response.status, username).toBe(403);
        expect(response.body.code).toBe('FORBIDDEN');
      }
    });

    it('requires every real endpoint to declare who may call it', () => {
      const modules = app.get(ModulesContainer);
      const undeclared: string[] = [];
      let checked = 0;
      for (const module of modules.values()) {
        for (const wrapper of module.controllers.values()) {
          const controller = wrapper.metatype;
          if (!controller || controller === AccessProbeController) continue;
          for (const name of Object.getOwnPropertyNames(controller.prototype)) {
            const handler: unknown = Object.getOwnPropertyDescriptor(
              controller.prototype,
              name,
            )?.value;
            if (
              name === 'constructor' ||
              typeof handler !== 'function' ||
              Reflect.getMetadata('path', handler) === undefined
            )
              continue;
            checked += 1;
            const declared = [PUBLIC_KEY, AUTHENTICATED_KEY, PERMISSIONS_KEY].some(
              (key) =>
                Reflect.getMetadata(key, handler) !== undefined ||
                Reflect.getMetadata(key, controller) !== undefined,
            );
            if (!declared) undeclared.push(`${controller.name}.${name}`);
          }
        }
      }
      expect(checked).toBeGreaterThanOrEqual(6);
      expect(undeclared).toEqual([]);
    });
  });

  describe('permissions', () => {
    it('lets a user through only when they hold the permission', async () => {
      const staff = await loggedIn(app, 'staff_a');
      expect((await staff.get('/__access/open')).status).toBe(200);
      expect((await staff.get('/__access/stock')).status).toBe(200);
      const denied = await staff.get('/__access/approve');
      expect(denied.status).toBe(403);
      expect(denied.body).toMatchObject({ code: 'FORBIDDEN', details: [] });

      const admin = await loggedIn(app, 'admin_a');
      expect((await admin.get('/__access/approve')).status).toBe(200);
    });

    it('applies a change to a role at once, without signing in again', async () => {
      const staff = await loggedIn(app, 'staff_a2');
      expect((await staff.get('/__access/approve')).status).toBe(403);
      const role = await owner.role.findUniqueOrThrow({ where: { name: 'STAFF' } });
      const permission = await owner.permission.findUniqueOrThrow({
        where: { code: 'stock.adjust_approve' },
      });
      await owner.rolePermission.create({ data: { roleId: role.id, permissionId: permission.id } });
      expect((await staff.get('/__access/approve')).status).toBe(200);
      await owner.rolePermission.delete({
        where: { roleId_permissionId: { roleId: role.id, permissionId: permission.id } },
      });
      expect((await staff.get('/__access/approve')).status).toBe(403);
    });
  });

  describe('CSRF protection', () => {
    it('requires the token and the application origin on every state-changing request', async () => {
      const client = await loggedIn(app, 'staff_a');
      const post = (headers: Record<string, string>) =>
        client.agent.post('/__access/write').set(headers).send({});

      expect((await post({ Origin: ORIGIN, 'X-CSRF-Token': client.csrf })).status).toBe(201);
      expect((await post({ Origin: ORIGIN })).status).toBe(403);
      expect((await post({ Origin: ORIGIN, 'X-CSRF-Token': 'forged' })).status).toBe(403);
      expect((await post({ Origin: ORIGIN, 'X-CSRF-Token': `${client.csrf}x` })).status).toBe(403);
      expect((await post({ 'X-CSRF-Token': client.csrf })).status).toBe(403);
      expect(
        (await post({ Origin: 'https://evil.example', 'X-CSRF-Token': client.csrf })).status,
      ).toBe(403);
    });

    it('rejects a token that belongs to another session', async () => {
      const mine = await loggedIn(app, 'staff_a');
      const other = await loggedIn(app, 'staff_a2');
      const response = await mine.agent
        .post('/__access/write')
        .set('Origin', ORIGIN)
        .set('X-CSRF-Token', other.csrf)
        .send({});
      expect(response.status).toBe(403);
      expect(response.body.message).toBe('Missing or invalid CSRF token');
    });

    it('does not ask for a token on reads', async () => {
      const client = await loggedIn(app, 'staff_a');
      expect((await client.get('/__access/stock')).status).toBe(200);
    });

    it('answers 401 before 403 so a signed-out user learns to sign in', async () => {
      const response = await request(app.getHttpServer())
        .post('/__access/write')
        .set('Origin', ORIGIN)
        .send({});
      expect(response.status).toBe(401);
    });
  });

  describe('branch context from the session', () => {
    it('limits each user to the data of their own branches', async () => {
      const ids = async (username: string, password = PASSWORD) =>
        (
          (await (await loggedIn(app, username, password)).get('/__access/invoices'))
            .body as string[]
        ).sort();
      expect(await ids('staff_a')).toEqual([w.invoiceA]);
      expect(await ids('admin_b')).toEqual([w.invoiceB]);
      expect(await ids('superadmin', 'super admin passphrase 42')).toEqual(
        [w.invoiceA, w.invoiceB].sort(),
      );
    });

    it('gives a user with no branch no data at all', async () => {
      await owner.userBranch.deleteMany({ where: { userId: w.users.staffB } });
      expect((await (await loggedIn(app, 'staff_b')).get('/__access/invoices')).body).toEqual([]);
      await owner.userBranch.create({ data: { userId: w.users.staffB, branchId: w.branchB } });
    });

    it('stops showing a branch the moment it is deactivated', async () => {
      const client = new TestClient(app);
      await client.login('admin_b');
      expect((await client.get('/__access/invoices')).body).toEqual([w.invoiceB]);
      await owner.branch.update({ where: { id: w.branchB }, data: { isActive: false } });
      expect((await client.get('/__access/invoices')).body).toEqual([]);
      await owner.branch.update({ where: { id: w.branchB }, data: { isActive: true } });
    });
  });
});
