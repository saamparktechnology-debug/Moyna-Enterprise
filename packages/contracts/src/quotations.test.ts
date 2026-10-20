import { describe, expect, it } from 'vitest';
import {
  AssignUnitRequestSchema,
  BUILD_STAGES,
  BuildUpdateRequestSchema,
  CancelQuotationRequestSchema,
  ConvertQuotationRequestSchema,
  CreateQuotationRequestSchema,
  QuotationListQuerySchema,
  TakeAdvanceRequestSchema,
  UpdateQuotationRequestSchema,
  allowedNextBuildStages,
  isOpenQuotation,
} from './quotations.js';
import { IssueInvoiceRequestSchema } from './billing.js';

const id = '0b6f6a8e-5a56-4a1c-9b1e-0f1d2c3b4a59';
const line = { itemId: id, qty: 1, unitPrice: '100000.00' };

const create = (over: Record<string, unknown> = {}) =>
  CreateQuotationRequestSchema.safeParse({
    customerId: id,
    type: 'GST',
    validUntil: '2026-12-31',
    lines: [line],
    ...over,
  });

describe('CreateQuotationRequestSchema', () => {
  it('takes the basics and defaults the rest', () => {
    const result = create();
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        brokerId: null,
        isCustomBuild: false,
        specification: null,
      });
      expect(result.data.lines[0]?.discountAmount).toBe('0.00');
    }
  });

  it('needs a line, a valid date and a customer', () => {
    expect(create({ lines: [] }).success).toBe(false);
    expect(create({ validUntil: '2026-02-30' }).success).toBe(false);
    expect(create({ customerId: 'x' }).success).toBe(false);
    expect(create({ type: 'OTHER' }).success).toBe(false);
  });

  it.each([
    { qty: 0 },
    { qty: 1.5 },
    { qty: 10_001 },
    { unitPrice: '-1' },
    { unitPrice: '10.555' },
    { discountAmount: 'abc' },
  ])('refuses the line %j', (over) => {
    expect(create({ lines: [{ ...line, ...over }] }).success).toBe(false);
  });

  it('needs a specification for a customized build, and only for one', () => {
    expect(create({ isCustomBuild: true }).success).toBe(false);
    expect(create({ isCustomBuild: true, specification: '  ' }).success).toBe(false);
    expect(
      create({ isCustomBuild: true, specification: 'Red body, 60V motor, two batteries' }).success,
    ).toBe(true);
    expect(create({ isCustomBuild: false, specification: 'Red body' }).success).toBe(false);
  });
});

describe('UpdateQuotationRequestSchema', () => {
  it('needs the row version', () => {
    const body = { customerId: id, type: 'GST', validUntil: '2026-12-31', lines: [line] };
    expect(UpdateQuotationRequestSchema.safeParse(body).success).toBe(false);
    expect(UpdateQuotationRequestSchema.safeParse({ ...body, rowVersion: 2 }).success).toBe(true);
  });
});

describe('cancelling, advances, build updates and units', () => {
  it('needs a reason to cancel', () => {
    expect(CancelQuotationRequestSchema.safeParse({ rowVersion: 1, reason: 'no' }).success).toBe(
      false,
    );
    expect(
      CancelQuotationRequestSchema.safeParse({ rowVersion: 1, reason: 'Customer withdrew' })
        .success,
    ).toBe(true);
  });

  it('takes an advance of more than nothing with a retry key', () => {
    const advance = (over: Record<string, unknown> = {}) =>
      TakeAdvanceRequestSchema.safeParse({
        mode: 'UPI',
        amount: '25000.00',
        paidOn: '2026-10-10',
        idempotencyKey: 'form-key-0001',
        ...over,
      });
    expect(advance().success).toBe(true);
    for (const amount of ['0', '0.00', '-5', '1.234', 'abc'])
      expect(advance({ amount }).success, amount).toBe(false);
    expect(advance({ idempotencyKey: 'short' }).success).toBe(false);
    expect(advance({ mode: ' ' }).success).toBe(false);
  });

  it('takes a build stage with an optional note', () => {
    expect(BuildUpdateRequestSchema.safeParse({ stage: 'IN_BUILD', rowVersion: 1 }).success).toBe(
      true,
    );
    expect(BuildUpdateRequestSchema.safeParse({ stage: 'DONE', rowVersion: 1 }).success).toBe(
      false,
    );
    expect(
      BuildUpdateRequestSchema.safeParse({ stage: 'READY', note: '   ', rowVersion: 1 }).success,
    ).toBe(false);
  });

  it('takes a vehicle with chassis and motor numbers made of safe characters', () => {
    const assign = (over: Record<string, unknown> = {}) =>
      AssignUnitRequestSchema.safeParse({ serialUnitId: id, rowVersion: 1, ...over });
    expect(assign().success).toBe(true);
    expect(assign({ chassisNo: 'MD2A12CY5RWK12345', motorNo: 'MTR-60V/0042' }).success).toBe(true);
    for (const bad of ['ab', ' ', '!!!', 'a'.repeat(41), "x'; DROP"])
      expect(assign({ chassisNo: bad }).success, bad).toBe(false);
  });

  it('converts a quotation with an optional due date', () => {
    expect(
      ConvertQuotationRequestSchema.parse({ quotationId: id, rowVersion: 3 }).dueDate,
    ).toBeNull();
    expect(
      ConvertQuotationRequestSchema.safeParse({ quotationId: 'x', rowVersion: 3 }).success,
    ).toBe(false);
    expect(
      ConvertQuotationRequestSchema.safeParse({
        quotationId: id,
        rowVersion: 3,
        dueDate: '2026-13-01',
      }).success,
    ).toBe(false);
  });

  it('lets issuing an invoice carry a reason for delivering unpaid', () => {
    expect(
      IssueInvoiceRequestSchema.safeParse({ rowVersion: 1, unpaidDeliveryReason: 'Pays on Friday' })
        .success,
    ).toBe(true);
    expect(
      IssueInvoiceRequestSchema.safeParse({ rowVersion: 1, unpaidDeliveryReason: 'no' }).success,
    ).toBe(false);
  });
});

describe('build stages and open quotations', () => {
  it('moves forward, back from quality check to the build, and never out of READY', () => {
    expect(allowedNextBuildStages('NOT_STARTED')).toEqual(['IN_BUILD', 'QUALITY_CHECK', 'READY']);
    expect(allowedNextBuildStages('IN_BUILD')).toEqual(['QUALITY_CHECK', 'READY']);
    expect(allowedNextBuildStages('QUALITY_CHECK')).toEqual(['IN_BUILD', 'READY']);
    expect(allowedNextBuildStages('READY')).toEqual([]);
    for (const stage of BUILD_STAGES) expect(allowedNextBuildStages(stage)).not.toContain(stage);
  });

  it('tells open quotations from closed ones', () => {
    expect(['DRAFT', 'SENT', 'ACCEPTED'].every((s) => isOpenQuotation(s as never))).toBe(true);
    expect(['EXPIRED', 'CONVERTED', 'CANCELLED'].some((s) => isOpenQuotation(s as never))).toBe(
      false,
    );
  });
});

describe('the list query', () => {
  it('applies defaults, and refuses unknown values', () => {
    expect(QuotationListQuerySchema.parse({}).status).toBe('all');
    expect(QuotationListQuerySchema.parse({ status: 'open' }).status).toBe('open');
    expect(QuotationListQuerySchema.parse({ customOnly: 'true' }).customOnly).toBe(true);
    expect(QuotationListQuerySchema.safeParse({ status: 'LOST' }).success).toBe(false);
    expect(QuotationListQuerySchema.safeParse({ customOnly: 'yes' }).success).toBe(false);
  });
});
