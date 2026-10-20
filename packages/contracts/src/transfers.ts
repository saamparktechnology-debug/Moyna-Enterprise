import { z } from 'zod';
import { DiscrepancyTypeSchema } from './purchasing.js';
import { paginatedSchema, PaginationQuerySchema } from './pagination.js';

export const TRANSFER_STATUSES = [
  'REQUESTED',
  'APPROVED',
  'REJECTED',
  'DISPATCHED',
  'IN_TRANSIT',
  'RECEIVED',
  'CANCELLED',
] as const;
export const TransferStatusSchema = z.enum(TRANSFER_STATUSES);
export type TransferStatus = z.infer<typeof TransferStatusSchema>;

/** Statuses in which goods are on their way and may be received. */
export const RECEIVABLE_STATUSES: readonly TransferStatus[] = ['DISPATCHED', 'IN_TRANSIT'];

const QtySchema = z
  .number('Enter a whole number')
  .int('Enter a whole number')
  .min(1, 'At least 1')
  .max(100_000, 'Too many');
const CountSchema = z
  .number('Enter a whole number')
  .int('Enter a whole number')
  .min(0, 'Cannot be negative')
  .max(100_000, 'Too many');
const NoteSchema = z
  .string()
  .trim()
  .min(3, 'Give at least 3 characters')
  .max(300, 'Use at most 300 characters');
const SerialNoSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(3, 'A serial number has at least 3 characters')
  .max(60, 'A serial number has at most 60 characters');
const RowVersionSchema = z.number().int().min(1);

export const CreateTransferRequestSchema = z
  .object({
    fromBranchId: z.uuid('Choose the branch to take stock from'),
    toBranchId: z.uuid('Choose the branch that receives it'),
    note: NoteSchema.optional(),
    lines: z
      .array(z.object({ itemId: z.uuid('Choose an item'), qty: QtySchema }))
      .min(1, 'Add at least one item')
      .max(100, 'At most 100 items'),
  })
  .superRefine((value, context) => {
    if (value.fromBranchId === value.toBranchId)
      context.addIssue({
        code: 'custom',
        path: ['toBranchId'],
        message: 'The two branches must be different',
      });
    const ids = value.lines.map((line) => line.itemId);
    if (new Set(ids).size !== ids.length)
      context.addIssue({ code: 'custom', path: ['lines'], message: 'List each item once' });
  });
export type CreateTransferRequest = z.input<typeof CreateTransferRequestSchema>;

export const ApproveTransferRequestSchema = z.object({ rowVersion: RowVersionSchema });
export const RejectTransferRequestSchema = z.object({
  rowVersion: RowVersionSchema,
  note: NoteSchema,
});
export const CancelTransferRequestSchema = z.object({
  rowVersion: RowVersionSchema,
  note: NoteSchema.optional(),
});

export const DispatchTransferRequestSchema = z
  .object({
    rowVersion: RowVersionSchema,
    note: NoteSchema.optional(),
    items: z
      .array(
        z.object({
          itemId: z.uuid('Choose an item'),
          /** For an item without serial numbers: how many are being sent. */
          qty: QtySchema.optional(),
          /** For an item with serial numbers: the units being sent, scanned one by one. */
          serialNos: z.array(SerialNoSchema).max(1000).optional(),
        }),
      )
      .min(1, 'Say what is being sent')
      .max(100),
  })
  .superRefine((value, context) => {
    value.items.forEach((item, index) => {
      if ((item.qty === undefined) === (item.serialNos === undefined))
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'qty'],
          message: 'Give a quantity, or the serial numbers for a serialized item',
        });
      if (item.serialNos && new Set(item.serialNos).size !== item.serialNos.length)
        context.addIssue({
          code: 'custom',
          path: ['items', index, 'serialNos'],
          message: 'A serial number appears twice',
        });
    });
    const ids = value.items.map((item) => item.itemId);
    if (new Set(ids).size !== ids.length)
      context.addIssue({ code: 'custom', path: ['items'], message: 'List each item once' });
  });
export type DispatchTransferRequest = z.input<typeof DispatchTransferRequestSchema>;

export const ReceiveTransferRequestSchema = z
  .object({
    rowVersion: RowVersionSchema,
    note: NoteSchema.optional(),
    /** What arrived for each line that is not serial-numbered, counted or scanned. */
    lines: z
      .array(z.object({ lineId: z.uuid(), received: CountSchema, damaged: CountSchema.default(0) }))
      .max(100)
      .default([]),
    /** The serial numbers that arrived, scanned one by one. A serial unit not listed here is counted as short. */
    serials: z
      .array(z.object({ serialNo: SerialNoSchema, damaged: z.boolean().default(false) }))
      .max(1000)
      .default([]),
  })
  .superRefine((value, context) => {
    value.lines.forEach((line, index) => {
      if (line.damaged > line.received)
        context.addIssue({
          code: 'custom',
          path: ['lines', index, 'damaged'],
          message: 'More damaged than arrived',
        });
    });
    const ids = value.lines.map((line) => line.lineId);
    if (new Set(ids).size !== ids.length)
      context.addIssue({ code: 'custom', path: ['lines'], message: 'Each line may appear once' });
    const numbers = value.serials.map((serial) => serial.serialNo);
    if (new Set(numbers).size !== numbers.length)
      context.addIssue({
        code: 'custom',
        path: ['serials'],
        message: 'A serial number appears twice',
      });
  });
export type ReceiveTransferRequest = z.input<typeof ReceiveTransferRequestSchema>;

export const TransferLineSchema = z.object({
  id: z.string(),
  itemId: z.string(),
  itemCode: z.string(),
  itemName: z.string(),
  isSerialized: z.boolean(),
  serialNo: z.string().nullable(),
  qtyRequested: z.number().int(),
  qtySent: z.number().int(),
  qtyReceived: z.number().int(),
  qtyDamaged: z.number().int(),
  discrepancies: z.array(
    z.object({
      id: z.string(),
      type: DiscrepancyTypeSchema,
      qty: z.number().int(),
      status: z.enum(['OPEN', 'RESOLVED']),
    }),
  ),
});
export type TransferLine = z.infer<typeof TransferLineSchema>;

export const TransferEventSchema = z.object({
  id: z.string(),
  status: TransferStatusSchema,
  at: z.string(),
  userName: z.string(),
  note: z.string().nullable(),
});
export type TransferEvent = z.infer<typeof TransferEventSchema>;

export const TransferSchema = z.object({
  id: z.string(),
  transferNo: z.string(),
  fromBranchId: z.string(),
  fromBranchCode: z.string(),
  fromBranchName: z.string(),
  toBranchId: z.string(),
  toBranchCode: z.string(),
  toBranchName: z.string(),
  status: TransferStatusSchema,
  requestedByName: z.string(),
  createdAt: z.string(),
  lines: z.array(TransferLineSchema),
  events: z.array(TransferEventSchema),
  rowVersion: z.number().int(),
});
export type Transfer = z.infer<typeof TransferSchema>;

export const TransferSummarySchema = TransferSchema.omit({ lines: true, events: true }).extend({
  itemCount: z.number().int(),
  unitCount: z.number().int(),
  openDiscrepancies: z.number().int(),
});
export type TransferSummary = z.infer<typeof TransferSummarySchema>;

export const TransferListQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().max(60).optional(),
  status: z.enum(['all', ...TRANSFER_STATUSES]).default('all'),
  direction: z.enum(['all', 'incoming', 'outgoing']).default('all'),
});
export type TransferListQuery = z.input<typeof TransferListQuerySchema>;
export const TransferListResponseSchema = paginatedSchema(TransferSummarySchema);
export type TransferListResponse = z.infer<typeof TransferListResponseSchema>;

/** A branch as offered in a list of choices: enough to pick one, nothing private. */
export const BranchOptionSchema = z.object({ id: z.string(), code: z.string(), name: z.string() });
export type BranchOption = z.infer<typeof BranchOptionSchema>;
export const BranchOptionListResponseSchema = z.array(BranchOptionSchema);

/** Fields a transfer list can be sorted by. */
export const TRANSFER_SORT_FIELDS = ['createdAt', 'transferNo', 'status'] as const;
