import { z } from 'zod';
import { DateOnlySchema } from './battery-dates.js';

/** What can be written inside an agreement's text as {{name}}; each is filled in for the employee when it is printed. */
export const AGREEMENT_PLACEHOLDERS = [
  { code: 'employee_name', label: 'Employee name' },
  { code: 'employee_code', label: 'Employee code' },
  { code: 'designation', label: 'Designation' },
  { code: 'department', label: 'Department' },
  { code: 'join_date', label: 'Date of joining' },
  { code: 'salary', label: 'Salary (the monthly salary or the daily rate)' },
  { code: 'duty_hours', label: 'Hours that make a full duty day' },
  { code: 'effective_from', label: 'Date the agreement starts' },
  { code: 'company_name', label: 'Company name' },
  { code: 'company_address', label: 'Company address' },
  { code: 'proprietor', label: 'Proprietor' },
  { code: 'today', label: 'Today’s date' },
] as const;
const PLACEHOLDER_CODES: readonly string[] = AGREEMENT_PLACEHOLDERS.map((entry) => entry.code);

/** The {{names}} in a text that are not one of the placeholders above (a typo would otherwise print as it is). */
export function unknownPlaceholders(text: string): string[] {
  const found = [...text.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)].map((match) => match[1] ?? '');
  return [...new Set(found.filter((name) => !PLACEHOLDER_CODES.includes(name)))];
}

/** The terms and rules, as plain text: a blank line starts a new paragraph. */
export const AgreementTextSchema = z
  .string('Enter the terms')
  .trim()
  .min(20, 'Enter the terms and rules')
  .max(30_000, 'The text is too long')
  .superRefine((text, context) => {
    const unknown = unknownPlaceholders(text);
    if (unknown.length > 0)
      context.addIssue({
        code: 'custom',
        message: `Unknown placeholder ${unknown.map((name) => `{{${name}}}`).join(', ')}`,
      });
  });

const TitleSchema = z
  .string()
  .trim()
  .min(3, 'Enter a title')
  .max(120, 'Use at most 120 characters');

/** Example terms to start a template from. Have your own lawyer or adviser review the wording before using it. */
export const STARTER_AGREEMENT_TEXT = `This agreement is made on {{effective_from}} between {{company_name}}, {{company_address}} (the Employer), and {{employee_name}}, employee code {{employee_code}} (the Employee).

1. Appointment. The Employee is employed as {{designation}} in {{department}}, from {{join_date}}.

2. Duty hours. A full duty day is {{duty_hours}} hours. The Employee punches in and out as work starts and stops, and the hours worked are taken from these punches.

3. Pay. The Employee is paid {{salary}}. Pay is made after the end of each month.

4. Leave. Leave is taken only with the Employer's approval. Leave without approval is not paid.

5. Conduct. The Employee will work honestly and carefully, look after the Employer's goods, stock and money, and follow the Employer's rules and instructions.

6. Confidentiality. The Employee will not share the Employer's prices, customers, suppliers or accounts with anyone outside the business, during the employment or after it.

7. Property. Everything given to the Employee for work, such as tools, keys and devices, remains the Employer's and is returned when the employment ends.

8. Ending the employment. Either side may end the employment by giving notice as the Employer's rules say. The Employer may end it at once for serious misconduct.

9. Changes. The Employer may change these terms and rules; a changed agreement takes effect only when it is signed again.

10. The Employee has read and understood this agreement, and signs it below.`;

export const AGREEMENT_STATUSES = ['DRAFT', 'SIGNED', 'ENDED', 'DISCARDED'] as const;
export const AgreementStatusSchema = z.enum(AGREEMENT_STATUSES);
export type AgreementStatusName = z.infer<typeof AgreementStatusSchema>;

// ---------- templates ----------

export const AgreementTemplateSchema = z.object({
  id: z.string(),
  name: z.string(),
  body: z.string(),
  isActive: z.boolean(),
  /** How many agreements were made from it. */
  agreementCount: z.number().int(),
  updatedAt: z.string(),
  rowVersion: z.number().int(),
});
export type AgreementTemplate = z.infer<typeof AgreementTemplateSchema>;
export const AgreementTemplateListResponseSchema = z.object({
  items: z.array(AgreementTemplateSchema),
});
export type AgreementTemplateListResponse = z.infer<typeof AgreementTemplateListResponseSchema>;

const TemplateNameSchema = z
  .string()
  .trim()
  .min(2, 'Enter a name')
  .max(80, 'Use at most 80 characters');

export const CreateAgreementTemplateRequestSchema = z.object({
  name: TemplateNameSchema,
  body: AgreementTextSchema,
});
export type CreateAgreementTemplateRequest = z.input<typeof CreateAgreementTemplateRequestSchema>;

export const UpdateAgreementTemplateRequestSchema = z
  .object({
    name: TemplateNameSchema.optional(),
    body: AgreementTextSchema.optional(),
    isActive: z.boolean().optional(),
    rowVersion: z.number().int().min(1),
  })
  .refine((value) => Object.keys(value).some((key) => key !== 'rowVersion'), {
    message: 'Change at least one field',
  });
export type UpdateAgreementTemplateRequest = z.input<typeof UpdateAgreementTemplateRequestSchema>;

// ---------- agreements ----------

export const AgreementSchema = z.object({
  id: z.string(),
  agreementNo: z.string(),
  staffId: z.string(),
  staffName: z.string(),
  employeeCode: z.string(),
  branchCode: z.string(),
  templateId: z.string().nullable(),
  templateName: z.string().nullable(),
  title: z.string(),
  /** The text as written, with {{placeholders}}. Once signed it is kept as it was when signed. */
  body: z.string(),
  effectiveFrom: z.string(),
  status: AgreementStatusSchema,
  signedOn: z.string().nullable(),
  hasSignedCopy: z.boolean(),
  signedFileName: z.string().nullable(),
  employeeSigned: z.boolean(),
  adminSigned: z.boolean(),
  recordedByName: z.string().nullable(),
  endedOn: z.string().nullable(),
  /** Why it ended, or why a draft was thrown away. */
  endReason: z.string().nullable(),
  createdAt: z.string(),
  rowVersion: z.number().int(),
});
export type Agreement = z.infer<typeof AgreementSchema>;
export const AgreementListResponseSchema = z.object({ items: z.array(AgreementSchema) });
export type AgreementListResponse = z.infer<typeof AgreementListResponseSchema>;

export const AgreementListQuerySchema = z.object({
  staffId: z.uuid().optional(),
  status: AgreementStatusSchema.optional(),
});
export type AgreementListQuery = z.input<typeof AgreementListQuerySchema>;

/** Makes a draft for one employee, from a template or written from scratch. */
export const CreateAgreementRequestSchema = z
  .object({
    staffId: z.uuid('Choose the employee'),
    templateId: z.uuid().optional(),
    title: TitleSchema.optional(),
    body: AgreementTextSchema.optional(),
    effectiveFrom: DateOnlySchema,
  })
  .refine((value) => value.templateId !== undefined || value.body !== undefined, {
    message: 'Choose a template or write the terms',
    path: ['templateId'],
  });
export type CreateAgreementRequest = z.input<typeof CreateAgreementRequestSchema>;

/** Changes a draft. A signed agreement cannot be changed; make a new one. */
export const UpdateAgreementRequestSchema = z
  .object({
    title: TitleSchema.optional(),
    body: AgreementTextSchema.optional(),
    effectiveFrom: DateOnlySchema.optional(),
    rowVersion: z.number().int().min(1),
  })
  .refine((value) => Object.keys(value).some((key) => key !== 'rowVersion'), {
    message: 'Change at least one field',
  });
export type UpdateAgreementRequest = z.input<typeof UpdateAgreementRequestSchema>;

/**
 * The signed copy is sent as the request body (a PDF, JPEG or PNG scan or photo). What it needs to say is in the query: the
 * file name, the date it was signed, and that the employee (left) and the Super Admin (right) have both signed it.
 */
export const SignedCopyQuerySchema = z.object({
  fileName: z
    .string()
    .trim()
    .min(1, 'The file has no name')
    .max(160, 'The file name is too long')
    .refine(
      (name) => ![...name].some((ch) => ch === '/' || ch === '\\' || ch.charCodeAt(0) < 32),
      'The file name has characters that are not allowed',
    ),
  signedOn: DateOnlySchema,
  employeeSigned: z.literal('true', { error: 'The employee must have signed it' }),
  adminSigned: z.literal('true', { error: 'The Super Admin must have signed it' }),
  rowVersion: z.coerce.number().int().min(1),
});
export type SignedCopyQuery = z.input<typeof SignedCopyQuerySchema>;

export const EndAgreementRequestSchema = z.object({
  endedOn: DateOnlySchema,
  reason: z.string().trim().min(3, 'Enter the reason').max(300, 'Use at most 300 characters'),
  rowVersion: z.number().int().min(1),
});
export type EndAgreementRequest = z.input<typeof EndAgreementRequestSchema>;

export const DiscardAgreementRequestSchema = z.object({
  reason: z.string().trim().min(3, 'Enter the reason').max(300, 'Use at most 300 characters'),
  rowVersion: z.number().int().min(1),
});
export type DiscardAgreementRequest = z.input<typeof DiscardAgreementRequestSchema>;
