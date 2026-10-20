import { describe, expect, it } from 'vitest';
import {
  CancelInvoiceRequestSchema,
  CreateInvoiceRequestSchema,
  DISCOUNT_STAFF_LIMIT_PERCENT,
  InvoiceLineInputSchema,
  InvoiceListQuerySchema,
  IssueInvoiceRequestSchema,
  MAX_INVOICE_LINES,
  MoneyAmountSchema,
  UpdateInvoiceRequestSchema,
} from './billing.js';

const customer = '11111111-1111-4111-8111-111111111111';
const item = '22222222-2222-4222-8222-222222222222';
const unitA = '33333333-3333-4333-8333-333333333333';
const unitB = '44444444-4444-4444-8444-444444444444';
const line = (over: object = {}) => ({ itemId: item, qty: 1, unitPrice: '100.00', ...over });
const create = (over: object = {}) =>
  CreateInvoiceRequestSchema.safeParse({
    customerId: customer,
    type: 'GST',
    lines: [line()],
    ...over,
  });

describe('money amounts', () => {
  it('accepts rupees with up to two decimals and nothing else', () => {
    for (const good of ['0', '5', '100.5', '100.50', '999999999.99'])
      expect(MoneyAmountSchema.safeParse(good).success, good).toBe(true);
    for (const bad of ['', '-1', '1.234', '1,000', 'abc', '1e3', '1000000000', ' '])
      expect(MoneyAmountSchema.safeParse(bad).success, bad).toBe(false);
    expect(MoneyAmountSchema.parse(' 12.50 ')).toBe('12.50');
  });
});

describe('an invoice line', () => {
  it('defaults the discount to nothing', () => {
    expect(InvoiceLineInputSchema.parse(line()).discountAmount).toBe('0.00');
  });

  it('needs a whole quantity from 1 to 10000', () => {
    for (const qty of [0, -1, 1.5, 10_001])
      expect(InvoiceLineInputSchema.safeParse(line({ qty })).success, String(qty)).toBe(false);
    expect(InvoiceLineInputSchema.safeParse(line({ qty: 10_000 })).success).toBe(true);
  });

  it('sells a unit tracked by serial number one at a time', () => {
    expect(InvoiceLineInputSchema.safeParse(line({ serialUnitId: unitA, qty: 1 })).success).toBe(
      true,
    );
    const many = InvoiceLineInputSchema.safeParse(line({ serialUnitId: unitA, qty: 2 }));
    expect(many.success).toBe(false);
    expect(many.error?.issues[0]?.path).toEqual(['qty']);
  });

  it('needs a real item id and a price', () => {
    expect(InvoiceLineInputSchema.safeParse(line({ itemId: 'nope' })).success).toBe(false);
    expect(InvoiceLineInputSchema.safeParse(line({ unitPrice: undefined })).success).toBe(false);
    expect(InvoiceLineInputSchema.safeParse(line({ unitPrice: '-5' })).success).toBe(false);
  });
});

describe('creating and editing an invoice', () => {
  it('needs a customer, a type and between 1 and 100 lines', () => {
    expect(create().success).toBe(true);
    expect(create({ customerId: 'nope' }).success).toBe(false);
    expect(create({ type: 'EXPORT' }).success).toBe(false);
    expect(create({ lines: [] }).success).toBe(false);
    expect(create({ lines: Array.from({ length: MAX_INVOICE_LINES }, () => line()) }).success).toBe(
      true,
    );
    expect(
      create({ lines: Array.from({ length: MAX_INVOICE_LINES + 1 }, () => line()) }).success,
    ).toBe(false);
  });

  it('refuses the same serial unit twice and points at the second one', () => {
    const result = create({
      lines: [
        line({ serialUnitId: unitA }),
        line({ serialUnitId: unitB }),
        line({ serialUnitId: unitA }),
      ],
    });
    expect(result.success).toBe(false);
    expect(result.error?.issues[0]?.path).toEqual(['lines', 2, 'serialUnitId']);
    expect(
      create({ lines: [line({ serialUnitId: unitA }), line({ serialUnitId: unitB })] }).success,
    ).toBe(true);
  });

  it('accepts a real due date only, and a branch only as an id', () => {
    expect(create({ dueDate: '2026-11-30' }).success).toBe(true);
    expect(create({ dueDate: '2026-02-30' }).success).toBe(false);
    expect(create({ branchId: 'nope' }).success).toBe(false);
  });

  it('needs the version that was read when editing', () => {
    const body = { customerId: customer, type: 'NON_GST', lines: [line()] };
    expect(UpdateInvoiceRequestSchema.safeParse(body).success).toBe(false);
    expect(UpdateInvoiceRequestSchema.safeParse({ ...body, rowVersion: 0 }).success).toBe(false);
    expect(UpdateInvoiceRequestSchema.safeParse({ ...body, rowVersion: 3 }).success).toBe(true);
  });
});

describe('issuing and cancelling', () => {
  it('needs the version, and a reason of at least 3 characters when cancelling', () => {
    expect(IssueInvoiceRequestSchema.safeParse({}).success).toBe(false);
    expect(IssueInvoiceRequestSchema.safeParse({ rowVersion: 2 }).success).toBe(true);
    expect(
      IssueInvoiceRequestSchema.safeParse({ rowVersion: 2, overrideReason: 'ab' }).success,
    ).toBe(false);
    expect(CancelInvoiceRequestSchema.safeParse({ rowVersion: 2 }).success).toBe(false);
    expect(CancelInvoiceRequestSchema.safeParse({ rowVersion: 2, reason: 'ab' }).success).toBe(
      false,
    );
    expect(
      CancelInvoiceRequestSchema.parse({ rowVersion: 2, reason: '  Wrong customer  ' }).reason,
    ).toBe('Wrong customer');
  });

  it('keeps staff discounts to 5% of a line', () => {
    expect(DISCOUNT_STAFF_LIMIT_PERCENT).toBe(5);
  });
});

describe('the invoice list query', () => {
  it('has safe defaults and rejects unknown choices', () => {
    expect(InvoiceListQuerySchema.parse({})).toMatchObject({
      page: 1,
      pageSize: 25,
      status: 'all',
      type: 'all',
    });
    const bad = (value: object) => InvoiceListQuerySchema.safeParse(value).success;
    expect(bad({ status: 'DELETED' })).toBe(false);
    expect(bad({ type: 'EXPORT' })).toBe(false);
    expect(bad({ customerId: 'nope' })).toBe(false);
    expect(bad({ from: '2026-13-01' })).toBe(false);
    expect(bad({ from: '2026-01-01', to: '2026-12-31', status: 'ISSUED', type: 'GST' })).toBe(true);
  });
});
