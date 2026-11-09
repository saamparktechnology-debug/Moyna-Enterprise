import { z } from 'zod';
import { DateOnlySchema } from './battery-dates.js';
import { MoneyAmountSchema } from './billing.js';
import { KycMimeSchema, PhoneSchema } from './customers.js';
import { paginatedSchema, PaginationQuerySchema } from './pagination.js';

export const COMMISSION_RULE_TYPES = ['PERCENT', 'FIXED'] as const;
export const CommissionRuleTypeSchema = z.enum(COMMISSION_RULE_TYPES);
export type CommissionRuleTypeName = z.infer<typeof CommissionRuleTypeSchema>;

/** How a commission came about: from the broker's standing rule, or agreed on the invoice as an amount or a gift. */
export const COMMISSION_KINDS = ['RULE', 'FIXED', 'GIFT'] as const;
export const CommissionKindSchema = z.enum(COMMISSION_KINDS);
export type CommissionKindName = z.infer<typeof CommissionKindSchema>;

export const COMMISSION_STATUSES = ['PAYABLE', 'PAID', 'REVERSED'] as const;
export const CommissionStatusSchema = z.enum(COMMISSION_STATUSES);
export type CommissionStatusName = z.infer<typeof CommissionStatusSchema>;

const BrokerNameSchema = z
  .string()
  .trim()
  .min(2, 'Enter at least 2 characters')
  .max(120, 'Use at most 120 characters');

export const BrokerAddressSchema = z
  .string()
  .trim()
  .min(1, 'Enter the address')
  .max(500, 'Use at most 500 characters');

export const CreateBrokerRequestSchema = z.object({
  name: BrokerNameSchema,
  phone: PhoneSchema.nullable().default(null),
  address: BrokerAddressSchema.nullable().default(null),
});
export type CreateBrokerRequest = z.input<typeof CreateBrokerRequestSchema>;

export const UpdateBrokerRequestSchema = z
  .object({
    name: BrokerNameSchema.optional(),
    phone: PhoneSchema.nullable().optional(),
    address: BrokerAddressSchema.nullable().optional(),
    isActive: z.boolean().optional(),
    rowVersion: z.number().int().min(1),
  })
  .refine((value) => Object.keys(value).some((key) => key !== 'rowVersion'), {
    message: 'Change at least one field',
  });
export type UpdateBrokerRequest = z.input<typeof UpdateBrokerRequestSchema>;

/**
 * Adds a commission rule and retires the one in force. A rule is never edited: the commissions already worked out keep
 * pointing at the terms they were worked out on. A percentage is of the invoice's taxable value (before GST), up to 100;
 * a fixed amount is paid once per invoice, and never more than the taxable value.
 */
export const AddCommissionRuleRequestSchema = z
  .object({
    type: CommissionRuleTypeSchema,
    value: MoneyAmountSchema,
  })
  .superRefine((rule, context) => {
    const value = Number(rule.value);
    if (!(value > 0))
      context.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'The value must be more than zero',
      });
    else if (rule.type === 'PERCENT' && value > 100)
      context.addIssue({
        code: 'custom',
        path: ['value'],
        message: 'A percentage cannot be more than 100',
      });
  });
export type AddCommissionRuleRequest = z.input<typeof AddCommissionRuleRequestSchema>;

export const CommissionRuleSchema = z.object({
  id: z.string(),
  type: CommissionRuleTypeSchema,
  value: z.string(),
  isActive: z.boolean(),
  createdAt: z.string(),
  createdByName: z.string().nullable(),
});
export type CommissionRule = z.infer<typeof CommissionRuleSchema>;

export const BROKER_FILE_KINDS = ['PHOTO', 'DOCUMENT'] as const;
export const BrokerFileKindSchema = z.enum(BROKER_FILE_KINDS);

/** A photo or a document kept for a broker (an ID proof, an agreement). Documents may be PDF, JPEG or PNG; the photo only JPEG or PNG. */
export const BrokerFileSchema = z.object({
  id: z.string(),
  kind: BrokerFileKindSchema,
  label: z.string().nullable(),
  fileName: z.string(),
  mimeType: KycMimeSchema,
  sizeBytes: z.number().int(),
  uploadedAt: z.string(),
});
export type BrokerFile = z.infer<typeof BrokerFileSchema>;

/** The file is sent as the request body; its name, and for a document what it is, are in the query. */
export const BrokerFileUploadQuerySchema = z.object({
  fileName: z
    .string()
    .trim()
    .min(1, 'The file has no name')
    .max(160, 'The file name is too long')
    .refine(
      (name) => ![...name].some((ch) => ch === '/' || ch === '\\' || ch.charCodeAt(0) < 32),
      'The file name has characters that are not allowed',
    ),
  label: z.string().trim().min(1).max(80, 'Use at most 80 characters').optional(),
});
export type BrokerFileUploadQuery = z.infer<typeof BrokerFileUploadQuerySchema>;

export const BrokerSummarySchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string().nullable(),
  address: z.string().nullable().optional(),
  /** True when a photo is on file. */
  hasPhoto: z.boolean().optional(),
  isActive: z.boolean(),
  /** The standing rule in force, if any. A rule is no longer needed to put a broker on an invoice: commission is agreed on the invoice. */
  activeRule: z.object({ type: CommissionRuleTypeSchema, value: z.string() }).nullable(),
  /** Commission still to be paid to the broker, after credit notes. */
  payable: z.string(),
  /** Commission paid out and since lowered by a credit note or a cancellation: money to get back from the broker. */
  toRecover: z.string(),
  createdAt: z.string(),
});
export type BrokerSummary = z.infer<typeof BrokerSummarySchema>;

export const BrokerSchema = BrokerSummarySchema.extend({
  rowVersion: z.number().int(),
  rules: z.array(CommissionRuleSchema),
  photo: BrokerFileSchema.nullable().optional(),
  documents: z.array(BrokerFileSchema).optional(),
});
export type Broker = z.infer<typeof BrokerSchema>;

export const BROKER_SORT_FIELDS = ['name', 'createdAt'] as const;
export const BrokerListQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['all', 'active', 'inactive']).default('all'),
});
export type BrokerListQuery = z.input<typeof BrokerListQuerySchema>;
export const BrokerListResponseSchema = paginatedSchema(BrokerSummarySchema);
export type BrokerListResponse = z.infer<typeof BrokerListResponseSchema>;

export const CommissionSchema = z.object({
  id: z.string(),
  status: CommissionStatusSchema,
  branchId: z.string(),
  branchCode: z.string(),
  brokerId: z.string(),
  brokerName: z.string(),
  invoiceId: z.string(),
  invoiceNo: z.string().nullable(),
  customerName: z.string(),
  /** `RULE`: worked out from the broker's rule. `FIXED`: an amount agreed on the invoice. `GIFT`: a gift agreed on the invoice, worth `amount`. */
  kind: CommissionKindSchema.optional(),
  /** The rule the commission was worked out on; `null` when it was agreed on the invoice. */
  ruleType: CommissionRuleTypeSchema.nullable(),
  ruleValue: z.string().nullable(),
  giftName: z.string().nullable().optional(),
  hasGiftPhoto: z.boolean().optional(),
  /** The invoice's taxable value, which the commission was worked out on. */
  baseAmount: z.string(),
  /** The commission when it was worked out. */
  amount: z.string(),
  /** What credit notes and a cancellation have taken off since. */
  adjusted: z.string(),
  /** What it is worth now: `amount` less `adjusted`. */
  effective: z.string(),
  paidAt: z.string().nullable(),
  paidAmount: z.string().nullable(),
  payoutReference: z.string().nullable(),
  /** For a paid commission lowered afterwards: what the broker was paid beyond what it is now worth. */
  toRecover: z.string(),
  createdAt: z.string(),
});
export type Commission = z.infer<typeof CommissionSchema>;

export const COMMISSION_SORT_FIELDS = ['createdAt', 'amount'] as const;
export const CommissionListQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  status: z.enum(['all', ...COMMISSION_STATUSES]).default('all'),
  brokerId: z.uuid().optional(),
  branchId: z.uuid().optional(),
});
export type CommissionListQuery = z.input<typeof CommissionListQuerySchema>;
export const CommissionListResponseSchema = paginatedSchema(CommissionSchema);
export type CommissionListResponse = z.infer<typeof CommissionListResponseSchema>;

export const MAX_PAYOUT_COMMISSIONS = 100;

/** Pays out commissions to one broker. Each is paid at what it is worth now. */
export const PayoutRequestSchema = z.object({
  commissionIds: z
    .array(z.uuid())
    .min(1, 'Choose at least one commission')
    .max(MAX_PAYOUT_COMMISSIONS)
    .refine((ids) => new Set(ids).size === ids.length, 'A commission is listed twice'),
  reference: z.string().trim().min(1).max(100).optional(),
});
export type PayoutRequest = z.input<typeof PayoutRequestSchema>;

export const PayoutResponseSchema = z.object({
  brokerId: z.string(),
  brokerName: z.string(),
  total: z.string(),
  commissions: z.array(CommissionSchema),
});
export type PayoutResponse = z.infer<typeof PayoutResponseSchema>;

export const BROKER_LEDGER_TYPES = [
  'COMMISSION',
  'CREDIT_NOTE',
  'INVOICE_CANCELLED',
  'PAYOUT',
] as const;
export const BrokerLedgerEntrySchema = z.object({
  date: z.string(),
  type: z.enum(BROKER_LEDGER_TYPES),
  documentNo: z.string().nullable(),
  documentId: z.string(),
  branchCode: z.string(),
  description: z.string(),
  /** Adds to what is owed to the broker. */
  increase: z.string(),
  /** Takes from what is owed to the broker. */
  decrease: z.string(),
  /** What is owed to the broker after this entry. A negative figure means the broker owes money back. */
  balance: z.string(),
});
export type BrokerLedgerEntry = z.infer<typeof BrokerLedgerEntrySchema>;

export const BrokerLedgerQuerySchema = PaginationQuerySchema.extend({
  from: DateOnlySchema.optional(),
  to: DateOnlySchema.optional(),
});
export type BrokerLedgerQuery = z.input<typeof BrokerLedgerQuerySchema>;

export const BrokerLedgerSchema = paginatedSchema(BrokerLedgerEntrySchema).extend({
  brokerId: z.string(),
  brokerName: z.string(),
  /** What is owed to the broker now, over every entry the caller can see. Negative means the broker owes money back. */
  balance: z.string(),
});
export type BrokerLedger = z.infer<typeof BrokerLedgerSchema>;
