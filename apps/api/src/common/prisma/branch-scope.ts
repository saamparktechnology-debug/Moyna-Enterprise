import { BranchAccessError } from '../errors/domain-errors.js';
import { BusinessRuleError } from '../errors/domain-errors.js';
import type { BranchContext } from '../branch-context/branch-context.service.js';

export type Scope =
  | { kind: 'branch' }
  | { kind: 'transfer' }
  | { kind: 'audit' }
  | { kind: 'user' }
  | { kind: 'via'; relation: string };

const BRANCH_MODELS = [
  'SerialUnit',
  'StockLedger',
  'StockBalance',
  'StockAdjustment',
  'PurchaseReturn',
  'PurchaseReturnLine',
  'PurchaseOrder',
  'PoLine',
  'SupplierPayment',
  'GoodsReceipt',
  'ReceiptLine',
  'Discrepancy',
  'Lead',
  'LeadFollowup',
  'Commission',
  'Quotation',
  'Invoice',
  'InvoiceLine',
  'Exchange',
  'CreditNote',
  'CreditNoteLine',
  'PaymentAllocation',
  'Payment',
  'PaymentReversal',
  'LeadNote',
  'CommissionAdjustment',
  'QuotationLine',
  'QuotationBuildUpdate',
  'CustomerRefund',
  'Staff',
  'Attendance',
  'LeaveRequest',
  'PayrollRecord',
  'Approval',
  'Attachment',
  'DocumentSequence',
] as const;

export const MODEL_SCOPES: Readonly<Record<string, Scope>> = {
  ...Object.fromEntries(BRANCH_MODELS.map((model) => [model, { kind: 'branch' } as Scope])),
  Transfer: { kind: 'transfer' },
  TransferLine: { kind: 'transfer' },
  TransferEvent: { kind: 'transfer' },
  AuditLog: { kind: 'audit' },
  Notification: { kind: 'user' },
  Battery: { kind: 'via', relation: 'serialUnit' },
};

type Args = Record<string, unknown>;

const READ_OPERATIONS = new Set([
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'findUnique',
  'findUniqueOrThrow',
  'count',
  'aggregate',
  'groupBy',
]);
const WHERE_WRITE_OPERATIONS = new Set([
  'update',
  'updateMany',
  'updateManyAndReturn',
  'delete',
  'deleteMany',
  'upsert',
]);

function isRecord(value: unknown): value is Args {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function inList(ids: readonly string[]): { in: string[] } {
  return { in: [...ids] };
}

export function scopeCondition(scope: Scope, context: BranchContext): Args | null {
  if (context.isSuperAdmin) return null;
  switch (scope.kind) {
    case 'branch':
    case 'audit':
      return { branchId: inList(context.branchIds) };
    case 'transfer':
      return {
        OR: [
          { fromBranchId: inList(context.branchIds) },
          { toBranchId: inList(context.branchIds) },
        ],
      };
    case 'user':
      return { userId: context.userId ?? '' };
    case 'via':
      return { [scope.relation]: { branchId: inList(context.branchIds) } };
  }
}

function withCondition(where: unknown, condition: Args): Args {
  if (!isRecord(where)) return condition;
  const existing = where['AND'];
  const and = existing === undefined ? [] : Array.isArray(existing) ? existing : [existing];
  return { ...where, AND: [...and, condition] };
}

function assertAllowed(context: BranchContext, branchId: unknown): void {
  if (typeof branchId !== 'string' || !context.branchIds.includes(branchId)) {
    throw new BranchAccessError();
  }
}

function branchIdOf(row: Args, field: 'branchId' | 'fromBranchId' | 'toBranchId'): unknown {
  const direct = row[field];
  if (direct !== undefined) return direct;
  const relation = row[field.replace(/Id$/, '')];
  if (isRecord(relation) && isRecord(relation['connect'])) return relation['connect']['id'];
  return undefined;
}

function checkedRow(scope: Scope, row: Args, context: BranchContext): Args {
  if (context.isSuperAdmin) return row;
  if (scope.kind === 'branch') {
    const given = branchIdOf(row, 'branchId');
    if (given !== undefined) {
      assertAllowed(context, given);
      return row;
    }
    if (context.branchIds.length === 1) return { ...row, branchId: context.branchIds[0] };
    throw new BusinessRuleError('branchId is required when the user works in several branches', [
      { field: 'branchId', message: 'Choose the branch for this record' },
    ]);
  }
  if (scope.kind === 'transfer') {
    const from = branchIdOf(row, 'fromBranchId');
    const to = branchIdOf(row, 'toBranchId');
    const allowed = [from, to].some(
      (id) => typeof id === 'string' && context.branchIds.includes(id),
    );
    if (!allowed) throw new BranchAccessError();
  }
  return row;
}

function checkedData(scope: Scope, data: unknown, context: BranchContext): unknown {
  if (Array.isArray(data))
    return data.map((row) => (isRecord(row) ? checkedRow(scope, row, context) : row));
  return isRecord(data) ? checkedRow(scope, data, context) : data;
}

function assertNotMoved(scope: Scope, data: unknown, context: BranchContext): void {
  if (context.isSuperAdmin || scope.kind !== 'branch' || !isRecord(data)) return;
  const given = branchIdOf(data, 'branchId');
  if (given !== undefined) assertAllowed(context, given);
}

export function scopeArgs(
  model: string,
  operation: string,
  args: unknown,
  context: BranchContext,
): Args {
  const base: Args = isRecord(args) ? { ...args } : {};
  const scope = MODEL_SCOPES[model];
  if (!scope) return base;
  const condition = scopeCondition(scope, context);

  if (READ_OPERATIONS.has(operation)) {
    return condition ? { ...base, where: withCondition(base['where'], condition) } : base;
  }
  if (WHERE_WRITE_OPERATIONS.has(operation)) {
    const scoped = condition ? { ...base, where: withCondition(base['where'], condition) } : base;
    if (operation === 'upsert') {
      return {
        ...scoped,
        create: checkedData(scope, scoped['create'], context),
        update: (assertNotMoved(scope, scoped['update'], context), scoped['update']),
      };
    }
    assertNotMoved(scope, scoped['data'], context);
    return scoped;
  }
  if (operation === 'create' || operation === 'createMany' || operation === 'createManyAndReturn') {
    return { ...base, data: checkedData(scope, base['data'], context) };
  }
  return base;
}
