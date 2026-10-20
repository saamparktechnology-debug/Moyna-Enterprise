# Leads and follow-ups (module 4.9)

People who may buy: where they came from, who looks after them, where they are in the sales process, what was said, when to ring next, and turning them into customers.

## Stages

`NEW`, `CONTACTED`, `QUALIFIED`, `QUOTED` and `NEGOTIATION` are the open funnel, in that order.

| From          | May go to                                              |
| ------------- | ------------------------------------------------------ |
| An open stage | Any later open stage (skipping is allowed), and `LOST` |
| `NEGOTIATION` | Also back to `QUOTED`                                  |
| `LOST`        | Only `CONTACTED` (reopening, which needs a reason)     |
| `WON`         | Nowhere                                                |

- `WON` is reached only by **converting** the lead to a customer. The stage endpoint refuses it.
- Losing a lead needs a reason (at least 3 characters). Reopening a lost lead needs a reason too.
- The rule is written once in `packages/contracts/src/leads.ts` (`allowedNextStages`), used by the API and the screen, and repeated by the database (`leads_guard`), which refuses any other move however the row is written.

## What each endpoint does

| Endpoint                       | Permission                                                   | Notes                                                                                                                                                    |
| ------------------------------ | ------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /leads`                   | `leads.view`                                                 | Search by name, phone or interest; filter by stage (`open`, `all` or one stage), source, assignee (`me`, `unassigned` or a user), late follow-ups; paged |
| `GET /leads/:id`               | `leads.view`                                                 | Details, history (newest first) and follow-ups                                                                                                           |
| `POST /leads`                  | `leads.manage`                                               | In the user's branch (a Super Admin names the branch)                                                                                                    |
| `PATCH /leads/:id`             | `leads.manage`                                               | Name, phone, source, interest. Open leads only. Needs `rowVersion`                                                                                       |
| `POST /leads/:id/stage`        | `leads.manage`                                               | Needs `rowVersion`                                                                                                                                       |
| `POST /leads/:id/assign`       | `leads.manage`                                               | A user, or `null` to unassign. Open leads only                                                                                                           |
| `POST /leads/:id/notes`        | `leads.manage`                                               | Allowed on any lead, even a closed one                                                                                                                   |
| `POST /leads/:id/convert`      | `leads.manage` (and `customers.manage` to create a customer) | See below                                                                                                                                                |
| `POST /leads/:id/followups`    | `leads.manage`                                               | Open leads only; the time must not be in the past (five minutes of grace)                                                                                |
| `GET /followups`               | `leads.view`                                                 | Scope `open`, `overdue`, `today`, `upcoming`, `done`, `all`; `mine=true` for the caller's leads                                                          |
| `GET /followups/counts`        | `leads.view`                                                 | `overdue`, `today`, `upcoming`: they never overlap. Meant for the dashboard and reminders (modules 5.1 and 5.2)                                          |
| `POST /followups/:id/complete` | `leads.manage`                                               | Once only, with an optional note                                                                                                                         |
| `GET /leads/assignees`         | `leads.view`                                                 | Active people who work in the branch, and Super Admins                                                                                                   |
| `GET /reference/lead-sources`  | any signed-in user                                           | The active sources                                                                                                                                       |

A follow-up is **overdue** when it is not done and its time has passed, **today** until the end of the day in India, and **upcoming** after that.

## Conversion

`POST /leads/:id/convert` makes the lead a customer in one transaction and marks it won.

1. A customer who already has the lead's phone number is **linked**, never created a second time. The response says `customerCreated: false`.
2. Otherwise a customer is created from the lead's name and phone, with the optional email, address, state and GSTIN sent with the request. A GSTIN already owned by another customer is refused (409) and nothing changes.
3. To link someone else, send `customerId`. Customer details cannot be sent with it.
4. Converting two leads with the same phone number at once, even in two branches, makes one customer (a lock on the number), and converting one lead twice at once succeeds once.
5. The lead's waiting follow-ups are closed with the note "The lead was converted", a note records the move, and `LEAD_CONVERTED` is audited. A lost lead must be reopened first.

## Safety and rules

- **Duplicates**: two open leads with the same phone number in one branch are refused (409), naming the lead already there. A won or lost lead does not block a new one. This is a business rule I chose, because it stops the same enquiry being worked twice; it is easy to relax in `assertNoOpenLead`.
- **Branches**: every lead, note and follow-up carries a branch with row-level security; another branch gets 404 on every endpoint. A note and a follow-up must be in their lead's branch (also a database trigger).
- **Assignment**: only an active person who works in the lead's branch, or a Super Admin.
- **Races**: changes lock the lead row and need the current `rowVersion`; two people moving one lead at once gives one success and one 409.
- **History**: notes are never edited or deleted (database trigger). Every stage change and assignment adds a note with the stages. Completed follow-ups never change and follow-ups cannot be deleted.
- **Closed leads**: a lead that is won or lost has its waiting follow-ups closed and takes no new ones.
- **Audit and events**: `LEAD_CREATED`, `LEAD_UPDATED`, `LEAD_STAGE_CHANGED`, `LEAD_ASSIGNED`, `LEAD_NOTE_ADDED`, `LEAD_CONVERTED`, `FOLLOWUP_SCHEDULED`, `FOLLOWUP_COMPLETED`; events `lead.created`, `lead.stage_changed`, `lead.assigned`, `lead.converted`, `lead.followup_scheduled`.

## Database (migration 15, `20261007001500_leads_followups`)

`leads.interest`; `lead_followups.completed_by` and `completion_note`; new table `lead_notes`; triggers `leads_guard`, `lead_followups_guard`, the note and follow-up branch checks, and the note freeze. The checks on a lead's name, phone format and "won has a customer" are added `NOT VALID`, so they apply to new and changed rows and cannot fail on rows that already exist.

## Not in this module

- `leads.broker_id` is still not used: module 4.10 puts the broker on the invoice, which is where commission is worked out.
- Reminders and notifications for due follow-ups are module 5.2; this module provides the data (`/followups/counts`, the `lead.followup_scheduled` event).
- A follow-up cannot be rescheduled or edited: complete it and plan another.
- Lead sources are a fixed list (the seed); there is no screen to manage them.
- A quotation is not linked to the lead it came from, so the stage `QUOTED` is still set by hand (module 4.11 added quotations but not that link).

## Rescheduling a follow-up, and lead sources

`POST /followups/:id/reschedule` (`leads.manage`) moves a follow-up that is still waiting to another time (not in the past, not the same time, with a reason and the row version). Each move is counted (`rescheduledCount`) and audited with the old and new times. A completed follow-up, or one whose lead is closed, cannot be moved. The database refuses a time change that is not counted, and completing and moving at once.

`/lead-sources` lists every source with its lead count (`leads.view`), and managers (`leads.manage_sources`) add (code in capitals, unique name), rename and switch sources on or off. Sources are never deleted, a switched-off source cannot be used for new leads (existing leads keep it), and at least one must stay on. The Leads page has a **Lead sources** tab for those who may manage them.
