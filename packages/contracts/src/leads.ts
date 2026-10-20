import { z } from 'zod';
import { StateCodeSchema, GstinSchema, gstinProblem } from './branches.js';
import { PhoneSchema } from './customers.js';
import { paginatedSchema, PaginationQuerySchema } from './pagination.js';

export const LEAD_STAGES = [
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'QUOTED',
  'NEGOTIATION',
  'WON',
  'LOST',
] as const;
export const LeadStageSchema = z.enum(LEAD_STAGES);
export type LeadStageName = z.infer<typeof LeadStageSchema>;

/** The funnel a lead moves along while it is still being worked, in order. */
export const OPEN_LEAD_STAGES = ['NEW', 'CONTACTED', 'QUALIFIED', 'QUOTED', 'NEGOTIATION'] as const;

export function isOpenStage(stage: LeadStageName): boolean {
  return (OPEN_LEAD_STAGES as readonly string[]).includes(stage);
}

/**
 * Where a lead may go next. Forward to any later open stage, from NEGOTIATION back to QUOTED, and from any open stage to
 * LOST. A lost lead may be reopened to CONTACTED. WON is not on this list: a lead is won only by converting it to a
 * customer, and nothing leaves WON. The database enforces the same rule.
 */
export function allowedNextStages(from: LeadStageName): LeadStageName[] {
  if (from === 'WON') return [];
  if (from === 'LOST') return ['CONTACTED'];
  const index = (OPEN_LEAD_STAGES as readonly string[]).indexOf(from);
  const forward = OPEN_LEAD_STAGES.slice(index + 1);
  const back: LeadStageName[] = from === 'NEGOTIATION' ? ['QUOTED'] : [];
  return [...forward, ...back, 'LOST'];
}

export const MAX_LEAD_NOTE_LENGTH = 1000;
const NoteSchema = z
  .string()
  .trim()
  .min(1, 'Write something')
  .max(MAX_LEAD_NOTE_LENGTH, 'Too long');
const LeadNameSchema = z
  .string()
  .trim()
  .min(2, 'Enter at least 2 characters')
  .max(120, 'Use at most 120 characters');
const InterestSchema = z.string().trim().min(1).max(300, 'Use at most 300 characters');

export const CreateLeadRequestSchema = z.object({
  name: LeadNameSchema,
  phone: PhoneSchema,
  source: z
    .string('Choose where the lead came from')
    .trim()
    .min(1, 'Choose where the lead came from')
    .max(30),
  interest: InterestSchema.nullable().default(null),
  assignedTo: z.uuid().nullable().default(null),
  note: NoteSchema.optional(),
  branchId: z.uuid().optional(),
});
export type CreateLeadRequest = z.input<typeof CreateLeadRequestSchema>;

export const UpdateLeadRequestSchema = z
  .object({
    name: LeadNameSchema.optional(),
    phone: PhoneSchema.optional(),
    source: z.string().trim().min(1).max(30).optional(),
    interest: InterestSchema.nullable().optional(),
    rowVersion: z.number().int().min(1),
  })
  .refine((value) => Object.keys(value).some((key) => key !== 'rowVersion'), {
    message: 'Change at least one field',
  });
export type UpdateLeadRequest = z.input<typeof UpdateLeadRequestSchema>;

/** Moves a lead along its stages. WON is not accepted here (convert the lead instead); LOST needs a reason. */
export const ChangeStageRequestSchema = z
  .object({
    stage: LeadStageSchema.exclude(['WON']),
    note: NoteSchema.optional(),
    rowVersion: z.number().int().min(1),
  })
  .superRefine((value, context) => {
    if (value.stage === 'LOST' && (value.note?.length ?? 0) < 3)
      context.addIssue({ code: 'custom', path: ['note'], message: 'Say why the lead was lost' });
  });
export type ChangeStageRequest = z.input<typeof ChangeStageRequestSchema>;

export const AssignLeadRequestSchema = z.object({
  assignedTo: z.uuid().nullable(),
  rowVersion: z.number().int().min(1),
});
export type AssignLeadRequest = z.input<typeof AssignLeadRequestSchema>;

export const AddLeadNoteRequestSchema = z.object({ body: NoteSchema });
export type AddLeadNoteRequest = z.input<typeof AddLeadNoteRequestSchema>;

/**
 * Turns a lead into a customer. If a customer already has the lead's phone number they are linked instead of being
 * created again. To link someone else, pass `customerId`; then no customer details may be sent.
 */
export const ConvertLeadRequestSchema = z
  .object({
    rowVersion: z.number().int().min(1),
    customerId: z.uuid().optional(),
    email: z
      .string()
      .trim()
      .toLowerCase()
      .pipe(z.email('Enter a valid email address'))
      .nullable()
      .optional(),
    address: z.string().trim().min(1).max(300).nullable().optional(),
    stateCode: StateCodeSchema.nullable().optional(),
    gstin: GstinSchema.nullable().optional(),
  })
  .superRefine((value, context) => {
    const details = [value.email, value.address, value.stateCode, value.gstin].some(
      (field) => field !== undefined,
    );
    if (value.customerId && details)
      context.addIssue({
        code: 'custom',
        path: ['customerId'],
        message: 'Either link an existing customer or give new customer details, not both',
      });
    if (value.gstin) {
      const problem = gstinProblem(value.gstin, value.stateCode ?? undefined);
      if (problem) context.addIssue({ code: 'custom', path: ['gstin'], message: problem });
    }
  });
export type ConvertLeadRequest = z.input<typeof ConvertLeadRequestSchema>;

const DueAtSchema = z.iso.datetime({ offset: true, message: 'Choose the date and time' });
export const CreateFollowupRequestSchema = z.object({
  dueAt: DueAtSchema,
  note: NoteSchema.optional(),
});
export type CreateFollowupRequest = z.input<typeof CreateFollowupRequestSchema>;

export const CompleteFollowupRequestSchema = z.object({ note: NoteSchema.optional() });

/** Moves a follow-up that is still waiting to another time. Each move is counted and audited with the reason. */
export const RescheduleFollowupRequestSchema = z.object({
  dueAt: DueAtSchema,
  rowVersion: z.number().int().min(1),
  reason: z.string().trim().min(3, 'Give a reason of at least 3 characters').max(300),
});
export type RescheduleFollowupRequest = z.input<typeof RescheduleFollowupRequestSchema>;
export type CompleteFollowupRequest = z.input<typeof CompleteFollowupRequestSchema>;

// ---------- responses ----------

export const LeadSummarySchema = z.object({
  id: z.string(),
  branchId: z.string(),
  branchCode: z.string(),
  name: z.string(),
  phone: z.string(),
  source: z.string(),
  sourceName: z.string(),
  stage: LeadStageSchema,
  interest: z.string().nullable(),
  assignedTo: z.string().nullable(),
  assignedToName: z.string().nullable(),
  customerId: z.string().nullable(),
  /** The earliest follow-up still to be done. */
  nextFollowupAt: z.string().nullable(),
  overdueFollowups: z.number().int(),
  createdAt: z.string(),
});
export type LeadSummary = z.infer<typeof LeadSummarySchema>;

export const FOLLOWUP_STATUSES = ['PENDING', 'OVERDUE', 'COMPLETED'] as const;
export const FollowupStatusSchema = z.enum(FOLLOWUP_STATUSES);
export type FollowupStatusName = z.infer<typeof FollowupStatusSchema>;

export const FollowupSchema = z.object({
  id: z.string(),
  leadId: z.string(),
  leadName: z.string(),
  leadPhone: z.string(),
  leadStage: LeadStageSchema,
  assignedToName: z.string().nullable(),
  branchCode: z.string(),
  dueAt: z.string(),
  note: z.string().nullable(),
  status: FollowupStatusSchema,
  completedAt: z.string().nullable(),
  completedByName: z.string().nullable(),
  completionNote: z.string().nullable(),
  createdByName: z.string().nullable(),
  /** How many times it has been moved. */
  rescheduledCount: z.number().int(),
  rowVersion: z.number().int(),
});
export type Followup = z.infer<typeof FollowupSchema>;

export const LeadNoteSchema = z.object({
  id: z.string(),
  body: z.string(),
  fromStage: LeadStageSchema.nullable(),
  toStage: LeadStageSchema.nullable(),
  createdByName: z.string().nullable(),
  createdAt: z.string(),
});
export type LeadNote = z.infer<typeof LeadNoteSchema>;

export const LeadSchema = LeadSummarySchema.extend({
  customerName: z.string().nullable(),
  createdByName: z.string().nullable(),
  rowVersion: z.number().int(),
  notes: z.array(LeadNoteSchema),
  followups: z.array(FollowupSchema),
});
export type Lead = z.infer<typeof LeadSchema>;

export const ConvertLeadResponseSchema = z.object({
  lead: LeadSchema,
  customerId: z.string(),
  customerName: z.string(),
  /** False when an existing customer with the same phone number was linked instead. */
  customerCreated: z.boolean(),
});
export type ConvertLeadResponse = z.infer<typeof ConvertLeadResponseSchema>;

export const LEAD_SORT_FIELDS = ['createdAt', 'name', 'stage'] as const;
export const LEAD_STAGE_FILTERS = ['all', 'open', ...LEAD_STAGES] as const;
export const LeadListQuerySchema = PaginationQuerySchema.extend({
  search: z.string().trim().max(100).optional(),
  stage: z.enum(LEAD_STAGE_FILTERS).default('all'),
  source: z.string().trim().max(30).optional(),
  /** A user id, `me`, or `unassigned`. */
  assignedTo: z.union([z.uuid(), z.enum(['me', 'unassigned'])]).optional(),
  branchId: z.uuid().optional(),
  /** Only leads that have a follow-up past its time. */
  overdue: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
});
export type LeadListQuery = z.input<typeof LeadListQuerySchema>;
export const LeadListResponseSchema = paginatedSchema(LeadSummarySchema);
export type LeadListResponse = z.infer<typeof LeadListResponseSchema>;

export const FOLLOWUP_SCOPES = ['open', 'overdue', 'today', 'upcoming', 'done', 'all'] as const;
export const FOLLOWUP_SORT_FIELDS = ['dueAt'] as const;
export const FollowupListQuerySchema = PaginationQuerySchema.extend({
  scope: z.enum(FOLLOWUP_SCOPES).default('open'),
  /** Only follow-ups on leads assigned to the caller. */
  mine: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  leadId: z.uuid().optional(),
  branchId: z.uuid().optional(),
});
export type FollowupListQuery = z.input<typeof FollowupListQuerySchema>;
export const FollowupListResponseSchema = paginatedSchema(FollowupSchema);
export type FollowupListResponse = z.infer<typeof FollowupListResponseSchema>;

export const FollowupCountsSchema = z.object({
  overdue: z.number().int(),
  today: z.number().int(),
  upcoming: z.number().int(),
});
export type FollowupCounts = z.infer<typeof FollowupCountsSchema>;

export const LeadAssigneeSchema = z.object({ id: z.string(), fullName: z.string() });
export const LeadAssigneeListResponseSchema = z.array(LeadAssigneeSchema);
export type LeadAssignee = z.infer<typeof LeadAssigneeSchema>;

export const LeadSourceSchema = z.object({ code: z.string(), name: z.string() });
export const LeadSourceListResponseSchema = z.array(LeadSourceSchema);
export type LeadSourceOption = z.infer<typeof LeadSourceSchema>;

// ---------- lead sources (reference data managers keep) ----------

export const CreateLeadSourceRequestSchema = z.object({
  /** A short code in capitals, such as WALK_IN. It never changes. */
  code: z
    .string()
    .trim()
    .toUpperCase()
    .regex(
      /^[A-Z][A-Z0-9_]{1,29}$/,
      'Use 2 to 30 capital letters, digits or _, starting with a letter',
    ),
  name: z.string().trim().min(2, 'Use at least 2 characters').max(60, 'Use at most 60 characters'),
});
export type CreateLeadSourceRequest = z.input<typeof CreateLeadSourceRequestSchema>;

export const UpdateLeadSourceRequestSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(2, 'Use at least 2 characters')
      .max(60, 'Use at most 60 characters')
      .optional(),
    isActive: z.boolean().optional(),
    rowVersion: z.number().int().min(1),
  })
  .refine((value) => value.name !== undefined || value.isActive !== undefined, {
    message: 'Change the name or switch it on or off',
  });
export type UpdateLeadSourceRequest = z.input<typeof UpdateLeadSourceRequestSchema>;

export const LeadSourceAdminSchema = z.object({
  code: z.string(),
  name: z.string(),
  isActive: z.boolean(),
  /** How many leads came from it. */
  leadCount: z.number().int(),
  rowVersion: z.number().int(),
});
export type LeadSourceAdmin = z.infer<typeof LeadSourceAdminSchema>;
export const LeadSourceAdminListResponseSchema = z.array(LeadSourceAdminSchema);
