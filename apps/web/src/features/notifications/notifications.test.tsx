import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import type { Notification, NotificationListResponse } from '@erp/contracts';
import { jsonResponse, makeSession, routeFetch, signedIn } from '@/test/fetch-mock';
import { renderApp } from '@/test/render-app';

const item = (n: number, over: Partial<Notification> = {}): Notification => ({
  id: `00000000-0000-4000-8000-00000000000${n}`,
  kind: 'LOW_STOCK',
  title: `Title ${n}`,
  message: `Message ${n}`,
  link: '/inventory',
  branchId: null,
  read: false,
  createdAt: '2026-10-10T08:00:00.000Z',
  ...over,
});

const list = (
  items: Notification[],
  over: Partial<NotificationListResponse> = {},
): NotificationListResponse => ({
  items,
  page: 1,
  pageSize: 20,
  total: items.length,
  totalPages: items.length === 0 ? 0 : 1,
  unreadCount: items.filter((entry) => !entry.read).length,
  ...over,
});

const WITH = ['notifications.view', 'stock.view'];

describe('the notification bell', () => {
  it('shows the unread count', async () => {
    routeFetch({
      ...signedIn(makeSession({ permissions: WITH })),
      'GET /api/notifications/unread-count': () => jsonResponse({ unreadCount: 3 }),
    });
    renderApp('/');
    expect(await screen.findByRole('link', { name: 'Notifications, 3 unread' })).toHaveAttribute(
      'href',
      '/notifications',
    );
  });

  it('shows no number when everything is read, or when the count cannot be fetched', async () => {
    routeFetch({
      ...signedIn(makeSession({ permissions: WITH })),
      'GET /api/notifications/unread-count': () => jsonResponse({ unreadCount: 0 }),
    });
    renderApp('/');
    expect(await screen.findByRole('link', { name: 'Notifications' })).toBeInTheDocument();
  });

  it('is not shown, and asks for nothing, without the permission', async () => {
    const calls = routeFetch(signedIn(makeSession({ permissions: ['stock.view'] })));
    renderApp('/');
    await screen.findByRole('heading', { name: 'Dashboard' });
    expect(screen.queryByRole('link', { name: /Notifications/ })).not.toBeInTheDocument();
    expect(calls.calls.some((c) => c.key.includes('/notifications'))).toBe(false);
  });
});

describe('the notifications page', () => {
  it('lists notifications with their type, and marks one read when opened', async () => {
    const user = userEvent.setup();
    let read = false;
    const calls = routeFetch({
      ...signedIn(makeSession({ permissions: WITH })),
      'GET /api/notifications/unread-count': () => jsonResponse({ unreadCount: read ? 0 : 1 }),
      'GET /api/notifications?*': () => jsonResponse(list([item(1, { read })])),
      'POST /api/notifications/00000000-0000-4000-8000-000000000001/read': () => {
        read = true;
        return jsonResponse(item(1, { read: true }));
      },
    });
    renderApp('/notifications');

    const row = await screen.findByRole('list', { name: 'Notification list' });
    expect(within(row).getByText('Title 1')).toBeInTheDocument();
    expect(within(row).getByText(/Low stock/)).toBeInTheDocument();
    expect(within(row).getByText(/unread/)).toBeInTheDocument();

    await user.click(within(row).getByRole('button', { name: 'Mark as read' }));
    await waitFor(() =>
      expect(calls.calls.some((c) => c.key.startsWith('POST /api/notifications/0000'))).toBe(true),
    );
    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Mark as read' })).not.toBeInTheDocument(),
    );
  });

  it('marks everything read', async () => {
    const user = userEvent.setup();
    const calls = routeFetch({
      ...signedIn(makeSession({ permissions: WITH })),
      'GET /api/notifications/unread-count': () => jsonResponse({ unreadCount: 2 }),
      'GET /api/notifications?*': () => jsonResponse(list([item(1), item(2)])),
      'POST /api/notifications/read-all': () => jsonResponse({ updated: 2 }),
    });
    renderApp('/notifications');
    await user.click(await screen.findByRole('button', { name: 'Mark all as read' }));
    await waitFor(() =>
      expect(calls.calls.some((c) => c.key === 'POST /api/notifications/read-all')).toBe(true),
    );
  });

  it('asks the server for unread only and for one type', async () => {
    const user = userEvent.setup();
    const calls = routeFetch({
      ...signedIn(makeSession({ permissions: WITH })),
      'GET /api/notifications/unread-count': () => jsonResponse({ unreadCount: 0 }),
      'GET /api/notifications?*': () => jsonResponse(list([])),
    });
    renderApp('/notifications');
    expect(await screen.findByText('You have no notifications.')).toBeInTheDocument();

    await user.click(screen.getByLabelText('Unread only'));
    await user.selectOptions(screen.getByLabelText('Type'), 'PENDING_KYC');
    expect(await screen.findByText('Nothing matches these filters.')).toBeInTheDocument();
    expect(
      calls.calls.some((c) => c.key.includes('unread=true') && c.key.includes('kind=PENDING_KYC')),
    ).toBe(true);
  });

  it('pages through a long list', async () => {
    const user = userEvent.setup();
    const calls = routeFetch({
      ...signedIn(makeSession({ permissions: WITH })),
      'GET /api/notifications/unread-count': () => jsonResponse({ unreadCount: 0 }),
      'GET /api/notifications?*': () => jsonResponse(list([item(1)], { totalPages: 3 })),
    });
    renderApp('/notifications');
    await user.click(await screen.findByRole('button', { name: 'Next' }));
    await waitFor(() => expect(calls.calls.some((c) => c.key.includes('page=2'))).toBe(true));
  });

  it('shows an error with a way to try again', async () => {
    const user = userEvent.setup();
    let failing = true;
    routeFetch({
      ...signedIn(makeSession({ permissions: WITH })),
      'GET /api/notifications/unread-count': () => jsonResponse({ unreadCount: 0 }),
      'GET /api/notifications?*': () =>
        failing
          ? jsonResponse(
              { code: 'INTERNAL_ERROR', message: 'Database is busy', details: [], requestId: 'r' },
              500,
            )
          : jsonResponse(list([item(1)])),
    });
    renderApp('/notifications');
    expect(await screen.findByRole('alert')).toHaveTextContent('Database is busy');
    failing = false;
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(await screen.findByText('Title 1')).toBeInTheDocument();
  });

  it('is closed to a user without the permission', async () => {
    routeFetch(signedIn(makeSession({ permissions: ['stock.view'] })));
    renderApp('/notifications');
    expect(await screen.findByText('You do not have access')).toBeInTheDocument();
  });
});
