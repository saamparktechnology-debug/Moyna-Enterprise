import { useState } from 'react';
import { useNavigate } from 'react-router';
import { NOTIFICATION_KINDS, NOTIFICATION_KIND_LABELS } from '@erp/contracts';
import type { Notification, NotificationKind } from '@erp/contracts';
import { Alert } from '@/components/alert';
import { DataTablePagination } from '@/components/data-table/data-table-pagination';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { LoadingState } from '@/components/loading-state';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { Select } from '@/components/select-field';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { ApiError } from '@/lib/api-client';
import { useNotificationList, useNotificationMutations } from './use-notifications';

const PAGE_SIZE = 20;

const when = (iso: string): string =>
  new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });

export function NotificationsPage() {
  const navigate = useNavigate();
  const [page, setPage] = useState(1);
  const [unread, setUnread] = useState(false);
  const [kind, setKind] = useState<NotificationKind | ''>('');
  const { data, error, isPending, refetch } = useNotificationList({
    page,
    pageSize: PAGE_SIZE,
    unread,
    kind,
  });
  const { markRead, markAllRead } = useNotificationMutations();

  const open = async (item: Notification) => {
    if (!item.read) await markRead.mutateAsync(item.id).catch(() => undefined);
    if (item.link) navigate(item.link);
  };

  return (
    <PageContainer>
      <PageHeader
        title="Notifications"
        description="Reminders and alerts for you. Open one to go to the record it is about."
        actions={
          <Button
            type="button"
            variant="secondary"
            disabled={markAllRead.isPending || (data?.unreadCount ?? 0) === 0}
            onClick={() => markAllRead.mutate()}
          >
            Mark all as read
          </Button>
        }
      />

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex min-h-control items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="size-4"
            checked={unread}
            onChange={(event) => {
              setUnread(event.target.checked);
              setPage(1);
            }}
          />
          Unread only
        </label>
        <label className="space-y-1 text-sm font-medium">
          <span>Type</span>
          <Select
            className="w-full sm:w-56"
            value={kind}
            onChange={(event) => {
              setKind(event.target.value as NotificationKind | '');
              setPage(1);
            }}
          >
            <option value="">All types</option>
            {NOTIFICATION_KINDS.map((value) => (
              <option key={value} value={value}>
                {NOTIFICATION_KIND_LABELS[value]}
              </option>
            ))}
          </Select>
        </label>
      </div>

      {markRead.error || markAllRead.error ? (
        <Alert tone="error">The notification could not be updated. Try again.</Alert>
      ) : null}

      {isPending ? <LoadingState label="Loading notifications…" rows={3} /> : null}
      {error ? (
        <ErrorState onRetry={refetch} retryLabel="Try again">
          {error instanceof ApiError ? error.message : 'Notifications could not be loaded'}
        </ErrorState>
      ) : null}

      {data && data.items.length === 0 ? (
        <EmptyState>
          {unread || kind ? 'Nothing matches these filters.' : 'You have no notifications.'}
        </EmptyState>
      ) : null}

      {data && data.items.length > 0 ? (
        <ul aria-label="Notification list" className="space-y-2">
          {data.items.map((item) => (
            <li key={item.id}>
              <Card className={item.read ? 'bg-muted/40' : 'border-primary/50'}>
                <CardContent className="flex items-start justify-between gap-3 p-4">
                  <div className="space-y-1">
                    <p className="text-xs text-muted-foreground">
                      {NOTIFICATION_KIND_LABELS[item.kind]} · {when(item.createdAt)}
                      {item.read ? '' : ' · unread'}
                    </p>
                    <p className="font-medium">{item.title}</p>
                    <p className="text-sm">{item.message}</p>
                  </div>
                  <div className="flex shrink-0 gap-2">
                    {item.link ? (
                      <Button type="button" size="sm" onClick={() => void open(item)}>
                        Open
                      </Button>
                    ) : null}
                    {item.read ? null : (
                      <Button
                        type="button"
                        size="sm"
                        variant="secondary"
                        onClick={() => markRead.mutate(item.id)}
                      >
                        Mark as read
                      </Button>
                    )}
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      ) : null}

      {data && data.totalPages > 1 ? (
        <DataTablePagination
          page={data.page}
          pageSize={data.pageSize}
          total={data.total}
          totalPages={data.totalPages}
          shown={data.items.length}
          isFetching={false}
          onPageChange={setPage}
        />
      ) : null}
    </PageContainer>
  );
}
