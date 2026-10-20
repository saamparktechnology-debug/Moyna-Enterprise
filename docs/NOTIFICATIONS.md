# Notifications (Stage 5, module 5.2)

## What it does

- **In-app inbox** for every user: `GET /notifications` (own rows only, newest first, filters `unread` and `kind`, paging), `GET /notifications/unread-count`, `POST /notifications/:id/read`, `POST /notifications/read-all`. Needs `notifications.view`. Nobody can read or mark another user's notification (404).
- **Daily reminders** (pg-boss queue `reminders`, cron `REMINDER_CRON`, default 08:00 India time) look for: follow-ups due or overdue, invoices overdue or due within 3 days, low stock, batteries expired or expiring within 30 days, transfers waiting for approval or on their way in, open receiving mismatches, KYC documents pending, and commission payable.
- **External messages** (email, SMS, WhatsApp) are added with `NOTIFICATION_CHANNELS` (for example `EMAIL`). Each one is a `notifications` row (PENDING) plus an outbox event written in the same transaction. The outbox relay hands it to the `domain-events` queue, and the delivery handler sends it through the provider.

## Who is told

| Kind              | Told                                                                                                    | Needs permission                          |
| ----------------- | ------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| Follow-up due     | The person the lead is assigned to (if still active), otherwise users with `leads.manage` in the branch | `leads.manage`                            |
| Payment due       | Users in the branch                                                                                     | `payments.view`                           |
| Low stock         | Users in the branch                                                                                     | `stock.view`                              |
| Battery expiry    | Users in the branch                                                                                     | `batteries.view`                          |
| Pending transfer  | Sending branch to approve; receiving branch to receive                                                  | `transfers.approve` / `transfers.receive` |
| Purchase mismatch | Users in the branch                                                                                     | `discrepancies.resolve`                   |
| Pending KYC       | Company-wide                                                                                            | `kyc.verify`                              |
| Unpaid commission | Users in the branch                                                                                     | `commissions.approve_payout`              |

Inactive users are never told. A Super Admin holds every permission in every branch, so hears about everything except follow-ups assigned to someone else. One notification per person, kind, branch and day: the unique key `(user, channel, dedupe_key)` makes a repeated run harmless.

## Delivery rules

- A temporary failure is retried by the queue; after 5 attempts, or at once for a failure that can never succeed, the row becomes FAILED with the reason. A repeat of the same event does nothing once the row is no longer PENDING.
- The provider is an interface (`NotificationProvider`). Included: `FakeProvider` (tests) and `LoggingProvider` (the default: logs, sends nothing). **No real SMTP, SMS or WhatsApp adapter is included**; add one by implementing the interface. Users have no phone number, so SMS and WhatsApp fail at once with a clear reason until one is stored.

## Database and the worker's rights

Migration 23 adds columns (`kind`, `title`, `link`, `dedupe_key`, `read_at`, `attempts`, `last_error`), a unique key, and checks. The worker role stays as narrow as before (no business tables, no direct outbox writes). It gets only these `SECURITY DEFINER` functions, executable by the worker alone: `worker_alert_*` (read-only counts per branch), `worker_recipients`, `worker_enqueue_delivery` (can only queue a delivery for an existing non-in-app notification) and `worker_notification_for_delivery`. It may insert notifications and update their delivery columns (`status`, `attempts`, `last_error`); row-level security still applies.

## Running it

The worker process starts the handlers and the schedule. `startWorker` only does so when given `{ consumers: true }` (the real `main.ts` does), so tests can read the queue themselves.

## Known limits

- Reminders run once a day; there is no hourly follow-up nudge.
- No per-user notification preferences yet.
- Branch alerts reach a Super Admin as one notification per branch.
