import type { NestExpressApplication } from '@nestjs/platform-express';
import type { Prisma } from '@prisma/client';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  BranchContextService,
  MissingBranchContextError,
} from '../../src/common/branch-context/branch-context.service.js';
import type { BranchContext } from '../../src/common/branch-context/branch-context.service.js';
import { BranchAccessError, BusinessRuleError } from '../../src/common/errors/domain-errors.js';
import { ScopedPrismaService } from '../../src/common/prisma/scoped-prisma.service.js';
import { TransactionService } from '../../src/common/prisma/transaction.service.js';
import { createTestApp } from '../support/create-test-app.js';
import { contextFor, createOwnerPrisma, createWorld, superContext } from '../support/fixtures.js';
import type { World } from '../support/fixtures.js';

describe('branch isolation through the application', () => {
  let app: NestExpressApplication;
  let w: World;
  let contexts: BranchContextService;
  let db: ScopedPrismaService['client'];
  let transactions: TransactionService;
  const owner = createOwnerPrisma();

  const as = <T>(context: BranchContext, fn: () => Promise<T>): Promise<T> =>
    contexts.run(context, fn);
  const userA = (): BranchContext => contextFor(w.userA, [w.branchA]);
  const userB = (): BranchContext => contextFor(w.userB, [w.branchB]);
  const userAB = (): BranchContext => contextFor(w.userAB, [w.branchA, w.branchB]);
  const ids = (rows: { id: string }[]): string[] => rows.map((r) => r.id).sort();

  beforeAll(async () => {
    w = await createWorld(owner);
    app = await createTestApp();
    contexts = app.get(BranchContextService);
    db = app.get(ScopedPrismaService).client;
    transactions = app.get(TransactionService);
    return async () => {
      await app.close();
      await owner.$disconnect();
    };
  });

  describe('without or with the wrong context', () => {
    it('fails closed when no branch context is active', async () => {
      await expect(db.invoice.findMany()).rejects.toBeInstanceOf(MissingBranchContextError);
      await expect(transactions.run(async (tx) => tx.invoice.findMany())).rejects.toBeInstanceOf(
        MissingBranchContextError,
      );
    });

    it('returns nothing for a user who has no branches', async () => {
      expect(await as(contextFor(w.userA, []), () => db.invoice.findMany())).toEqual([]);
    });

    it("does not leak one request's branches into another running at the same time", async () => {
      const read = (context: BranchContext) =>
        as(context, async () => {
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 20));
          const first = ids(await db.invoice.findMany());
          await new Promise((resolve) => setTimeout(resolve, Math.random() * 20));
          return [first, ids(await db.invoice.findMany())];
        });
      const results = await Promise.all([userA(), userB(), userA(), userB(), userAB()].map(read));
      expect(results.map((r) => r[0])).toEqual([
        [w.invoiceA],
        [w.invoiceB],
        [w.invoiceA],
        [w.invoiceB],
        [w.invoiceA, w.invoiceB].sort(),
      ]);
      for (const [first, second] of results) expect(second).toEqual(first);
    });
  });

  describe('reads', () => {
    it("returns only the rows of the user's branches", async () => {
      expect(ids(await as(userA(), () => db.invoice.findMany()))).toEqual([w.invoiceA]);
      expect(ids(await as(userB(), () => db.invoice.findMany()))).toEqual([w.invoiceB]);
      expect(ids(await as(userAB(), () => db.invoice.findMany()))).toEqual(
        [w.invoiceA, w.invoiceB].sort(),
      );
      expect(ids(await as(superContext(w.userSuper), () => db.invoice.findMany()))).toEqual(
        [w.invoiceA, w.invoiceB].sort(),
      );
    });

    it("treats another branch's row as not found, however it is looked up", async () => {
      const lookups = await as(userA(), async () => [
        await db.invoice.findUnique({ where: { id: w.invoiceB } }),
        await db.invoice.findFirst({ where: { id: w.invoiceB } }),
        await db.invoice.findFirst({
          where: { OR: [{ id: w.invoiceB }, { branchId: w.branchB }] },
        }),
        await db.invoice.count({ where: { id: w.invoiceB } }),
      ]);
      expect(lookups).toEqual([null, null, null, 0]);
    });

    it('scopes counts, aggregates and groupings', async () => {
      const [count, sum, groups] = await as(
        userA(),
        async () =>
          [
            await db.invoice.count(),
            await db.invoice.aggregate({ _sum: { total: true } }),
            await db.invoice.groupBy({ by: ['branchId'], _count: true }),
          ] as const,
      );
      expect(count).toBe(1);
      expect(sum._sum.total?.toString()).toBe('105');
      expect(groups.map((g) => g.branchId)).toEqual([w.branchA]);
    });

    it("does not show another branch's rows through relations", async () => {
      const item = await as(userA(), () =>
        db.item.findUniqueOrThrow({
          where: { id: w.itemId },
          include: {
            stockBalances: true,
            invoiceLines: true,
            serialUnits: { include: { battery: true } },
          },
        }),
      );
      expect(item.stockBalances.map((b) => b.branchId)).toEqual([w.branchA]);
      expect(item.invoiceLines.map((l) => l.branchId)).toEqual([w.branchA]);
      expect(item.serialUnits.map((s) => s.id)).toEqual([w.serialA]);
      expect(item.serialUnits[0]?.battery).not.toBeNull();

      const branches = await as(userA(), () => db.branch.findMany({ include: { invoices: true } }));
      expect(branches).toHaveLength(3);
      expect(branches.flatMap((b) => b.invoices.map((i) => i.id))).toEqual([w.invoiceA]);

      const customer = await as(userB(), () =>
        db.customer.findUniqueOrThrow({
          where: { id: w.customerId },
          include: { invoices: { include: { invoiceLines: true } } },
        }),
      );
      expect(customer.invoices.map((i) => i.id)).toEqual([w.invoiceB]);
      expect(customer.invoices[0]?.invoiceLines.map((l) => l.branchId)).toEqual([w.branchB]);
    });

    it('shares customers and other masters across branches', async () => {
      expect(await as(userA(), () => db.customer.count())).toBe(1);
      expect(await as(userB(), () => db.customer.count())).toBe(1);
      expect(await as(userA(), () => db.item.count())).toBe(1);
    });

    it('shows a battery only to the branch holding its serial unit', async () => {
      expect((await as(userA(), () => db.battery.findMany())).map((b) => b.serialUnitId)).toEqual([
        w.serialA,
      ]);
      expect((await as(userB(), () => db.battery.findMany())).map((b) => b.serialUnitId)).toEqual([
        w.serialB,
      ]);
      expect(await as(contextFor(w.userA, [w.branchC]), () => db.battery.findMany())).toEqual([]);
    });

    it('shows a transfer to the sending and receiving branch, but not to a third', async () => {
      const visible = async (branchId: string) =>
        ids(await as(contextFor(w.userAB, [branchId]), () => db.transfer.findMany()));
      expect(await visible(w.branchA)).toEqual([w.transferAB]);
      expect(await visible(w.branchB)).toEqual([w.transferAB, w.transferBC].sort());
      expect(await visible(w.branchC)).toEqual([w.transferBC]);
      const withLines = await as(userA(), () =>
        db.transfer.findMany({ include: { transferLines: true } }),
      );
      expect(withLines.flatMap((t) => t.transferLines).length).toBe(1);
    });

    it('shows a user only their own notifications, including through relations', async () => {
      expect((await as(userA(), () => db.notification.findMany())).map((n) => n.message)).toEqual([
        'for A',
      ]);
      expect(await as(superContext(w.userSuper), () => db.notification.findMany())).toEqual([]);
      const users = await as(userA(), () => db.user.findMany({ include: { notifications: true } }));
      expect(users.flatMap((u) => u.notifications.map((n) => n.message))).toEqual(['for A']);
    });

    it('applies the row-level security settings to raw SQL only inside a transaction', async () => {
      const inside = await as(userA(), () =>
        transactions.run(
          (tx) => tx.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM invoices`,
        ),
      );
      expect(inside[0]?.n).toBe(1);
      const outside = await as(
        userA(),
        () => db.$queryRaw<{ n: number }[]>`SELECT count(*)::int AS n FROM invoices`,
      );
      expect(outside[0]?.n).toBe(0);
    });
  });

  describe('writes', () => {
    it("never changes or deletes another branch's row, even when asked by id", async () => {
      await as(userA(), async () => {
        await expect(
          db.invoice.update({
            where: { id: w.invoiceB },
            data: { dueDate: new Date('2030-01-01') },
          }),
        ).rejects.toThrow();
        expect(
          (
            await db.invoice.updateMany({
              where: { id: w.invoiceB },
              data: { dueDate: new Date('2030-01-01') },
            })
          ).count,
        ).toBe(0);
        await expect(
          db.invoice.update({ where: { id: w.invoiceB }, data: { branchId: w.branchA } }),
        ).rejects.toThrow();
      });
      const row = await owner.invoice.findUniqueOrThrow({ where: { id: w.invoiceB } });
      expect(row.branchId).toBe(w.branchB);
      expect(row.dueDate).toBeNull();
    });

    it("lets a user change their own branch's row", async () => {
      const updated = await as(userA(), () =>
        db.invoice.update({ where: { id: w.invoiceA }, data: { dueDate: new Date('2026-12-31') } }),
      );
      expect(updated.dueDate?.toISOString().slice(0, 10)).toBe('2026-12-31');
    });

    it('refuses to create or move a row into a branch the user does not have', async () => {
      const data = { customerId: w.customerId, type: 'NON_GST' as const };
      await expect(
        as(userA(), () => db.invoice.create({ data: { ...data, branchId: w.branchB } })),
      ).rejects.toBeInstanceOf(BranchAccessError);
      await expect(
        as(userA(), () =>
          db.invoice.update({ where: { id: w.invoiceA }, data: { branchId: w.branchB } }),
        ),
      ).rejects.toBeInstanceOf(BranchAccessError);
      await expect(
        as(userA(), () =>
          db.invoice.createMany({
            data: [
              { ...data, branchId: w.branchA },
              { ...data, branchId: w.branchC },
            ],
          }),
        ),
      ).rejects.toBeInstanceOf(BranchAccessError);
      expect(await owner.invoice.count({ where: { branchId: w.branchC } })).toBe(0);
    });

    it('puts a new row in the only branch of a single-branch user, and asks a multi-branch user to choose', async () => {
      const created = await as(userA(), () =>
        db.invoice.create({
          data: { customerId: w.customerId, type: 'NON_GST' } as Prisma.InvoiceUncheckedCreateInput,
        }),
      );
      expect(created.branchId).toBe(w.branchA);
      await expect(
        as(userAB(), () =>
          db.invoice.create({
            data: {
              customerId: w.customerId,
              type: 'NON_GST',
            } as Prisma.InvoiceUncheckedCreateInput,
          }),
        ),
      ).rejects.toBeInstanceOf(BusinessRuleError);
      const chosen = await as(userAB(), () =>
        db.invoice.create({
          data: { customerId: w.customerId, type: 'NON_GST', branchId: w.branchB },
        }),
      );
      expect(chosen.branchId).toBe(w.branchB);
    });

    it('lets a Super Admin write in any branch', async () => {
      const created = await as(superContext(w.userSuper), () =>
        db.invoice.create({
          data: { customerId: w.customerId, type: 'NON_GST', branchId: w.branchC },
        }),
      );
      expect(created.branchId).toBe(w.branchC);
    });

    it('does not let the database itself accept a write the application filter missed', async () => {
      await expect(
        as(userA(), () =>
          transactions.run(
            (tx) =>
              tx.$executeRaw`INSERT INTO invoices (branch_id, customer_id, type) VALUES (${w.branchB}::uuid, ${w.customerId}::uuid, 'NON_GST')`,
          ),
        ),
      ).rejects.toThrow();
    });
  });

  describe('transactions', () => {
    it('commits everything or nothing', async () => {
      const make = (no: string) => ({
        branchId: w.branchA,
        customerId: w.customerId,
        type: 'NON_GST' as const,
        invoiceNo: no,
        status: 'ISSUED' as const,
      });
      await as(userA(), () =>
        transactions.run(async (tx) => {
          await tx.invoice.create({ data: make('TX-1') });
          await tx.invoice.create({ data: make('TX-2') });
        }),
      );
      await expect(
        as(userA(), () =>
          transactions.run(async (tx) => {
            await tx.invoice.create({ data: make('TX-3') });
            throw new Error('boom');
          }),
        ),
      ).rejects.toThrow('boom');
      const numbers = (
        await owner.invoice.findMany({ where: { invoiceNo: { startsWith: 'TX-' } } })
      )
        .map((i) => i.invoiceNo)
        .sort();
      expect(numbers).toEqual(['TX-1', 'TX-2']);
    });

    it('keeps the branch filter and security settings inside the transaction, including relations', async () => {
      const seen = await as(userA(), () =>
        transactions.run(async (tx) => {
          const direct = ids(await tx.invoice.findMany());
          const nested = await tx.item.findUniqueOrThrow({
            where: { id: w.itemId },
            include: { stockBalances: true },
          });
          return { direct, balances: nested.stockBalances.map((b) => b.branchId) };
        }),
      );
      expect(seen).toEqual({ direct: expect.arrayContaining([w.invoiceA]), balances: [w.branchA] });
      expect(seen.direct).not.toContain(w.invoiceB);
    });

    it('runs system work across all branches when explicitly asked to', async () => {
      const all = await contexts.runAsSystem(() => db.invoice.count());
      expect(all).toBeGreaterThanOrEqual(2);
    });
  });
});
