import { z } from 'zod';
import { checkBatteryDates, DateOnlySchema, BatteryMonthsSchema } from './battery-dates.js';
import { paginatedSchema, PaginationQuerySchema } from './pagination.js';

export const STOCK_STATES = [
  'AVAILABLE',
  'RESERVED',
  'IN_TRANSIT',
  'DAMAGED',
  'RETURNED',
  'QUARANTINE',
] as const;
export const StockStateSchema = z.enum(STOCK_STATES);
export type StockStateName = z.infer<typeof StockStateSchema>;

export const SERIAL_UNIT_STATES = [...STOCK_STATES, 'SOLD', 'SCRAPPED'] as const;
export const SerialUnitStateSchema = z.enum(SERIAL_UNIT_STATES);
export type SerialUnitStateName = z.infer<typeof SerialUnitStateSchema>;

export const MOVEMENT_TYPES = [
  'OPENING_BALANCE',
  'PURCHASE_RECEIPT',
  'PURCHASE_RETURN',
  'SALE',
  'SALE_RETURN',
  'TRANSFER_DISPATCH',
  'TRANSFER_RECEIPT',
  'ADJUSTMENT_IN',
  'ADJUSTMENT_OUT',
  'STATE_CHANGE',
  'EXCHANGE_IN',
  'EXCHANGE_OUT',
  'WRITE_OFF',
] as const;
export const MovementTypeSchema = z.enum(MOVEMENT_TYPES);
export type MovementTypeName = z.infer<typeof MovementTypeSchema>;

const uuidFilter = z.uuid().optional();

export const StockBalanceSchema = z.object({
  branchId: z.string(),
  branchCode: z.string(),
  itemId: z.string(),
  itemCode: z.string(),
  itemName: z.string(),
  unitCode: z.string(),
  isSerialized: z.boolean(),
  reorderLevel: z.number().int(),
  available: z.number().int(),
  reserved: z.number().int(),
  inTransit: z.number().int(),
  damaged: z.number().int(),
  returned: z.number().int(),
  quarantine: z.number().int(),
  total: z.number().int(),
  isLow: z.boolean(),
});
export type StockBalance = z.infer<typeof StockBalanceSchema>;

export const STOCK_BALANCE_SORT_FIELDS = ['itemCode', 'name', 'available', 'branch'] as const;
export const StockBalanceQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  branchId: uuidFilter,
  categoryId: uuidFilter,
  lowOnly: z
    .enum(['true', 'false'])
    .default('false')
    .transform((value) => value === 'true'),
});
export type StockBalanceQuery = z.input<typeof StockBalanceQuerySchema>;
export const StockBalanceListResponseSchema = paginatedSchema(StockBalanceSchema);
export type StockBalanceListResponse = z.infer<typeof StockBalanceListResponseSchema>;

export const LowStockSchema = z.object({
  branchId: z.string(),
  branchCode: z.string(),
  itemId: z.string(),
  itemCode: z.string(),
  itemName: z.string(),
  unitCode: z.string(),
  available: z.number().int(),
  reorderLevel: z.number().int(),
  shortBy: z.number().int(),
});
export type LowStock = z.infer<typeof LowStockSchema>;
export const LowStockQuerySchema = PaginationQuerySchema.extend({ branchId: uuidFilter });
export const LowStockListResponseSchema = paginatedSchema(LowStockSchema);
export type LowStockListResponse = z.infer<typeof LowStockListResponseSchema>;

export const MovementSchema = z.object({
  id: z.string(),
  createdAt: z.string(),
  branchId: z.string(),
  branchCode: z.string(),
  itemId: z.string(),
  itemCode: z.string(),
  itemName: z.string(),
  serialNo: z.string().nullable(),
  state: StockStateSchema,
  qtyDelta: z.number().int(),
  movementType: MovementTypeSchema,
  sourceDocType: z.string().nullable(),
  sourceDocId: z.string().nullable(),
  createdByName: z.string().nullable(),
});
export type Movement = z.infer<typeof MovementSchema>;
export const MovementQuerySchema = PaginationQuerySchema.extend({
  itemId: uuidFilter,
  branchId: uuidFilter,
  movementType: MovementTypeSchema.optional(),
  serialNo: z.string().trim().max(60).optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export type MovementQuery = z.input<typeof MovementQuerySchema>;
export const MovementListResponseSchema = paginatedSchema(MovementSchema);
export type MovementListResponse = z.infer<typeof MovementListResponseSchema>;

export const SerialUnitSchema = z.object({
  id: z.string(),
  branchId: z.string(),
  branchCode: z.string(),
  itemId: z.string(),
  itemCode: z.string(),
  itemName: z.string(),
  serialNo: z.string(),
  chassisNo: z.string().nullable(),
  state: SerialUnitStateSchema,
});
export type SerialUnit = z.infer<typeof SerialUnitSchema>;
export const SERIAL_UNIT_SORT_FIELDS = ['serialNo', 'createdAt'] as const;
export const SerialUnitQuerySchema = PaginationQuerySchema.extend({
  itemId: uuidFilter,
  branchId: uuidFilter,
  state: SerialUnitStateSchema.optional(),
  search: z.string().trim().max(60).optional(),
});
export type SerialUnitQuery = z.input<typeof SerialUnitQuerySchema>;
export const SerialUnitListResponseSchema = paginatedSchema(SerialUnitSchema);
export type SerialUnitListResponse = z.infer<typeof SerialUnitListResponseSchema>;

export const ADJUSTMENT_KINDS = ['IN', 'OUT', 'WRITE_OFF', 'STATE_CHANGE'] as const;
export const AdjustmentKindSchema = z.enum(ADJUSTMENT_KINDS);
export type AdjustmentKind = z.infer<typeof AdjustmentKindSchema>;

export const ADJUSTMENT_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export const AdjustmentStatusSchema = z.enum(ADJUSTMENT_STATUSES);
export type AdjustmentStatus = z.infer<typeof AdjustmentStatusSchema>;

export const MAX_ADJUSTMENT_QTY = 100_000;

const SerialNumberSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9._/-]{2,39}$/, 'Use 3 to 40 letters, digits, dots, dashes or slashes');

export const CreateStockAdjustmentRequestSchema = z
  .object({
    branchId: z.uuid().optional(),
    itemId: z.uuid('Choose an item'),
    kind: AdjustmentKindSchema,
    state: StockStateSchema.default('AVAILABLE'),
    toState: StockStateSchema.optional(),
    qty: z
      .number('Enter a whole number')
      .int('Enter a whole number')
      .min(1, 'Enter at least 1')
      .max(MAX_ADJUSTMENT_QTY, 'Too large')
      .default(1),
    serialUnitId: z.uuid().optional(),
    serialNo: SerialNumberSchema.optional(),
    chassisNo: SerialNumberSchema.optional(),
    /** Battery dates, for a serial unit coming in. A battery arrives with its dates in one step. */
    manufacturedOn: DateOnlySchema.optional(),
    expiryOn: DateOnlySchema.optional(),
    warrantyMonths: BatteryMonthsSchema.optional(),
    reason: z
      .string()
      .trim()
      .min(3, 'Give a reason of at least 3 characters')
      .max(500, 'Use at most 500 characters'),
  })
  .superRefine((value, context) => {
    const issue = (path: string, message: string) =>
      context.addIssue({ code: 'custom', path: [path], message });
    if (value.kind === 'STATE_CHANGE') {
      if (!value.toState) issue('toState', 'Choose the state the stock moves to');
      else if (value.toState === value.state) issue('toState', 'Choose a different state');
    } else if (value.toState) issue('toState', 'Only a state change has a new state');
    if (value.serialNo && value.kind !== 'IN')
      issue('serialNo', 'A new serial number can only be added with stock coming in');
    if (value.serialUnitId && value.kind === 'IN')
      issue('serialUnitId', 'Stock coming in creates a new serial unit');
    if (value.chassisNo && !value.serialNo)
      issue('chassisNo', 'A chassis number needs a serial number');
    if ((value.serialNo || value.serialUnitId) && value.qty !== 1)
      issue('qty', 'A serial unit is always one piece');
    const hasDates =
      value.manufacturedOn !== undefined ||
      value.expiryOn !== undefined ||
      value.warrantyMonths !== undefined;
    if (hasDates && !value.serialNo) issue('serialNo', 'Battery dates need a serial number');
    checkBatteryDates(value, issue);
  });
export type CreateStockAdjustmentRequest = z.input<typeof CreateStockAdjustmentRequestSchema>;

export const StockAdjustmentSchema = z.object({
  id: z.string(),
  branchId: z.string(),
  branchCode: z.string(),
  itemId: z.string(),
  itemCode: z.string(),
  itemName: z.string(),
  isSerialized: z.boolean(),
  kind: AdjustmentKindSchema,
  state: StockStateSchema,
  toState: StockStateSchema.nullable(),
  qty: z.number().int(),
  serialUnitId: z.string().nullable(),
  serialNo: z.string().nullable(),
  chassisNo: z.string().nullable(),
  reason: z.string(),
  status: AdjustmentStatusSchema,
  requestedById: z.string(),
  requestedByName: z.string(),
  approvedByName: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decisionNote: z.string().nullable(),
  rowVersion: z.number().int(),
  createdAt: z.string(),
});
export type StockAdjustment = z.infer<typeof StockAdjustmentSchema>;

export const AdjustmentListQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'all']).default('PENDING'),
  kind: AdjustmentKindSchema.optional(),
  itemId: uuidFilter,
  branchId: uuidFilter,
});
export type AdjustmentListQuery = z.input<typeof AdjustmentListQuerySchema>;
export const AdjustmentListResponseSchema = paginatedSchema(StockAdjustmentSchema);
export type AdjustmentListResponse = z.infer<typeof AdjustmentListResponseSchema>;

export const ApproveAdjustmentRequestSchema = z.object({
  rowVersion: z.number().int().min(1),
  note: z.string().trim().max(500).optional(),
});
export type ApproveAdjustmentRequest = z.infer<typeof ApproveAdjustmentRequestSchema>;

export const RejectAdjustmentRequestSchema = z.object({
  rowVersion: z.number().int().min(1),
  note: z.string().trim().min(3, 'Say why it is rejected').max(500),
});
export type RejectAdjustmentRequest = z.infer<typeof RejectAdjustmentRequestSchema>;

export const CancelAdjustmentRequestSchema = z.object({ rowVersion: z.number().int().min(1) });
export type CancelAdjustmentRequest = z.infer<typeof CancelAdjustmentRequestSchema>;

/** The most units a branch Admin may approve in one adjustment. Larger adjustments need a Super Admin. */
export const ADJUSTMENT_ADMIN_APPROVAL_LIMIT = 10;

/** Fields the stock adjustment, movement and low-stock lists can be sorted by. */
export const ADJUSTMENT_SORT_FIELDS = ['createdAt', 'status', 'qty'] as const;
export const MOVEMENT_SORT_FIELDS = ['createdAt', 'movementType', 'qtyDelta'] as const;
export const LOW_STOCK_SORT_FIELDS = ['shortfall', 'available', 'itemCode', 'branch'] as const;
