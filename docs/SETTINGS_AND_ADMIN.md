# Settings and admin (Stage 5, module 5.5)

## What is built

| Area                                | Endpoints                                                                              | Permission        |
| ----------------------------------- | -------------------------------------------------------------------------------------- | ----------------- |
| Company details and approval limits | `GET /settings`, `PUT /settings/:key`, `POST /settings/:key/reset`                     | `settings.manage` |
| Document number series              | `GET /settings/document-series`, `POST /settings/document-series/:id/advance`          | `settings.manage` |
| Tax (GST) rates                     | `GET /settings/gst-rates`, `POST /settings/gst-rates`, `PATCH /settings/gst-rates/:id` | `settings.manage` |
| Audit log viewer                    | `GET /audit-log`, `GET /audit-log/facets`                                              | `audit.view`      |
| User activity history               | `GET /audit-log/users/:id`                                                             | `audit.view`      |

In the role presets `settings.manage` belongs to the Super Admin only; `audit.view` belongs to Super Admin, Admin **and Staff** (see "Decisions").

## Settings

Seven settings, each validated by its own rule (`packages/contracts/src/settings.ts`): company name, address, GSTIN, phone and email; the exchange approval limit (rupees); the stock adjustment approval limit (units).

- A setting that was never saved uses its default: the server's `EXCHANGE_ADMIN_APPROVAL_LIMIT` for the exchange limit, 10 units for adjustments, nothing for the company details. The response says which (`source`).
- Saving needs the row version once a value exists (optimistic locking); a stale save gives 409. Reset deletes the saved value.
- Every change and reset is written to the audit log with the value before and after.
- **The two approval limits are live**: exchange approval and stock adjustment approval read them on every decision, so a change applies at once.
- The company details are stored for use on documents but nothing reads them yet.
- The database refuses a setting key it does not know.

## Document number series

- Lists every branch, document type and financial year with what the next document will be called.
- "Move forward" raises the next number (for example to skip numbers already used on paper). It locks the row, never moves a number back, allows at most 10,000 at a time, checks the result still fits the 16-character GST limit, needs a reason (5 or more characters) and is audited with how many numbers were skipped. Skipped numbers are never reused.
- The prefix cannot be edited here.

## Tax rates

- Add a rate (0 to 40%, two decimals), change its label, switch it off or on. The percentage itself never changes, because invoices already issued used it.
- A rate that active items still use cannot be switched off (422, with the count). Switched-off rates disappear from `GET /reference/gst-rates`.

## Audit log viewer

- Filters: person, branch, action, record type, record id, text, date range (whole days in India time), sort and paging; lists of actions and record types for the filter menus.
- Row-level security decides what exists for the caller: a Super Admin sees everything, including actions with no branch (sign-ins); a branch user sees the actions of their own branches only. Naming another branch gives 403.
- The log is read-only; values were redacted when written.
- The user activity summary shows last sign-in, open sessions, actions in the last 30 days and the most common actions, counting only what the viewer may see.

## NOT built: workflow (state machine) configuration

The requirements list "state-machine workflow configuration". It is not built. Each module's states and transitions are fixed in code and covered by that module's tests; making them editable would change how transfers, purchase orders, quotations, exchanges and others behave, which needs a decision on which transitions an administrator may change before any code. The two approval limits above are the only workflow rules that are configurable today. Branch details (address, GSTIN) are edited under Branches.

## Decisions to confirm

- `audit.view` is held by Staff in the presets, so a branch Staff member can read other people's audit entries for their own branch, including before and after values. Consider making it manager-only.
- Workflow configuration (above): which transitions, if any, should be configurable?
- The company details have no consumer yet.
