import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';
import type { BranchContext } from '../../src/common/branch-context/branch-context.service.js';
import { TEST_DATABASE_URL } from './test-env.js';

export function createOwnerPrisma(): PrismaClient {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString: TEST_DATABASE_URL }) });
}

export interface World {
  branchA: string;
  branchB: string;
  branchC: string;
  userSuper: string;
  userA: string;
  userB: string;
  userAB: string;
  itemId: string;
  customerId: string;
  supplierId: string;
  invoiceA: string;
  invoiceB: string;
  serialA: string;
  serialB: string;
  transferAB: string;
  transferBC: string;
}

export async function createMasters(prisma: PrismaClient): Promise<void> {
  await prisma.state.createMany({
    data: [
      { code: '27', name: 'Maharashtra' },
      { code: '29', name: 'Karnataka' },
    ],
    skipDuplicates: true,
  });
  await prisma.gstRate.createMany({
    data: [
      { rate: '0', label: 'GST 0%' },
      { rate: '5', label: 'GST 5%' },
      { rate: '18', label: 'GST 18%' },
    ],
    skipDuplicates: true,
  });
  await prisma.hsnCode.createMany({
    data: [{ code: '8703', description: 'E-rickshaw', gstRate: '5' }],
    skipDuplicates: true,
  });
  await prisma.unitOfMeasure.createMany({
    data: [{ code: 'PCS', name: 'Pieces' }],
    skipDuplicates: true,
  });
  await prisma.paymentMode.createMany({
    data: [{ code: 'CASH', name: 'Cash' }],
    skipDuplicates: true,
  });
  await prisma.leadSource.createMany({
    data: [{ code: 'WALK_IN', name: 'Walk-in' }],
    skipDuplicates: true,
  });
}

export async function createWorld(prisma: PrismaClient): Promise<World> {
  await createMasters(prisma);
  const branch = (code: string, stateCode = '27') =>
    prisma.branch.create({ data: { code, name: `Branch ${code}`, stateCode } }).then((b) => b.id);
  const [branchA, branchB, branchC] = [
    await branch('AA'),
    await branch('BB'),
    await branch('CC', '29'),
  ];
  const user = (username: string) =>
    prisma.user
      .create({
        data: { username, email: `${username}@example.com`, fullName: username, passwordHash: 'x' },
      })
      .then((u) => u.id);
  const [userSuper, userA, userB, userAB] = [
    await user('super'),
    await user('user_a'),
    await user('user_b'),
    await user('user_ab'),
  ];

  const category = await prisma.itemCategory.create({ data: { name: 'Vehicles' } });
  const item = await prisma.item.create({
    data: {
      itemCode: 'TOTO-1',
      name: 'TOTO',
      categoryId: category.id,
      unitCode: 'PCS',
      hsnCode: '8703',
      taxRate: '5',
      isSerialized: true,
    },
  });
  const customer = await prisma.customer.create({
    data: { name: 'Ravi', phone: '9000000001', stateCode: '27' },
  });
  const supplier = await prisma.supplier.create({ data: { name: 'Supplier One' } });

  const invoice = (branchId: string, no: string) =>
    prisma.invoice
      .create({
        data: {
          branchId,
          customerId: customer.id,
          type: 'GST',
          invoiceNo: no,
          status: 'ISSUED',
          total: '105',
          subtotal: '100',
          taxableValue: '100',
          cgstAmount: '2.5',
          sgstAmount: '2.5',
          placeOfSupply: '27',
          issuedOn: new Date('2026-10-01'),
          invoiceLines: {
            create: {
              branchId,
              itemId: item.id,
              qty: 1,
              amount: '105',
              unitPrice: '100',
              taxableAmount: '100',
            },
          },
        },
      })
      .then((i) => i.id);
  const invoiceA = await invoice(branchA, 'AAINV/2627/00001');
  const invoiceB = await invoice(branchB, 'BBINV/2627/00001');

  for (const [branchId, quantity] of [
    [branchA, 5],
    [branchB, 7],
  ] as const) {
    await prisma.stockBalance.create({
      data: { branchId, itemId: item.id, state: 'AVAILABLE', quantity },
    });
  }
  const serial = (branchId: string, serialNo: string) =>
    prisma.serialUnit
      .create({
        data: {
          branchId,
          itemId: item.id,
          serialNo,
          battery: {
            create: { expiryOn: new Date('2027-12-31'), manufacturedOn: new Date('2026-01-01') },
          },
        },
      })
      .then((s) => s.id);
  const serialA = await serial(branchA, 'SN-A-1');
  const serialB = await serial(branchB, 'SN-B-1');

  const transfer = (from: string, to: string, no: string) =>
    prisma.transfer
      .create({
        data: {
          transferNo: no,
          fromBranchId: from,
          toBranchId: to,
          transferLines: {
            create: {
              itemId: item.id,
              qtyRequested: 1,
              qtySent: 1,
              fromBranchId: from,
              toBranchId: to,
            },
          },
        },
      })
      .then((t) => t.id);
  const transferAB = await transfer(branchA, branchB, 'AATRF/2627/00001');
  const transferBC = await transfer(branchB, branchC, 'BBTRF/2627/00001');

  await prisma.notification.createMany({
    data: [
      { userId: userA, channel: 'IN_APP', message: 'for A' },
      { userId: userB, channel: 'IN_APP', message: 'for B' },
    ],
  });
  await prisma.auditLog.createMany({
    data: [
      { action: 'TEST_A', entityType: 'Invoice', branchId: branchA },
      { action: 'TEST_B', entityType: 'Invoice', branchId: branchB },
      { action: 'TEST_GLOBAL', entityType: 'User', branchId: null },
    ],
  });

  return {
    branchA,
    branchB,
    branchC,
    userSuper,
    userA,
    userB,
    userAB,
    itemId: item.id,
    customerId: customer.id,
    supplierId: supplier.id,
    invoiceA,
    invoiceB,
    serialA,
    serialB,
    transferAB,
    transferBC,
  };
}

export function contextFor(userId: string, branchIds: string[]): BranchContext {
  return { userId, branchIds, isSuperAdmin: false };
}

export function superContext(userId: string): BranchContext {
  return { userId, branchIds: [], isSuperAdmin: true };
}
