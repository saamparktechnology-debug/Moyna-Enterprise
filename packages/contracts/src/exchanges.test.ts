import { describe, expect, it } from 'vitest';
import {
  ApproveExchangeRequestSchema,
  CancelExchangeRequestSchema,
  ExchangeListQuerySchema,
  RejectExchangeRequestSchema,
  RequestExchangeRequestSchema,
  settlementOf,
} from './exchanges.js';
import { DOCUMENT_PREFIXES, DOCUMENT_TYPES } from './documents.js';
import { RESERVED_PAYMENT_MODES } from './payments.js';

const a = '0b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59';
const b = '1b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59';
const c = '2b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59';

const request = (over: Record<string, unknown> = {}) =>
  RequestExchangeRequestSchema.safeParse({
    invoiceId: a,
    newSerialUnitId: b,
    oldSerialUnitId: c,
    kind: 'OLD_FOR_NEW',
    valuationAmount: '40000.00',
    disposition: 'STOCK',
    reason: 'Customer wants the larger model',
    ...over,
  });

describe('RequestExchangeRequestSchema', () => {
  it('takes an old-for-new exchange with a valuation', () => {
    expect(request().success).toBe(true);
  });

  it('takes a new-for-new exchange with no valuation, because it is taken back at the price paid', () => {
    expect(request({ kind: 'NEW_FOR_NEW', valuationAmount: undefined }).success).toBe(true);
    const given = request({ kind: 'NEW_FOR_NEW' });
    expect(given.success).toBe(false);
    expect(JSON.stringify(given.error?.issues)).toContain('price paid');
  });

  it('needs a valuation for old-for-new, and one that is more than nothing', () => {
    expect(request({ valuationAmount: undefined }).success).toBe(false);
    for (const valuationAmount of ['0', '0.00', '-5', '1.234', 'abc'])
      expect(request({ valuationAmount }).success, valuationAmount).toBe(false);
  });

  it('needs different vehicles, a reason, a disposition and real ids', () => {
    expect(request({ newSerialUnitId: c }).success).toBe(false);
    expect(request({ reason: 'no' }).success).toBe(false);
    expect(request({ disposition: 'BURN' }).success).toBe(false);
    expect(request({ disposition: 'SCRAP' }).success).toBe(true);
    expect(request({ invoiceId: 'x' }).success).toBe(false);
    expect(request({ kind: 'SWAP' }).success).toBe(false);
  });
});

describe('deciding an exchange', () => {
  it('approves with an optional note and rejects only with a reason', () => {
    expect(ApproveExchangeRequestSchema.safeParse({ rowVersion: 1 }).success).toBe(true);
    expect(ApproveExchangeRequestSchema.safeParse({ rowVersion: 1, note: ' ' }).success).toBe(
      false,
    );
    expect(RejectExchangeRequestSchema.safeParse({ rowVersion: 1 }).success).toBe(false);
    expect(RejectExchangeRequestSchema.safeParse({ rowVersion: 1, note: 'ab' }).success).toBe(
      false,
    );
    expect(
      RejectExchangeRequestSchema.safeParse({ rowVersion: 1, note: 'Valuation too high' }).success,
    ).toBe(true);
    expect(CancelExchangeRequestSchema.safeParse({ rowVersion: 0 }).success).toBe(false);
  });
});

describe('settlementOf', () => {
  it('says who pays: above zero the customer, below zero a credit for them', () => {
    expect(settlementOf('1500.00')).toBe('PAYABLE');
    expect(settlementOf('-250.00')).toBe('REFUNDABLE');
    expect(settlementOf('0.00')).toBe('EVEN');
  });
});

describe('the list query and the document type', () => {
  it('applies defaults and refuses unknown values', () => {
    expect(ExchangeListQuerySchema.parse({})).toMatchObject({
      status: 'all',
      kind: 'all',
      page: 1,
    });
    expect(ExchangeListQuerySchema.safeParse({ status: 'DONE' }).success).toBe(false);
    expect(ExchangeListQuerySchema.safeParse({ kind: 'SWAP' }).success).toBe(false);
  });

  it('gives exchanges their own number series and reserves their payment mode', () => {
    expect(DOCUMENT_TYPES).toContain('EXCHANGE');
    expect(DOCUMENT_PREFIXES.EXCHANGE).toBe('EXC');
    expect(RESERVED_PAYMENT_MODES).toContain('EXCHANGE');
  });
});
