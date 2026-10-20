import { z } from 'zod';
import { GstinSchema, StateCodeSchema, gstinProblem } from './branches.js';
import { paginatedSchema, PaginationQuerySchema } from './pagination.js';

export const KYC_STATUSES = ['NOT_SUBMITTED', 'PENDING', 'VERIFIED', 'REJECTED'] as const;
export const KycStatusSchema = z.enum(KYC_STATUSES);
export type KycStatusName = z.infer<typeof KycStatusSchema>;

export const PhoneSchema = z
  .string()
  .trim()
  .regex(/^[6-9][0-9]{9}$/, 'Enter a 10-digit mobile number');

const CustomerNameSchema = z
  .string()
  .trim()
  .min(2, 'Enter at least 2 characters')
  .max(120, 'Use at most 120 characters');
const AddressSchema = z.string().trim().min(1).max(300, 'Use at most 300 characters');
const EmailSchema = z.string().trim().toLowerCase().pipe(z.email('Enter a valid email address'));

function checkGstin(
  value: { gstin?: string | null | undefined; stateCode?: string | null | undefined },
  context: z.RefinementCtx,
): void {
  if (!value.gstin) return;
  const problem = gstinProblem(value.gstin, value.stateCode ?? undefined);
  if (problem) context.addIssue({ code: 'custom', path: ['gstin'], message: problem });
}

export const CreateCustomerRequestSchema = z
  .object({
    name: CustomerNameSchema,
    phone: PhoneSchema,
    email: EmailSchema.nullable().default(null),
    address: AddressSchema.nullable().default(null),
    stateCode: StateCodeSchema.nullable().default(null),
    gstin: GstinSchema.nullable().default(null),
  })
  .superRefine(checkGstin);
export type CreateCustomerRequest = z.input<typeof CreateCustomerRequestSchema>;

export const UpdateCustomerRequestSchema = z
  .object({
    name: CustomerNameSchema.optional(),
    phone: PhoneSchema.optional(),
    email: EmailSchema.nullable().optional(),
    address: AddressSchema.nullable().optional(),
    stateCode: StateCodeSchema.nullable().optional(),
    gstin: GstinSchema.nullable().optional(),
    rowVersion: z.number().int().min(1),
  })
  .refine((value) => Object.keys(value).some((key) => key !== 'rowVersion'), {
    message: 'Change at least one field',
  });
export type UpdateCustomerRequest = z.infer<typeof UpdateCustomerRequestSchema>;

export const CustomerSchema = z.object({
  id: z.string(),
  name: z.string(),
  phone: z.string(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  stateCode: z.string().nullable(),
  stateName: z.string().nullable(),
  gstin: z.string().nullable(),
  kycStatus: KycStatusSchema,
  rowVersion: z.number().int(),
  createdAt: z.string(),
});
export type Customer = z.infer<typeof CustomerSchema>;

export const CUSTOMER_SORT_FIELDS = ['name', 'phone', 'createdAt'] as const;
export const CustomerListQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  kycStatus: KycStatusSchema.optional(),
  stateCode: StateCodeSchema.optional(),
});
export type CustomerListQuery = z.input<typeof CustomerListQuerySchema>;
export const CustomerListResponseSchema = paginatedSchema(CustomerSchema);
export type CustomerListResponse = z.infer<typeof CustomerListResponseSchema>;

// ---------- KYC documents ----------

export const KYC_MAX_BYTES = 5 * 1024 * 1024;
export const KYC_ALLOWED_TYPES = ['application/pdf', 'image/jpeg', 'image/png'] as const;
export const KycMimeSchema = z.enum(KYC_ALLOWED_TYPES);
export type KycMime = z.infer<typeof KycMimeSchema>;

/** Documents that prove who the customer is. One verified document of these is needed for the customer to be verified. */
export const KYC_IDENTITY_TYPES = [
  'AADHAAR',
  'PAN',
  'VOTER_ID',
  'DRIVING_LICENCE',
  'PASSPORT',
] as const;

const NUMBER_FORMATS: Record<string, { pattern: RegExp; message: string }> = {
  AADHAAR: { pattern: /^[0-9]{12}$/, message: 'An Aadhaar number has 12 digits' },
  PAN: {
    pattern: /^[A-Z]{5}[0-9]{4}[A-Z]$/,
    message: 'A PAN has 5 letters, 4 digits and a letter',
  },
};
const GENERIC_NUMBER = {
  // 4 to 20 characters of letters, digits, dashes and slashes, with at least four letters or digits among them.
  pattern: /^(?=(?:[^A-Z0-9]*[A-Z0-9]){4})[A-Z0-9/-]{4,20}$/,
  message: 'Use 4 to 20 letters, digits, dashes or slashes',
};

/** The reason a document number is not acceptable for its type, or `null` when it is. */
export function documentNumberProblem(docType: string, raw: string): string | null {
  const value = normalizeDocumentNumber(raw);
  const format = NUMBER_FORMATS[docType] ?? GENERIC_NUMBER;
  return format.pattern.test(value) ? null : format.message;
}

export function normalizeDocumentNumber(raw: string): string {
  return raw.replace(/[\s]/g, '').toUpperCase();
}

/**
 * Hides all but the last four letters or digits (always at least one is hidden). Dashes and slashes are dropped first, so
 * what is kept is only ever letters and digits. The full number is never stored or logged.
 */
export function maskDocumentNumber(raw: string): string {
  const value = normalizeDocumentNumber(raw).replace(/[^A-Z0-9]/g, '');
  const visible = Math.min(4, value.length - 1);
  return `${'X'.repeat(value.length - visible)}${value.slice(value.length - visible)}`;
}

export const KycUploadQuerySchema = z.object({
  docType: z.string().trim().min(1, 'Choose the kind of document').max(40),
  fileName: z
    .string()
    .trim()
    .min(1, 'The file has no name')
    .max(160, 'The file name is too long')
    .refine(
      (name) => ![...name].some((ch) => ch === '/' || ch === '\\' || ch.charCodeAt(0) < 32),
      'The file name has characters that are not allowed',
    ),
});
export type KycUploadQuery = z.infer<typeof KycUploadQuerySchema>;

export const KycDocumentSchema = z.object({
  id: z.string(),
  customerId: z.string(),
  docType: z.string(),
  docTypeName: z.string(),
  status: KycStatusSchema,
  fileName: z.string(),
  mimeType: KycMimeSchema,
  sizeBytes: z.number().int(),
  docNumberMasked: z.string().nullable(),
  uploadedByName: z.string().nullable(),
  uploadedAt: z.string(),
  reviewedByName: z.string().nullable(),
  reviewedAt: z.string().nullable(),
  rejectionReason: z.string().nullable(),
  /** The latest document of its kind. The earlier ones stay as history. */
  isCurrent: z.boolean(),
  rowVersion: z.number().int(),
});
export type KycDocument = z.infer<typeof KycDocumentSchema>;

export const KycOverviewSchema = z.object({
  kycStatus: KycStatusSchema,
  documents: z.array(KycDocumentSchema),
});
export type KycOverview = z.infer<typeof KycOverviewSchema>;

export const KycDocumentTypeSchema = z.object({ code: z.string(), name: z.string() });
export type KycDocumentType = z.infer<typeof KycDocumentTypeSchema>;
export const KycDocumentTypeListResponseSchema = z.array(KycDocumentTypeSchema);

export const VerifyKycRequestSchema = z.object({ rowVersion: z.number().int().min(1) });
export const RejectKycRequestSchema = z.object({
  rowVersion: z.number().int().min(1),
  reason: z.string().trim().min(3, 'Give a reason of at least 3 characters').max(300),
});
export type RejectKycRequest = z.infer<typeof RejectKycRequestSchema>;

/**
 * A customer's KYC status follows the latest document of each kind. Any document waiting for review makes the customer
 * pending; otherwise the customer is verified once an identity document is verified; rejected documents alone leave
 * the customer rejected.
 */
export function computeKycStatus(
  current: readonly { docType: string; status: KycStatusName }[],
): KycStatusName {
  if (current.length === 0) return 'NOT_SUBMITTED';
  if (current.some((document) => document.status === 'PENDING')) return 'PENDING';
  const identity: readonly string[] = KYC_IDENTITY_TYPES;
  if (
    current.some(
      (document) => document.status === 'VERIFIED' && identity.includes(document.docType),
    )
  )
    return 'VERIFIED';
  if (current.some((document) => document.status === 'REJECTED')) return 'REJECTED';
  return 'PENDING';
}
