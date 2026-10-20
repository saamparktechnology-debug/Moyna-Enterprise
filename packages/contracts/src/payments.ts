import { z } from 'zod';
import { DateOnlySchema } from './battery-dates.js';
import { MoneyAmountSchema } from './billing.js';
import { paginatedSchema, PaginationQuerySchema } from './pagination.js';

export const MAX_PAYMENT_ALLOCATIONS = 100;

const ReasonSchema = z.string().trim().min(3, 'Give a reason of at least 3 characters').max(300);

/** An amount of money that must be more than zero. */
export const PositiveMoneySchema = MoneyAmountSchema.refine(
  (value) => Number(value) > 0,
  'The amount must be more than zero',
);

/** Money in paise, so amounts can be added and compared without floating-point error. */
export function toPaise(value: string): number {
  const [rupees = '0', fraction = ''] = value.trim().split('.');
  return Number(rupees) * 100 + Number(fraction.padEnd(2, '0'));
}

export const PAYMENT_STATUSES = ['ACTIVE', 'REVERSED'] as const;
export const PaymentStatusSchema = z.enum(PAYMENT_STATUSES);
export type PaymentStatusName = z.infer<typeof PaymentStatusSchema>;

export const PaymentAllocationInputSchema = z.object({
  invoiceId: z.uuid('Choose the invoice'),
  amount: PositiveMoneySchema,
});
export type PaymentAllocationInput = z.input<typeof PaymentAllocationInputSchema>;

function checkAllocations(
  allocations: readonly { invoiceId: string; amount: string }[],
  limit: string | null,
  context: z.RefinementCtx,
): void {
  const seen = new Set<string>();
  let total = 0;
  allocations.forEach((allocation, index) => {
    if (seen.has(allocation.invoiceId))
      context.addIssue({
        code: 'custom',
        path: ['allocations', index, 'invoiceId'],
        message: 'This invoice is already listed',
      });
    seen.add(allocation.invoiceId);
    total += toPaise(allocation.amount);
  });
  if (limit !== null && total > toPaise(limit))
    context.addIssue({
      code: 'custom',
      path: ['allocations'],
      message: 'The invoice amounts add up to more than the payment',
    });
}

/**
 * Records money received from a customer. The browser creates one `idempotencyKey` per form, so a retried or
 * double-clicked request is recognised and answered with the payment it already created instead of taking the money twice.
 * Leave `allocations` empty to keep the whole amount as an advance, or set `allocateAutomatically` to settle the oldest
 * dues first. Whatever is not applied to an invoice stays with the customer as credit.
 */
export const RecordPaymentRequestSchema = z
  .object({
    customerId: z.uuid('Choose the customer'),
    branchId: z.uuid().optional(),
    mode: z.string('Choose how it was paid').trim().min(1, 'Choose how it was paid').max(30),
    amount: PositiveMoneySchema,
    paidOn: DateOnlySchema,
    reference: z.string().trim().min(1).max(60).optional(),
    note: z.string().trim().min(1).max(300).optional(),
    idempotencyKey: z.string().trim().min(8).max(100),
    allocateAutomatically: z.boolean().default(false),
    allocations: z.array(PaymentAllocationInputSchema).max(MAX_PAYMENT_ALLOCATIONS).default([]),
  })
  .superRefine((value, context) => {
    if (value.allocateAutomatically && value.allocations.length > 0)
      context.addIssue({
        code: 'custom',
        path: ['allocations'],
        message: 'Choose either automatic allocation or the invoices, not both',
      });
    checkAllocations(value.allocations, value.amount, context);
  });
export type RecordPaymentRequest = z.input<typeof RecordPaymentRequestSchema>;

export const ReversePaymentRequestSchema = z.object({ reason: ReasonSchema });
export type ReversePaymentRequest = z.input<typeof ReversePaymentRequestSchema>;

/** Applies what is left of a payment to more invoices. */
export const ApplyPaymentRequestSchema = z
  .object({
    allocateAutomatically: z.boolean().default(false),
    allocations: z.array(PaymentAllocationInputSchema).max(MAX_PAYMENT_ALLOCATIONS).default([]),
  })
  .superRefine((value, context) => {
    if (value.allocateAutomatically === value.allocations.length > 0)
      context.addIssue({
        code: 'custom',
        path: ['allocations'],
        message: 'Choose the invoices, or ask for automatic allocation',
      });
    checkAllocations(value.allocations, null, context);
  });
export type ApplyPaymentRequest = z.input<typeof ApplyPaymentRequestSchema>;

export const PaymentAllocationSchema = z.object({
  invoiceId: z.string(),
  invoiceNo: z.string().nullable(),
  amount: z.string(),
});
export type PaymentAllocation = z.infer<typeof PaymentAllocationSchema>;

export const PaymentReversalSchema = z.object({
  reason: z.string(),
  reversedOn: z.string(),
  reversedAt: z.string(),
  reversedByName: z.string().nullable(),
});

export const PaymentSchema = z.object({
  id: z.string(),
  receiptNo: z.string(),
  status: PaymentStatusSchema,
  branchId: z.string(),
  branchCode: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  mode: z.string(),
  modeName: z.string(),
  amount: z.string(),
  /** The part of the payment applied to invoices. */
  allocated: z.string(),
  /** The part still held for the customer as credit. Zero for a reversed payment. */
  unallocated: z.string(),
  paidOn: z.string(),
  reference: z.string().nullable(),
  note: z.string().nullable(),
  allocations: z.array(PaymentAllocationSchema),
  reversal: PaymentReversalSchema.nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
});
export type Payment = z.infer<typeof PaymentSchema>;

export const PaymentSummarySchema = PaymentSchema.omit({
  allocations: true,
  note: true,
  reversal: true,
});
export type PaymentSummary = z.infer<typeof PaymentSummarySchema>;

export const PAYMENT_SORT_FIELDS = ['paidOn', 'createdAt', 'amount', 'receiptNo'] as const;
export const PaymentListQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['all', ...PAYMENT_STATUSES]).default('all'),
  customerId: z.uuid().optional(),
  branchId: z.uuid().optional(),
  mode: z.string().trim().max(30).optional(),
  /** Only payments that still hold credit for the customer. Needs a customer. */
  withCredit: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  from: DateOnlySchema.optional(),
  to: DateOnlySchema.optional(),
}).superRefine((value, context) => {
  if (value.withCredit && !value.customerId)
    context.addIssue({
      code: 'custom',
      path: ['customerId'],
      message: 'Choose the customer to see the payments that hold credit',
    });
});
export type PaymentListQuery = z.input<typeof PaymentListQuerySchema>;

export const PaymentListResponseSchema = paginatedSchema(PaymentSummarySchema);
export type PaymentListResponse = z.infer<typeof PaymentListResponseSchema>;

// ---------- dues ----------

export const DUE_STATUSES = ['UNPAID', 'PARTIAL', 'PAID'] as const;
export const DueStatusSchema = z.enum(DUE_STATUSES);
export type DueStatusName = z.infer<typeof DueStatusSchema>;

export const DueInvoiceSchema = z.object({
  invoiceId: z.string(),
  invoiceNo: z.string().nullable(),
  type: z.enum(['GST', 'NON_GST']),
  branchId: z.string(),
  branchCode: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  issuedOn: z.string().nullable(),
  dueDate: z.string().nullable(),
  total: z.string(),
  /** Approved credit notes against the invoice. */
  credited: z.string(),
  /** Money applied from payments that have not been reversed. */
  paid: z.string(),
  /** What is still owed. Never below zero. */
  outstanding: z.string(),
  /** Paid beyond what the invoice is now worth, for example after a credit note. Held for the customer. */
  surplus: z.string(),
  status: DueStatusSchema,
  overdue: z.boolean(),
  overdueDays: z.number().int().min(0),
});
export type DueInvoice = z.infer<typeof DueInvoiceSchema>;

export const DUE_SCOPES = ['outstanding', 'overdue', 'settled', 'all'] as const;
export const DUE_SORT_FIELDS = [
  'dueDate',
  'issuedOn',
  'invoiceNo',
  'outstanding',
  'customerName',
] as const;
export const DueListQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  scope: z.enum(DUE_SCOPES).default('outstanding'),
  customerId: z.uuid().optional(),
  branchId: z.uuid().optional(),
});
export type DueListQuery = z.input<typeof DueListQuerySchema>;

export const DueTotalsSchema = z.object({
  invoices: z.number().int(),
  outstanding: z.string(),
  overdue: z.string(),
});

export const DueListResponseSchema = paginatedSchema(DueInvoiceSchema).extend({
  /** Over every invoice that matches the filters, not only this page. */
  totals: DueTotalsSchema,
});
export type DueListResponse = z.infer<typeof DueListResponseSchema>;

export const CustomerDueSchema = z.object({
  customerId: z.string(),
  customerName: z.string(),
  phone: z.string().nullable(),
  openInvoices: z.number().int(),
  outstanding: z.string(),
  overdue: z.string(),
  /** Credit held for the customer: unapplied payments plus invoice surpluses. */
  credit: z.string(),
});
export type CustomerDue = z.infer<typeof CustomerDueSchema>;

export const CUSTOMER_DUE_SORT_FIELDS = ['customerName', 'outstanding', 'overdue'] as const;
export const CustomerDueListQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  branchId: z.uuid().optional(),
});
export type CustomerDueListQuery = z.input<typeof CustomerDueListQuerySchema>;
export const CustomerDueListResponseSchema = paginatedSchema(CustomerDueSchema);
export type CustomerDueListResponse = z.infer<typeof CustomerDueListResponseSchema>;

// ---------- customer ledger ----------

export const LEDGER_ENTRY_TYPES = [
  'INVOICE',
  'INVOICE_CANCELLED',
  'CREDIT_NOTE',
  'PAYMENT',
  'PAYMENT_REVERSAL',
  'REFUND',
] as const;
export const LedgerEntryTypeSchema = z.enum(LEDGER_ENTRY_TYPES);
export type LedgerEntryType = z.infer<typeof LedgerEntryTypeSchema>;

export const LedgerEntrySchema = z.object({
  date: z.string(),
  type: LedgerEntryTypeSchema,
  documentNo: z.string().nullable(),
  documentId: z.string(),
  branchCode: z.string(),
  description: z.string(),
  /** Adds to what the customer owes. */
  debit: z.string(),
  /** Reduces what the customer owes. */
  credit: z.string(),
  /** What the customer owes after this entry. A negative figure means the customer has credit. */
  balance: z.string(),
});
export type LedgerEntry = z.infer<typeof LedgerEntrySchema>;

export const LedgerQuerySchema = PaginationQuerySchema.extend({
  from: DateOnlySchema.optional(),
  to: DateOnlySchema.optional(),
  branchId: z.uuid().optional(),
});
export type LedgerQuery = z.input<typeof LedgerQuerySchema>;

export const CustomerLedgerSchema = paginatedSchema(LedgerEntrySchema).extend({
  customerId: z.string(),
  customerName: z.string(),
  /** What the customer owes now, over every entry the caller can see. Negative means credit. */
  balance: z.string(),
});
export type CustomerLedger = z.infer<typeof CustomerLedgerSchema>;

/** Payment modes only the system uses. Money taken as the value of an old unit in an exchange is recorded in `EXCHANGE`. */
export const RESERVED_PAYMENT_MODES: readonly string[] = ['EXCHANGE'];

// ---------- refunds of a customer's credit ----------

/** Pays a customer back money they hold as credit. Only credit that is not held for an open order can be refunded. */
export const CreateRefundRequestSchema = z.object({
  customerId: z.uuid('Choose the customer'),
  branchId: z.uuid().optional(),
  amount: PositiveMoneySchema,
  mode: z
    .string('Choose how it was paid back')
    .trim()
    .min(1, 'Choose how it was paid back')
    .max(30),
  paidOn: DateOnlySchema,
  reference: z.string().trim().min(1).max(60).optional(),
  reason: z.string().trim().min(3, 'Give a reason of at least 3 characters').max(300),
  idempotencyKey: z.string().trim().min(8).max(100),
});
export type CreateRefundRequest = z.input<typeof CreateRefundRequestSchema>;

export const RefundSchema = z.object({
  id: z.string(),
  refundNo: z.string(),
  branchId: z.string(),
  branchCode: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  amount: z.string(),
  mode: z.string(),
  modeName: z.string(),
  paidOn: z.string(),
  reference: z.string().nullable(),
  reason: z.string(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
});
export type Refund = z.infer<typeof RefundSchema>;

/** What a customer holds in one branch, and how much of it can be paid back. */
export const CustomerCreditSchema = z.object({
  customerId: z.string(),
  branchId: z.string(),
  /** Unapplied payments and what was overpaid on invoices, less refunds already paid. */
  credit: z.string(),
  /** Advances held for an accepted quotation: they belong to that order and cannot be refunded. */
  heldForOrders: z.string(),
  refunded: z.string(),
  /** What can be refunded now. */
  refundable: z.string(),
});
export type CustomerCredit = z.infer<typeof CustomerCreditSchema>;

export const RefundListQuerySchema = PaginationQuerySchema.extend({
  customerId: z.uuid().optional(),
  branchId: z.uuid().optional(),
});
export type RefundListQuery = z.input<typeof RefundListQuerySchema>;
export const RefundListResponseSchema = paginatedSchema(RefundSchema);
export type RefundListResponse = z.infer<typeof RefundListResponseSchema>;

export const CustomerCreditQuerySchema = z.object({
  customerId: z.uuid('Choose the customer'),
  branchId: z.uuid().optional(),
});

/** Fields a refund list can be sorted by. */
export const REFUND_SORT_FIELDS = ['paidOn', 'createdAt', 'amount', 'refundNo'] as const;
