import { describe, expect, it } from 'vitest';
import { gstinCheckCharacter } from './branches.js';
import {
  ALLOWED_RESOLUTIONS,
  AmountSchema,
  CostSchema,
  CreatePurchaseOrderRequestSchema,
  CreatePurchaseReturnRequestSchema,
  CreateSupplierRequestSchema,
  DISCREPANCY_TYPES,
  PurchaseOrderListQuerySchema,
  ReceiveGoodsRequestSchema,
  RecordSupplierPaymentRequestSchema,
  ResolveDiscrepancyRequestSchema,
  UpdatePurchaseOrderRequestSchema,
  UpdateSupplierRequestSchema,
} from './purchasing.js';

const id = '11111111-1111-4111-8111-111111111111';
const other = '22222222-2222-4222-8222-222222222222';
const gstin = `27ABCDE1234F1Z${gstinCheckCharacter('27ABCDE1234F1Z')}`;

describe('amounts and costs', () => {
  it('accept up to two decimals and refuse zero, negatives and rupee signs where money is paid', () => {
    expect(AmountSchema.safeParse('1250').success).toBe(true);
    expect(AmountSchema.safeParse(' 1250.50 ').data).toBe('1250.50');
    expect(AmountSchema.safeParse('0').success).toBe(false);
    expect(AmountSchema.safeParse('0.00').success).toBe(false);
    expect(AmountSchema.safeParse('-5').success).toBe(false);
    expect(AmountSchema.safeParse('12.345').success).toBe(false);
    expect(AmountSchema.safeParse('Rs 5').success).toBe(false);
    expect(AmountSchema.safeParse('1'.repeat(13)).success).toBe(false);
    expect(AmountSchema.safeParse(100).success).toBe(false);
  });

  it('let a cost be zero, for a free sample', () => {
    expect(CostSchema.safeParse('0').success).toBe(true);
    expect(CostSchema.safeParse('-1').success).toBe(false);
  });
});

describe('suppliers', () => {
  it('checks the GSTIN against its state and defaults the optional fields to empty', () => {
    expect(CreateSupplierRequestSchema.parse({ name: 'Acme' })).toEqual({
      name: 'Acme',
      gstin: null,
      phone: null,
      stateCode: null,
    });
    expect(
      CreateSupplierRequestSchema.safeParse({ name: 'Acme', gstin, stateCode: '27' }).success,
    ).toBe(true);
    expect(
      CreateSupplierRequestSchema.safeParse({ name: 'Acme', gstin, stateCode: '29' }).success,
    ).toBe(false);
    expect(
      CreateSupplierRequestSchema.safeParse({ name: 'Acme', gstin: '27ABCDE1234F1ZX' }).success,
    ).toBe(false);
  });

  it('wants a real name and phone, and a version and a change when editing', () => {
    expect(CreateSupplierRequestSchema.safeParse({ name: 'x' }).success).toBe(false);
    expect(CreateSupplierRequestSchema.safeParse({ name: 'Acme', phone: 'call' }).success).toBe(
      false,
    );
    expect(UpdateSupplierRequestSchema.safeParse({ rowVersion: 1 }).success).toBe(false);
    expect(UpdateSupplierRequestSchema.safeParse({ isActive: false }).success).toBe(false);
    expect(UpdateSupplierRequestSchema.safeParse({ isActive: false, rowVersion: 1 }).success).toBe(
      true,
    );
  });
});

describe('purchase orders', () => {
  const line = { itemId: id, qtyOrdered: 2, unitCost: '10.50' };

  it('needs a supplier and one or more lines with an item only once each', () => {
    const parse = (value: object) =>
      CreatePurchaseOrderRequestSchema.safeParse({ supplierId: id, lines: [line], ...value });
    expect(parse({}).success).toBe(true);
    expect(parse({ supplierId: 'nope' }).success).toBe(false);
    expect(parse({ lines: [] }).success).toBe(false);
    expect(parse({ lines: [line, line] }).success).toBe(false);
    expect(parse({ lines: [line, { ...line, itemId: other }] }).success).toBe(true);
    expect(parse({ lines: [{ ...line, qtyOrdered: 0 }] }).success).toBe(false);
    expect(parse({ lines: [{ ...line, qtyOrdered: 1.5 }] }).success).toBe(false);
    expect(parse({ lines: [{ ...line, unitCost: '-1' }] }).success).toBe(false);
    expect(parse({ orderDate: '2026-02-30' }).success).toBe(false);
  });

  it('needs the version and a change to edit one', () => {
    expect(UpdatePurchaseOrderRequestSchema.safeParse({ rowVersion: 1 }).success).toBe(false);
    expect(UpdatePurchaseOrderRequestSchema.safeParse({ orderDate: '2026-10-01' }).success).toBe(
      false,
    );
    expect(
      UpdatePurchaseOrderRequestSchema.safeParse({ orderDate: '2026-10-01', rowVersion: 2 })
        .success,
    ).toBe(true);
  });

  it('has safe list defaults and rejects an unknown status', () => {
    expect(PurchaseOrderListQuerySchema.parse({})).toMatchObject({ status: 'all', page: 1 });
    expect(PurchaseOrderListQuerySchema.safeParse({ status: 'open' }).success).toBe(true);
    expect(PurchaseOrderListQuerySchema.safeParse({ status: 'lost' }).success).toBe(false);
  });
});

describe('receiving goods', () => {
  const poLineId = id;
  const parse = (value: object) => ReceiveGoodsRequestSchema.safeParse(value);

  it('needs something to have arrived', () => {
    expect(parse({}).success).toBe(false);
    expect(parse({ lines: [] }).success).toBe(false);
    expect(parse({ lines: [{ poLineId, received: 5 }] }).success).toBe(true);
    expect(parse({ wrongItems: [{ itemId: other, qty: 1 }] }).success).toBe(true);
  });

  it('counts a plain item by number and a serial item by serial number, never both', () => {
    expect(parse({ lines: [{ poLineId }] }).success).toBe(false);
    expect(parse({ lines: [{ poLineId, received: 2, damaged: 3 }] }).success).toBe(false);
    expect(parse({ lines: [{ poLineId, received: 3, damaged: 3 }] }).success).toBe(true);
    expect(parse({ lines: [{ poLineId, received: 0, deliveryNoteQty: 4 }] }).success).toBe(true);
    expect(
      parse({ lines: [{ poLineId, received: 1, serials: [{ serialNo: 'abc-001' }] }] }).success,
    ).toBe(false);
    expect(
      parse({ lines: [{ poLineId, damaged: 1, serials: [{ serialNo: 'abc-001' }] }] }).success,
    ).toBe(false);
    const parsed = parse({ lines: [{ poLineId, serials: [{ serialNo: ' abc-001 ' }] }] });
    expect(parsed.data?.lines[0]?.serials?.[0]?.serialNo).toBe('ABC-001');
  });

  it('refuses a serial number twice on a line, one line twice and bad battery dates', () => {
    expect(
      parse({ lines: [{ poLineId, serials: [{ serialNo: 'ABC-001' }, { serialNo: 'abc-001' }] }] })
        .success,
    ).toBe(false);
    expect(
      parse({
        lines: [
          { poLineId, received: 1 },
          { poLineId, received: 1 },
        ],
      }).success,
    ).toBe(false);
    expect(
      parse({
        lines: [
          {
            poLineId,
            serials: [
              { serialNo: 'ABC-001', manufacturedOn: '2026-05-01', expiryOn: '2026-05-01' },
            ],
          },
        ],
      }).success,
    ).toBe(false);
    expect(
      parse({
        lines: [
          {
            poLineId,
            serials: [
              {
                serialNo: 'ABC-001',
                manufacturedOn: '2026-05-01',
                expiryOn: '2027-05-01',
                warrantyMonths: 12,
              },
            ],
          },
        ],
      }).success,
    ).toBe(true);
    expect(parse({ lines: [{ poLineId, serials: [{ serialNo: 'AB' }] }] }).success).toBe(false);
  });

  it('wants one serial number per wrong unit', () => {
    expect(
      parse({ wrongItems: [{ itemId: other, qty: 2, serials: [{ serialNo: 'WRG-001' }] }] })
        .success,
    ).toBe(false);
    expect(
      parse({
        wrongItems: [
          { itemId: other, qty: 2, serials: [{ serialNo: 'WRG-001' }, { serialNo: 'WRG-002' }] },
        ],
      }).success,
    ).toBe(true);
  });
});

describe('settling discrepancies', () => {
  it('allows each kind of discrepancy only the decisions that make sense', () => {
    expect(ALLOWED_RESOLUTIONS.SHORT).toEqual(['CLAIM', 'WRITE_OFF']);
    expect(ALLOWED_RESOLUTIONS.EXCESS).toEqual(['ACCEPT', 'RETURN']);
    expect(ALLOWED_RESOLUTIONS.WRONG_ITEM).toEqual(['RETURN', 'WRITE_OFF']);
    expect(ALLOWED_RESOLUTIONS.DAMAGED).toEqual(['ACCEPT', 'RETURN', 'WRITE_OFF']);
    expect(ALLOWED_RESOLUTIONS.MISMATCHED).toEqual([]);
    expect(Object.keys(ALLOWED_RESOLUTIONS).sort()).toEqual([...DISCREPANCY_TYPES].sort());
  });

  it('needs a known decision and the version it read', () => {
    expect(
      ResolveDiscrepancyRequestSchema.safeParse({ resolution: 'ACCEPT', rowVersion: 1 }).success,
    ).toBe(true);
    expect(
      ResolveDiscrepancyRequestSchema.safeParse({ resolution: 'IGNORE', rowVersion: 1 }).success,
    ).toBe(false);
    expect(ResolveDiscrepancyRequestSchema.safeParse({ resolution: 'ACCEPT' }).success).toBe(false);
  });
});

describe('returns and payments', () => {
  it('needs the order, a reason and lines, each by quantity or by listed units', () => {
    const parse = (value: object) =>
      CreatePurchaseReturnRequestSchema.safeParse({
        poId: id,
        reason: 'Faulty',
        lines: [{ poLineId: id, qty: 1 }],
        ...value,
      });
    expect(parse({}).success).toBe(true);
    expect(parse({ reason: 'no' }).success).toBe(false);
    expect(parse({ lines: [] }).success).toBe(false);
    expect(parse({ poId: 'nope' }).success).toBe(false);
    expect(parse({ lines: [{ poLineId: id, serialUnitIds: [other] }] }).success).toBe(true);
    expect(parse({ lines: [{ poLineId: id, qty: 0 }] }).success).toBe(false);
  });

  it('needs an amount, a mode, and refuses a malformed date', () => {
    const parse = (value: object) =>
      RecordSupplierPaymentRequestSchema.safeParse({ amount: '10', mode: 'CASH', ...value });
    expect(parse({}).success).toBe(true);
    expect(parse({ amount: '0' }).success).toBe(false);
    expect(parse({ mode: '' }).success).toBe(false);
    expect(parse({ paidOn: '2026-13-01' }).success).toBe(false);
    expect(parse({ reference: '' }).success).toBe(false);
    expect(parse({ reference: 'CHQ-1', paidOn: '2026-10-01' }).success).toBe(true);
  });
});
