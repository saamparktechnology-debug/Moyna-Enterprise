import type { Branch, PermissionGroup, Role, User } from '@erp/contracts';

export const BRANCH_A = {
  id: '11111111-1111-4111-8111-111111111111',
  code: 'AA',
  name: 'Alpha Branch',
};
export const BRANCH_B = {
  id: '22222222-2222-4222-8222-222222222222',
  code: 'BB',
  name: 'Beta Branch',
};
export const BRANCH_C = {
  id: '33333333-3333-4333-8333-333333333333',
  code: 'CC',
  name: 'Gamma Branch',
};
export const ROLE_STAFF = {
  id: '44444444-4444-4444-8444-444444444444',
  name: 'STAFF',
  tier: 'STAFF' as const,
};
export const ROLE_ADMIN = {
  id: '55555555-5555-4555-8555-555555555555',
  name: 'ADMIN',
  tier: 'ADMIN' as const,
};
export const ROLE_SUPER = {
  id: '66666666-6666-4666-8666-666666666666',
  name: 'SUPER_ADMIN',
  tier: 'SUPER_ADMIN' as const,
};

export function makeBranch(
  over: Partial<Branch> & { id: string; code: string; name: string },
): Branch {
  return {
    gstin: null,
    stateCode: '19',
    stateName: 'West Bengal',
    isActive: true,
    rowVersion: 1,
    createdAt: '2026-10-01T00:00:00.000Z',
    updatedAt: '2026-10-01T00:00:00.000Z',
    ...over,
  };
}

export function branchPage(branches = [BRANCH_A, BRANCH_B, BRANCH_C]) {
  const items = branches.map((branch) => makeBranch(branch));
  return { items, page: 1, pageSize: 100, total: items.length, totalPages: 1 };
}

export function makeUserDto(over: Partial<User> & { id?: string } = {}): User {
  return {
    id: 'u-1',
    username: 'asha',
    fullName: 'Asha Rao',
    email: 'asha@example.com',
    status: 'ACTIVE',
    role: ROLE_STAFF,
    branches: [BRANCH_A],
    lastLoginAt: null,
    mustChangePassword: false,
    manageable: true,
    rowVersion: 1,
    createdAt: '2026-10-01T00:00:00.000Z',
    ...over,
  };
}

export function userPage(
  items: User[],
  over: Partial<{ page: number; total: number; totalPages: number; pageSize: number }> = {},
) {
  return { items, page: 1, pageSize: 10, total: items.length, totalPages: 1, ...over };
}

export function makeRoleDto(over: Partial<Role> = {}): Role {
  return {
    id: 'r-1',
    name: 'Store Keeper',
    description: 'Looks after stock',
    tier: 'STAFF',
    isSystem: false,
    editable: true,
    permissionCodes: ['stock.view'],
    userCount: 2,
    rowVersion: 1,
    ...over,
  };
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    module: 'roles',
    permissions: [
      { code: 'roles.view', description: 'View roles and permissions', reserved: false },
      { code: 'roles.manage', description: 'Create and edit roles', reserved: true },
    ],
  },
  {
    module: 'stock',
    permissions: [
      { code: 'stock.view', description: 'View stock balances', reserved: false },
      { code: 'stock.adjust', description: 'Request a stock adjustment', reserved: false },
    ],
  },
];
