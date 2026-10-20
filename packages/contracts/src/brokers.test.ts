import { describe, expect, it } from 'vitest';
import {
  AddCommissionRuleRequestSchema,
  BrokerLedgerQuerySchema,
  BrokerListQuerySchema,
  CommissionListQuerySchema,
  CreateBrokerRequestSchema,
  PayoutRequestSchema,
  UpdateBrokerRequestSchema,
} from './brokers.js';
import { CreateInvoiceRequestSchema } from './billing.js';

const id = '0b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59';
const id2 = '1b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59';

describe('CreateBrokerRequestSchema', () => {
  it('needs a name, and takes a phone or none', () => {
    expect(CreateBrokerRequestSchema.safeParse({ name: 'R' }).success).toBe(false);
    expect(CreateBrokerRequestSchema.parse({ name: 'Ravi Broker' }).phone).toBeNull();
    expect(
      CreateBrokerRequestSchema.safeParse({ name: 'Ravi Broker', phone: '9000000001' }).success,
    ).toBe(true);
    for (const phone of ['12345', '5000000001', 'abcdefghij'])
      expect(CreateBrokerRequestSchema.safeParse({ name: 'Ravi Broker', phone }).success).toBe(
        false,
      );
  });
});

describe('UpdateBrokerRequestSchema', () => {
  it('needs a change and a row version', () => {
    expect(UpdateBrokerRequestSchema.safeParse({ rowVersion: 1 }).success).toBe(false);
    expect(UpdateBrokerRequestSchema.safeParse({ isActive: false }).success).toBe(false);
    expect(UpdateBrokerRequestSchema.safeParse({ isActive: false, rowVersion: 3 }).success).toBe(
      true,
    );
    expect(UpdateBrokerRequestSchema.safeParse({ phone: null, rowVersion: 3 }).success).toBe(true);
  });
});

describe('AddCommissionRuleRequestSchema', () => {
  const rule = (type: string, value: string) =>
    AddCommissionRuleRequestSchema.safeParse({ type, value });

  it('takes a percentage up to 100 and a fixed amount', () => {
    expect(rule('PERCENT', '2.5').success).toBe(true);
    expect(rule('PERCENT', '100').success).toBe(true);
    expect(rule('FIXED', '5000.00').success).toBe(true);
    expect(rule('FIXED', '250000').success).toBe(true);
  });

  it.each([
    ['PERCENT', '100.01'],
    ['PERCENT', '150'],
    ['PERCENT', '0'],
    ['FIXED', '0.00'],
    ['FIXED', '-5'],
    ['PERCENT', '2.555'],
    ['FIXED', 'abc'],
    ['MIXED', '5'],
  ])('refuses %s %s', (type, value) => {
    expect(rule(type, value).success).toBe(false);
  });
});

describe('PayoutRequestSchema', () => {
  it('needs commissions, none twice, and an optional reference', () => {
    expect(PayoutRequestSchema.safeParse({ commissionIds: [] }).success).toBe(false);
    expect(PayoutRequestSchema.safeParse({ commissionIds: [id, id] }).success).toBe(false);
    expect(PayoutRequestSchema.safeParse({ commissionIds: ['x'] }).success).toBe(false);
    expect(PayoutRequestSchema.safeParse({ commissionIds: [id, id2] }).success).toBe(true);
    expect(
      PayoutRequestSchema.safeParse({ commissionIds: [id], reference: 'UTR 123' }).success,
    ).toBe(true);
    expect(PayoutRequestSchema.safeParse({ commissionIds: [id], reference: '  ' }).success).toBe(
      false,
    );
    expect(
      PayoutRequestSchema.safeParse({
        commissionIds: Array.from({ length: 101 }, (_, i) => `${i}`),
      }).success,
    ).toBe(false);
  });
});

describe('list queries', () => {
  it('apply defaults and refuse unknown values', () => {
    expect(BrokerListQuerySchema.parse({}).status).toBe('all');
    expect(BrokerListQuerySchema.safeParse({ status: 'gone' }).success).toBe(false);
    expect(CommissionListQuerySchema.parse({}).status).toBe('all');
    expect(CommissionListQuerySchema.safeParse({ status: 'OWED' }).success).toBe(false);
    expect(CommissionListQuerySchema.safeParse({ brokerId: 'x' }).success).toBe(false);
    expect(BrokerLedgerQuerySchema.safeParse({ from: '2026-13-01' }).success).toBe(false);
  });
});

describe('the broker on an invoice', () => {
  const invoice = (over: Record<string, unknown> = {}) =>
    CreateInvoiceRequestSchema.safeParse({
      customerId: id,
      type: 'GST',
      lines: [{ itemId: id2, qty: 1, unitPrice: '100.00' }],
      ...over,
    });

  it('is optional and defaults to none', () => {
    const result = invoice();
    expect(result.success).toBe(true);
    if (result.success) expect(result.data.brokerId).toBeNull();
    expect(invoice({ brokerId: id2 }).success).toBe(true);
    expect(invoice({ brokerId: null }).success).toBe(true);
    expect(invoice({ brokerId: 'not-an-id' }).success).toBe(false);
  });
});
