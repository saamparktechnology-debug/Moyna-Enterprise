import { describe, expect, it } from 'vitest';
import { BranchAccessError, BusinessRuleError } from '../errors/domain-errors.js';
import type { BranchContext } from '../branch-context/branch-context.service.js';
import { MODEL_SCOPES, scopeArgs } from './branch-scope.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';
const C = '33333333-3333-4333-8333-333333333333';

const userA: BranchContext = { userId: 'u1', branchIds: [A], isSuperAdmin: false };
const userAB: BranchContext = { userId: 'u2', branchIds: [A, B], isSuperAdmin: false };
const superAdmin: BranchContext = { userId: 'u3', branchIds: [], isSuperAdmin: true };

describe('scopeArgs reads', () => {
  it('adds the branch filter to a query with no filter', () => {
    expect(scopeArgs('Invoice', 'findMany', {}, userAB)).toEqual({
      where: { branchId: { in: [A, B] } },
    });
  });

  it('keeps the existing filter and the caller cannot widen it with OR', () => {
    const result = scopeArgs(
      'Invoice',
      'findMany',
      { where: { OR: [{ branchId: C }, { status: 'ISSUED' }] } },
      userA,
    );
    expect(result['where']).toEqual({
      OR: [{ branchId: C }, { status: 'ISSUED' }],
      AND: [{ branchId: { in: [A] } }],
    });
  });

  it('appends to an existing AND instead of replacing it', () => {
    const result = scopeArgs(
      'Invoice',
      'findFirst',
      { where: { AND: [{ status: 'ISSUED' }] } },
      userA,
    );
    expect(result['where']).toEqual({ AND: [{ status: 'ISSUED' }, { branchId: { in: [A] } }] });
  });

  it.each(['findUnique', 'findUniqueOrThrow', 'findFirstOrThrow', 'count', 'aggregate', 'groupBy'])(
    'scopes %s',
    (operation) => {
      expect(scopeArgs('Payment', operation, { where: { id: 'x' } }, userA)['where']).toEqual({
        id: 'x',
        AND: [{ branchId: { in: [A] } }],
      });
    },
  );

  it('matches nothing for a user with no branches', () => {
    const none: BranchContext = { userId: 'u', branchIds: [], isSuperAdmin: false };
    expect(scopeArgs('Invoice', 'findMany', {}, none)['where']).toEqual({ branchId: { in: [] } });
  });

  it('does not touch the query for a Super Admin or an unscoped model', () => {
    expect(scopeArgs('Invoice', 'findMany', { where: { id: 'x' } }, superAdmin)).toEqual({
      where: { id: 'x' },
    });
    expect(scopeArgs('Item', 'findMany', {}, userA)).toEqual({});
  });

  it('scopes transfers to either end, notifications to the user, batteries through their unit', () => {
    expect(scopeArgs('Transfer', 'findMany', {}, userA)['where']).toEqual({
      OR: [{ fromBranchId: { in: [A] } }, { toBranchId: { in: [A] } }],
    });
    expect(scopeArgs('Notification', 'findMany', {}, userA)['where']).toEqual({ userId: 'u1' });
    expect(scopeArgs('Battery', 'findMany', {}, userA)['where']).toEqual({
      serialUnit: { branchId: { in: [A] } },
    });
  });

  it('does not mutate the arguments it was given', () => {
    const args = Object.freeze({ where: Object.freeze({ status: 'ISSUED' }) });
    expect(() => scopeArgs('Invoice', 'findMany', args, userA)).not.toThrow();
    expect(args.where).toEqual({ status: 'ISSUED' });
  });
});

describe('scopeArgs writes', () => {
  it('scopes the where of updates and deletes', () => {
    for (const operation of ['update', 'updateMany', 'delete', 'deleteMany']) {
      expect(
        scopeArgs(
          'Invoice',
          operation,
          { where: { id: 'x' }, data: { status: 'CANCELLED' } },
          userA,
        )['where'],
      ).toEqual({
        id: 'x',
        AND: [{ branchId: { in: [A] } }],
      });
    }
  });

  it('refuses to move a row to a branch the user does not have', () => {
    expect(() =>
      scopeArgs('Invoice', 'update', { where: { id: 'x' }, data: { branchId: C } }, userA),
    ).toThrowError(BranchAccessError);
    expect(() =>
      scopeArgs('Invoice', 'update', { where: { id: 'x' }, data: { branchId: A } }, userA),
    ).not.toThrow();
  });

  it('fills in the only branch of a single-branch user on create', () => {
    expect(scopeArgs('Invoice', 'create', { data: { total: 1 } }, userA)['data']).toEqual({
      total: 1,
      branchId: A,
    });
  });

  it('requires a branch for a multi-branch user and rejects a foreign one', () => {
    expect(() => scopeArgs('Invoice', 'create', { data: {} }, userAB)).toThrowError(
      BusinessRuleError,
    );
    expect(() => scopeArgs('Invoice', 'create', { data: { branchId: C } }, userAB)).toThrowError(
      BranchAccessError,
    );
    expect(() => scopeArgs('Invoice', 'create', { data: { branchId: B } }, userAB)).not.toThrow();
  });

  it('checks the branch given through a relation connect', () => {
    expect(() =>
      scopeArgs('Invoice', 'create', { data: { branch: { connect: { id: C } } } }, userA),
    ).toThrowError(BranchAccessError);
    expect(() =>
      scopeArgs('Invoice', 'create', { data: { branch: { connect: { id: A } } } }, userA),
    ).not.toThrow();
  });

  it('checks every row of a bulk create', () => {
    expect(() =>
      scopeArgs('Payment', 'createMany', { data: [{ branchId: A }, { branchId: C }] }, userAB),
    ).toThrowError(BranchAccessError);
    expect(scopeArgs('Payment', 'createMany', { data: [{}, {}] }, userA)['data']).toEqual([
      { branchId: A },
      { branchId: A },
    ]);
  });

  it('checks both the create and the update side of an upsert', () => {
    const result = scopeArgs(
      'Invoice',
      'upsert',
      { where: { id: 'x' }, create: {}, update: { total: 2 } },
      userA,
    );
    expect(result['create']).toEqual({ branchId: A });
    expect(result['where']).toEqual({ id: 'x', AND: [{ branchId: { in: [A] } }] });
    expect(() =>
      scopeArgs(
        'Invoice',
        'upsert',
        { where: { id: 'x' }, create: { branchId: C }, update: {} },
        userA,
      ),
    ).toThrowError(BranchAccessError);
  });

  it('requires a transfer to involve one of the user branches', () => {
    expect(() =>
      scopeArgs('Transfer', 'create', { data: { fromBranchId: B, toBranchId: C } }, userA),
    ).toThrowError(BranchAccessError);
    expect(() =>
      scopeArgs('Transfer', 'create', { data: { fromBranchId: B, toBranchId: A } }, userA),
    ).not.toThrow();
  });

  it('lets a Super Admin write anywhere', () => {
    expect(scopeArgs('Invoice', 'create', { data: { branchId: C } }, superAdmin)['data']).toEqual({
      branchId: C,
    });
  });
});

describe('MODEL_SCOPES', () => {
  it('covers 42 scoped models', () => {
    expect(Object.keys(MODEL_SCOPES)).toHaveLength(42);
  });
});
