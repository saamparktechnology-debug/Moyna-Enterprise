import { z } from 'zod';
import { GstinSchema, StateCodeSchema, gstinProblem } from './branches.js';
import { DateOnlySchema } from './battery-dates.js';
import { paginatedSchema, PaginationQuerySchema } from './pagination.js';
import { BatteryMonthsSchema } from './battery-dates.js';

export const AmountSchema = z
  .string('Enter an amount')
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Enter an amount such as 1250 or 1250.50')
  .refine((value) => Number(value) > 0, 'The amount must be more than zero');
export const CostSchema = z
  .string('Enter a cost')
  .trim()
  .regex(/^\d{1,12}(\.\d{1,2})?$/, 'Enter a cost such as 1250 or 1250.50');

const MAX_QTY = 100_000;
const QtySchema = z
  .number('Enter a whole number')
  .int('Enter a whole number')
  .min(1, 'Enter at least 1')
  .max(MAX_QTY, 'Too large');
const CountSchema = z
  .number('Enter a whole number')
  .int('Enter a whole number')
  .min(0, 'Cannot be negative')
  .max(MAX_QTY, 'Too large');
const NoteSchema = z.string().trim().max(300, 'Use at most 300 characters');
const ReasonSchema = z.string().trim().min(3, 'Give a reason of at least 3 characters').max(300);

// ---------- suppliers ----------

export const SupplierSchema = z.object({
  id: z.string(),
  name: z.string(),
  gstin: z.string().nullable(),
  phone: z.string().nullable(),
  stateCode: z.string().nullable(),
  isActive: z.boolean(),
  rowVersion: z.number().int(),
});
export type Supplier = z.infer<typeof SupplierSchema>;

const SupplierNameSchema = z.string().trim().min(2, 'Enter at least 2 characters').max(120);
const PhoneSchema = z
  .string()
  .trim()
  .regex(/^[0-9+() -]{7,20}$/, 'Enter a phone number');

function checkGstin(
  value: { gstin?: string | null | undefined; stateCode?: string | null | undefined },
  context: z.RefinementCtx,
): void {
  if (!value.gstin) return;
  const problem = gstinProblem(value.gstin, value.stateCode ?? undefined);
  if (problem) context.addIssue({ code: 'custom', path: ['gstin'], message: problem });
}

export const CreateSupplierRequestSchema = z
  .object({
    name: SupplierNameSchema,
    gstin: GstinSchema.nullable().default(null),
    phone: PhoneSchema.nullable().default(null),
    stateCode: StateCodeSchema.nullable().default(null),
  })
  .superRefine(checkGstin);
export type CreateSupplierRequest = z.input<typeof CreateSupplierRequestSchema>;

export const UpdateSupplierRequestSchema = z
  .object({
    name: SupplierNameSchema.optional(),
    gstin: GstinSchema.nullable().optional(),
    phone: PhoneSchema.nullable().optional(),
    stateCode: StateCodeSchema.nullable().optional(),
    isActive: z.boolean().optional(),
    rowVersion: z.number().int().min(1),
  })
  .refine((value) => Object.keys(value).some((key) => key !== 'rowVersion'), {
    message: 'Change at least one field',
  });
export type UpdateSupplierRequest = z.infer<typeof UpdateSupplierRequestSchema>;

export const SUPPLIER_SORT_FIELDS = ['name', 'createdAt'] as const;
export const SupplierListQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['active', 'inactive', 'all']).default('active'),
});
export type SupplierListQuery = z.input<typeof SupplierListQuerySchema>;
export const SupplierListResponseSchema = paginatedSchema(SupplierSchema);
export type SupplierListResponse = z.infer<typeof SupplierListResponseSchema>;

/** What the company owes a supplier, across the branches the caller can see. */
export const SupplierBalanceSchema = z.object({
  supplierId: z.string(),
  charged: z.string(),
  credited: z.string(),
  paid: z.string(),
  outstanding: z.string(),
});
export type SupplierBalance = z.infer<typeof SupplierBalanceSchema>;

export const SupplierDetailSchema = SupplierSchema.extend({ balance: SupplierBalanceSchema });
export type SupplierDetail = z.infer<typeof SupplierDetailSchema>;

export const LEDGER_KINDS = [
  'RECEIPT',
  'ACCEPTED_LATER',
  'WRITTEN_OFF',
  'RETURN',
  'PAYMENT',
] as const;
export const LedgerKindSchema = z.enum(LEDGER_KINDS);
export const SupplierLedgerEntrySchema = z.object({
  at: z.string(),
  kind: LedgerKindSchema,
  documentNo: z.string(),
  branchCode: z.string(),
  description: z.string(),
  /** What the company owes more because of this entry. */
  debit: z.string(),
  /** What the company owes less because of this entry. */
  credit: z.string(),
  balance: z.string(),
});
export type SupplierLedgerEntry = z.infer<typeof SupplierLedgerEntrySchema>;
export const SupplierLedgerQuerySchema = PaginationQuerySchema;
export const SupplierLedgerResponseSchema = paginatedSchema(SupplierLedgerEntrySchema).extend({
  balance: SupplierBalanceSchema,
});
export type SupplierLedgerResponse = z.infer<typeof SupplierLedgerResponseSchema>;

export const RecordSupplierPaymentRequestSchema = z.object({
  branchId: z.uuid().optional(),
  amount: AmountSchema,
  paidOn: DateOnlySchema.optional(),
  mode: z.string().trim().min(1, 'Choose how it was paid'),
  reference: z.string().trim().min(1).max(60).optional(),
});
export type RecordSupplierPaymentRequest = z.input<typeof RecordSupplierPaymentRequestSchema>;
export const SupplierPaymentSchema = z.object({
  id: z.string(),
  supplierId: z.string(),
  branchId: z.string(),
  amount: z.string(),
  paidOn: z.string(),
  mode: z.string(),
  reference: z.string().nullable(),
  outstanding: z.string(),
});
export type SupplierPayment = z.infer<typeof SupplierPaymentSchema>;

export const PaymentModeSchema = z.object({ code: z.string(), name: z.string() });
export const PaymentModeListResponseSchema = z.array(PaymentModeSchema);
export type PaymentMode = z.infer<typeof PaymentModeSchema>;

// ---------- purchase orders ----------

export const PO_STATUSES = [
  'DRAFT',
  'APPROVED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CANCELLED',
] as const;
export const PoStatusSchema = z.enum(PO_STATUSES);
export type PoStatus = z.infer<typeof PoStatusSchema>;

export const PoLineInputSchema = z.object({
  itemId: z.uuid('Choose an item'),
  qtyOrdered: QtySchema,
  unitCost: CostSchema,
});
const poLines = z
  .array(PoLineInputSchema)
  .min(1, 'Add at least one item')
  .max(100, 'At most 100 lines')
  .refine((lines) => new Set(lines.map((line) => line.itemId)).size === lines.length, {
    message: 'Each item may appear on one line only',
  });

export const CreatePurchaseOrderRequestSchema = z.object({
  branchId: z.uuid().optional(),
  supplierId: z.uuid('Choose a supplier'),
  orderDate: DateOnlySchema.optional(),
  lines: poLines,
});
export type CreatePurchaseOrderRequest = z.input<typeof CreatePurchaseOrderRequestSchema>;

export const UpdatePurchaseOrderRequestSchema = z
  .object({
    supplierId: z.uuid('Choose a supplier').optional(),
    orderDate: DateOnlySchema.optional(),
    lines: poLines.optional(),
    rowVersion: z.number().int().min(1),
  })
  .refine((value) => Object.keys(value).some((key) => key !== 'rowVersion'), {
    message: 'Change at least one field',
  });
export type UpdatePurchaseOrderRequest = z.infer<typeof UpdatePurchaseOrderRequestSchema>;

export const PurchaseOrderLineSchema = z.object({
  id: z.string(),
  itemId: z.string(),
  itemCode: z.string(),
  itemName: z.string(),
  unitCode: z.string(),
  isSerialized: z.boolean(),
  qtyOrdered: z.number().int(),
  unitCost: z.string(),
  lineTotal: z.string(),
  /** Good units accepted into stock, including damaged or excess units accepted later. */
  accepted: z.number().int(),
  /** Quantity settled by writing it off after a discrepancy, so it will not arrive. */
  closed: z.number().int(),
  remaining: z.number().int(),
});
export type PurchaseOrderLine = z.infer<typeof PurchaseOrderLineSchema>;

export const PurchaseOrderSchema = z.object({
  id: z.string(),
  poNo: z.string(),
  branchId: z.string(),
  branchCode: z.string(),
  supplierId: z.string(),
  supplierName: z.string(),
  status: PoStatusSchema,
  orderDate: z.string(),
  total: z.string(),
  orderedQty: z.number().int(),
  remainingQty: z.number().int(),
  receiptCount: z.number().int(),
  lines: z.array(PurchaseOrderLineSchema),
  rowVersion: z.number().int(),
});
export type PurchaseOrder = z.infer<typeof PurchaseOrderSchema>;

export const PurchaseOrderSummarySchema = PurchaseOrderSchema.omit({ lines: true });
export type PurchaseOrderSummary = z.infer<typeof PurchaseOrderSummarySchema>;

export const PO_SORT_FIELDS = ['poNo', 'orderDate', 'createdAt'] as const;
export const PurchaseOrderListQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum([...PO_STATUSES, 'open', 'all']).default('all'),
  supplierId: z.uuid().optional(),
  branchId: z.uuid().optional(),
});
export type PurchaseOrderListQuery = z.input<typeof PurchaseOrderListQuerySchema>;
export const PurchaseOrderListResponseSchema = paginatedSchema(PurchaseOrderSummarySchema);
export type PurchaseOrderListResponse = z.infer<typeof PurchaseOrderListResponseSchema>;

export const ApprovePurchaseOrderRequestSchema = z.object({ rowVersion: z.number().int().min(1) });
export const CancelPurchaseOrderRequestSchema = z.object({
  rowVersion: z.number().int().min(1),
  reason: ReasonSchema,
});

// ---------- receiving ----------

const SerialNumberSchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z0-9][A-Z0-9._/-]{2,39}$/, 'Use 3 to 40 letters, digits, dots, dashes or slashes');

export const ReceivedSerialSchema = z
  .object({
    serialNo: SerialNumberSchema,
    chassisNo: SerialNumberSchema.optional(),
    damaged: z.boolean().default(false),
    manufacturedOn: DateOnlySchema.optional(),
    expiryOn: DateOnlySchema.optional(),
    warrantyMonths: BatteryMonthsSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.manufacturedOn && value.expiryOn && value.expiryOn <= value.manufacturedOn)
      context.addIssue({
        code: 'custom',
        path: ['expiryOn'],
        message: 'The expiry date must be after the manufacture date',
      });
  });
export type ReceivedSerial = z.input<typeof ReceivedSerialSchema>;

export const ReceiveLineSchema = z
  .object({
    poLineId: z.uuid(),
    /** For an item without serial numbers: how many arrived. */
    received: CountSchema.optional(),
    /** For an item without serial numbers: how many of those arrived damaged. */
    damaged: CountSchema.default(0),
    /** What the supplier's delivery note says was sent. When it is more than arrived, the difference is short. */
    deliveryNoteQty: CountSchema.optional(),
    /** For an item with serial numbers: one entry per unit that arrived. */
    serials: z.array(ReceivedSerialSchema).max(1000).optional(),
  })
  .superRefine((value, context) => {
    const issue = (path: string, message: string) =>
      context.addIssue({ code: 'custom', path: [path], message });
    if (value.serials) {
      if (value.received !== undefined)
        issue('received', 'Serial items are counted by their serial numbers');
      if (value.damaged !== 0) issue('damaged', 'Mark damaged units on their serial numbers');
      const numbers = value.serials.map((serial) => serial.serialNo);
      if (new Set(numbers).size !== numbers.length)
        issue('serials', 'A serial number appears twice');
    } else if (value.received === undefined) issue('received', 'Enter how many arrived');
    else if (value.damaged > value.received) issue('damaged', 'More damaged than arrived');
  });
export type ReceiveLine = z.input<typeof ReceiveLineSchema>;

export const WrongItemSchema = z.object({
  itemId: z.uuid('Choose the item that arrived'),
  qty: QtySchema,
  serials: z
    .array(z.object({ serialNo: SerialNumberSchema, chassisNo: SerialNumberSchema.optional() }))
    .max(1000)
    .optional(),
});
export type WrongItem = z.input<typeof WrongItemSchema>;

export const ReceiveGoodsRequestSchema = z
  .object({
    lines: z.array(ReceiveLineSchema).max(100).default([]),
    wrongItems: z.array(WrongItemSchema).max(50).default([]),
    deliveryNoteNo: z.string().trim().min(1).max(60).optional(),
    note: NoteSchema.optional(),
  })
  .superRefine((value, context) => {
    if (value.lines.length === 0 && value.wrongItems.length === 0)
      context.addIssue({ code: 'custom', path: ['lines'], message: 'Enter what arrived' });
    const ids = value.lines.map((line) => line.poLineId);
    if (new Set(ids).size !== ids.length)
      context.addIssue({
        code: 'custom',
        path: ['lines'],
        message: 'Each purchase order line may appear once',
      });
    value.wrongItems.forEach((wrong, index) => {
      if (wrong.serials && wrong.serials.length !== wrong.qty)
        context.addIssue({
          code: 'custom',
          path: ['wrongItems', index, 'serials'],
          message: 'Give one serial number per unit',
        });
    });
  });
export type ReceiveGoodsRequest = z.input<typeof ReceiveGoodsRequestSchema>;

export const DISCREPANCY_TYPES = [
  'SHORT',
  'EXCESS',
  'WRONG_ITEM',
  'DAMAGED',
  'MISMATCHED',
] as const;
export const DiscrepancyTypeSchema = z.enum(DISCREPANCY_TYPES);
export type DiscrepancyTypeName = z.infer<typeof DiscrepancyTypeSchema>;
export const DISCREPANCY_RESOLUTIONS = ['ACCEPT', 'RETURN', 'CLAIM', 'WRITE_OFF'] as const;
export const DiscrepancyResolutionSchema = z.enum(DISCREPANCY_RESOLUTIONS);
export type DiscrepancyResolutionName = z.infer<typeof DiscrepancyResolutionSchema>;

/** What may be done with each kind of discrepancy on goods received from a supplier. */
export const ALLOWED_RESOLUTIONS: Readonly<
  Record<DiscrepancyTypeName, readonly DiscrepancyResolutionName[]>
> = {
  SHORT: ['CLAIM', 'WRITE_OFF'],
  DAMAGED: ['ACCEPT', 'RETURN', 'WRITE_OFF'],
  EXCESS: ['ACCEPT', 'RETURN'],
  WRONG_ITEM: ['RETURN', 'WRITE_OFF'],
  MISMATCHED: [],
};

/**
 * What may be done with a discrepancy found when a transfer is received. Goods that never arrived can only be written
 * off; damaged goods are accepted or written off. Nothing goes back to a supplier, because there is none.
 */
export const ALLOWED_TRANSFER_RESOLUTIONS: Readonly<
  Record<DiscrepancyTypeName, readonly DiscrepancyResolutionName[]>
> = {
  SHORT: ['WRITE_OFF'],
  DAMAGED: ['ACCEPT', 'WRITE_OFF'],
  EXCESS: [],
  WRONG_ITEM: [],
  MISMATCHED: [],
};

export const DiscrepancySchema = z.object({
  id: z.string(),
  branchId: z.string(),
  branchCode: z.string(),
  type: DiscrepancyTypeSchema,
  qty: z.number().int(),
  status: z.enum(['OPEN', 'RESOLVED']),
  resolution: DiscrepancyResolutionSchema.nullable(),
  resolvedAt: z.string().nullable(),
  itemId: z.string().nullable(),
  itemCode: z.string().nullable(),
  itemName: z.string().nullable(),
  documentNo: z.string().nullable(),
  supplierName: z.string().nullable(),
  allowedResolutions: z.array(DiscrepancyResolutionSchema),
  rowVersion: z.number().int(),
  createdAt: z.string(),
});
export type Discrepancy = z.infer<typeof DiscrepancySchema>;

export const DiscrepancyListQuerySchema = PaginationQuerySchema.extend({
  status: z.enum(['OPEN', 'RESOLVED', 'all']).default('OPEN'),
  type: DiscrepancyTypeSchema.optional(),
  branchId: z.uuid().optional(),
});
export type DiscrepancyListQuery = z.input<typeof DiscrepancyListQuerySchema>;
export const DiscrepancyListResponseSchema = paginatedSchema(DiscrepancySchema);
export type DiscrepancyListResponse = z.infer<typeof DiscrepancyListResponseSchema>;

export const ResolveDiscrepancyRequestSchema = z.object({
  resolution: DiscrepancyResolutionSchema,
  note: NoteSchema.optional(),
  rowVersion: z.number().int().min(1),
});
export type ResolveDiscrepancyRequest = z.input<typeof ResolveDiscrepancyRequestSchema>;

export const GoodsReceiptLineSchema = z.object({
  id: z.string(),
  poLineId: z.string().nullable(),
  itemId: z.string(),
  itemCode: z.string(),
  itemName: z.string(),
  qtyReceived: z.number().int(),
  qtyAccepted: z.number().int(),
  discrepancies: z.array(
    z.object({
      id: z.string(),
      type: DiscrepancyTypeSchema,
      qty: z.number().int(),
      status: z.enum(['OPEN', 'RESOLVED']),
    }),
  ),
});
export const GoodsReceiptSchema = z.object({
  id: z.string(),
  grnNo: z.string(),
  poId: z.string().nullable(),
  poNo: z.string().nullable(),
  branchId: z.string(),
  branchCode: z.string(),
  supplierName: z.string().nullable(),
  receivedAt: z.string(),
  receivedByName: z.string(),
  deliveryNoteNo: z.string().nullable(),
  note: z.string().nullable(),
  lines: z.array(GoodsReceiptLineSchema),
});
export type GoodsReceipt = z.infer<typeof GoodsReceiptSchema>;
export const GoodsReceiptListQuerySchema = PaginationQuerySchema.extend({
  poId: z.uuid().optional(),
  branchId: z.uuid().optional(),
});
export const GoodsReceiptListResponseSchema = paginatedSchema(
  GoodsReceiptSchema.omit({ lines: true }).extend({
    lineCount: z.number().int(),
    openDiscrepancies: z.number().int(),
  }),
);
export type GoodsReceiptListResponse = z.infer<typeof GoodsReceiptListResponseSchema>;

// ---------- purchase returns ----------

export const CreatePurchaseReturnRequestSchema = z.object({
  poId: z.uuid('Choose the purchase order'),
  reason: ReasonSchema,
  lines: z
    .array(
      z.object({
        poLineId: z.uuid(),
        qty: QtySchema.optional(),
        serialUnitIds: z.array(z.uuid()).max(1000).optional(),
      }),
    )
    .min(1, 'Add at least one line')
    .max(100),
});
export type CreatePurchaseReturnRequest = z.input<typeof CreatePurchaseReturnRequestSchema>;

export const PurchaseReturnSchema = z.object({
  id: z.string(),
  returnNo: z.string(),
  branchId: z.string(),
  branchCode: z.string(),
  supplierId: z.string(),
  supplierName: z.string(),
  poNo: z.string().nullable(),
  discrepancyId: z.string().nullable(),
  reason: z.string(),
  returnedOn: z.string(),
  credit: z.string(),
  lines: z.array(
    z.object({
      id: z.string(),
      itemId: z.string(),
      itemCode: z.string(),
      itemName: z.string(),
      qty: z.number().int(),
      serialNo: z.string().nullable(),
      unitCost: z.string(),
    }),
  ),
});
export type PurchaseReturn = z.infer<typeof PurchaseReturnSchema>;
export const PurchaseReturnListQuerySchema = PaginationQuerySchema.extend({
  supplierId: z.uuid().optional(),
  branchId: z.uuid().optional(),
});
export const PurchaseReturnListResponseSchema = paginatedSchema(PurchaseReturnSchema);
export type PurchaseReturnListResponse = z.infer<typeof PurchaseReturnListResponseSchema>;

/** Fields the goods receipt, discrepancy and purchase return lists can be sorted by. */
export const GOODS_RECEIPT_SORT_FIELDS = ['receivedAt', 'grnNo', 'createdAt'] as const;
export const DISCREPANCY_SORT_FIELDS = ['createdAt', 'status', 'type', 'qty'] as const;
export const PURCHASE_RETURN_SORT_FIELDS = ['createdAt', 'returnNo'] as const;
