import type { NestExpressApplication } from '@nestjs/platform-express';
import { beforeAll, describe, expect, it } from 'vitest';
import { BranchContextService } from '../../src/common/branch-context/branch-context.service.js';
import { DocumentNumberService } from '../../src/common/document-number/document-number.service.js';
import {
  BranchAccessError,
  BusinessRuleError,
  NotFoundError,
} from '../../src/common/errors/domain-errors.js';
import { TransactionService } from '../../src/common/prisma/transaction.service.js';
import { createTestApp } from '../support/create-test-app.js';
import { contextFor, createOwnerPrisma, createWorld, superContext } from '../support/fixtures.js';
import type { World } from '../support/fixtures.js';

const OCT_2026 = new Date('2026-10-07T10:00:00+05:30');
const APRIL_2027 = new Date('2027-04-02T10:00:00+05:30');
const serialOf = (number: string): number => Number(number.split('/').at(-1));

describe('document numbers', () => {
  let app: NestExpressApplication;
  let w: World;
  let contexts: BranchContextService;
  let numbers: DocumentNumberService;
  let transactions: TransactionService;
  const owner = createOwnerPrisma();

  beforeAll(async () => {
    w = await createWorld(owner);
    app = await createTestApp();
    contexts = app.get(BranchContextService);
    numbers = app.get(DocumentNumberService);
    transactions = app.get(TransactionService);
    return async () => {
      await app.close();
      await owner.$disconnect();
    };
  });

  const asA = <T>(fn: () => Promise<T>): Promise<T> =>
    contexts.run(contextFor(w.userA, [w.branchA]), fn);
  const next = (
    docType: Parameters<DocumentNumberService['next']>[1]['docType'],
    date = OCT_2026,
    branchId = w.branchA,
  ): Promise<string> =>
    asA(() => transactions.run((tx) => numbers.next(tx, { branchId, docType, date })));
  const nextValue = async (
    docType: Parameters<DocumentNumberService['next']>[1]['docType'],
  ): Promise<number> =>
    (await owner.documentSequence.findFirstOrThrow({ where: { branchId: w.branchA, docType } }))
      .nextNumber;

  it('formats the number with the branch series, financial year and a padded serial', async () => {
    expect(await next('PURCHASE_ORDER')).toBe('AAPO/2627/00001');
    expect(await next('PURCHASE_ORDER')).toBe('AAPO/2627/00002');
  });

  it('stays unique and gap-free when many requests ask at the same moment', async () => {
    const results = await Promise.all(Array.from({ length: 30 }, () => next('INVOICE_GST')));
    expect(new Set(results).size).toBe(30);
    expect(results.map(serialOf).sort((a, b) => a - b)).toEqual(
      Array.from({ length: 30 }, (_, i) => i + 1),
    );
    expect(await nextValue('INVOICE_GST')).toBe(31);
  });

  it('leaves no gap when the transaction that took a number is rolled back', async () => {
    const first = await next('QUOTATION');
    await expect(
      asA(() =>
        transactions.run(async (tx) => {
          await numbers.next(tx, { branchId: w.branchA, docType: 'QUOTATION', date: OCT_2026 });
          throw new Error('invoice failed validation');
        }),
      ),
    ).rejects.toThrow('invoice failed validation');
    const second = await next('QUOTATION');
    expect(serialOf(second)).toBe(serialOf(first) + 1);
  });

  it('stays gap-free when some of many parallel transactions fail', async () => {
    const outcomes = await Promise.allSettled(
      Array.from({ length: 24 }, (_, i) =>
        asA(() =>
          transactions.run(async (tx) => {
            const number = await numbers.next(tx, {
              branchId: w.branchA,
              docType: 'CREDIT_NOTE',
              date: OCT_2026,
            });
            if (i % 3 === 0) throw new Error('rolled back');
            return number;
          }),
        ),
      ),
    );
    const issued = outcomes
      .flatMap((o) => (o.status === 'fulfilled' ? [serialOf(o.value)] : []))
      .sort((a, b) => a - b);
    expect(issued).toHaveLength(16);
    expect(issued).toEqual(Array.from({ length: 16 }, (_, i) => i + 1));
    expect(await nextValue('CREDIT_NOTE')).toBe(17);
  });

  it('keeps a separate series for each branch, document type and financial year', async () => {
    const inBranchB = await contexts.run(contextFor(w.userB, [w.branchB]), () =>
      transactions.run((tx) =>
        numbers.next(tx, { branchId: w.branchB, docType: 'PURCHASE_ORDER', date: OCT_2026 }),
      ),
    );
    expect(inBranchB).toBe('BBPO/2627/00001');
    expect(await next('GOODS_RECEIPT')).toBe('AAGRN/2627/00001');
    expect(await next('PURCHASE_ORDER', APRIL_2027)).toBe('AAPO/2728/00001');
    expect(serialOf(await next('PURCHASE_ORDER'))).toBe(3);
    expect(await next('PAYMENT_RECEIPT', new Date('2027-03-31T23:30:00+05:30'))).toBe(
      'AARCT/2627/00001',
    );
    expect(await next('PAYMENT_RECEIPT', new Date('2027-04-01T00:30:00+05:30'))).toBe(
      'AARCT/2728/00001',
    );
  });

  it('keeps GST and non-GST invoices in separate series', async () => {
    expect(await next('INVOICE_NON_GST')).toBe('AAN/2627/00001');
    expect(await next('INVOICE_NON_GST')).toBe('AAN/2627/00002');
  });

  it('keeps GST invoice numbers within the 16 characters the law allows, even for the longest branch code', async () => {
    const long = await owner.branch.create({
      data: { code: 'LNGB', name: 'Long code', stateCode: '27' },
    });
    const issue = (docType: 'INVOICE_GST' | 'CREDIT_NOTE') =>
      contexts.run(superContext(w.userSuper), () =>
        transactions.run((tx) => numbers.next(tx, { branchId: long.id, docType, date: OCT_2026 })),
      );
    expect(await issue('INVOICE_GST')).toBe('LNGBG/2627/00001');
    expect((await issue('CREDIT_NOTE')).length).toBeLessThanOrEqual(16);
  });

  it('refuses a series prefix that would push a GST number past 16 characters, and keeps the number free', async () => {
    const branch = await owner.branch.create({
      data: { code: 'PRE1', name: 'Prefix', stateCode: '27' },
    });
    const run = () =>
      contexts.run(superContext(w.userSuper), () =>
        transactions.run((tx) =>
          numbers.next(tx, { branchId: branch.id, docType: 'INVOICE_GST', date: OCT_2026 }),
        ),
      );
    await run();
    await owner.documentSequence.updateMany({
      where: { branchId: branch.id },
      data: { prefix: 'PRE1-HEAD-OFFICE-G' },
    });
    await expect(run()).rejects.toBeInstanceOf(BusinessRuleError);
    expect(
      (await owner.documentSequence.findFirstOrThrow({ where: { branchId: branch.id } }))
        .nextNumber,
    ).toBe(2);
  });

  it('refuses a branch the user does not work in, and a branch that does not exist', async () => {
    await expect(next('PURCHASE_ORDER', OCT_2026, w.branchB)).rejects.toBeInstanceOf(
      BranchAccessError,
    );
    await expect(
      contexts.run(superContext(w.userSuper), () =>
        transactions.run((tx) =>
          numbers.next(tx, {
            branchId: '00000000-0000-4000-8000-000000000000',
            docType: 'PURCHASE_ORDER',
            date: OCT_2026,
          }),
        ),
      ),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('records the next number so a restart continues the series', async () => {
    const issued = await next('GOODS_RECEIPT');
    expect(await nextValue('GOODS_RECEIPT')).toBe(serialOf(issued) + 1);
  });
});
