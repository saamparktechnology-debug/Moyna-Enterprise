import { describe, expect, it } from 'vitest';
import {
  PERMISSION_CODES,
  RESERVED_PERMISSIONS,
  ROLES,
  ROLE_PRESETS,
  SYSTEM_ROLE_TIERS,
  canManageTier,
  highestTier,
  isRoleTier,
} from './index.js';

describe('tiers', () => {
  it('lets a higher tier manage a lower one and nobody manage their own tier or above', () => {
    expect(canManageTier('SUPER_ADMIN', 'ADMIN')).toBe(true);
    expect(canManageTier('SUPER_ADMIN', 'STAFF')).toBe(true);
    expect(canManageTier('ADMIN', 'STAFF')).toBe(true);
    for (const tier of ['SUPER_ADMIN', 'ADMIN', 'STAFF'] as const)
      expect(canManageTier(tier, tier)).toBe(false);
    expect(canManageTier('ADMIN', 'SUPER_ADMIN')).toBe(false);
    expect(canManageTier('STAFF', 'ADMIN')).toBe(false);
    expect(canManageTier('STAFF', 'SUPER_ADMIN')).toBe(false);
  });

  it('picks the highest tier, and defaults to staff', () => {
    expect(highestTier(['STAFF', 'ADMIN'])).toBe('ADMIN');
    expect(highestTier(['STAFF', 'SUPER_ADMIN', 'ADMIN'])).toBe('SUPER_ADMIN');
    expect(highestTier([])).toBe('STAFF');
  });

  it('recognises tiers', () => {
    expect(isRoleTier('ADMIN')).toBe(true);
    expect(isRoleTier('admin')).toBe(false);
    expect(isRoleTier('MANAGER')).toBe(false);
  });

  it('gives every system role the tier of its own name', () => {
    for (const role of ROLES) expect(SYSTEM_ROLE_TIERS[role]).toBe(role);
  });

  it('reserves only real permissions, and only the Super Admin preset holds them', () => {
    for (const code of RESERVED_PERMISSIONS) {
      expect(PERMISSION_CODES).toContain(code);
      expect(ROLE_PRESETS.SUPER_ADMIN).toContain(code);
      expect(ROLE_PRESETS.ADMIN).not.toContain(code);
      expect(ROLE_PRESETS.STAFF).not.toContain(code);
    }
  });
});
