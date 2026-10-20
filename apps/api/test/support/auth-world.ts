import argon2 from 'argon2';
import type { PrismaClient } from '@prisma/client';
import request from 'supertest';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { runSeed } from '../../../../prisma/seed/run-seed.js';
import { loadSeedConfig } from '../../../../prisma/seed/seed-env.js';
import { createWorld } from './fixtures.js';
import type { World } from './fixtures.js';
import { TEST_DATABASE_URL } from './test-env.js';

export const ORIGIN = 'http://localhost:5173';
export const PASSWORD = 'correct horse battery staple';
export const SUPER_PASSWORD = 'super admin passphrase 42';

export interface AuthWorld extends World {
  users: Record<
    'super' | 'adminA' | 'adminB' | 'staffA' | 'staffA2' | 'staffB' | 'inactive',
    string
  >;
}

const cheapHash = (password: string): Promise<string> =>
  argon2.hash(password, { type: argon2.argon2id, memoryCost: 4096, timeCost: 1, parallelism: 1 });

export async function createAuthWorld(owner: PrismaClient): Promise<AuthWorld> {
  const world = await createWorld(owner);
  await runSeed(
    owner,
    loadSeedConfig({
      MIGRATION_DATABASE_URL: TEST_DATABASE_URL,
      SEED_SUPER_ADMIN_EMAIL: 'root.admin@example.com',
      SEED_SUPER_ADMIN_USERNAME: 'superadmin',
      SEED_SUPER_ADMIN_PASSWORD: SUPER_PASSWORD,
      SEED_BRANCH_CODE: 'HQ',
      SEED_BRANCH_NAME: 'Head Office',
      SEED_BRANCH_STATE_CODE: '27',
    }),
  );
  const hash = await cheapHash(PASSWORD);
  const make = async (
    username: string,
    role: string,
    branchId: string | null,
    status: 'ACTIVE' | 'INACTIVE' = 'ACTIVE',
  ) => {
    const roleRow = await owner.role.findUniqueOrThrow({ where: { name: role } });
    const user = await owner.user.create({
      data: {
        username,
        email: `${username}@example.com`,
        fullName: `Person ${username}`,
        passwordHash: hash,
        status,
        userRoles: { create: { roleId: roleRow.id } },
        ...(branchId ? { userBranches: { create: { branchId } } } : {}),
      },
    });
    return user.id;
  };
  const users = {
    super: (await owner.user.findFirstOrThrow({ where: { username: 'superadmin' } })).id,
    adminA: await make('admin_a', 'ADMIN', world.branchA),
    adminB: await make('admin_b', 'ADMIN', world.branchB),
    staffA: await make('staff_a', 'STAFF', world.branchA),
    staffA2: await make('staff_a2', 'STAFF', world.branchA),
    staffB: await make('staff_b', 'STAFF', world.branchB),
    inactive: await make('inactive_user', 'STAFF', world.branchA, 'INACTIVE'),
  };
  return { ...world, users };
}

export class TestClient {
  readonly agent;
  csrf = '';

  constructor(app: NestExpressApplication) {
    this.agent = request.agent(app.getHttpServer());
  }

  async login(username: string, password = PASSWORD): Promise<request.Response> {
    const response = await this.agent
      .post('/auth/login')
      .set('Origin', ORIGIN)
      .send({ username, password });
    if (response.status === 200) this.csrf = response.body.csrfToken;
    return response;
  }

  get(path: string): request.Test {
    return this.agent.get(path);
  }

  post(path: string, body: object = {}): request.Test {
    return this.agent.post(path).set('Origin', ORIGIN).set('X-CSRF-Token', this.csrf).send(body);
  }

  put(path: string, body: object = {}): request.Test {
    return this.agent.put(path).set('Origin', ORIGIN).set('X-CSRF-Token', this.csrf).send(body);
  }

  patch(path: string, body: object = {}): request.Test {
    return this.agent.patch(path).set('Origin', ORIGIN).set('X-CSRF-Token', this.csrf).send(body);
  }
}

export async function loggedIn(
  app: NestExpressApplication,
  username: string,
  password = PASSWORD,
): Promise<TestClient> {
  const client = new TestClient(app);
  const response = await client.login(username, password);
  if (response.status !== 200)
    throw new Error(
      `Login as ${username} failed with ${response.status}: ${JSON.stringify(response.body)}`,
    );
  return client;
}

export async function addUser(
  owner: PrismaClient,
  options: {
    username: string;
    role: string;
    branchIds: string[];
    status?: 'ACTIVE' | 'INACTIVE';
    password?: string;
  },
): Promise<string> {
  const role = await owner.role.findUniqueOrThrow({ where: { name: options.role } });
  const user = await owner.user.create({
    data: {
      username: options.username,
      email: `${options.username}@example.com`,
      fullName: `Person ${options.username}`,
      passwordHash: await cheapHash(options.password ?? PASSWORD),
      status: options.status ?? 'ACTIVE',
      userRoles: { create: { roleId: role.id } },
      userBranches: { create: options.branchIds.map((branchId) => ({ branchId })) },
    },
  });
  return user.id;
}

export async function roleId(owner: PrismaClient, name: string): Promise<string> {
  return (await owner.role.findUniqueOrThrow({ where: { name } })).id;
}
