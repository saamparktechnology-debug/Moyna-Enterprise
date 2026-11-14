import { z } from 'zod';
import { DateOnlySchema } from './battery-dates.js';
import { BrokerFileUploadQuerySchema } from './brokers.js';
import { PhoneSchema } from './customers.js';

// ---------- what a customer promises, and who stands guarantor, on an invoice that is not paid ----------

export const DuePromiseSchema = z.object({
  id: z.string(),
  invoiceId: z.string(),
  promisedDate: z.string(),
  note: z.string().nullable(),
  createdAt: z.string(),
  createdByName: z.string().nullable(),
});
export type DuePromise = z.infer<typeof DuePromiseSchema>;

/** Every promise made on the invoice, the latest first. */
export const DuePromiseListResponseSchema = z.object({ items: z.array(DuePromiseSchema) });
export type DuePromiseListResponse = z.infer<typeof DuePromiseListResponseSchema>;

export const CreateDuePromiseRequestSchema = z.object({
  /** The day the customer says they will pay. It cannot be in the past. */
  promisedDate: DateOnlySchema,
  note: z.string().trim().min(1).max(200, 'Use at most 200 characters').optional(),
});
export type CreateDuePromiseRequest = z.input<typeof CreateDuePromiseRequestSchema>;

export const GuarantorKycSchema = z.object({
  fileName: z.string(),
  mimeType: z.string(),
  sizeBytes: z.number().int(),
});

export const GuarantorSchema = z.object({
  invoiceId: z.string(),
  name: z.string(),
  phone: z.string(),
  address: z.string().nullable(),
  relation: z.string().nullable(),
  /** The KYC file, when one was uploaded. It is optional. */
  kyc: GuarantorKycSchema.nullable(),
  rowVersion: z.number().int(),
});
export type Guarantor = z.infer<typeof GuarantorSchema>;

export const GuarantorResponseSchema = z.object({ guarantor: GuarantorSchema.nullable() });
export type GuarantorResponse = z.infer<typeof GuarantorResponseSchema>;

/** Sets the guarantor of an invoice, or replaces the details of the one already there (then rowVersion is needed). */
export const SetGuarantorRequestSchema = z.object({
  name: z
    .string('Enter the name')
    .trim()
    .min(2, 'Enter at least 2 characters')
    .max(120, 'Use at most 120 characters'),
  phone: PhoneSchema,
  address: z.string().trim().min(1).max(300, 'Use at most 300 characters').optional(),
  relation: z.string().trim().min(1).max(60, 'Use at most 60 characters').optional(),
  rowVersion: z.number().int().min(1).optional(),
});
export type SetGuarantorRequest = z.input<typeof SetGuarantorRequestSchema>;

/** The KYC file is sent as the request body (PDF, JPEG or PNG); its name is in the query. */
export const GuarantorKycUploadQuerySchema = BrokerFileUploadQuerySchema.pick({ fileName: true });
export type GuarantorKycUploadQuery = z.infer<typeof GuarantorKycUploadQuerySchema>;
