import type { NestExpressApplication } from '@nestjs/platform-express';
import { beforeAll, describe, expect, it } from 'vitest';
import { AuditService } from '../../src/common/audit/audit.service.js';
import {
  BranchContextService,
  MissingBranchContextError,
} from '../../src/common/branch-context/branch-context.service.js';
import type { BranchContext } from '../../src/common/branch-context/branch-context.service.js';
import { OutboxService } from '../../src/common/outbox/outbox.service.js';
import { ScopedPrismaService } from '../../src/common/prisma/scoped-prisma.service.js';
import { TransactionService } from '../../src/common/prisma/transaction.service.js';
import { createTestApp } from '../support/create-test-app.js';
import { contextFor, createOwnerPrisma, createWorld, superContext } from '../support/fixtures.js';
import type { World } from '../support/fixtures.js';

describe('audit trail and outbox', () => {
  let app: NestExpressApplication;
  let w: World;
  let contexts: BranchContextService;
  let audit: AuditService;
  let outbox: OutboxService;
  let transactions: TransactionService;
  let db: ScopedPrismaService['client'];
  const owner = createOwnerPrisma();

  beforeAll(async () => {
    w = await createWorld(owner);
    app = await createTestApp();
    contexts = app.get(BranchContextService);
    audit = app.get(AuditService);
    outbox = app.get(OutboxService);
    transactions = app.get(TransactionService);
    db = app.get(ScopedPrismaService).client;
    return async () => {
      await app.close();
      await owner.$disconnect();
    };
  });

  const userA = (): BranchContext => ({
    ...contextFor(w.userA, [w.branchA]),
    ipAddress: '10.0.0.7',
    userAgent: 'vitest',
    requestId: 'req-77',
  });

  describe('audit log', () => {
    it('records who did what, where from, with the request id', async () => {
      await contexts.run(userA(), () =>
        transactions.run((tx) =>
          audit.record(tx, {
            action: 'INVOICE_ISSUED',
            entityType: 'Invoice',
            entityId: w.invoiceA,
            branchId: w.branchA,
            newValue: { total: '105.00' },
          }),
        ),
      );
      const row = await owner.auditLog.findFirstOrThrow({ where: { action: 'INVOICE_ISSUED' } });
      expect(row).toMatchObject({
        actorId: w.userA,
        branchId: w.branchA,
        entityType: 'Invoice',
        entityId: w.invoiceA,
        ipAddress: '10.0.0.7',
        userAgent: 'vitest',
        requestId: 'req-77',
      });
      expect(row.newValue).toEqual({ total: '105.00' });
    });

    it('keeps passwords, tokens and full KYC numbers out of the stored values', async () => {
      await contexts.run(userA(), () =>
        transactions.run((tx) =>
          audit.record(tx, {
            action: 'USER_UPDATED',
            entityType: 'User',
            branchId: w.branchA,
            oldValue: { fullName: 'Old', password: 'hunter2', passwordHash: '$argon2id$x' },
            newValue: {
              fullName: 'New',
              sessionToken: 'abc',
              kyc: { aadhaarNumber: '123412341234', type: 'AADHAAR' },
            },
          }),
        ),
      );
      const row = await owner.auditLog.findFirstOrThrow({ where: { action: 'USER_UPDATED' } });
      const stored = JSON.stringify([row.oldValue, row.newValue]);
      expect(stored).not.toMatch(/hunter2|argon2id|abc|123412341234/);
      expect(row.oldValue).toMatchObject({ fullName: 'Old' });
      expect(row.newValue).toMatchObject({ fullName: 'New', kyc: { type: 'AADHAAR' } });
    });

    it('is written in the same transaction as the change, so a rollback removes both', async () => {
      await expect(
        contexts.run(userA(), () =>
          transactions.run(async (tx) => {
            await audit.record(tx, {
              action: 'ROLLED_BACK',
              entityType: 'Invoice',
              branchId: w.branchA,
            });
            throw new Error('fail');
          }),
        ),
      ).rejects.toThrow('fail');
      expect(await owner.auditLog.count({ where: { action: 'ROLLED_BACK' } })).toBe(0);
    });

    it('accepts an event with no branch, such as a login, from any user', async () => {
      await contexts.run(userA(), () =>
        transactions.run((tx) =>
          audit.record(tx, { action: 'LOGIN', entityType: 'User', entityId: w.userA }),
        ),
      );
      expect(await owner.auditLog.count({ where: { action: 'LOGIN', branchId: null } })).toBe(1);
    });

    it('needs a request context to know who is acting', async () => {
      await expect(
        transactions.run((tx) => audit.record(tx, { action: 'X', entityType: 'Y' })),
      ).rejects.toBeInstanceOf(MissingBranchContextError);
    });

    it("shows a branch user their own branch's history only, and a Super Admin everything", async () => {
      const mine = await contexts.run(userA(), () =>
        db.auditLog.findMany({ where: { action: { in: ['INVOICE_ISSUED', 'LOGIN', 'TEST_B'] } } }),
      );
      expect(mine.map((r) => r.action)).toEqual(['INVOICE_ISSUED']);
      const all = await contexts.run(superContext(w.userSuper), () =>
        db.auditLog.findMany({ where: { action: { in: ['INVOICE_ISSUED', 'LOGIN', 'TEST_B'] } } }),
      );
      expect(all.map((r) => r.action).sort()).toEqual(['INVOICE_ISSUED', 'LOGIN', 'TEST_B']);
    });

    it('cannot be rewritten or erased through the application', async () => {
      const row = await owner.auditLog.findFirstOrThrow({ where: { action: 'INVOICE_ISSUED' } });
      await expect(
        contexts.run(userA(), () =>
          db.auditLog.update({ where: { id: row.id }, data: { action: 'FORGED' } }),
        ),
      ).rejects.toThrow(/permission denied|denied/i);
      await expect(
        contexts.run(userA(), () => db.auditLog.deleteMany({ where: { id: row.id } })),
      ).rejects.toThrow(/permission denied|denied/i);
      expect((await owner.auditLog.findUniqueOrThrow({ where: { id: row.id } })).action).toBe(
        'INVOICE_ISSUED',
      );
    });
  });

  describe('outbox', () => {
    it('stores a pending event with its payload and branch', async () => {
      const id = await contexts.run(userA(), () =>
        transactions.run((tx) =>
          outbox.enqueue(tx, {
            eventType: 'invoice.issued',
            payload: { invoiceId: w.invoiceA, total: '105.00' },
            branchId: w.branchA,
          }),
        ),
      );
      const row = await owner.outboxEvent.findUniqueOrThrow({ where: { id } });
      expect(row).toMatchObject({
        eventType: 'invoice.issued',
        status: 'PENDING',
        attempts: 0,
        branchId: w.branchA,
        processedAt: null,
      });
      expect(row.payload).toEqual({ invoiceId: w.invoiceA, total: '105.00' });
    });

    it('is committed with the business change or not at all', async () => {
      await expect(
        contexts.run(userA(), () =>
          transactions.run(async (tx) => {
            await outbox.enqueue(tx, { eventType: 'invoice.cancelled', payload: {} });
            throw new Error('fail');
          }),
        ),
      ).rejects.toThrow('fail');
      expect(await owner.outboxEvent.count({ where: { eventType: 'invoice.cancelled' } })).toBe(0);
    });

    it('cannot be read back by the application, only relayed by the worker', async () => {
      await expect(
        contexts.runAsSystem(() =>
          transactions.run((tx) => tx.$queryRaw`SELECT * FROM outbox_events`),
        ),
      ).rejects.toThrow(/denied/i);
    });
  });
});
