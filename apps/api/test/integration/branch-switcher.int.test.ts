import { Controller, Get, Inject } from '@nestjs/common';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { beforeAll, describe, expect, it } from 'vitest';
import { ScopedPrismaService } from '../../src/common/prisma/scoped-prisma.service.js';
import { Authenticated } from '../../src/features/auth/decorators.js';
import { createTestApp } from '../support/create-test-app.js';
import { createOwnerPrisma } from '../support/fixtures.js';
import { addUser, createAuthWorld, loggedIn, SUPER_PASSWORD } from '../support/auth-world.js';
import type { AuthWorld, TestClient } from '../support/auth-world.js';

@Controller('__switcher')
class SwitcherProbeController {
  constructor(@Inject(ScopedPrismaService) private readonly prisma: ScopedPrismaService) {}

  @Get('invoices')
  @Authenticated()
  async invoices(): Promise<string[]> {
    return (await this.prisma.client.invoice.findMany()).map((invoice) => invoice.id).sort();
  }
}

describe('the branch switcher header', () => {
  let app: NestExpressApplication;
  let w: AuthWorld;
  const owner = createOwnerPrisma();
  const seen = async (client: TestClient, header?: string) => {
    const request = client.agent.get('/__switcher/invoices');
    return header === undefined ? request : request.set('X-Branch-Id', header);
  };

  beforeAll(async () => {
    w = await createAuthWorld(owner);
    await addUser(owner, {
      username: 'admin_ab',
      role: 'ADMIN',
      branchIds: [w.branchA, w.branchB],
    });
    app = await createTestApp({ controllers: [SwitcherProbeController] });
    return async () => {
      await app.close();
      await owner.$disconnect();
    };
  });

  it('shows a user with several branches all of them by default, or when they ask for "all"', async () => {
    const client = await loggedIn(app, 'admin_ab');
    const both = [w.invoiceA, w.invoiceB].sort();
    expect((await seen(client)).body).toEqual(both);
    expect((await seen(client, 'all')).body).toEqual(both);
  });

  it('narrows a request to the chosen branch', async () => {
    const client = await loggedIn(app, 'admin_ab');
    expect((await seen(client, w.branchA)).body).toEqual([w.invoiceA]);
    expect((await seen(client, w.branchB)).body).toEqual([w.invoiceB]);
  });

  it("refuses a branch that is not one of the user's, instead of quietly ignoring it", async () => {
    const client = await loggedIn(app, 'staff_a');
    const response = await seen(client, w.branchB);
    expect(response.status).toBe(403);
    expect(response.body.code).toBe('FORBIDDEN');
    expect((await seen(client, w.branchA)).body).toEqual([w.invoiceA]);
  });

  it('rejects a header that is not a branch id', async () => {
    const client = await loggedIn(app, 'staff_a');
    for (const header of ['not-a-uuid', '1; DROP TABLE invoices', ''])
      expect((await seen(client, header)).status, header).toBe(400);
  });

  it('lets a Super Admin work in one branch, or across all', async () => {
    const client = await loggedIn(app, 'superadmin', SUPER_PASSWORD);
    expect((await seen(client, w.branchB)).body).toEqual([w.invoiceB]);
    expect((await seen(client, 'all')).body).toEqual([w.invoiceA, w.invoiceB].sort());
    expect((await seen(client)).body).toEqual([w.invoiceA, w.invoiceB].sort());
  });

  it('stops a chosen branch widening what a user may see, even for a branch that is switched off', async () => {
    const client = await loggedIn(app, 'admin_ab');
    await owner.branch.update({ where: { id: w.branchB }, data: { isActive: false } });
    expect((await seen(client, w.branchB)).status).toBe(403);
    expect((await seen(client)).body).toEqual([w.invoiceA]);
    await owner.branch.update({ where: { id: w.branchB }, data: { isActive: true } });
  });
});
