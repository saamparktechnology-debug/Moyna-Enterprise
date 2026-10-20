import { describe, expect, it } from 'vitest';
import {
  ApproveCreditNoteRequestSchema,
  CreateCreditNoteRequestSchema,
  CreditNoteListQuerySchema,
  RejectCreditNoteRequestSchema,
} from './credit-notes.js';

const invoice = '11111111-1111-4111-8111-111111111111';
const lineA = '22222222-2222-4222-8222-222222222222';
const lineB = '33333333-3333-4333-8333-333333333333';
const create = (over: object = {}) =>
  CreateCreditNoteRequestSchema.safeParse({
    invoiceId: invoice,
    reason: 'Customer returned them',
    lines: [{ invoiceLineId: lineA, qty: 1 }],
    ...over,
  });

describe('asking for a credit note', () => {
  it('accepts an invoice, a reason and lines', () => {
    expect(create().success).toBe(true);
    expect(
      create({
        lines: [
          { invoiceLineId: lineA, qty: 2 },
          { invoiceLineId: lineB, qty: 1 },
        ],
      }).success,
    ).toBe(true);
  });

  it('needs a real reason and at least one line', () => {
    expect(create({ reason: 'ab' }).success).toBe(false);
    expect(create({ reason: 'x'.repeat(301) }).success).toBe(false);
    expect(create({ lines: [] }).success).toBe(false);
    expect(create({ invoiceId: 'nope' }).success).toBe(false);
  });

  it('wants whole quantities of at least one, on lines that exist once each', () => {
    expect(create({ lines: [{ invoiceLineId: lineA, qty: 0 }] }).success).toBe(false);
    expect(create({ lines: [{ invoiceLineId: lineA, qty: 1.5 }] }).success).toBe(false);
    expect(create({ lines: [{ invoiceLineId: 'nope', qty: 1 }] }).success).toBe(false);
    const twice = create({
      lines: [
        { invoiceLineId: lineA, qty: 1 },
        { invoiceLineId: lineA, qty: 1 },
      ],
    });
    expect(twice.success).toBe(false);
    expect(twice.error?.issues[0]?.path).toEqual(['lines', 1, 'invoiceLineId']);
  });
});

describe('deciding on a credit note', () => {
  it('needs the version to approve, and a reason as well to reject', () => {
    expect(ApproveCreditNoteRequestSchema.safeParse({ rowVersion: 1 }).success).toBe(true);
    expect(ApproveCreditNoteRequestSchema.safeParse({ rowVersion: 0 }).success).toBe(false);
    expect(RejectCreditNoteRequestSchema.safeParse({ rowVersion: 1 }).success).toBe(false);
    expect(RejectCreditNoteRequestSchema.safeParse({ rowVersion: 1, reason: 'no' }).success).toBe(
      false,
    );
    expect(
      RejectCreditNoteRequestSchema.parse({ rowVersion: 1, reason: '  Goods used  ' }).reason,
    ).toBe('Goods used');
  });
});

describe('the credit note list query', () => {
  it('has safe defaults and rejects unknown choices', () => {
    expect(CreditNoteListQuerySchema.parse({})).toMatchObject({
      page: 1,
      pageSize: 25,
      status: 'all',
    });
    expect(CreditNoteListQuerySchema.safeParse({ status: 'DELETED' }).success).toBe(false);
    expect(CreditNoteListQuerySchema.safeParse({ invoiceId: 'nope' }).success).toBe(false);
    expect(CreditNoteListQuerySchema.safeParse({ pageSize: 101 }).success).toBe(false);
  });
});
