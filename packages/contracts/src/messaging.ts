import { z } from 'zod';
import { PaginationQuerySchema, paginatedSchema } from './pagination.js';

export const MESSAGE_CHANNELS = ['WHATSAPP', 'EMAIL'] as const;
export const MessageChannelSchema = z.enum(MESSAGE_CHANNELS);
export type MessageChannel = z.infer<typeof MessageChannelSchema>;

/** What can be written in a bulk message as {{name}}; each is filled in for the person it goes to. */
export const MESSAGE_PLACEHOLDERS = [
  { code: 'name', label: 'Customer name' },
  { code: 'due', label: 'Amount the customer still owes (0 if nothing)' },
  { code: 'shop', label: 'Company name' },
] as const;
const PLACEHOLDER_CODES: readonly string[] = MESSAGE_PLACEHOLDERS.map((entry) => entry.code);
/** The {{names}} in a message that are not placeholders. */
export function unknownMessagePlaceholders(text: string): string[] {
  const found = [...text.matchAll(/\{\{\s*([^{}]*?)\s*\}\}/g)].map((match) => match[1] ?? '');
  return [...new Set(found.filter((name) => !PLACEHOLDER_CODES.includes(name)))];
}

const MessageTextSchema = z
  .string('Enter the message')
  .trim()
  .min(2, 'Enter the message')
  .max(1000, 'Use at most 1000 characters')
  .superRefine((text, context) => {
    const unknown = unknownMessagePlaceholders(text);
    if (unknown.length > 0)
      context.addIssue({
        code: 'custom',
        message: `Unknown placeholder ${unknown.map((name) => `{{${name}}}`).join(', ')}`,
      });
  });

/** What a message is for. Each purpose has its own WhatsApp template. */
export const MESSAGE_TEMPLATE_KEYS = ['GENERAL', 'INVOICE', 'RECEIPT', 'REMINDER'] as const;
export const MessageTemplateKeySchema = z.enum(MESSAGE_TEMPLATE_KEYS);
export type MessageTemplateKey = z.infer<typeof MessageTemplateKeySchema>;

export const MessagingStatusSchema = z.object({
  whatsapp: z.object({
    configured: z.boolean(),
    /** Whether a template is set up for each purpose, for people who have not written in the last 24 hours. */
    templates: z.object({
      general: z.boolean(),
      invoice: z.boolean(),
      receipt: z.boolean(),
      reminder: z.boolean(),
    }),
  }),
  email: z.object({ configured: z.boolean(), from: z.string().nullable() }),
});
export type MessagingStatus = z.infer<typeof MessagingStatusSchema>;

export const AudienceSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('ALL') }),
  z.object({ kind: z.literal('DUES') }),
  z.object({
    kind: z.literal('SELECTED'),
    customerIds: z.array(z.uuid()).min(1, 'Choose at least one customer').max(1000),
  }),
]);
export type Audience = z.infer<typeof AudienceSchema>;

export const PreviewBulkRequestSchema = z.object({
  channel: MessageChannelSchema,
  audience: AudienceSchema,
});
export type PreviewBulkRequest = z.input<typeof PreviewBulkRequestSchema>;
export const BulkPreviewSchema = z.object({
  /** People the message would go to. */
  count: z.number().int(),
  /** People in the audience who have no phone number or email address for this channel. */
  withoutContact: z.number().int(),
  /** People in the audience who asked not to get bulk messages and are left out. */
  optedOut: z.number().int(),
  sampleNames: z.array(z.string()),
});
export type BulkPreview = z.infer<typeof BulkPreviewSchema>;

/** Sends one message to many customers. Each person gets their own ordinary message, not a broadcast. */
export const CreateBulkMessageRequestSchema = z
  .object({
    branchId: z.uuid().optional(),
    channel: MessageChannelSchema,
    audience: AudienceSchema,
    subject: z.string().trim().min(1).max(120, 'Use at most 120 characters').optional(),
    body: MessageTextSchema,
  })
  .refine((value) => value.channel !== 'EMAIL' || value.subject !== undefined, {
    message: 'Enter the subject of the email',
    path: ['subject'],
  });
export type CreateBulkMessageRequest = z.input<typeof CreateBulkMessageRequestSchema>;

/** Sends an invoice or a receipt to the customer as a PDF. */
export const SendDocumentRequestSchema = z.object({
  kind: z.enum(['INVOICE', 'RECEIPT']),
  id: z.uuid(),
  channel: MessageChannelSchema,
  /** A phone number or email address to use instead of the customer's own. */
  to: z.string().trim().min(3).max(200).optional(),
  message: z.string().trim().min(2).max(1000, 'Use at most 1000 characters').optional(),
});
export type SendDocumentRequest = z.input<typeof SendDocumentRequestSchema>;

export const MessageOptOutSchema = z.object({
  customerId: z.string(),
  customerName: z.string(),
  phone: z.string(),
  reason: z.string().nullable(),
  createdAt: z.string(),
});
export type MessageOptOut = z.infer<typeof MessageOptOutSchema>;
export const MessageOptOutListResponseSchema = z.object({ items: z.array(MessageOptOutSchema) });
export type MessageOptOutListResponse = z.infer<typeof MessageOptOutListResponseSchema>;
export const AddOptOutRequestSchema = z.object({
  customerId: z.uuid('Choose a customer'),
  reason: z.string().trim().min(1).max(200, 'Use at most 200 characters').optional(),
});
export type AddOptOutRequest = z.input<typeof AddOptOutRequestSchema>;

export const MessageDeliverySchema = z.object({
  id: z.string(),
  recipientName: z.string(),
  toAddress: z.string(),
  status: z.enum(['PENDING', 'SENT', 'FAILED']),
  /** How it went: as a free message, as a document, as a template (outside the 24-hour window) or as an email. */
  via: z.enum(['TEXT', 'DOCUMENT', 'TEMPLATE', 'EMAIL']).nullable(),
  error: z.string().nullable(),
  attempts: z.number().int(),
  sentAt: z.string().nullable(),
});
export type MessageDelivery = z.infer<typeof MessageDeliverySchema>;

export const MessageCampaignSchema = z.object({
  id: z.string(),
  kind: z.enum(['BULK', 'INVOICE', 'RECEIPT']),
  channel: MessageChannelSchema,
  subject: z.string().nullable(),
  body: z.string(),
  audience: z.string(),
  templateKey: MessageTemplateKeySchema,
  createdAt: z.string(),
  createdByName: z.string().nullable(),
  total: z.number().int(),
  sent: z.number().int(),
  failed: z.number().int(),
  pending: z.number().int(),
  /** Every delivery, for one campaign opened on its own. */
  deliveries: z.array(MessageDeliverySchema).optional(),
});
export type MessageCampaign = z.infer<typeof MessageCampaignSchema>;

export const MessageCampaignListQuerySchema = PaginationQuerySchema.extend({
  kind: z.enum(['BULK', 'INVOICE', 'RECEIPT']).optional(),
});
export type MessageCampaignListQuery = z.input<typeof MessageCampaignListQuerySchema>;
export const MessageCampaignListResponseSchema = paginatedSchema(MessageCampaignSchema);
export type MessageCampaignListResponse = z.infer<typeof MessageCampaignListResponseSchema>;
