import type { PermissionCode } from './catalog.js';
import type { Role } from './roles.js';

export const ROLE_TIERS = ['SUPER_ADMIN', 'ADMIN', 'STAFF'] as const;
export type RoleTier = (typeof ROLE_TIERS)[number];

const RANK: Readonly<Record<RoleTier, number>> = { SUPER_ADMIN: 3, ADMIN: 2, STAFF: 1 };

export const SYSTEM_ROLE_TIERS: Readonly<Record<Role, RoleTier>> = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  ADMIN: 'ADMIN',
  STAFF: 'STAFF',
};

/** Permissions that only the Super Admin role may hold: changing roles or the branch structure. */
export const RESERVED_PERMISSIONS: readonly PermissionCode[] = ['roles.manage', 'branches.manage'];

export function isRoleTier(value: string): value is RoleTier {
  return (ROLE_TIERS as readonly string[]).includes(value);
}

/** A person may manage someone only when their own tier is strictly higher. */
export function canManageTier(actor: RoleTier, target: RoleTier): boolean {
  return RANK[actor] > RANK[target];
}

export function highestTier(tiers: readonly RoleTier[]): RoleTier {
  return tiers.reduce<RoleTier>((best, tier) => (RANK[tier] > RANK[best] ? tier : best), 'STAFF');
}
