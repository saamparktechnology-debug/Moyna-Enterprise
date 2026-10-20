import { describe, expect, it } from 'vitest';
import {
  PERMISSION_CATALOG,
  PERMISSION_CODES,
  ROLE_DESCRIPTIONS,
  ROLE_PRESETS,
  ROLES,
  isPermissionCode,
} from './index.js';

describe('permission catalog', () => {
  it('has unique codes in module.action form', () => {
    expect(new Set(PERMISSION_CODES).size).toBe(PERMISSION_CODES.length);
    for (const permission of PERMISSION_CATALOG) {
      expect(permission.code).toMatch(/^[a-z_]+\.[a-z_]+$/);
      expect(permission.description.length).toBeGreaterThan(5);
    }
  });

  it('recognises catalog codes and rejects anything else', () => {
    expect(isPermissionCode('stock.adjust')).toBe(true);
    expect(isPermissionCode('stock.destroy')).toBe(false);
    expect(isPermissionCode('')).toBe(false);
  });
});

describe('role presets', () => {
  it('gives Super Admin every permission', () => {
    expect([...ROLE_PRESETS.SUPER_ADMIN].sort()).toEqual([...PERMISSION_CODES].sort());
  });

  it('keeps each lower role inside the one above it', () => {
    const admin = new Set<string>(ROLE_PRESETS.ADMIN);
    const staff = new Set<string>(ROLE_PRESETS.STAFF);
    for (const code of staff) expect(admin.has(code)).toBe(true);
    expect(staff.size).toBeLessThan(admin.size);
    expect(admin.size).toBeLessThan(ROLE_PRESETS.SUPER_ADMIN.length);
  });

  it('reserves company-level administration for Super Admin', () => {
    for (const code of [
      'branches.manage',
      'roles.manage',
      'settings.manage',
      'dashboards.view_company',
    ] as const) {
      expect(ROLE_PRESETS.ADMIN).not.toContain(code);
      expect(ROLE_PRESETS.STAFF).not.toContain(code);
    }
  });

  it('keeps approvals, user management and audit away from Staff but lets Staff work', () => {
    for (const code of [
      'users.manage',
      'stock.adjust_approve',
      'invoices.cancel',
      'audit.view',
      'payments.reverse',
    ] as const) {
      expect(ROLE_PRESETS.STAFF).not.toContain(code);
    }
    for (const code of [
      'invoices.create',
      'payments.create',
      'purchases.receive',
      'transfers.request',
      'attendance.mark',
    ] as const) {
      expect(ROLE_PRESETS.STAFF).toContain(code);
    }
  });

  it('defines a preset and a description for every role', () => {
    for (const role of ROLES) {
      expect(ROLE_PRESETS[role].length).toBeGreaterThan(0);
      expect(ROLE_DESCRIPTIONS[role].length).toBeGreaterThan(10);
    }
  });
});
