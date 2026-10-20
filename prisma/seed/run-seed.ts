import { DOCUMENT_PREFIXES, DOCUMENT_TYPES, financialYearOf } from '@erp/contracts';
import {
  PERMISSION_CATALOG,
  ROLE_DESCRIPTIONS,
  ROLE_PRESETS,
  ROLES,
  SYSTEM_ROLE_TIERS,
} from '@erp/permissions';
import argon2 from 'argon2';
import type { PrismaClient } from '@prisma/client';
import {
  DEPARTMENTS,
  GST_RATES,
  HSN_CODES,
  ITEM_CATEGORIES,
  KYC_DOCUMENT_TYPES,
  LEAD_SOURCES,
  PAYMENT_MODES,
  STATES,
  UNITS,
} from './data.js';
import type { SeedConfig } from './seed-env.js';

export interface SeedSummary {
  states: number;
  gstRates: number;
  hsnCodes: number;
  permissions: number;
  roles: number;
  rolePermissions: number;
  itemCategories: number;
  documentSequences: number;
  superAdminCreated: boolean;
}

async function seedMasters(prisma: PrismaClient): Promise<void> {
  await prisma.state.createMany({
    data: STATES.map(([code, name]) => ({ code, name })),
    skipDuplicates: true,
  });
  await prisma.gstRate.createMany({
    data: GST_RATES.map(([rate, label]) => ({ rate, label })),
    skipDuplicates: true,
  });
  await prisma.hsnCode.createMany({
    data: HSN_CODES.map(([code, description, gstRate]) => ({ code, description, gstRate })),
    skipDuplicates: true,
  });
  const simple = (rows: readonly (readonly [string, string])[]) =>
    rows.map(([code, name]) => ({ code, name }));
  await prisma.unitOfMeasure.createMany({ data: simple(UNITS), skipDuplicates: true });
  await prisma.paymentMode.createMany({ data: simple(PAYMENT_MODES), skipDuplicates: true });
  await prisma.leadSource.createMany({ data: simple(LEAD_SOURCES), skipDuplicates: true });
  await prisma.kycDocumentType.createMany({
    data: simple(KYC_DOCUMENT_TYPES),
    skipDuplicates: true,
  });
  await prisma.department.createMany({ data: simple(DEPARTMENTS), skipDuplicates: true });
}

async function seedAccessControl(prisma: PrismaClient): Promise<void> {
  for (const permission of PERMISSION_CATALOG) {
    await prisma.permission.upsert({
      where: { code: permission.code },
      update: { description: permission.description, module: permission.module },
      create: {
        code: permission.code,
        description: permission.description,
        module: permission.module,
      },
    });
  }
  const permissionIds = new Map((await prisma.permission.findMany()).map((p) => [p.code, p.id]));
  for (const role of ROLES) {
    const row = await prisma.role.upsert({
      where: { name: role },
      update: {
        description: ROLE_DESCRIPTIONS[role],
        isSystem: true,
        tier: SYSTEM_ROLE_TIERS[role],
      },
      create: {
        name: role,
        description: ROLE_DESCRIPTIONS[role],
        isSystem: true,
        tier: SYSTEM_ROLE_TIERS[role],
      },
    });
    await prisma.rolePermission.createMany({
      data: ROLE_PRESETS[role].map((code) => ({
        roleId: row.id,
        permissionId: permissionIds.get(code) as string,
      })),
      skipDuplicates: true,
    });
  }
}

async function seedItemCategories(prisma: PrismaClient): Promise<void> {
  const ensure = async (name: string, parentId: string | null): Promise<string> => {
    const existing = await prisma.itemCategory.findFirst({ where: { name, parentId } });
    if (existing) return existing.id;
    return (await prisma.itemCategory.create({ data: { name, parentId } })).id;
  };
  for (const category of ITEM_CATEGORIES) {
    const parentId = await ensure(category.name, null);
    for (const child of category.children ?? []) await ensure(child, parentId);
  }
}

async function seedBranchAndAdmin(
  prisma: PrismaClient,
  config: SeedConfig,
  now: Date,
): Promise<{ created: boolean }> {
  const existingBranch = await prisma.branch.findUnique({ where: { code: config.branch.code } });
  const branch =
    existingBranch ??
    (await prisma.branch.create({
      data: {
        code: config.branch.code,
        name: config.branch.name,
        stateCode: config.branch.stateCode,
        gstin: config.branch.gstin ?? null,
      },
    }));

  const year = financialYearOf(now).label;
  await prisma.documentSequence.createMany({
    data: DOCUMENT_TYPES.map((docType) => ({
      branchId: branch.id,
      docType,
      financialYear: year,
      prefix: `${branch.code}${DOCUMENT_PREFIXES[docType]}`,
    })),
    skipDuplicates: true,
  });

  const existingUser = await prisma.user.findFirst({
    where: { username: { equals: config.superAdmin.username, mode: 'insensitive' } },
  });
  const user =
    existingUser ??
    (await prisma.user.create({
      data: {
        username: config.superAdmin.username,
        email: config.superAdmin.email,
        fullName: config.superAdmin.fullName,
        passwordHash: await argon2.hash(config.superAdmin.password, { type: argon2.argon2id }),
      },
    }));

  const role = await prisma.role.findUniqueOrThrow({ where: { name: 'SUPER_ADMIN' } });
  await prisma.userRole.createMany({
    data: [{ userId: user.id, roleId: role.id }],
    skipDuplicates: true,
  });
  await prisma.userBranch.createMany({
    data: [{ userId: user.id, branchId: branch.id }],
    skipDuplicates: true,
  });
  return { created: !existingUser };
}

export async function runSeed(
  prisma: PrismaClient,
  config: SeedConfig,
  now: Date = new Date(),
): Promise<SeedSummary> {
  await seedMasters(prisma);
  await seedAccessControl(prisma);
  await seedItemCategories(prisma);
  const { created } = await seedBranchAndAdmin(prisma, config, now);
  return {
    states: await prisma.state.count(),
    gstRates: await prisma.gstRate.count(),
    hsnCodes: await prisma.hsnCode.count(),
    permissions: await prisma.permission.count(),
    roles: await prisma.role.count(),
    rolePermissions: await prisma.rolePermission.count(),
    itemCategories: await prisma.itemCategory.count(),
    documentSequences: await prisma.documentSequence.count(),
    superAdminCreated: created,
  };
}
