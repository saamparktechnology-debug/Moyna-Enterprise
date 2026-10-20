import { describe, expect, it } from 'vitest';
import {
  CreateRoleRequestSchema,
  CreateUserRequestSchema,
  UpdateRoleRequestSchema,
  UpdateUserRequestSchema,
  UserListQuerySchema,
} from './index.js';

const id = '11111111-1111-4111-8111-111111111111';
const id2 = '22222222-2222-4222-8222-222222222222';
const user = {
  username: ' Ravi.K ',
  fullName: '  Ravi Kumar ',
  email: ' Ravi@Example.COM ',
  roleId: id,
  branchIds: [id],
};

describe('CreateUserRequestSchema', () => {
  it('normalises the username and email and trims the name', () => {
    expect(CreateUserRequestSchema.parse(user)).toEqual({
      username: 'ravi.k',
      fullName: 'Ravi Kumar',
      email: 'ravi@example.com',
      roleId: id,
      branchIds: [id],
    });
  });

  it.each(['ab', 'a'.repeat(33), 'has space', 'ünï', 'semi;colon', ''])(
    'rejects the username %j',
    (username) => {
      expect(CreateUserRequestSchema.safeParse({ ...user, username }).success).toBe(false);
    },
  );

  it.each(['', 'not-an-email', 'a@b', '@example.com', `${'a'.repeat(250)}@x.com`])(
    'rejects the email %j',
    (email) => {
      expect(CreateUserRequestSchema.safeParse({ ...user, email }).success).toBe(false);
    },
  );

  it('needs a role and at least one distinct branch', () => {
    expect(CreateUserRequestSchema.safeParse({ ...user, roleId: 'x' }).success).toBe(false);
    expect(CreateUserRequestSchema.safeParse({ ...user, branchIds: [] }).success).toBe(false);
    expect(CreateUserRequestSchema.safeParse({ ...user, branchIds: [id, id] }).success).toBe(false);
    expect(CreateUserRequestSchema.safeParse({ ...user, branchIds: [id, id2] }).success).toBe(true);
    expect(CreateUserRequestSchema.safeParse({ ...user, branchIds: ['not-a-uuid'] }).success).toBe(
      false,
    );
  });
});

describe('UpdateUserRequestSchema', () => {
  it('allows an empty branch list, because the server keeps branches the editor does not manage', () => {
    expect(
      UpdateUserRequestSchema.safeParse({ ...user, branchIds: [], rowVersion: 1 }).success,
    ).toBe(true);
    expect(
      UpdateUserRequestSchema.safeParse({ ...user, branchIds: [id, id], rowVersion: 1 }).success,
    ).toBe(false);
  });

  it('carries the version and ignores a username', () => {
    const parsed = UpdateUserRequestSchema.parse({ ...user, rowVersion: 2 });
    expect(parsed).not.toHaveProperty('username');
    expect(parsed.rowVersion).toBe(2);
    expect(UpdateUserRequestSchema.safeParse({ ...user }).success).toBe(false);
  });
});

describe('UserListQuerySchema', () => {
  it('defaults and validates filters', () => {
    expect(UserListQuerySchema.parse({})).toMatchObject({ status: 'all', page: 1 });
    expect(UserListQuerySchema.safeParse({ roleId: 'x' }).success).toBe(false);
    expect(UserListQuerySchema.safeParse({ status: 'gone' }).success).toBe(false);
    expect(UserListQuerySchema.parse({ branchId: id, roleId: id2 })).toMatchObject({
      branchId: id,
      roleId: id2,
    });
  });
});

describe('role schemas', () => {
  const role = {
    name: ' Store Keeper ',
    description: '  ',
    tier: 'STAFF',
    permissionCodes: ['stock.view'],
  };

  it('trims, and turns an empty description into none', () => {
    expect(CreateRoleRequestSchema.parse(role)).toEqual({
      name: 'Store Keeper',
      description: null,
      tier: 'STAFF',
      permissionCodes: ['stock.view'],
    });
    expect(
      CreateRoleRequestSchema.parse({ ...role, description: undefined }).description,
    ).toBeNull();
  });

  it('never accepts a Super Admin tier for a new role', () => {
    expect(CreateRoleRequestSchema.safeParse({ ...role, tier: 'SUPER_ADMIN' }).success).toBe(false);
    expect(CreateRoleRequestSchema.safeParse({ ...role, tier: 'ADMIN' }).success).toBe(true);
  });

  it.each(['', 'x', '<script>', '  ', '-leading', 'a'.repeat(51)])(
    'rejects the role name %j',
    (name) => {
      expect(CreateRoleRequestSchema.safeParse({ ...role, name }).success).toBe(false);
    },
  );

  it('rejects a permission listed twice and allows an empty list', () => {
    expect(
      CreateRoleRequestSchema.safeParse({ ...role, permissionCodes: ['a.b', 'a.b'] }).success,
    ).toBe(false);
    expect(CreateRoleRequestSchema.safeParse({ ...role, permissionCodes: [] }).success).toBe(true);
  });

  it('does not let an update change the tier', () => {
    const parsed = UpdateRoleRequestSchema.parse({ ...role, tier: 'ADMIN', rowVersion: 3 });
    expect(parsed).not.toHaveProperty('tier');
    expect(UpdateRoleRequestSchema.safeParse(role).success).toBe(false);
  });
});
