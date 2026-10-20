import argon2 from 'argon2';
import { PERMISSION_CODES, ROLE_PRESETS } from '@erp/permissions';
import { afterAll, describe, expect, it } from 'vitest';
import { runSeed } from '../../../../prisma/seed/run-seed.js';
import { loadSeedConfig } from '../../../../prisma/seed/seed-env.js';
import { createOwnerPrisma } from '../support/fixtures.js';
import { TEST_DATABASE_URL } from '../support/test-env.js';

const config = loadSeedConfig({
  MIGRATION_DATABASE_URL: TEST_DATABASE_URL,
  SEED_SUPER_ADMIN_EMAIL: 'admin@example.com',
  SEED_SUPER_ADMIN_PASSWORD: 'first-password-123',
  SEED_BRANCH_CODE: 'HQ',
  SEED_BRANCH_NAME: 'Head Office',
  SEED_BRANCH_STATE_CODE: '19',
});
const NOW = new Date('2026-10-07T10:00:00+05:30');

describe('seed', () => {
  const prisma = createOwnerPrisma();
  afterAll(async () => {
    await prisma.$disconnect();
  });

  async function snapshot() {
    const counts = {
      states: await prisma.state.count(),
      gstRates: await prisma.gstRate.count(),
      hsnCodes: await prisma.hsnCode.count(),
      units: await prisma.unitOfMeasure.count(),
      paymentModes: await prisma.paymentMode.count(),
      leadSources: await prisma.leadSource.count(),
      kycTypes: await prisma.kycDocumentType.count(),
      departments: await prisma.department.count(),
      permissions: await prisma.permission.count(),
      roles: await prisma.role.count(),
      rolePermissions: await prisma.rolePermission.count(),
      categories: await prisma.itemCategory.count(),
      branches: await prisma.branch.count(),
      users: await prisma.user.count(),
      userRoles: await prisma.userRole.count(),
      userBranches: await prisma.userBranch.count(),
      sequences: await prisma.documentSequence.count(),
    };
    return counts;
  }

  it('creates the reference data, permissions, default branch, Super Admin and number series', async () => {
    const summary = await runSeed(prisma, config, NOW);
    expect(summary.superAdminCreated).toBe(true);
    expect(await snapshot()).toEqual({
      states: 39,
      gstRates: 4,
      hsnCodes: 7,
      units: 7,
      paymentModes: 6,
      leadSources: 8,
      kycTypes: 8,
      departments: 5,
      permissions: PERMISSION_CODES.length,
      roles: 3,
      rolePermissions:
        ROLE_PRESETS.SUPER_ADMIN.length + ROLE_PRESETS.ADMIN.length + ROLE_PRESETS.STAFF.length,
      categories: 12,
      branches: 1,
      users: 1,
      userRoles: 1,
      userBranches: 1,
      sequences: 11,
    });
  });

  it('can run twice without duplicating anything', async () => {
    const before = await snapshot();
    const second = await runSeed(prisma, config, NOW);
    expect(second.superAdminCreated).toBe(false);
    expect(await snapshot()).toEqual(before);
  });

  it('stores the Super Admin password as an Argon2id hash, and a re-run does not change it', async () => {
    const user = await prisma.user.findFirstOrThrow({ where: { username: 'superadmin' } });
    expect(user.passwordHash).toMatch(/^\$argon2id\$/);
    expect(await argon2.verify(user.passwordHash, 'first-password-123')).toBe(true);
    await runSeed(
      prisma,
      { ...config, superAdmin: { ...config.superAdmin, password: 'a-different-password-9' } },
      NOW,
    );
    const after = await prisma.user.findFirstOrThrow({ where: { username: 'superadmin' } });
    expect(after.passwordHash).toBe(user.passwordHash);
  });

  it('gives each role exactly its preset permissions', async () => {
    const codes = async (role: string) =>
      (
        await prisma.rolePermission.findMany({
          where: { role: { name: role } },
          include: { permission: true },
        })
      )
        .map((r) => r.permission.code)
        .sort();
    expect(await codes('SUPER_ADMIN')).toEqual([...PERMISSION_CODES].sort());
    expect(await codes('ADMIN')).toEqual([...ROLE_PRESETS.ADMIN].sort());
    expect(await codes('STAFF')).toEqual([...ROLE_PRESETS.STAFF].sort());
    expect(await codes('ADMIN')).not.toContain('branches.manage');
    expect(await codes('STAFF')).toContain('invoices.create');
    expect((await prisma.role.findMany()).every((r) => r.isSystem)).toBe(true);
  });

  it('makes the Super Admin a member of the default branch with the Super Admin role', async () => {
    const user = await prisma.user.findFirstOrThrow({
      where: { username: 'superadmin' },
      include: {
        userRoles: { include: { role: true } },
        userBranches: { include: { branch: true } },
      },
    });
    expect(user.userRoles.map((r) => r.role.name)).toEqual(['SUPER_ADMIN']);
    expect(user.userBranches.map((b) => b.branch.code)).toEqual(['HQ']);
  });

  it('creates one number series per document type for the current financial year, with the branch code in the prefix', async () => {
    const sequences = await prisma.documentSequence.findMany({ orderBy: { docType: 'asc' } });
    expect(sequences).toHaveLength(11);
    expect(new Set(sequences.map((s) => s.financialYear))).toEqual(new Set(['2026-27']));
    expect(sequences.find((s) => s.docType === 'INVOICE_GST')).toMatchObject({
      prefix: 'HQG',
      nextNumber: 1,
    });
    expect(sequences.find((s) => s.docType === 'PURCHASE_ORDER')?.prefix).toBe('HQPO');
  });

  it('seeds GST rates and HSN codes that agree with each other', async () => {
    expect((await prisma.gstRate.findMany()).map((r) => r.rate.toString()).sort()).toEqual([
      '0',
      '18',
      '40',
      '5',
    ]);
    const hsn = await prisma.hsnCode.findUniqueOrThrow({
      where: { code: '8703' },
      include: { gstSlab: true },
    });
    expect(hsn.gstSlab?.rate.toString()).toBe('5');
    expect((await prisma.hsnCode.findMany({ where: { gstRate: null } })).length).toBe(0);
  });

  it('builds the item category tree', async () => {
    const parent = await prisma.itemCategory.findFirstOrThrow({
      where: { name: 'Spare Parts', parentId: null },
      include: { itemCategories: true },
    });
    expect(parent.itemCategories.map((c) => c.name).sort()).toEqual([
      'Body and chassis',
      'Brakes and suspension',
      'Electrical and wiring',
      'Tyres and tubes',
    ]);
  });

  it('keeps changes people make to reference data and adds only what is missing', async () => {
    await prisma.state.update({ where: { code: '27' }, data: { name: 'Maharashtra (renamed)' } });
    await prisma.gstRate.update({ where: { rate: '5' }, data: { isActive: false } });
    await prisma.state.delete({ where: { code: '99' } });
    await runSeed(prisma, config, NOW);
    expect((await prisma.state.findUniqueOrThrow({ where: { code: '27' } })).name).toBe(
      'Maharashtra (renamed)',
    );
    expect((await prisma.gstRate.findUniqueOrThrow({ where: { rate: '5' } })).isActive).toBe(false);
    expect(await prisma.state.findUnique({ where: { code: '99' } })).not.toBeNull();
  });

  it('starts a new number series when a new financial year begins, without touching the old one', async () => {
    await runSeed(prisma, config, new Date('2027-04-05T10:00:00+05:30'));
    expect(await prisma.documentSequence.count()).toBe(22);
    await prisma.documentSequence.updateMany({
      where: { financialYear: '2026-27' },
      data: { nextNumber: 41 },
    });
    await runSeed(prisma, config, new Date('2027-04-06T10:00:00+05:30'));
    expect(
      (await prisma.documentSequence.findMany({ where: { financialYear: '2026-27' } })).every(
        (s) => s.nextNumber === 41,
      ),
    ).toBe(true);
  });

  it('gives each system role its tier', async () => {
    const roles = await prisma.role.findMany();
    expect(Object.fromEntries(roles.map((role) => [role.name, role.tier]))).toEqual({
      SUPER_ADMIN: 'SUPER_ADMIN',
      ADMIN: 'ADMIN',
      STAFF: 'STAFF',
    });
  });
});
