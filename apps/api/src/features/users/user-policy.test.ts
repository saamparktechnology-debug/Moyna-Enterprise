import { describe, expect, it } from 'vitest';
import type { RoleTier } from '@erp/permissions';
import {
  canAssignBranch,
  canAssignRole,
  canDeactivate,
  canManage,
  canSee,
  resultingBranches,
} from './user-policy.js';
import type { Actor, Target } from './user-policy.js';

const A = 'branch-a';
const B = 'branch-b';
const C = 'branch-c';
const actor = (tier: RoleTier, branchIds: string[], userId = 'actor'): Actor => ({
  userId,
  tier,
  branchIds,
});
const target = (tier: RoleTier, branchIds: string[], userId = 'target'): Target => ({
  userId,
  tier,
  branchIds,
});

describe('who may manage whom', () => {
  it('lets a Super Admin manage Admins and Staff anywhere, but never other Super Admins or themselves', () => {
    const superAdmin = actor('SUPER_ADMIN', [A]);
    expect(canManage(superAdmin, target('ADMIN', [C]))).toBe(true);
    expect(canManage(superAdmin, target('STAFF', [B, C]))).toBe(true);
    expect(canManage(superAdmin, target('SUPER_ADMIN', [A]))).toBe(false);
    expect(canManage(superAdmin, target('STAFF', [A], 'actor'))).toBe(false);
  });

  it('lets an Admin manage only Staff who share a branch', () => {
    const admin = actor('ADMIN', [A, B]);
    expect(canManage(admin, target('STAFF', [A]))).toBe(true);
    expect(canManage(admin, target('STAFF', [B, C]))).toBe(true);
    expect(canManage(admin, target('STAFF', [C]))).toBe(false);
    expect(canManage(admin, target('ADMIN', [A]))).toBe(false);
    expect(canManage(admin, target('SUPER_ADMIN', [A]))).toBe(false);
  });

  it('lets Staff manage nobody, whatever permissions they hold', () => {
    const staff = actor('STAFF', [A]);
    for (const tier of ['STAFF', 'ADMIN', 'SUPER_ADMIN'] as const)
      expect(canManage(staff, target(tier, [A]))).toBe(false);
  });

  it('never lets anyone manage themselves', () => {
    for (const tier of ['SUPER_ADMIN', 'ADMIN', 'STAFF'] as const)
      expect(canManage(actor(tier, [A], 'me'), target(tier, [A], 'me'))).toBe(false);
  });
});

describe('seeing users', () => {
  it('shows a Super Admin everyone and others only people they share a branch with, and themselves', () => {
    expect(canSee(actor('SUPER_ADMIN', []), target('STAFF', [C]))).toBe(true);
    expect(canSee(actor('ADMIN', [A]), target('STAFF', [A, C]))).toBe(true);
    expect(canSee(actor('ADMIN', [A]), target('STAFF', [C]))).toBe(false);
    expect(canSee(actor('STAFF', [A], 'me'), target('STAFF', [], 'me'))).toBe(true);
  });
});

describe('deactivating', () => {
  it("lets an Admin deactivate Staff only when every branch of that person is the Admin's own", () => {
    const admin = actor('ADMIN', [A, B]);
    expect(canDeactivate(admin, target('STAFF', [A]))).toBe(true);
    expect(canDeactivate(admin, target('STAFF', [A, B]))).toBe(true);
    expect(canDeactivate(admin, target('STAFF', [A, C]))).toBe(false);
  });

  it('lets a Super Admin deactivate any Admin or Staff', () => {
    expect(canDeactivate(actor('SUPER_ADMIN', []), target('ADMIN', [C]))).toBe(true);
    expect(canDeactivate(actor('SUPER_ADMIN', []), target('SUPER_ADMIN', [C]))).toBe(false);
  });
});

describe('assigning roles and branches', () => {
  it('only allows roles of a lower tier than the actor', () => {
    expect(canAssignRole(actor('SUPER_ADMIN', []), 'ADMIN')).toBe(true);
    expect(canAssignRole(actor('SUPER_ADMIN', []), 'SUPER_ADMIN')).toBe(false);
    expect(canAssignRole(actor('ADMIN', [A]), 'STAFF')).toBe(true);
    expect(canAssignRole(actor('ADMIN', [A]), 'ADMIN')).toBe(false);
    expect(canAssignRole(actor('STAFF', [A]), 'STAFF')).toBe(false);
  });

  it('lets an Admin hand out only their own branches', () => {
    expect(canAssignBranch(actor('ADMIN', [A]), A)).toBe(true);
    expect(canAssignBranch(actor('ADMIN', [A]), B)).toBe(false);
    expect(canAssignBranch(actor('SUPER_ADMIN', []), C)).toBe(true);
  });
});

describe('resultingBranches', () => {
  it('replaces the set for a Super Admin', () => {
    expect(resultingBranches(actor('SUPER_ADMIN', []), [A, B], [C])).toEqual([C]);
  });

  it('keeps memberships an Admin does not control and replaces the ones they do', () => {
    const admin = actor('ADMIN', [A, B]);
    expect(resultingBranches(admin, [A, C], [B])).toEqual([C, B]);
    expect(resultingBranches(admin, [A, C], [])).toEqual([C]);
    expect(resultingBranches(admin, [A], [A, B])).toEqual([A, B]);
  });

  it('never repeats a branch', () => {
    expect(resultingBranches(actor('ADMIN', [A]), [C, A], [A, A])).toEqual([C, A]);
  });
});
