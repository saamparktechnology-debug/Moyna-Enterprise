import { z } from 'zod';
import { paginatedSchema, PaginationQuerySchema } from './pagination.js';
import { PositiveMoneySchema } from './payments.js';

/**
 * An old-for-new exchange takes back a vehicle that was sold to the customer earlier, at a value up to what they paid, against
 * a new vehicle. A new-for-new exchange swaps a vehicle for another, and takes the old one back at exactly the price paid.
 */
export const EXCHANGE_KINDS = ['OLD_FOR_NEW', 'NEW_FOR_NEW'] as const;
export const ExchangeKindSchema = z.enum(EXCHANGE_KINDS);
export type ExchangeKindName = z.infer<typeof ExchangeKindSchema>;

/** What becomes of the old vehicle: back into stock as returned goods, or scrapped. */
export const EXCHANGE_DISPOSITIONS = ['STOCK', 'SCRAP'] as const;
export const ExchangeDispositionSchema = z.enum(EXCHANGE_DISPOSITIONS);
export type ExchangeDispositionName = z.infer<typeof ExchangeDispositionSchema>;

export const EXCHANGE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'CANCELLED'] as const;
export const ExchangeStatusSchema = z.enum(EXCHANGE_STATUSES);
export type ExchangeStatusName = z.infer<typeof ExchangeStatusSchema>;

const ReasonSchema = z.string().trim().min(3, 'Give a reason of at least 3 characters').max(300);

export const RequestExchangeRequestSchema = z
  .object({
    /** The issued invoice that delivered the new vehicle. */
    invoiceId: z.uuid('Choose the invoice'),
    newSerialUnitId: z.uuid('Choose the new vehicle'),
    oldSerialUnitId: z.uuid('Choose the old vehicle'),
    kind: ExchangeKindSchema,
    /** What the old vehicle is worth in the exchange. Only for old-for-new; a new-for-new exchange takes it back at the price paid. */
    valuationAmount: PositiveMoneySchema.optional(),
    disposition: ExchangeDispositionSchema,
    reason: ReasonSchema,
  })
  .superRefine((value, context) => {
    if (value.newSerialUnitId === value.oldSerialUnitId)
      context.addIssue({
        code: 'custom',
        path: ['oldSerialUnitId'],
        message: 'The old and the new vehicle must be different',
      });
    if (value.kind === 'OLD_FOR_NEW' && value.valuationAmount === undefined)
      context.addIssue({
        code: 'custom',
        path: ['valuationAmount'],
        message: 'Say what the old vehicle is worth',
      });
    if (value.kind === 'NEW_FOR_NEW' && value.valuationAmount !== undefined)
      context.addIssue({
        code: 'custom',
        path: ['valuationAmount'],
        message: 'A new-for-new exchange takes the old vehicle back at the price paid',
      });
  });
export type RequestExchangeRequest = z.input<typeof RequestExchangeRequestSchema>;

export const ApproveExchangeRequestSchema = z.object({
  rowVersion: z.number().int().min(1),
  note: z.string().trim().min(1).max(300).optional(),
});
export type ApproveExchangeRequest = z.input<typeof ApproveExchangeRequestSchema>;

export const RejectExchangeRequestSchema = z.object({
  rowVersion: z.number().int().min(1),
  note: ReasonSchema,
});
export type RejectExchangeRequest = z.input<typeof RejectExchangeRequestSchema>;

/** Whether the customer pays more, gets a credit, or neither. */
export function settlementOf(difference: string): 'PAYABLE' | 'REFUNDABLE' | 'EVEN' {
  const value = Number(difference);
  if (value > 0) return 'PAYABLE';
  return value < 0 ? 'REFUNDABLE' : 'EVEN';
}

export const ExchangeUnitSchema = z.object({
  id: z.string(),
  serialNo: z.string(),
  itemCode: z.string(),
  itemName: z.string(),
  chassisNo: z.string().nullable(),
  motorNo: z.string().nullable(),
  state: z.string(),
  /** Batteries installed in the vehicle. */
  batteries: z.array(z.object({ id: z.string(), serialNo: z.string() })),
});
export type ExchangeUnit = z.infer<typeof ExchangeUnitSchema>;

export const ExchangeSummarySchema = z.object({
  id: z.string(),
  exchangeNo: z.string(),
  status: ExchangeStatusSchema,
  kind: ExchangeKindSchema,
  branchId: z.string(),
  branchCode: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  invoiceId: z.string(),
  invoiceNo: z.string().nullable(),
  originalInvoiceId: z.string(),
  originalInvoiceNo: z.string().nullable(),
  oldSerialNo: z.string(),
  newSerialNo: z.string(),
  valuationAmount: z.string(),
  newAmount: z.string(),
  /** The new vehicle's price less the valuation. Above zero the customer pays it; below zero it is held as credit for them. */
  differenceAmount: z.string(),
  settlement: z.enum(['PAYABLE', 'REFUNDABLE', 'EVEN']),
  disposition: ExchangeDispositionSchema,
  createdAt: z.string(),
});
export type ExchangeSummary = z.infer<typeof ExchangeSummarySchema>;

export const ExchangeSchema = ExchangeSummarySchema.extend({
  reason: z.string(),
  /** What the customer paid for the old vehicle, tax included. */
  returnedAmount: z.string(),
  decisionNote: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decidedByName: z.string().nullable(),
  createdByName: z.string().nullable(),
  rowVersion: z.number().int(),
  oldUnit: ExchangeUnitSchema,
  newUnit: ExchangeUnitSchema,
  /** The payment that applied the valuation to the delivery invoice, once approved. */
  tradeInPayment: z
    .object({
      id: z.string(),
      receiptNo: z.string(),
      amount: z.string(),
      /** How much of it went against the delivery invoice; the rest is credit held for the customer. */
      appliedToInvoice: z.string(),
    })
    .nullable(),
});
export type Exchange = z.infer<typeof ExchangeSchema>;

export const ExchangeOldUnitOptionSchema = z.object({
  unitId: z.string(),
  serialNo: z.string(),
  itemCode: z.string(),
  itemName: z.string(),
  chassisNo: z.string().nullable(),
  motorNo: z.string().nullable(),
  originalInvoiceId: z.string(),
  originalInvoiceNo: z.string().nullable(),
  soldOn: z.string().nullable(),
  /** What the customer paid for it, tax included: the most it can be valued at. */
  lineAmount: z.string(),
  batteries: z.array(z.object({ id: z.string(), serialNo: z.string() })),
});

export const ExchangeOptionsSchema = z.object({
  invoiceId: z.string(),
  invoiceNo: z.string().nullable(),
  customerName: z.string(),
  /** Vehicles on the delivery invoice that can be the new one. */
  newUnits: z.array(
    z.object({
      unitId: z.string(),
      serialNo: z.string(),
      itemCode: z.string(),
      itemName: z.string(),
      lineAmount: z.string(),
    }),
  ),
  /** Vehicles sold to this customer that can be taken back. */
  oldUnits: z.array(ExchangeOldUnitOptionSchema),
});
export type ExchangeOptions = z.infer<typeof ExchangeOptionsSchema>;

export const EXCHANGE_SORT_FIELDS = ['createdAt', 'differenceAmount', 'exchangeNo'] as const;
export const ExchangeListQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['all', ...EXCHANGE_STATUSES]).default('all'),
  kind: z.enum(['all', ...EXCHANGE_KINDS]).default('all'),
  branchId: z.uuid().optional(),
  customerId: z.uuid().optional(),
});
export type ExchangeListQuery = z.input<typeof ExchangeListQuerySchema>;
export const ExchangeListResponseSchema = paginatedSchema(ExchangeSummarySchema);
export type ExchangeListResponse = z.infer<typeof ExchangeListResponseSchema>;

export const ExchangeOptionsQuerySchema = z.object({ invoiceId: z.uuid('Choose the invoice') });

/** The person who asked withdraws a request that is still waiting. */
export const CancelExchangeRequestSchema = z.object({ rowVersion: z.number().int().min(1) });
export type CancelExchangeRequest = z.input<typeof CancelExchangeRequestSchema>;
