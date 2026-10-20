import { z } from 'zod';
import { DateOnlySchema } from './battery-dates.js';
import {
  InvoiceTypeSchema,
  MAX_INVOICE_LINES,
  MAX_LINE_QTY,
  MoneyAmountSchema,
} from './billing.js';
import { PositiveMoneySchema } from './payments.js';
import { paginatedSchema, PaginationQuerySchema } from './pagination.js';

export const QUOTATION_STATUSES = [
  'DRAFT',
  'SENT',
  'ACCEPTED',
  'EXPIRED',
  'CONVERTED',
  'CANCELLED',
] as const;
export const QuotationStatusSchema = z.enum(QUOTATION_STATUSES);
export type QuotationStatusName = z.infer<typeof QuotationStatusSchema>;

export const BUILD_STAGES = ['NOT_STARTED', 'IN_BUILD', 'QUALITY_CHECK', 'READY'] as const;
export const BuildStageSchema = z.enum(BUILD_STAGES);
export type BuildStageName = z.infer<typeof BuildStageSchema>;

/**
 * Where the build of a custom order may go next. Forward to any later stage, and from quality check back to the build
 * when the check fails. Nothing leaves READY. The database enforces the same rule.
 */
export function allowedNextBuildStages(from: BuildStageName): BuildStageName[] {
  if (from === 'READY') return [];
  const index = BUILD_STAGES.indexOf(from);
  const later = BUILD_STAGES.slice(index + 1);
  return from === 'QUALITY_CHECK' ? ['IN_BUILD', ...later] : [...later];
}

/** A quotation can still be worked on while it is in one of these. */
export function isOpenQuotation(status: QuotationStatusName): boolean {
  return status === 'DRAFT' || status === 'SENT' || status === 'ACCEPTED';
}

const ReasonSchema = z.string().trim().min(3, 'Give a reason of at least 3 characters').max(300);
const NoteSchema = z
  .string()
  .trim()
  .min(1, 'Write something')
  .max(500, 'Use at most 500 characters');
const IdentifierSchema = z
  .string()
  .trim()
  .min(3, 'Enter at least 3 characters')
  .max(40, 'Use at most 40 characters')
  .regex(/^[A-Za-z0-9][A-Za-z0-9 ._/-]*$/, 'Use letters, digits and - . / _ only');

export const QuotationLineInputSchema = z.object({
  itemId: z.uuid('Choose the item'),
  qty: z
    .number('Enter a quantity')
    .int('The quantity must be a whole number')
    .min(1, 'The quantity must be at least 1')
    .max(MAX_LINE_QTY, `At most ${MAX_LINE_QTY}`),
  unitPrice: MoneyAmountSchema,
  discountAmount: MoneyAmountSchema.default('0.00'),
});
export type QuotationLineInput = z.input<typeof QuotationLineInputSchema>;

const QuotationBodyShape = {
  customerId: z.uuid('Choose the customer'),
  type: InvoiceTypeSchema,
  validUntil: DateOnlySchema,
  brokerId: z.uuid().nullable().default(null),
  isCustomBuild: z.boolean().default(false),
  /** What the customer wants built, for a customized order. */
  specification: z
    .string()
    .trim()
    .min(1)
    .max(1000, 'Use at most 1000 characters')
    .nullable()
    .default(null),
  lines: z
    .array(QuotationLineInputSchema)
    .min(1, 'Add at least one line')
    .max(MAX_INVOICE_LINES, `At most ${MAX_INVOICE_LINES} lines`),
};

function customNeedsSpecification(
  value: { isCustomBuild: boolean; specification: string | null },
  context: z.RefinementCtx,
): void {
  if (value.isCustomBuild && !value.specification)
    context.addIssue({
      code: 'custom',
      path: ['specification'],
      message: 'Describe what is to be built',
    });
  if (!value.isCustomBuild && value.specification)
    context.addIssue({
      code: 'custom',
      path: ['isCustomBuild'],
      message: 'A specification is for a customized build',
    });
}

export const CreateQuotationRequestSchema = z
  .object({ ...QuotationBodyShape, branchId: z.uuid().optional() })
  .superRefine(customNeedsSpecification);
export type CreateQuotationRequest = z.input<typeof CreateQuotationRequestSchema>;

export const UpdateQuotationRequestSchema = z
  .object({ ...QuotationBodyShape, rowVersion: z.number().int().min(1) })
  .superRefine(customNeedsSpecification);
export type UpdateQuotationRequest = z.input<typeof UpdateQuotationRequestSchema>;

export const QuotationVersionRequestSchema = z.object({ rowVersion: z.number().int().min(1) });
export type QuotationVersionRequest = z.input<typeof QuotationVersionRequestSchema>;

export const CancelQuotationRequestSchema = z.object({
  rowVersion: z.number().int().min(1),
  reason: ReasonSchema,
});
export type CancelQuotationRequest = z.input<typeof CancelQuotationRequestSchema>;

/** Money taken before the invoice, for an accepted quotation. Partial advances are fine; they never add up to more than the quotation. */
export const TakeAdvanceRequestSchema = z.object({
  mode: z.string('Choose how it was paid').trim().min(1, 'Choose how it was paid').max(30),
  amount: PositiveMoneySchema,
  paidOn: DateOnlySchema,
  reference: z.string().trim().min(1).max(60).optional(),
  note: z.string().trim().min(1).max(300).optional(),
  idempotencyKey: z.string().trim().min(8).max(100),
});
export type TakeAdvanceRequest = z.input<typeof TakeAdvanceRequestSchema>;

export const BuildUpdateRequestSchema = z.object({
  stage: BuildStageSchema,
  note: NoteSchema.optional(),
  rowVersion: z.number().int().min(1),
});
export type BuildUpdateRequest = z.input<typeof BuildUpdateRequestSchema>;

/**
 * Sets aside the vehicle that will be delivered on a line, and records its chassis and motor numbers. A number
 * already recorded on the vehicle cannot be replaced.
 */
export const AssignUnitRequestSchema = z.object({
  serialUnitId: z.uuid('Choose the vehicle'),
  chassisNo: IdentifierSchema.optional(),
  motorNo: IdentifierSchema.optional(),
  rowVersion: z.number().int().min(1),
});
export type AssignUnitRequest = z.input<typeof AssignUnitRequestSchema>;

/** Makes a draft invoice from an accepted quotation, at the quoted prices. */
export const ConvertQuotationRequestSchema = z.object({
  quotationId: z.uuid('Choose the quotation'),
  rowVersion: z.number().int().min(1),
  dueDate: DateOnlySchema.nullable().default(null),
});
export type ConvertQuotationRequest = z.input<typeof ConvertQuotationRequestSchema>;

// ---------- responses ----------

export const QuotationUnitSchema = z.object({
  id: z.string(),
  serialNo: z.string(),
  chassisNo: z.string().nullable(),
  motorNo: z.string().nullable(),
  /** Batteries installed in the vehicle, which go with it. */
  batteries: z.array(z.object({ id: z.string(), serialNo: z.string() })),
});
export type QuotationUnit = z.infer<typeof QuotationUnitSchema>;

export const QuotationLineSchema = z.object({
  id: z.string(),
  lineNo: z.number().int(),
  itemId: z.string(),
  itemCode: z.string(),
  itemName: z.string(),
  isSerialized: z.boolean(),
  qty: z.number().int(),
  unitPrice: z.string(),
  discountAmount: z.string(),
  taxRate: z.string().nullable(),
  taxableAmount: z.string(),
  amount: z.string(),
  unit: QuotationUnitSchema.nullable(),
});
export type QuotationLine = z.infer<typeof QuotationLineSchema>;

export const QuotationAdvanceSchema = z.object({
  paymentId: z.string(),
  receiptNo: z.string(),
  mode: z.string(),
  modeName: z.string(),
  amount: z.string(),
  paidOn: z.string(),
  reference: z.string().nullable(),
  status: z.enum(['ACTIVE', 'REVERSED']),
});
export type QuotationAdvance = z.infer<typeof QuotationAdvanceSchema>;

export const BuildUpdateSchema = z.object({
  id: z.string(),
  stage: BuildStageSchema,
  note: z.string().nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
});
export type BuildUpdate = z.infer<typeof BuildUpdateSchema>;

const TotalsShape = {
  subtotal: z.string(),
  discountTotal: z.string(),
  taxableValue: z.string(),
  cgstAmount: z.string(),
  sgstAmount: z.string(),
  igstAmount: z.string(),
  roundOff: z.string(),
  total: z.string(),
};

export const QuotationSummarySchema = z.object({
  id: z.string(),
  quotationNo: z.string(),
  status: QuotationStatusSchema,
  branchId: z.string(),
  branchCode: z.string(),
  customerId: z.string(),
  customerName: z.string(),
  type: InvoiceTypeSchema,
  validUntil: z.string(),
  isCustomBuild: z.boolean(),
  buildStage: BuildStageSchema,
  total: z.string(),
  /** Advances taken and not reversed. */
  advancePaid: z.string(),
  createdAt: z.string(),
});
export type QuotationSummary = z.infer<typeof QuotationSummarySchema>;

export const QuotationSchema = QuotationSummarySchema.extend({
  ...TotalsShape,
  placeOfSupply: z.string().nullable(),
  interState: z.boolean(),
  brokerId: z.string().nullable(),
  brokerName: z.string().nullable(),
  specification: z.string().nullable(),
  /** What is still to be paid: the total less the advances. Never below zero. */
  balanceDue: z.string(),
  sentAt: z.string().nullable(),
  acceptedAt: z.string().nullable(),
  cancelledAt: z.string().nullable(),
  cancelReason: z.string().nullable(),
  createdByName: z.string().nullable(),
  rowVersion: z.number().int(),
  lines: z.array(QuotationLineSchema),
  advances: z.array(QuotationAdvanceSchema),
  buildUpdates: z.array(BuildUpdateSchema),
  /** The invoice made from this quotation that is still standing (a draft or an issued one). */
  invoiceId: z.string().nullable(),
  invoiceNo: z.string().nullable(),
  invoiceStatus: z.enum(['DRAFT', 'ISSUED']).nullable(),
});
export type Quotation = z.infer<typeof QuotationSchema>;

export const QUOTATION_SORT_FIELDS = ['createdAt', 'validUntil', 'total', 'quotationNo'] as const;
export const QuotationListQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['all', 'open', ...QUOTATION_STATUSES]).default('all'),
  customerId: z.uuid().optional(),
  branchId: z.uuid().optional(),
  /** Only customized builds. */
  customOnly: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});
export type QuotationListQuery = z.input<typeof QuotationListQuerySchema>;
export const QuotationListResponseSchema = paginatedSchema(QuotationSummarySchema);
export type QuotationListResponse = z.infer<typeof QuotationListResponseSchema>;
