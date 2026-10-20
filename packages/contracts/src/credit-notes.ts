import { z } from 'zod';
import { paginatedSchema, PaginationQuerySchema } from './pagination.js';

export const CREDIT_NOTE_STATUSES = ['PENDING', 'APPROVED', 'REJECTED'] as const;
export const CreditNoteStatusSchema = z.enum(CREDIT_NOTE_STATUSES);
export type CreditNoteStatusName = z.infer<typeof CreditNoteStatusSchema>;

export const MAX_CREDIT_NOTE_LINES = 100;

const ReasonSchema = z.string().trim().min(3, 'Give a reason of at least 3 characters').max(300);

export const CreditNoteLineInputSchema = z.object({
  invoiceLineId: z.uuid('Choose the invoice line'),
  qty: z
    .number('Enter a whole number')
    .int('Enter a whole number')
    .min(1, 'At least 1')
    .max(10_000, 'Too many'),
});

export const CreateCreditNoteRequestSchema = z
  .object({
    invoiceId: z.uuid('Choose the invoice'),
    reason: ReasonSchema,
    lines: z
      .array(CreditNoteLineInputSchema)
      .min(1, 'Choose at least one line to credit')
      .max(MAX_CREDIT_NOTE_LINES),
  })
  .superRefine((value, context) => {
    const seen = new Set<string>();
    value.lines.forEach((line, index) => {
      if (seen.has(line.invoiceLineId))
        context.addIssue({
          code: 'custom',
          path: ['lines', index, 'invoiceLineId'],
          message: 'This line is already on the credit note',
        });
      seen.add(line.invoiceLineId);
    });
  });
export type CreateCreditNoteRequest = z.input<typeof CreateCreditNoteRequestSchema>;

export const ApproveCreditNoteRequestSchema = z.object({ rowVersion: z.number().int().min(1) });
export const RejectCreditNoteRequestSchema = z.object({
  rowVersion: z.number().int().min(1),
  reason: ReasonSchema,
});
export type RejectCreditNoteRequest = z.input<typeof RejectCreditNoteRequestSchema>;

export const CreditNoteLineSchema = z.object({
  id: z.string(),
  invoiceLineId: z.string(),
  itemId: z.string(),
  itemCode: z.string(),
  itemName: z.string(),
  serialUnitId: z.string().nullable(),
  serialNo: z.string().nullable(),
  qty: z.number().int(),
  taxableAmount: z.string(),
  cgstAmount: z.string(),
  sgstAmount: z.string(),
  igstAmount: z.string(),
  amount: z.string(),
});

export const CreditNoteSchema = z.object({
  id: z.string(),
  creditNoteNo: z.string().nullable(),
  status: CreditNoteStatusSchema,
  branchId: z.string(),
  branchCode: z.string(),
  invoiceId: z.string(),
  invoiceNo: z.string().nullable(),
  customerName: z.string(),
  reason: z.string(),
  taxableValue: z.string(),
  cgstAmount: z.string(),
  sgstAmount: z.string(),
  igstAmount: z.string(),
  amount: z.string(),
  requestedByName: z.string().nullable(),
  createdAt: z.string(),
  decidedByName: z.string().nullable(),
  decidedAt: z.string().nullable(),
  decisionNote: z.string().nullable(),
  lines: z.array(CreditNoteLineSchema),
  rowVersion: z.number().int(),
});
export type CreditNote = z.infer<typeof CreditNoteSchema>;

export const CreditNoteSummarySchema = z.object({
  id: z.string(),
  creditNoteNo: z.string().nullable(),
  status: CreditNoteStatusSchema,
  branchCode: z.string(),
  invoiceId: z.string(),
  invoiceNo: z.string().nullable(),
  customerName: z.string(),
  amount: z.string(),
  requestedByName: z.string().nullable(),
  lineCount: z.number().int(),
  createdAt: z.string(),
});
export type CreditNoteSummary = z.infer<typeof CreditNoteSummarySchema>;

export const CREDIT_NOTE_SORT_FIELDS = ['createdAt', 'creditNoteNo', 'amount'] as const;
export const CreditNoteListQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['all', ...CREDIT_NOTE_STATUSES]).default('all'),
  invoiceId: z.uuid().optional(),
  branchId: z.uuid().optional(),
});
export type CreditNoteListQuery = z.input<typeof CreditNoteListQuerySchema>;
export const CreditNoteListResponseSchema = paginatedSchema(CreditNoteSummarySchema);
export type CreditNoteListResponse = z.infer<typeof CreditNoteListResponseSchema>;

/** What can still be credited on each line of an invoice: what was sold, what is already credited or waiting, and the rest. */
export const ReturnableLineSchema = z.object({
  invoiceLineId: z.string(),
  itemCode: z.string(),
  itemName: z.string(),
  serialNo: z.string().nullable(),
  soldQty: z.number().int(),
  creditedQty: z.number().int(),
  returnableQty: z.number().int(),
});
export type ReturnableLine = z.infer<typeof ReturnableLineSchema>;
export const ReturnableResponseSchema = z.array(ReturnableLineSchema);
