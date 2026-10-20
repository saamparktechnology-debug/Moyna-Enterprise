import { z } from 'zod';
import { PaginationQuerySchema, paginatedSchema } from './pagination.js';

export const NOTIFICATION_KINDS = [
  'GENERAL',
  'FOLLOWUP_DUE',
  'PAYMENT_DUE',
  'LOW_STOCK',
  'BATTERY_EXPIRY',
  'PENDING_TRANSFER',
  'PURCHASE_MISMATCH',
  'PENDING_KYC',
  'UNPAID_COMMISSION',
] as const;
export const NotificationKindSchema = z.enum(NOTIFICATION_KINDS);
export type NotificationKind = z.infer<typeof NotificationKindSchema>;

/** The words shown for each kind of notification. */
export const NOTIFICATION_KIND_LABELS: Record<NotificationKind, string> = {
  GENERAL: 'General',
  FOLLOWUP_DUE: 'Follow-up',
  PAYMENT_DUE: 'Payment due',
  LOW_STOCK: 'Low stock',
  BATTERY_EXPIRY: 'Battery expiry',
  PENDING_TRANSFER: 'Transfer',
  PURCHASE_MISMATCH: 'Purchase mismatch',
  PENDING_KYC: 'KYC',
  UNPAID_COMMISSION: 'Commission',
};

export const NotificationSchema = z.object({
  id: z.uuid(),
  kind: NotificationKindSchema,
  title: z.string(),
  message: z.string(),
  /** An app path to open, such as /payments, or null. */
  link: z.string().nullable(),
  branchId: z.uuid().nullable(),
  read: z.boolean(),
  createdAt: z.string(),
});
export type Notification = z.infer<typeof NotificationSchema>;

export const NotificationListQuerySchema = PaginationQuerySchema.pick({
  page: true,
  pageSize: true,
}).extend({
  unread: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  kind: NotificationKindSchema.optional(),
});
export type NotificationListQuery = z.input<typeof NotificationListQuerySchema>;

export const NotificationListResponseSchema = paginatedSchema(NotificationSchema).extend({
  unreadCount: z.number().int().min(0),
});
export type NotificationListResponse = z.infer<typeof NotificationListResponseSchema>;

export const UnreadCountResponseSchema = z.object({ unreadCount: z.number().int().min(0) });
export type UnreadCountResponse = z.infer<typeof UnreadCountResponseSchema>;

export const MarkAllReadResponseSchema = z.object({ updated: z.number().int().min(0) });
export type MarkAllReadResponse = z.infer<typeof MarkAllReadResponseSchema>;

/** The kind of outbox event the worker turns into an email, SMS or WhatsApp message. */
export const NOTIFICATION_DELIVER_EVENT = 'notification.deliver';
export const NotificationDeliverPayloadSchema = z.object({
  notificationId: z.uuid(),
  userId: z.uuid(),
});
export type NotificationDeliverPayload = z.infer<typeof NotificationDeliverPayloadSchema>;
