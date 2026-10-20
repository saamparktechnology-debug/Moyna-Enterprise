import { describe, expect, it } from 'vitest';
import { ROLES, isRole } from './index.js';

describe('roles', () => {
  it('defines the three user levels in order of authority', () => {
    expect(ROLES).toEqual(['SUPER_ADMIN', 'ADMIN', 'STAFF']);
  });

  it('recognises valid roles and rejects anything else', () => {
    expect(isRole('ADMIN')).toBe(true);
    expect(isRole('admin')).toBe(false);
    expect(isRole('')).toBe(false);
  });
});
