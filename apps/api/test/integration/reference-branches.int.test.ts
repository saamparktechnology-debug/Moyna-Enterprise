import type { NestExpressApplication } from '@nestjs/platform-express';
import { BranchOptionListResponseSchema } from '@erp/contracts';
import request from 'supertest';
import { beforeAll, describe, expect, it } from 'vitest';
import { createTestApp } from '../support/create-test-app.js';
import { createOwnerPrisma } from '../support/fixtures.js';
import { createAuthWorld, loggedIn } from '../support/auth-world.js';
import type { AuthWorld, TestClient } from '../support/auth-world.js';

describe('the list of branches to choose from', () => {
  let app: NestExpressApplication;
  let w: AuthWorld;
  let staffA: TestClient;
  const owner = createOwnerPrisma();

  beforeAll(async () => {
    w = await createAuthWorld(owner);
    await owner.branch.create({
      data: { code: 'ZZ', name: 'Closed branch', stateCode: '27', isActive: false },
    });
    app = await createTestApp();
    staffA = await loggedIn(app, 'staff_a');
    return async () => {
      await app.close();
      await owner.$disconnect();
    };
  });

  it('answers 401 when signed out', async () => {
    expect((await request(app.getHttpServer()).get('/reference/branches')).status).toBe(401);
  });

  it('shows a branch user every active branch, including ones they do not work in', async () => {
    const response = await staffA.get('/reference/branches');
    expect(response.status).toBe(200);
    const branches = BranchOptionListResponseSchema.parse(response.body);
    const ids = branches.map((branch) => branch.id);
    expect(ids).toEqual(expect.arrayContaining([w.branchA, w.branchB, w.branchC]));
  });

  it('leaves out inactive branches and sorts by code', async () => {
    const branches = BranchOptionListResponseSchema.parse(
      (await staffA.get('/reference/branches')).body,
    );
    expect(branches.map((branch) => branch.code)).not.toContain('ZZ');
    const codes = branches.map((branch) => branch.code);
    expect(codes).toEqual([...codes].sort());
  });

  it('gives only an id, a code and a name', async () => {
    const [first] = (await staffA.get('/reference/branches')).body as Record<string, unknown>[];
    expect(Object.keys(first ?? {}).sort()).toEqual(['code', 'id', 'name']);
  });
});
