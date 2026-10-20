import { describe, expect, it } from 'vitest';
import {
  ApplyPaymentRequestSchema,
  DueListQuerySchema,
  LedgerQuerySchema,
  PaymentListQuerySchema,
  RecordPaymentRequestSchema,
  ReversePaymentRequestSchema,
  toPaise,
} from './payments.js';

const customerId = '0b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59';
const invoiceA = '1b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59';
const invoiceB = '2b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59';

const record = (overrides: Record<string, unknown> = {}) =>
  RecordPaymentRequestSchema.safeParse({
    customerId,
    mode: 'CASH',
    amount: '1000.00',
    paidOn: '2026-10-10',
    idempotencyKey: 'form-key-0001',
    ...overrides,
  });

describe('toPaise', () => {
  it('turns rupees into whole paise without rounding errors', () => {
    expect(toPaise('0.10') + toPaise('0.20')).toBe(30);
    expect(toPaise('19.99')).toBe(1999);
    expect(toPaise('5')).toBe(500);
    expect(toPaise('5.5')).toBe(550);
    expect(toPaise('123456789.99')).toBe(12345678999);
  });
});

describe('RecordPaymentRequestSchema', () => {
  it('accepts a payment with no allocation and defaults the allocation fields', () => {
    const result = record();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data.allocations).toEqual([]);
      expect(result.data.allocateAutomatically).toBe(false);
    }
  });

  it.each(['0', '0.00', '-5', '12.345', '1e3', '', 'abc', '1234567890'])(
    'rejects the amount %j',
    (amount) => {
      expect(record({ amount }).success).toBe(false);
    },
  );

  it('rejects a missing mode, a bad date and a short or missing retry key', () => {
    expect(record({ mode: '  ' }).success).toBe(false);
    expect(record({ paidOn: '2026-02-30' }).success).toBe(false);
    expect(record({ idempotencyKey: 'short' }).success).toBe(false);
    expect(record({ idempotencyKey: undefined }).success).toBe(false);
  });

  it('accepts allocations that add up to no more than the payment', () => {
    const ok = record({
      allocations: [
        { invoiceId: invoiceA, amount: '600.00' },
        { invoiceId: invoiceB, amount: '400.00' },
      ],
    });
    expect(ok.success).toBe(true);
  });

  it('rejects allocations above the payment, even by one paisa', () => {
    const result = record({
      allocations: [
        { invoiceId: invoiceA, amount: '600.00' },
        { invoiceId: invoiceB, amount: '400.01' },
      ],
    });
    expect(result.success).toBe(false);
    expect(JSON.stringify(result.error?.issues)).toContain('more than the payment');
  });

  it('adds decimals exactly when it compares allocations with the payment', () => {
    const result = record({
      amount: '0.30',
      allocations: [
        { invoiceId: invoiceA, amount: '0.10' },
        { invoiceId: invoiceB, amount: '0.20' },
      ],
    });
    expect(result.success).toBe(true);
  });

  it('rejects the same invoice twice and a zero allocation', () => {
    expect(
      record({
        allocations: [
          { invoiceId: invoiceA, amount: '1.00' },
          { invoiceId: invoiceA, amount: '2.00' },
        ],
      }).success,
    ).toBe(false);
    expect(record({ allocations: [{ invoiceId: invoiceA, amount: '0.00' }] }).success).toBe(false);
  });

  it('rejects asking for automatic allocation and naming invoices at once', () => {
    expect(
      record({
        allocateAutomatically: true,
        allocations: [{ invoiceId: invoiceA, amount: '1.00' }],
      }).success,
    ).toBe(false);
    expect(record({ allocateAutomatically: true }).success).toBe(true);
  });
});

describe('ApplyPaymentRequestSchema', () => {
  it('needs either invoices or automatic allocation, not neither and not both', () => {
    expect(ApplyPaymentRequestSchema.safeParse({}).success).toBe(false);
    expect(ApplyPaymentRequestSchema.safeParse({ allocateAutomatically: true }).success).toBe(true);
    expect(
      ApplyPaymentRequestSchema.safeParse({ allocations: [{ invoiceId: invoiceA, amount: '5' }] })
        .success,
    ).toBe(true);
    expect(
      ApplyPaymentRequestSchema.safeParse({
        allocateAutomatically: true,
        allocations: [{ invoiceId: invoiceA, amount: '5' }],
      }).success,
    ).toBe(false);
  });
});

describe('ReversePaymentRequestSchema', () => {
  it('needs a real reason', () => {
    expect(ReversePaymentRequestSchema.safeParse({ reason: 'ab' }).success).toBe(false);
    expect(ReversePaymentRequestSchema.safeParse({ reason: 'Cheque bounced' }).success).toBe(true);
  });
});

describe('list queries', () => {
  it('apply defaults and read the credit filter from text', () => {
    expect(PaymentListQuerySchema.parse({})).toMatchObject({ status: 'all', page: 1 });
    expect(PaymentListQuerySchema.parse({ withCredit: 'true', customerId }).withCredit).toBe(true);
    expect(PaymentListQuerySchema.safeParse({ withCredit: 'true' }).success).toBe(false);
    expect(PaymentListQuerySchema.safeParse({ withCredit: 'yes' }).success).toBe(false);
    expect(DueListQuerySchema.parse({}).scope).toBe('outstanding');
    expect(DueListQuerySchema.safeParse({ scope: 'everything' }).success).toBe(false);
    expect(LedgerQuerySchema.safeParse({ from: '2026-13-01' }).success).toBe(false);
  });
});
