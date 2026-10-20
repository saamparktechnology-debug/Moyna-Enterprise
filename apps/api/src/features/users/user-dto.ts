import { highestTier } from '@erp/permissions';
import type { RoleTier } from '@erp/permissions';
import type { User } from '@erp/contracts';
import type { Prisma } from '@prisma/client';
import { canManage } from './user-policy.js';
import type { Actor, Target } from './user-policy.js';

export const USER_INCLUDE = {
  userRoles: { include: { role: true } },
  userBranches: { include: { branch: true } },
} satisfies Prisma.UserInclude;

export type UserRow = Prisma.UserGetPayload<{ include: typeof USER_INCLUDE }>;

const RANK: Record<RoleTier, number> = { SUPER_ADMIN: 3, ADMIN: 2, STAFF: 1 };

export function primaryRole(row: UserRow): UserRow['userRoles'][number]['role'] | null {
  const roles = row.userRoles
    .map((entry) => entry.role)
    .sort((a, b) => RANK[b.tier] - RANK[a.tier]);
  return roles[0] ?? null;
}

export function targetOf(row: UserRow): Target {
  return {
    userId: row.id,
    tier: highestTier(row.userRoles.map((entry) => entry.role.tier)),
    branchIds: row.userBranches.map((entry) => entry.branchId),
  };
}

export function toUserDto(row: UserRow, actor: Actor): User {
  const role = primaryRole(row);
  return {
    id: row.id,
    username: row.username,
    fullName: row.fullName,
    email: row.email,
    status: row.status,
    role: role ? { id: role.id, name: role.name, tier: role.tier } : null,
    branches: row.userBranches
      .map((entry) => ({ id: entry.branch.id, code: entry.branch.code, name: entry.branch.name }))
      .sort((a, b) => a.code.localeCompare(b.code)),
    lastLoginAt: row.lastLoginAt ? row.lastLoginAt.toISOString() : null,
    mustChangePassword: row.mustChangePassword,
    manageable: canManage(actor, targetOf(row)),
    rowVersion: row.rowVersion,
    createdAt: row.createdAt.toISOString(),
  };
}
