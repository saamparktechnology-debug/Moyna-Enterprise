import { describe, expect, it } from 'vitest';
import { ALLOWED_TRANSFER_RESOLUTIONS } from './purchasing.js';
import {
  CancelTransferRequestSchema,
  CreateTransferRequestSchema,
  DispatchTransferRequestSchema,
  ReceiveTransferRequestSchema,
  RECEIVABLE_STATUSES,
  RejectTransferRequestSchema,
  TransferListQuerySchema,
} from './transfers.js';

const a = '11111111-1111-4111-8111-111111111111';
const b = '22222222-2222-4222-8222-222222222222';
const item = '33333333-3333-4333-8333-333333333333';
const other = '44444444-4444-4444-8444-444444444444';

describe('asking for a transfer', () => {
  const parse = (over: object) =>
    CreateTransferRequestSchema.safeParse({
      fromBranchId: a,
      toBranchId: b,
      lines: [{ itemId: item, qty: 2 }],
      ...over,
    });

  it('needs two different branches and at least one item', () => {
    expect(parse({}).success).toBe(true);
    expect(parse({ toBranchId: a }).error?.issues[0]?.path).toEqual(['toBranchId']);
    expect(parse({ lines: [] }).success).toBe(false);
    expect(parse({ fromBranchId: 'nope' }).success).toBe(false);
  });

  it('keeps quantities whole, positive and listed once per item', () => {
    expect(parse({ lines: [{ itemId: item, qty: 0 }] }).success).toBe(false);
    expect(parse({ lines: [{ itemId: item, qty: 1.5 }] }).success).toBe(false);
    expect(parse({ lines: [{ itemId: item, qty: 100_001 }] }).success).toBe(false);
    expect(
      parse({
        lines: [
          { itemId: item, qty: 1 },
          { itemId: item, qty: 2 },
        ],
      }).success,
    ).toBe(false);
    expect(
      parse({
        lines: [
          { itemId: item, qty: 1 },
          { itemId: other, qty: 2 },
        ],
      }).success,
    ).toBe(true);
  });

  it('tidies a note and refuses a very short one', () => {
    expect(parse({ note: '  Shop is low  ' }).data?.note).toBe('Shop is low');
    expect(parse({ note: 'ab' }).success).toBe(false);
  });
});

describe('deciding a transfer', () => {
  it('needs a reason to reject but not to cancel', () => {
    expect(RejectTransferRequestSchema.safeParse({ rowVersion: 1 }).success).toBe(false);
    expect(RejectTransferRequestSchema.safeParse({ rowVersion: 1, note: 'no' }).success).toBe(
      false,
    );
    expect(
      RejectTransferRequestSchema.safeParse({ rowVersion: 1, note: 'Not needed' }).success,
    ).toBe(true);
    expect(CancelTransferRequestSchema.safeParse({ rowVersion: 1 }).success).toBe(true);
    expect(CancelTransferRequestSchema.safeParse({ rowVersion: 0 }).success).toBe(false);
  });
});

describe('dispatching', () => {
  const parse = (items: object[]) =>
    DispatchTransferRequestSchema.safeParse({ rowVersion: 1, items });

  it('wants a quantity or serial numbers for each item, never both and never neither', () => {
    expect(parse([{ itemId: item, qty: 3 }]).success).toBe(true);
    expect(
      parse([{ itemId: item, serialNos: ['sn-1', 'sn-2'] }]).data?.items[0]?.serialNos,
    ).toEqual(['SN-1', 'SN-2']);
    expect(parse([{ itemId: item }]).success).toBe(false);
    expect(parse([{ itemId: item, qty: 1, serialNos: ['SN-1'] }]).success).toBe(false);
  });

  it('refuses a repeated serial number, a repeated item and nothing at all', () => {
    expect(parse([{ itemId: item, serialNos: ['SN-1', 'sn-1'] }]).success).toBe(false);
    expect(
      parse([
        { itemId: item, qty: 1 },
        { itemId: item, qty: 2 },
      ]).success,
    ).toBe(false);
    expect(parse([]).success).toBe(false);
    expect(parse([{ itemId: item, serialNos: ['ab'] }]).success).toBe(false);
  });
});

describe('receiving', () => {
  const parse = (value: object) =>
    ReceiveTransferRequestSchema.safeParse({ rowVersion: 2, ...value });

  it('defaults damaged to none and the lists to empty', () => {
    expect(parse({ lines: [{ lineId: a, received: 4 }] }).data?.lines[0]?.damaged).toBe(0);
    expect(parse({}).data).toMatchObject({ lines: [], serials: [] });
    expect(parse({ serials: [{ serialNo: 'sn-1' }] }).data?.serials[0]).toEqual({
      serialNo: 'SN-1',
      damaged: false,
    });
  });

  it('refuses more damaged than arrived, repeated lines and repeated serial numbers', () => {
    expect(parse({ lines: [{ lineId: a, received: 2, damaged: 3 }] }).success).toBe(false);
    expect(
      parse({
        lines: [
          { lineId: a, received: 2 },
          { lineId: a, received: 1 },
        ],
      }).success,
    ).toBe(false);
    expect(parse({ serials: [{ serialNo: 'SN-1' }, { serialNo: 'sn-1' }] }).success).toBe(false);
    expect(parse({ lines: [{ lineId: a, received: -1 }] }).success).toBe(false);
  });
});

describe('transfer lists and rules', () => {
  it('has safe defaults and rejects unknown choices', () => {
    expect(TransferListQuerySchema.parse({})).toMatchObject({
      status: 'all',
      direction: 'all',
      page: 1,
    });
    expect(TransferListQuerySchema.safeParse({ status: 'LOST' }).success).toBe(false);
    expect(TransferListQuerySchema.safeParse({ direction: 'sideways' }).success).toBe(false);
  });

  it('receives goods that are dispatched or in transit, and settles a transfer short only by a write-off', () => {
    expect([...RECEIVABLE_STATUSES]).toEqual(['DISPATCHED', 'IN_TRANSIT']);
    expect(ALLOWED_TRANSFER_RESOLUTIONS.SHORT).toEqual(['WRITE_OFF']);
    expect(ALLOWED_TRANSFER_RESOLUTIONS.DAMAGED).toEqual(['ACCEPT', 'WRITE_OFF']);
    expect(ALLOWED_TRANSFER_RESOLUTIONS.EXCESS).toEqual([]);
  });
});
