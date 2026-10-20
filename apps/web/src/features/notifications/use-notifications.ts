import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  getUnreadCount,
  listNotifications,
  markAllNotificationsRead,
  markNotificationRead,
} from './notifications-api';
import type { NotificationListParams } from './notifications-api';

const KEY = 'notifications';
const REFRESH_MS = 60_000;

/** The number on the bell. A failed check just shows no number. */
export const useUnreadCount = (enabled: boolean) =>
  useQuery({
    queryKey: [KEY, 'unread'],
    queryFn: getUnreadCount,
    enabled,
    refetchInterval: REFRESH_MS,
    retry: false,
  });

export const useNotificationList = (params: NotificationListParams) =>
  useQuery({
    queryKey: [KEY, 'list', params],
    queryFn: () => listNotifications(params),
    placeholderData: keepPreviousData,
  });

export function useNotificationMutations() {
  const queryClient = useQueryClient();
  const refresh = () => queryClient.invalidateQueries({ queryKey: [KEY] });
  return {
    markRead: useMutation({ mutationFn: markNotificationRead, onSuccess: refresh }),
    markAllRead: useMutation({ mutationFn: markAllNotificationsRead, onSuccess: refresh }),
  };
}
