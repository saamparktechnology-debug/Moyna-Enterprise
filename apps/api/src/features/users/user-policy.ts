import { canManageTier } from '@erp/permissions';
import type { RoleTier } from '@erp/permissions';

export interface Actor {
  userId: string;
  tier: RoleTier;
  /** The active branches the actor works in. */
  branchIds: readonly string[];
}

export interface Target {
  userId: string;
  tier: RoleTier;
  /** Every branch the target is assigned to, active or not. */
  branchIds: readonly string[];
}

const intersects = (a: readonly string[], b: readonly string[]): boolean =>
  a.some((id) => b.includes(id));

/** Whether the actor may see the user at all. A Super Admin sees everyone, others see people they share a branch with. */
export function canSee(actor: Actor, target: Target): boolean {
  return (
    actor.tier === 'SUPER_ADMIN' ||
    actor.userId === target.userId ||
    intersects(actor.branchIds, target.branchIds)
  );
}

/** Edit, reset the password of, or change the branches of someone: a strictly higher tier, and for Admins a shared branch. */
export function canManage(actor: Actor, target: Target): boolean {
  if (actor.userId === target.userId) return false;
  if (!canManageTier(actor.tier, target.tier)) return false;
  return actor.tier === 'SUPER_ADMIN' || intersects(actor.branchIds, target.branchIds);
}

/** Deactivating removes all access, so an Admin may only do it when every branch of the person is their own. */
export function canDeactivate(actor: Actor, target: Target): boolean {
  if (!canManage(actor, target)) return false;
  return (
    actor.tier === 'SUPER_ADMIN' || target.branchIds.every((id) => actor.branchIds.includes(id))
  );
}

export function canAssignRole(actor: Actor, roleTier: RoleTier): boolean {
  return canManageTier(actor.tier, roleTier);
}

/** Branches an actor may hand out: a Super Admin any, an Admin only their own. */
export function canAssignBranch(actor: Actor, branchId: string): boolean {
  return actor.tier === 'SUPER_ADMIN' || actor.branchIds.includes(branchId);
}

/**
 * The branches a person ends up with after an edit. An Admin can only change the memberships that are theirs;
 * memberships in branches the Admin does not work in are kept as they are.
 */
export function resultingBranches(
  actor: Actor,
  current: readonly string[],
  requested: readonly string[],
): string[] {
  if (actor.tier === 'SUPER_ADMIN') return [...new Set(requested)];
  const kept = current.filter((id) => !actor.branchIds.includes(id));
  return [...new Set([...kept, ...requested])];
}
