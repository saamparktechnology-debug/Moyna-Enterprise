import { z } from 'zod';
import { DateOnlySchema } from './battery-dates.js';
import { DOCUMENT_TYPES } from './documents.js';
import { PaginationQuerySchema, paginatedSchema } from './pagination.js';

// ---------- settings ----------

export const SETTING_GROUPS = ['company', 'approvals'] as const;
export type SettingGroup = (typeof SETTING_GROUPS)[number];

export interface SettingDefinition {
  key: string;
  group: SettingGroup;
  label: string;
  description: string;
  type: 'text' | 'amount' | 'int';
  /** What the value may be. */
  schema: z.ZodType<string | number>;
}

const text = (max: number, min = 1) => z.string().trim().min(min).max(max);

export const SETTING_DEFINITIONS = [
  {
    key: 'company.name',
    group: 'company',
    label: 'Company name',
    description: 'The trading name of the business.',
    type: 'text',
    schema: text(120),
  },
  {
    key: 'company.address',
    group: 'company',
    label: 'Registered address',
    description: 'The head office address.',
    type: 'text',
    schema: text(300),
  },
  {
    key: 'company.gstin',
    group: 'company',
    label: 'Company GSTIN',
    description: 'The 15-character GST number of the head office.',
    type: 'text',
    schema: z
      .string()
      .trim()
      .toUpperCase()
      .regex(/^\d{2}[A-Z]{5}\d{4}[A-Z][1-9A-Z]Z[0-9A-Z]$/, 'Enter a valid 15-character GSTIN'),
  },
  {
    key: 'company.phone',
    group: 'company',
    label: 'Company phone',
    description: 'The main phone number.',
    type: 'text',
    schema: z
      .string()
      .trim()
      .regex(/^[0-9+\-\s()]{7,20}$/, 'Enter a phone number'),
  },
  {
    key: 'company.email',
    group: 'company',
    label: 'Company email',
    description: 'The main email address.',
    type: 'text',
    schema: z.string().trim().max(120).pipe(z.email()),
  },
  {
    key: 'approvals.exchange_admin_limit',
    group: 'approvals',
    label: 'Exchange approval limit (rupees)',
    description:
      'The most an Admin may approve as the valuation of an exchange. Above it only a Super Admin may approve. Leave it unset for no limit.',
    type: 'amount',
    schema: z
      .string()
      .trim()
      .regex(/^\d+(\.\d{1,2})?$/, 'Enter an amount in rupees, such as 50000 or 50000.50')
      .refine((value) => Number(value) > 0, 'Enter an amount above zero'),
  },
  {
    key: 'approvals.adjustment_admin_limit',
    group: 'approvals',
    label: 'Stock adjustment approval limit (units)',
    description:
      'The most units of one stock adjustment an Admin may approve. Above it only a Super Admin may approve.',
    type: 'int',
    schema: z.number().int().min(1).max(100_000),
  },
] as const satisfies readonly SettingDefinition[];

export const SETTING_KEYS = SETTING_DEFINITIONS.map((definition) => definition.key);
export const SettingKeySchema = z.enum(SETTING_KEYS as [string, ...string[]]);
export const SETTING_BY_KEY = new Map<string, SettingDefinition>(
  SETTING_DEFINITIONS.map((definition) => [definition.key, definition]),
);

/** The units an Admin may approve for one stock adjustment when no setting has been saved. */
export const DEFAULT_ADJUSTMENT_ADMIN_LIMIT = 10;

export const SettingSchema = z.object({
  key: z.string(),
  group: z.enum(SETTING_GROUPS),
  label: z.string(),
  description: z.string(),
  type: z.enum(['text', 'amount', 'int']),
  /** The value in force: the saved one, or the default when nothing was saved. Null when there is neither. */
  value: z.union([z.string(), z.number()]).nullable(),
  defaultValue: z.union([z.string(), z.number()]).nullable(),
  source: z.enum(['SETTING', 'DEFAULT']),
  /** Needed to save a change to a setting that already has a saved value. */
  rowVersion: z.number().int().nullable(),
  updatedAt: z.string().nullable(),
});
export type Setting = z.infer<typeof SettingSchema>;
export const SettingListResponseSchema = z.array(SettingSchema);

export const UpdateSettingRequestSchema = z
  .object({
    value: z.union([z.string(), z.number()]),
    rowVersion: z.number().int().min(1).optional(),
  })
  .strict();
export type UpdateSettingRequest = z.infer<typeof UpdateSettingRequestSchema>;

export const ResetSettingRequestSchema = z.object({ rowVersion: z.number().int().min(1) }).strict();
export type ResetSettingRequest = z.infer<typeof ResetSettingRequestSchema>;

// ---------- document number series ----------

export const DocumentTypeSchema = z.enum(DOCUMENT_TYPES);

export const DOCUMENT_SERIES_SORT_FIELDS = [
  'branch',
  'docType',
  'financialYear',
  'nextNumber',
] as const;
export const DocumentSeriesListQuerySchema = PaginationQuerySchema.extend({
  branchId: z.uuid().optional(),
  docType: DocumentTypeSchema.optional(),
  financialYear: z
    .string()
    .regex(/^\d{4}-\d{2}$/, 'Use a financial year such as 2026-27')
    .optional(),
});
export type DocumentSeriesListQuery = z.input<typeof DocumentSeriesListQuerySchema>;

export const DocumentSeriesSchema = z.object({
  id: z.uuid(),
  branchId: z.uuid(),
  branchCode: z.string(),
  docType: DocumentTypeSchema,
  financialYear: z.string(),
  prefix: z.string(),
  nextNumber: z.number().int(),
  /** What the next document will be called. */
  nextExample: z.string(),
  rowVersion: z.number().int(),
});
export type DocumentSeries = z.infer<typeof DocumentSeriesSchema>;
export const DocumentSeriesListResponseSchema = paginatedSchema(DocumentSeriesSchema);
export type DocumentSeriesListResponse = z.infer<typeof DocumentSeriesListResponseSchema>;

/** How far one change may move the next number, so a typo cannot burn a whole series. */
export const MAX_SERIES_JUMP = 10_000;
export const AdvanceSeriesRequestSchema = z
  .object({
    nextNumber: z.number().int().min(2),
    reason: z.string().trim().min(5, 'Say why, in at least 5 characters').max(300),
    rowVersion: z.number().int().min(1),
  })
  .strict();
export type AdvanceSeriesRequest = z.infer<typeof AdvanceSeriesRequestSchema>;

// ---------- tax rates ----------

export const GstRateAdminSchema = z.object({
  id: z.uuid(),
  rate: z.string(),
  label: z.string(),
  isActive: z.boolean(),
  /** Active items that use this rate. A rate in use cannot be switched off. */
  itemsUsing: z.number().int(),
  rowVersion: z.number().int(),
});
export type GstRateAdmin = z.infer<typeof GstRateAdminSchema>;
export const GstRateAdminListResponseSchema = z.array(GstRateAdminSchema);

export const CreateGstRateRequestSchema = z
  .object({
    rate: z
      .string()
      .trim()
      .regex(/^\d{1,2}(\.\d{1,2})?$/, 'Enter a percentage such as 18 or 12.5')
      .refine((value) => Number(value) <= 40, 'A GST rate is at most 40%'),
    label: z.string().trim().min(1).max(60),
  })
  .strict();
export type CreateGstRateRequest = z.infer<typeof CreateGstRateRequestSchema>;

/** The percentage itself never changes (invoices already issued used it); only the label and whether it is offered. */
export const UpdateGstRateRequestSchema = z
  .object({
    label: z.string().trim().min(1).max(60).optional(),
    isActive: z.boolean().optional(),
    rowVersion: z.number().int().min(1),
  })
  .strict()
  .refine(
    (value) => value.label !== undefined || value.isActive !== undefined,
    'Nothing to change',
  );
export type UpdateGstRateRequest = z.infer<typeof UpdateGstRateRequestSchema>;

// ---------- audit log ----------

export const AUDIT_SORT_FIELDS = ['createdAt', 'action', 'entityType'] as const;
export const AuditLogQuerySchema = PaginationQuerySchema.pick({ page: true, pageSize: true })
  .extend({
    actorId: z.uuid().optional(),
    branchId: z.uuid().optional(),
    action: z.string().trim().min(1).max(80).optional(),
    entityType: z.string().trim().min(1).max(80).optional(),
    entityId: z.uuid().optional(),
    from: DateOnlySchema.optional(),
    to: DateOnlySchema.optional(),
    /** Part of an action or record type, such as "refund". */
    q: z.string().trim().min(2).max(60).optional(),
    sortBy: z.enum(AUDIT_SORT_FIELDS).optional(),
    sortOrder: z.enum(['asc', 'desc']).default('desc'),
  })
  .strict();
export type AuditLogQuery = z.input<typeof AuditLogQuerySchema>;

export const AuditEntrySchema = z.object({
  id: z.uuid(),
  createdAt: z.string(),
  actorId: z.uuid().nullable(),
  actorName: z.string().nullable(),
  branchId: z.uuid().nullable(),
  branchCode: z.string().nullable(),
  action: z.string(),
  entityType: z.string(),
  entityId: z.uuid().nullable(),
  oldValue: z.unknown().nullable(),
  newValue: z.unknown().nullable(),
  ipAddress: z.string().nullable(),
  requestId: z.string().nullable(),
});
export type AuditEntry = z.infer<typeof AuditEntrySchema>;
export const AuditLogResponseSchema = paginatedSchema(AuditEntrySchema);
export type AuditLogResponse = z.infer<typeof AuditLogResponseSchema>;

export const AuditFacetsSchema = z.object({
  actions: z.array(z.string()),
  entityTypes: z.array(z.string()),
});
export type AuditFacets = z.infer<typeof AuditFacetsSchema>;

export const UserActivitySchema = z.object({
  userId: z.uuid(),
  fullName: z.string(),
  username: z.string(),
  status: z.string(),
  lastLoginAt: z.string().nullable(),
  /** Signed-in sessions that have not expired or been ended. */
  activeSessions: z.number().int(),
  /** Actions recorded for this person in the last 30 days, among the branches you may see. */
  actionsLast30Days: z.number().int(),
  topActions: z.array(z.object({ action: z.string(), count: z.number().int() })),
});
export type UserActivity = z.infer<typeof UserActivitySchema>;
