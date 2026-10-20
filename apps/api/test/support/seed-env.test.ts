import { describe, expect, it } from 'vitest';
import { loadSeedConfig } from '../../../../prisma/seed/seed-env.js';

const valid = {
  MIGRATION_DATABASE_URL: 'postgresql://erp:erp@localhost:5432/erp_dev',
  SEED_SUPER_ADMIN_EMAIL: 'admin@example.com',
  SEED_SUPER_ADMIN_PASSWORD: 'a-long-enough-password',
  SEED_BRANCH_CODE: 'HQ',
  SEED_BRANCH_NAME: 'Head Office',
  SEED_BRANCH_STATE_CODE: '19',
};

describe('loadSeedConfig', () => {
  it('accepts a complete configuration and applies defaults', () => {
    const config = loadSeedConfig(valid);
    expect(config.superAdmin).toMatchObject({
      username: 'superadmin',
      fullName: 'Super Admin',
      email: 'admin@example.com',
    });
    expect(config.branch).toMatchObject({ code: 'HQ', stateCode: '19' });
  });

  it.each([
    ['a short password', { SEED_SUPER_ADMIN_PASSWORD: 'short' }, /SEED_SUPER_ADMIN_PASSWORD/],
    ['an invalid email', { SEED_SUPER_ADMIN_EMAIL: 'not-an-email' }, /SEED_SUPER_ADMIN_EMAIL/],
    ['a lowercase branch code', { SEED_BRANCH_CODE: 'hq' }, /SEED_BRANCH_CODE/],
    [
      'a branch code too long for GST invoice numbers',
      { SEED_BRANCH_CODE: 'HEADQ' },
      /16 characters/,
    ],
    ['a one-digit state code', { SEED_BRANCH_STATE_CODE: '9' }, /SEED_BRANCH_STATE_CODE/],
    ['an uppercase username', { SEED_SUPER_ADMIN_USERNAME: 'Admin' }, /SEED_SUPER_ADMIN_USERNAME/],
  ])('rejects %s', (_label, override, message) => {
    expect(() => loadSeedConfig({ ...valid, ...override })).toThrowError(message);
  });

  it('lists every missing variable and never echoes the password', () => {
    try {
      loadSeedConfig({ SEED_SUPER_ADMIN_PASSWORD: 'too-short' });
      expect.unreachable();
    } catch (error) {
      const text = (error as Error).message;
      expect(text).toContain('MIGRATION_DATABASE_URL');
      expect(text).toContain('SEED_BRANCH_CODE');
      expect(text).not.toContain('too-short');
    }
  });
});
