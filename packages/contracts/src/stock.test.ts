import { describe, expect, it } from 'vitest';
import {
  ADJUSTMENT_ADMIN_APPROVAL_LIMIT,
  AdjustmentListQuerySchema,
  CreateStockAdjustmentRequestSchema,
  MovementQuerySchema,
  RejectAdjustmentRequestSchema,
  StockBalanceQuerySchema,
} from './stock.js';

const item = '11111111-1111-4111-8111-111111111111';
const base = { itemId: item, kind: 'IN', reason: 'Opening stock' } as const;
const parse = (over: object) => CreateStockAdjustmentRequestSchema.safeParse({ ...base, ...over });

describe('asking for a stock adjustment', () => {
  it('defaults to one piece of available stock and tidies the reason', () => {
    expect(
      CreateStockAdjustmentRequestSchema.parse({ ...base, reason: '  Counted  ' }),
    ).toMatchObject({
      state: 'AVAILABLE',
      qty: 1,
      reason: 'Counted',
    });
  });

  it('needs a real reason, a whole quantity of at least one, and a known item', () => {
    expect(parse({ reason: 'ab' }).success).toBe(false);
    expect(parse({ qty: 0 }).success).toBe(false);
    expect(parse({ qty: 1.5 }).success).toBe(false);
    expect(parse({ qty: 100_001 }).success).toBe(false);
    expect(parse({ itemId: 'nope' }).success).toBe(false);
    expect(parse({ state: 'SOLD' }).success).toBe(false);
  });

  it('asks a state change for a different target state, and nobody else', () => {
    expect(parse({ kind: 'STATE_CHANGE' }).success).toBe(false);
    expect(parse({ kind: 'STATE_CHANGE', toState: 'AVAILABLE' }).success).toBe(false);
    expect(parse({ kind: 'STATE_CHANGE', toState: 'DAMAGED' }).success).toBe(true);
    expect(parse({ kind: 'OUT', toState: 'DAMAGED' }).success).toBe(false);
  });

  it('keeps serial numbers to one piece, to stock coming in, and tidied', () => {
    expect(parse({ serialNo: ' ab-123 ' }).data?.serialNo).toBe('AB-123');
    expect(parse({ serialNo: 'AB-123', qty: 2 }).success).toBe(false);
    expect(parse({ kind: 'OUT', serialNo: 'AB-123' }).success).toBe(false);
    expect(parse({ serialNo: 'x' }).success).toBe(false);
    expect(parse({ chassisNo: 'CH-12345' }).success).toBe(false);
    expect(parse({ serialNo: 'AB-123', chassisNo: 'CH-12345' }).success).toBe(true);
    expect(parse({ kind: 'OUT', serialUnitId: item }).success).toBe(true);
    expect(parse({ kind: 'OUT', serialUnitId: item, qty: 3 }).success).toBe(false);
    expect(parse({ serialUnitId: item }).success).toBe(false);
  });
});

describe('deciding an adjustment', () => {
  it('needs a reason to reject but not to approve', () => {
    expect(RejectAdjustmentRequestSchema.safeParse({ rowVersion: 1 }).success).toBe(false);
    expect(RejectAdjustmentRequestSchema.safeParse({ rowVersion: 1, note: 'no' }).success).toBe(
      false,
    );
    expect(
      RejectAdjustmentRequestSchema.safeParse({ rowVersion: 1, note: 'Not needed' }).success,
    ).toBe(true);
  });

  it('puts the Admin approval limit at ten units', () => {
    expect(ADJUSTMENT_ADMIN_APPROVAL_LIMIT).toBe(10);
  });
});

describe('stock queries', () => {
  it('has safe defaults and rejects unknown choices', () => {
    expect(StockBalanceQuerySchema.parse({})).toMatchObject({
      page: 1,
      pageSize: 25,
      lowOnly: false,
    });
    expect(StockBalanceQuerySchema.parse({ lowOnly: 'true' }).lowOnly).toBe(true);
    expect(StockBalanceQuerySchema.safeParse({ lowOnly: 'maybe' }).success).toBe(false);
    expect(AdjustmentListQuerySchema.parse({}).status).toBe('PENDING');
    expect(AdjustmentListQuerySchema.safeParse({ status: 'DELETED' }).success).toBe(false);
    expect(MovementQuerySchema.safeParse({ movementType: 'THEFT' }).success).toBe(false);
    expect(MovementQuerySchema.parse({ from: '2026-10-01' }).from).toBeInstanceOf(Date);
  });
});
