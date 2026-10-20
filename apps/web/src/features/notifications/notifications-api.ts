import {
  MarkAllReadResponseSchema,
  NotificationListResponseSchema,
  NotificationSchema,
  UnreadCountResponseSchema,
} from '@erp/contracts';
import type {
  MarkAllReadResponse,
  Notification,
  NotificationKind,
  NotificationListResponse,
  UnreadCountResponse,
} from '@erp/contracts';
import { api } from '@/lib/api';

export interface NotificationListParams {
  page: number;
  pageSize: number;
  unread: boolean;
  kind: NotificationKind | '';
}

export const listNotifications = (
  params: NotificationListParams,
): Promise<NotificationListResponse> => {
  const query = new URLSearchParams({
    page: String(params.page),
    pageSize: String(params.pageSize),
  });
  if (params.unread) query.set('unread', 'true');
  if (params.kind) query.set('kind', params.kind);
  return api.get(`/notifications?${query.toString()}`, NotificationListResponseSchema);
};

export const getUnreadCount = (): Promise<UnreadCountResponse> =>
  api.get('/notifications/unread-count', UnreadCountResponseSchema);

export const markNotificationRead = (id: string): Promise<Notification> =>
  api.post(`/notifications/${id}/read`, {}, NotificationSchema);

export const markAllNotificationsRead = (): Promise<MarkAllReadResponse> =>
  api.post('/notifications/read-all', {}, MarkAllReadResponseSchema);
