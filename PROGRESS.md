# Progress

Source of truth for stage status. The working rules live in `docs/IMPLEMENTATION_PROMPT.md`.

## Stage status

| Stage | Name                                   | Status                                                                                                                                                                                                                              |
| ----- | -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1     | Project foundation                     | Approved                                                                                                                                                                                                                            |
| 2     | Database and core infrastructure       | Approved                                                                                                                                                                                                                            |
| 3     | Authentication and authorization       | 3.1, 3.2 approved; 3.3 verified in the sandbox (see below)                                                                                                                                                                          |
| 4     | Core feature modules (4.1 to 4.13)     | All 13 modules built: 4.1 to 4.12 approved (4.7 to 4.12 pending the owner's local checks); 4.13 staff and HR built, awaiting verification. The Stage 4 exit gate (the core workflow end to end) is still to be shown as one journey |
| 5     | Supporting modules (5.1 to 5.5)        | 5.1 approved; 5.2 delivered; 5.3 delivered; 5.4 delivered; 5.5 built and verified in the sandbox (workflow configuration not built), awaiting approval                                                                              |
| 6     | UI/UX completion                       | **Built and verified in the sandbox; awaiting approval.** Two exit-gate items are only partly met (see the checklist under "Stage 6")                                                                                               |
| 7     | Integration and end-to-end testing     | Not started                                                                                                                                                                                                                         |
| 8     | Security, performance and code quality | Not started                                                                                                                                                                                                                         |
| 9     | Final verification                     | Not started                                                                                                                                                                                                                         |

## Stage 2 evidence (sandbox, PostgreSQL 16)

| Check                             | Result                                                                                                                         |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Schema                            | 57 tables (48 approved plus 9 added), 23 enums, 111 foreign keys; the database matches `prisma/schema.prisma` exactly (test)   |
| Migrations                        | Apply to an empty database and on top of the previous state; refuse to apply over data that breaks a new constraint (tests)    |
| Constraints                       | 44 checks plus unique and partial indexes; bad data rejected (33 tests)                                                        |
| Privileges and row-level security | Ledgers append-only for the app role, worker limited to outbox processing columns, branch isolation in the database (22 tests) |
| Application isolation             | Branch filter plus row-level security, including nested relations, transactions and concurrent requests (21 tests)             |
| Document numbers                  | 30 parallel requests give 1 to 30, no gaps, rollbacks return their number (9 tests)                                            |
| Seed                              | Idempotent, keeps edits to reference data, new financial year adds a new series (14 tests)                                     |
| Worker                            | Relay publishes each event once across parallel relays, retries, gives up after the limit, pg-boss queues set up (22 tests)    |

## Not verified in the sandbox (Stage 2)

- `prisma migrate deploy`, `migrate reset` and `pnpm db:drift`: Prisma's schema engine cannot be downloaded in the sandbox, so the migrations were applied with `psql` and the commands are untested here. Run `pnpm db:setup` then `pnpm db:drift` on your machine.
- Playwright, Docker Compose and CI, as in Stage 1.

## Decisions (Stage 2)

- Customers, suppliers, brokers and items are shared company-wide masters; transactions are branch-scoped. Notifications are private to their owner, even from a Super Admin.
- Extra masters added at the owner's request: `states`, `gst_rates`, `hsn_codes`, `units_of_measure`, `payment_modes`, `lead_sources`, `kyc_document_types`, `departments`; plus `document_sequences` for gap-free numbering.
- Tax documents use short series (`G`, `N`, `C`) and branch codes are 2 to 4 characters so GST invoice and credit note numbers fit the 16-character legal limit.
- `argon2` (Argon2id, as the Stage 3 spec requires), `tsx` (runs the TypeScript seed), `pg` and `pg-boss` were added; `eslint-plugin-react-hooks` and `nestjs-pino` were added in Stage 1.
- The API and worker connect as `erp_app` and `erp_worker`; only migrations and the seed use the owner account.
- The schema is generated from one specification, so the Prisma schema and the SQL cannot disagree; `docs/DATABASE.md` is generated from the same source.

## Stage 3, module 3.1 (Authentication)

Implemented: migration 3 (lockout, password and session columns), login, logout, session, change-password and admin reset endpoints, global sign-in, CSRF and permission guards (deny by default), per-request branch context, audit rows, and the web login page, route guards, `Can`, permission-aware navigation, change-password page and automatic redirect on an expired session. See `docs/AUTHENTICATION.md`.

Decisions: 30-minute idle and 12-hour absolute session limits; `SESSION_SECRET` added to the configuration; a locked account says so (the other failures give one generic message); new dependency `react-hook-form` and `@hookform/resolvers` (approved stack, first used now).

Not verified in the sandbox: Playwright specs, `prisma migrate deploy` of migration 3, Docker and CI (as before).

## Stage 3, module 3.2 (Branches)

Implemented: migration 4 (code, name and GSTIN integrity checks), branch list/view/create/edit/deactivate/reactivate endpoints, `GET /reference/states`, GSTIN validation with checksum (shared by form and API), optimistic concurrency, deactivation and tax-identity rules, audit rows, and the branch screens (list with search, filter and server pagination; create and edit dialog; deactivate and reactivate confirmation). See `docs/BRANCHES.md`.

Also fixed while building it: the shared search helper now treats `%`, `_` and backslash as ordinary characters (Prisma's `contains` does not escape them).

New dependency: `@radix-ui/react-dialog` (the dialog primitive behind shadcn/ui).

Not verified in the sandbox: Playwright specs, `prisma migrate deploy` of migration 4, Docker and CI (as before).

## Fixes

- Fix 1 (owner report: `password authentication failed for user "erp"`, integration tests failing slowly): vitest never loaded the root `.env`, so `DATABASE_URL_TEST` set there was ignored, and a bad connection failed after about 33s with a raw driver error. Now `.env` is loaded for tests (shell variables still win), a preflight check fails in about 1s with an actionable message (wrong credentials or another PostgreSQL on the port, database missing, server down), and `POSTGRES_PORT` lets Docker use a free host port. Guarded by `database-preflight.test.ts` and `load-root-env.test.ts`.

## Stage 3, module 3.3 (Users, roles and permissions)

Implemented: migration 5 (`roles.tier`), user list/view/create/edit/deactivate/reactivate endpoints, role list/view/create/edit and permission-catalogue endpoints, one tier-based hierarchy rule shared by user management and password reset, the `X-Branch-Id` branch switcher, and the screens: users (list, filters, form, deactivate, reset, one-time temporary password), roles (list and a permission editor grouped by module) and the branch switcher. See `docs/USERS_AND_ROLES.md`.

Decisions: one role per user; Super Admins are created only by the seed; Staff-level roles can never manage anyone; `roles.manage` and `branches.manage` are reserved to the Super Admin role; roles are not deleted; the edit request may carry an empty branch list (the server keeps the memberships the editor does not manage).

Not verified in the sandbox: Playwright specs (16 now), `prisma migrate deploy` of migration 5, Docker and CI (as before).

## Stage 3 re-verification (sandbox, PostgreSQL 16)

Before starting Stage 4 the whole of Stage 1 to 3 was run again from a clean checkout: contracts 68, permissions 14, web 112, worker 22, API unit 143 and API integration 304 tests all passed, with type check, lint and format check clean. This covers module 3.3, which was awaiting verification.

## Stage 4, module 4.1 (Item master and barcodes)

Implemented: migration 6 (item code and barcode checks, case-insensitive sibling category names, barcode sequence, two company-wide stock functions), item list/view/create/edit/deactivate/reactivate, scan lookup, barcode add/remove/generate (EAN-13, prefix 20), label data, item categories (tree, three levels), reference lists for units, GST rates and HSN codes, and the screens: items (list, filters, server paging, form, status dialog, scan box, label printing, categories). See `docs/ITEMS.md`.

Decisions: items carry no prices (the approved schema has none; prices come from purchase order lines and invoice lines); an item can have up to 10 barcodes; labels draw EAN-13 barcodes only, other barcodes print as text (a Code 128 encoder would be new code to approve); `items.view` covers label printing, `items.manage` covers everything that changes data; no new permissions and no new dependencies.

Changed existing files: `app.module.ts`, `reference.controller.ts` (three read-only lists added), `contracts/index.ts`, `scripts/check-schema-drift.mjs` (one allowed index), `migrations.int.test.ts` (migration list), `test/support/auth-world.ts` (a `patch` helper), web `navigation.ts`, `routes.tsx` and `index.css` (print rules).

Tests added: contracts 16, API integration 45, web 41. Two integration tests were checked by mutation: they fail when the company-wide functions lose `SECURITY DEFINER`.

Not verified in the sandbox: Playwright (`e2e/items.spec.ts`), `prisma migrate deploy` of migration 6 (applied with `psql`, as before), Docker and CI.

## Stage 4, module 4.2 (Inventory and stock ledger)

Implemented: migration 7 (`stock_adjustments`, `stock_balance_drift()`, `serial_number_in_use()`), one posting service for every stock change (never below zero, ledger and balance written together, row-locked), stock by state per branch, low-stock list, movement history, serial units, adjustment requests with approve, reject and cancel, and the Inventory screens (Stock, Low stock, Movements, Serial numbers, Adjustments). See `docs/STOCK.md`.

Decisions: an Admin approves up to 10 units per adjustment, larger ones need a Super Admin; nobody approves their own request except a Super Admin; items have no prices so the limit is by quantity; the limit is a constant until module 5.5 adds company settings; no new permissions and no new dependencies.

Changed existing files: `schema.prisma` (the new table and enum), `branch-scope.ts` and its test (the new table is branch-scoped), `schema-conformance.int.test.ts`, `migrations.int.test.ts`, `app.module.ts`, web `navigation.ts` and `routes.tsx`, and `app-shell.test.tsx` (it used `/inventory` as its "not built yet" example, so it now uses `/sales`).

Tests added: contracts 7, API integration 39, web 31 (against module 4.1: contracts 84 to 91, API 492 to 531, web 153 to 184). Negative stock, racing issues, balance equal to ledger and the approval limit are each covered.

Not verified in the sandbox: Playwright (`e2e/inventory.spec.ts`), `prisma migrate deploy` of migration 7 (applied with `psql`), Docker and CI.

## Stage 4, module 4.3 (Batteries)

Implemented: migration 8 (where a battery is installed, a ten-year warranty limit, battery dates on incoming stock adjustments), battery details recorded with the stock or later, expiry and warranty status judged by the calendar day in India, a sale check that refuses an expired battery without a manager override and audits every override, warranty start on sale for billing, installing a battery in a vehicle (reserved, not sold) and taking it out, expiry alert counts, and the Batteries screens (list with filters, alerts, details form, install dialog). See `docs/BATTERIES.md`.

Decisions: a battery is good through its expiry date; the warranty starts on the sale date (module 4.7 calls `startWarranty`); installation reserves the battery for the vehicle rather than selling it; overrides need `batteries.override_expiry` plus a reason; no new permissions and no new dependencies.

Changed existing files: `schema.prisma`, `packages/contracts/src/index.ts`, `migrations.int.test.ts`, `schema-conformance.int.test.ts`, `app.module.ts`, web `navigation.ts` and `routes.tsx`, and the inventory screens (battery fields on the adjustment request).

Tests added: contracts 19, API integration 32, web 23 (against module 4.2: contracts 91 to 110, API 531 to 563, web 184 to 207). Warranty month maths (leap years, month ends, year ends), the expiry boundary, the override rules, duplicate serials and concurrent installs are each covered.

Not verified in the sandbox: Playwright (`e2e/batteries.spec.ts`, which only opens the page and checks the first validation), `prisma migrate deploy` of migration 8 (applied with `psql`), Docker and CI.

## Stage 4, module 4.4 (Purchasing and receiving)

Implemented: migration 9 (purchase returns, supplier payment references, delivery note details, unique GSTIN, one line per item on an order, a rule that supplier deactivation looks at every branch), suppliers with GSTIN checks, purchase orders (draft, approve, cancel), goods receipts verified line by line (good units to Available; damaged, excess and wrong units to Quarantine; short deliveries from the delivery note), serial and battery receiving, the shared discrepancy workflow, returns to a supplier, supplier payments and a supplier ledger, and the Purchasing screen with its five tabs (orders, receipts, discrepancies, returns, suppliers). See `docs/PURCHASING.md`.

Two defects were found and fixed while writing the backend tests: lines of an order, receipt and return were listed in an unstable order (they shared one timestamp), and the two new tables had no row-version trigger. One type error in the returns screen was fixed when the screens were finished. The pinned counts in the migration, schema, seed and branch-scope tests were updated for the new tables and document type.

Decisions: a receipt never changes stock without a line-by-line count; good units go to Available and everything else to Quarantine until someone decides; a supplier's ledger counts only the branches the caller can see; no new permissions and no new dependencies.

Tests added: contracts 15, API integration 45, web 68 (against module 4.3: contracts 110 to 125, API 563 to 608, web 207 to 275). Orders, receiving (counts, damaged, short, serial and battery lines, wrong items), suppliers (GSTIN, ledger, payments), receipts, discrepancies and returns are each covered, including the server's refusals.

Not verified in the sandbox: Playwright (`e2e/purchasing.spec.ts`, which opens the page and checks the first validation of a supplier and an order), `prisma migrate deploy` of migration 9 (applied with `psql`), Docker and CI.

## Stage 4, module 4.5 (Inter-branch transfers)

Implemented: migration 10 (a note on every step, requested against sent quantities, damaged count, serial number on the line, quantity checks, and `transfer_arrive_in_transit` for the one cross-branch stock write), the transfer workflow (ask, approve or reject, dispatch, receive, cancel) with line-by-line counts, serial scanning, short and damaged goods recorded as discrepancies, and the Transfers screen (list with filters, request form, detail with history, approve, reject, cancel, dispatch and receive dialogs). See `docs/TRANSFERS.md`.

Decisions: the branch that needs the stock asks and the branch that holds it approves and sends; goods are held in transit at the destination from dispatch, so nothing is ever lost between branches; only the receiving branch settles problems on arrival; the transfer screen tells the user where to settle them rather than duplicating the discrepancy screen; no new permissions and no new dependencies.

Changed existing files: `schema.prisma`, `packages/contracts/src/index.ts`, `app.module.ts`, `reference.controller.ts` (the branch list), `migrations.int.test.ts`, `schema-conformance.int.test.ts`, web `navigation.ts` and `routes.tsx`.

Tests added: contracts 10, API integration 42, web 41 (against module 4.4: contracts 125 to 135, API 608 to 650, web 275 to 316). Dispatch and receive races, stock that runs out, serial units, short and damaged deliveries, settlement and the database guard are each covered, and the screens are tested for every status and role.

Not verified in the sandbox: Playwright (`e2e/transfers.spec.ts`, which opens the page and checks the first validation), `prisma migrate deploy` of migration 10 (applied with `psql`), Docker and CI.

## Stage 4, module 4.6 (Customers and KYC)

Implemented: migration 11 (customer phone and GSTIN rules, file and review details on KYC documents, a masked document number the database enforces, a guard that freezes uploaded and decided documents, no delete), the customer master, KYC upload with real file-type and size checks, the verify and reject workflow with full history, masked numbers, access logging of every file read, `GET /reference/kyc-document-types`, an upload method and a download method on the web API client, and the Customers screens (list with search and KYC filter, form, KYC dialog with history, upload, view, verify and reject). See `docs/CUSTOMERS.md`.

Decisions: customers belong to the company, not a branch; a phone number and a GSTIN each belong to one customer (this is what stops duplicates when a lead is converted); a customer is verified by one verified identity document; nobody verifies their own upload except a Super Admin; the document number is kept only as its last four letters or digits; a file is accepted by what it is, not what it claims to be; no new permissions and no new dependencies.

Changed existing files: `schema.prisma`, `bootstrap.ts` (a body parser for PDF, JPEG and PNG files), `logger.module.ts` (the document-number header is never logged), `app.module.ts`, `reference.controller.ts`, `api-client.ts` (upload and download), `routes.tsx`, `migrations.int.test.ts` and `schema-conformance.int.test.ts` (migration list and one more foreign key), and `contracts/index.ts`.

Tests added: contracts 17, API unit 3, API integration 37, web 32 plus 7 for the client (against module 4.5: contracts 135 to 152, API 650 to 690, web 316 to 355). The masking and the KYC status rules, file-type checks by content, the size limit at exactly 5 MB and one byte over, rejected-then-resubmitted documents, racing uploads and decisions, access logging and the database guards are each covered.

One real defect was found while writing the masking tests and fixed before it could ship: a licence number ending in a dash or slash would have produced a masked value the database refuses. Masking now uses letters and digits only.

**Open item that needs your decision:** object storage is still the in-memory stand-in from Stage 3, so uploaded KYC files are lost when the API restarts. A real S3-compatible adapter is needed before production. It can be written by hand (signing requests with Node's crypto, no new package) or with the AWS SDK (a new dependency, which your rules say to ask about first). It also needs a MinIO service in `docker-compose.yml` and storage settings in the environment. I did not build it without your choice. **Resolved in module 4.8:** files are now kept on disk (see below); an S3 adapter is optional later.

Not verified in the sandbox: Playwright (`e2e/customers.spec.ts`), `prisma migrate deploy` of migration 11 (applied with `psql`), Docker and CI.

## Stage 4, module 4.7 (Billing and invoicing)

Implemented: migration 12 (cancel and reissue details, a line number on each line, arithmetic checks, guards that freeze an issued invoice and its lines, and two guarded functions for discarding a draft and replacing its lines), GST and non-GST invoices with the tax worked out line by line and a rounded total, the CGST and SGST or IGST split by place of supply, discounts with a staff limit of 5% and manager approval above it, gap-free numbers per branch taken when the invoice is issued, stock, serial units, batteries and warranties in the same transaction, cancel and reissue, a PDF written without a library, the `invoice.issued` and `invoice.cancelled` events, and the Sales screens (list, draft form with live totals, detail with issue, discard, cancel, reissue and PDF). See `docs/BILLING.md`.

Several billing files (the migration, the spec tests and a PDF test) were already in the tree from an earlier session. They were treated as the specification, and the service, contracts and PDF were fitted to them. The batteries service gained one small public method, `assertSellable`, for billing's use. The app-shell test now uses `/reports` as its "not built yet" page, because `/sales` is built.

Decisions: the browser sends only item, quantity, price and discount, because items carry no list price; staff may discount up to 5% of a line; a draft may name a serial unit that is not available yet, which is checked again when the invoice is issued; an invoice cannot be cancelled while it has a payment, a credit note or an exchange against it; no new permissions and no new dependencies.

Tests added (against module 4.6): contracts 152 to 169, API 690 to 773, web 355 to 401; the billing integration test has 40 cases, the credit note integration test 22 and the invoice calculation and PDF tests 21. Rounding, inter-state and intra-state splits, number gaps under concurrency, no edit after issue, the stock effect of cancelling, expired batteries and vehicles sold with fitted batteries are each covered.

Part C, credit notes: migration 13 (status, tax columns and decision details on credit notes, a `credit_note_lines` table, guards that fix a decided credit note and its lines, and a database check against over-crediting), requesting, approving and rejecting, the amounts credited in proportion to the goods returned with the last units taking the exact remainder, returned goods in the Returned stock state, serial units and battery warranties, a gap-free number taken only on approval, and the Credit notes tab with the request and decision dialogs. Nobody approves their own request except a Super Admin. A credit note PDF is not built. See `docs/BILLING.md`.

Not verified in the sandbox: Playwright (`e2e/billing.spec.ts`, which opens the page and checks the first validation of a draft), `prisma migrate deploy` of migrations 12 and 13, Docker and CI.

KYC files are now kept on disk (module 4.8); an S3-compatible adapter is a possible later addition.

## Stage 4, module 4.8 (Payments and dues)

Implemented: migration 14 (reference, note and retry key on `payments`; the `payment_reversals` table; a ledger freeze on payments, allocations and reversals; database checks that an allocation matches branch, customer and an issued invoice and never exceeds the payment or what the invoice is owed, taken under row locks), recording a payment with automatic or chosen allocation or as an advance, applying leftover credit later, reversal by a new row, dues (outstanding, overdue, settled) with totals, customer dues, the customer ledger with a running balance, and the Payments screens (invoices due, customers with ledger, payments with detail, record and reverse). See `docs/PAYMENTS.md`.

KYC storage (the open item from 4.6) is fixed: files are kept on disk under `KYC_STORAGE_PATH` behind the existing storage interface, with a start-up check, safe keys, atomic writes and owner-only permissions. Production requires the setting and refuses in-memory storage. See `docs/CUSTOMERS.md`. No S3 adapter exists and none is tested.

Changed existing files: `schema.prisma`, `billing.service.ts` (a reversed payment no longer blocks cancelling an invoice), `app.module.ts`, `branch-scope.ts`, `core.module.ts` and `env.ts` (storage choice), `contracts/index.ts`, web `navigation.ts` and `routes.tsx`, `.env.example`, `CUSTOMERS.md`, `BILLING.md`, and the pinned counts in `migrations.int.test.ts`, `schema-conformance.int.test.ts` and `branch-scope.test.ts`.

Decisions: a payment is reversed by a reversal row, never edited; a retry key is required on every payment; an overpayment stays as credit held for the customer; a credit note counts once approved; refunding a surplus is not built (the schema has no outgoing payment); a payment can be applied to an invoice once; the ledger counts only the branches the caller can see; no new permissions and no new dependencies.

Tests (against module 4.7, all run in the sandbox against PostgreSQL 16): contracts 169 to 188, API 773 to 834 (51 files; 26 payment integration tests, KYC storage and configuration tests, the allocation planner), web 401 to 424 (34 files), permissions 14. Worker 22 of 23: the one failure is the old `worker.test.ts` described below. Type check is clean for contracts, permissions, API, web, e2e and prisma; lint is clean for the whole repository.

Not verified in the sandbox: Playwright (`e2e/payments.spec.ts`), `prisma migrate deploy` of migration 14 (applied with a script running the SQL), `pnpm db:drift`, Docker and CI. `docs/DATABASE.md` was not regenerated.

Known failure that was already in the repository: `apps/worker/src/worker.test.ts` is out of date with `startWorker(env, logger)`, so the root `pnpm typecheck` fails at the worker. It was left unchanged.

Still open: credit note PDF (not built, independent of payments); fitted batteries are not returned with a vehicle (not inspected, no effect on payment calculations that I found); refund of a customer's surplus.

## Stage 4, module 4.9 (Leads and follow-ups)

Implemented: migration 15 (what a lead wants; who completed a follow-up and the result; the `lead_notes` table; database guards so a lead moves only along the allowed stages, a won lead always has its customer and never changes again, notes are never edited or deleted, a completed follow-up never changes and follow-ups cannot be deleted, and a note or follow-up is in its lead's branch), leads (create, edit, search and filter, assign), stages with the rule written once in the shared contract, notes and a history of every stage change and assignment, follow-ups (plan, complete, overdue, today, upcoming, counts), conversion to a customer that links an existing customer with the same phone number instead of creating another, `GET /reference/lead-sources`, and the Leads screens (lead list with filters, new and edit lead, a lead dialog with stage, assignment, notes, follow-ups and conversion, and a Follow-ups tab). See `docs/LEADS.md`.

Decisions: a lead moves forward to any later open stage, from negotiation back to quoted, to lost (reason needed) and from lost back to contacted (reason needed); won is reached only by converting; two open leads with one phone number in a branch are refused (my choice, easy to relax); waiting follow-ups close when a lead is won or lost; converting links the customer who has the phone number rather than creating one; a person needs `customers.manage` to create a customer through conversion; leads are visible to the whole branch, not only the person they are assigned to; no new permissions and no new dependencies.

Changed existing files: `schema.prisma`, `app.module.ts`, `branch-scope.ts`, `reference.controller.ts` (the lead sources list), `contracts/index.ts`, web `navigation.ts` and `routes.tsx`, and the pinned counts in `migrations.int.test.ts`, `schema-conformance.int.test.ts` and `branch-scope.test.ts`.

Not in this module: brokers on leads (module 4.10), reminders and notifications (module 5.2; the data is ready), rescheduling a follow-up, a screen to manage lead sources, quotations from a lead (module 4.11).

Tests (against module 4.8, run in the sandbox against PostgreSQL 16): contracts 188 to 209, API 834 to 872 (52 files; 38 leads integration tests), web 424 to 450 (35 files; 26 leads tests), permissions 14. Worker 22 of 23: the one failure is the old `worker.test.ts` (see module 4.8). One purchasing web test failed once while the machine was busy with lint and passed in two isolated runs and in a full rerun, so it is a timing flake and is unchanged. Type check is clean for contracts, permissions, API, web, e2e and prisma; lint is clean for the whole repository.

Not verified in the sandbox: Playwright (`e2e/leads.spec.ts`), `prisma migrate deploy` of migration 15 (applied with a script running the SQL), `pnpm db:drift`, Docker and CI. `docs/DATABASE.md` was not regenerated.

## Stage 4, module 4.10 (Brokers and commission)

Implemented: migration 16 (a broker on the invoice; unique broker phone; commission rules that can never be edited, with one live rule per broker; the amount a commission was worked out on and how it was paid; one commission per invoice; append-only commission adjustments; database guards on all of it), the broker master (add, edit, switch off and on, search), commission rules (a new rule retires the old one), commission worked out when an invoice is issued on the rule in force then, reduced by approved credit notes and taken back on cancellation, payout of commissions to one broker at a time, a broker ledger with a running balance, and the Brokers screens (brokers, rules, ledger, commissions with payout) plus a Broker field on the invoice form. See `docs/BROKERS.md`.

Decisions: commission is worked out on the invoice's taxable value (before GST); a fixed rule is paid once per invoice and capped at the taxable value; a credit note takes back its share of the commission in total, so the paisa add up; a commission that was already paid and is lowered afterwards is shown as money to get back, not settled in the system; payout is allowed as soon as the invoice is issued, whether or not the customer has paid; payout needs `commissions.approve_payout` and brokers are managed with `brokers.manage` (both manager-only, as set up in Stage 1); no new permissions and no new dependencies.

Changed existing files: `schema.prisma`, `billing.service.ts` (broker on drafts, commission at issue, reversal at cancel, broker carried onto a re-issued draft), `credit-notes.service.ts` (reduce the commission on approval), `billing.mapper.ts` and the invoice contract (`brokerId`, `brokerName`), `app.module.ts`, `billing.module.ts`, `branch-scope.ts`, `check-schema-drift.mjs` (one partial index), `contracts/index.ts`, web `navigation.ts`, `routes.tsx`, the invoice form and detail, `docs/LEADS.md`, `docs/BILLING.md`, and the pinned counts and one commission-rule test in `constraints.int.test.ts`, `migrations.int.test.ts`, `schema-conformance.int.test.ts` and `branch-scope.test.ts`, and the invoice fixtures in `invoice-pdf.test.ts` and the web `test-data.ts`.

Not in this module: exchange effect on commission (module 4.12), brokers on leads (the column stays unused), reminders for unpaid commission (module 5.2), a commission report (module 5.4), settling money to get back from a broker.

Tests (against module 4.9, run in the sandbox against PostgreSQL 16, in chunks because of a time limit): contracts 209 to 223, API 872 to 916 (54 files; 36 brokers integration tests and 8 commission calculation tests), web 450 to 477 (37 files; 22 brokers screen tests and 5 invoice broker tests), permissions 14. Worker 22 of 23: the one failure is the old `worker.test.ts` (see module 4.8). Type check is clean for contracts, permissions, API, web, e2e and prisma; lint and the format check are clean for the whole repository. A bug found and fixed while testing: the first broker ledger query read a `timestamp` column as if it had a time zone, which could shift an entry's date by a day; the 4.8 and 4.9 queries read `timestamptz` columns and are not affected.

Not verified in the sandbox: Playwright (`e2e/brokers.spec.ts`), `prisma migrate deploy` of migration 16 (applied with a script running the SQL), `pnpm db:drift` (including the new partial index entry), Docker and CI. `docs/DATABASE.md` was not regenerated.

## Stage 4, module 4.11 (Quotations and customized TOTO orders)

Implemented: migration 17 (quotation lines, tax totals, validity, broker, custom-build flag, specification and build stage on `quotations`; build history; a motor number on serial units; advances as payments that name their quotation; database guards for the status moves, the freeze after sending, advances, vehicle promising and the build history), quotations (write, edit a draft, send, accept, cancel, expire), advances (partial, capped at the quotation total, retry-safe), build tracking and vehicle assignment with chassis and motor numbers, conversion to a draft invoice at the quoted prices, and at issue the delivery-before-full-payment rule, application of the advances and marking the quotation converted. The Quotations screens and a delivery-reason field on the invoice detail. See `docs/QUOTATIONS.md`.

Decisions: quoted prices are fixed when sent and an invoice from a quotation cannot change them, while tax is worked out at the rate in force at invoicing; a quotation with an advance paid never lapses; delivery before full payment needs a new manager-only permission, `quotations.deliver_unpaid`, plus a reason, and is audited; the rest of the order is taken as an advance on the quotation before delivery; cancelling a delivered invoice needs the advance payments reversed first and then reopens the quotation; a vehicle is set aside, not reserved; the discount limit for staff applies when sending a quotation.

Changed existing files: `schema.prisma`, `billing.service.ts` and `billing.controller.ts` (invoice from a quotation, locked prices, delivery rule and advances at issue, reopening at cancel, quotation carried onto a re-issued draft), `billing.mapper.ts` and the invoice contract (`quotationId`, `quotationNo`, `unpaidDeliveryReason`), `payments.service.ts` (the recording step can now run inside another transaction; behaviour unchanged), `app.module.ts`, `billing.module.ts`, `branch-scope.ts`, the permission catalog and presets (one new permission), `contracts/index.ts`, web `navigation.ts`, `routes.tsx`, the invoice detail, `docs/BILLING.md`, `docs/PAYMENTS.md`, `docs/LEADS.md`, and the pinned counts in `migrations.int.test.ts`, `schema-conformance.int.test.ts` and `branch-scope.test.ts`, plus the invoice fixtures in `invoice-pdf.test.ts` and the web `test-data.ts`.

Not in this module: a PDF of a quotation, a link from a lead to its quotation, notifications for a quotation about to lapse (module 5.2), the effect of an exchange on a delivered order (module 4.12), showing the quotation on the payments screens, unassigning a vehicle.

Tests (against module 4.10, run in the sandbox against PostgreSQL 16, in chunks because of a time limit): contracts 223 to 242, API 916 to 960 (55 files; 44 quotation integration tests), web 477 to 507 (38 files; 25 quotation screen tests and 5 invoice-detail tests, run in two halves), permissions 14. Worker: unchanged, and still 22 of 23 because of the old `worker.test.ts` (see module 4.8). Type check is clean for contracts, permissions, API, web, e2e and prisma; lint and the format check are clean for the whole repository. Two fixes made while testing: the web quotation tests used a wrong route and hand-built item pages, and the quotation API tests needed branch A to have a GSTIN and a real GST slab (the seeded slabs are 0, 5, 18 and 40).

Not verified in the sandbox: Playwright (`e2e/quotations.spec.ts`), `prisma migrate deploy` of migration 17 (applied with a script running the SQL), `pnpm db:drift`, Docker and CI. `docs/DATABASE.md` was not regenerated.

## Stage 4, module 4.12 (Exchange)

Implemented: migration 18 (an exchange gets its own number, kind, status, original invoice, valuation, amounts, disposition, reason and decision details; a new document type and number series; the reserved payment mode `EXCHANGE`; database guards for the terms, the one-open-exchange-per-vehicle rule, the figures and the credit note interplay; an `EXCHANGE` kind of commission adjustment), requesting an exchange against an issued delivery invoice (old-for-new at a chosen valuation, new-for-new at the price paid), approval by a different manager, rejection, withdrawal by the requester, and the Exchanges screens. On approval, in one transaction: the old vehicle and its fitted batteries go back into stock as returned goods or are scrapped, the valuation is paid in as a trade-in and applied to the delivery invoice (the rest is credit held for the customer), and the commission on the old sale is lowered by the vehicle's share. See `docs/EXCHANGES.md`.

Decisions: an exchange takes back only a vehicle this system sold to the same customer from the same branch; a swap is valued at exactly the price paid and a trade-in at up to that; the difference is the new price less the valuation, payable above zero and held as credit below zero; the delivery invoice's commission is not changed; a vehicle with a credit note cannot be exchanged and a vehicle in an exchange cannot be credited; neither invoice can be cancelled while an exchange stands; nobody approves their own exchange except a Super Admin; no valuation limit for approvers because the requirements give no figure; the payment mode `EXCHANGE` is reserved to exchanges; no new permissions and no new dependencies.

Changed existing files: `schema.prisma`, `payments.service.ts` (refuses the reserved mode; the recording step takes an option for the system to use it), `commissions.service.ts` (reduction for exchanges, and credit notes now count exchanged vehicles), `credit-notes.service.ts` (a vehicle in an exchange cannot be credited), `billing.service.ts` (cancel is refused on either invoice of an exchange), `app.module.ts`, `documents.ts`, `payments.ts` and `contracts/index.ts` in the contracts, `prisma/seed/data.ts`, `check-schema-drift.mjs`, web `navigation.ts`, `routes.tsx` and `use-purchasing.ts` (reserved modes are not offered), the docs `PAYMENTS.md`, `BILLING.md` and `BROKERS.md`, and the pinned counts in `migrations.int.test.ts`, `schema-conformance.int.test.ts` and `seed.int.test.ts`, plus one billing test rewritten for the new rules.

Not in this module: approval limits, trade-in of a vehicle this system never sold, paying credit back to the customer, reversing an approved exchange, a PDF of an exchange, notifications (module 5.2).

Tests (against module 4.11, run in the sandbox against PostgreSQL 16, in chunks because of a time limit): contracts 242 to 250, API 990 in 56 files (32 new exchange integration tests; the 4.11 figure of 960 was overstated by 2 because of a summing slip, the measured number for those suites is unchanged), web 507 to 529 (39 files; 22 exchange screen tests, run in two halves), permissions 14 (unchanged). Worker unchanged, still 22 of 23 because of the old `worker.test.ts` (see module 4.8). Type check is clean for contracts, permissions, API, web, e2e and prisma; lint and the format check are clean for the whole repository. Existing tests changed only where this module changes what they pin: the seed counts (one more payment mode, one more number series), the schema counts, the app shell menu (Exchanges appears after Sales for people who may view invoices), and one billing test rewritten for the new cancel rule.

Not verified in the sandbox: Playwright (`e2e/exchanges.spec.ts`), `prisma migrate deploy` of migration 18 (applied with a script running the SQL, including `ALTER TYPE ... ADD VALUE`, which needs PostgreSQL 12 or later), `pnpm db:drift` (including the two new partial indexes), Docker and CI. `docs/DATABASE.md` was not regenerated.

## Stage 4, module 4.13 (Staff and HR)

Implemented: migration 19 (staff profiles gain an employee code, designation, monthly salary and the day they left; leave gains a kind, reason and decision details; attendance records who corrected it and why; payroll records gain a status, deductions, a snapshot of what they were worked out on and a final state; database guards for leave overlap, attendance only for days worked here, a shift of at most a day, and a frozen final month), staff profiles with leaving and returning, self check-in and check-out across midnight, manager corrections, leave with overlap protection and approval, monthly payroll generation (pro rata for joiners and leavers, a default deduction for unpaid leave, adjustable drafts, finalization), and one HR page with My day, Leave, Attendance, Payroll and Staff. See `docs/HR.md`.

Decisions: `hr.view` without `hr.manage` shows only your own records, because Staff hold `hr.view` and salaries are private; one new permission, `leave.request`; a working day is the date of the check-in in India so a night shift stays on the day it began; nobody approves their own leave, finalizes their own pay or corrects their own attendance except a Super Admin; no overlapping leave for one person; pay is the monthly salary by calendar days employed (both ends counted) rounded to the paisa, and deductions start as the share for approved unpaid leave (my rules, as the requirements give no pay policy); payroll can only be made for a month that has ended; once final, that person's month cannot change in attendance, leave or pay; this module records payroll and does not pay anyone or work out statutory deductions.

Changed existing files: `schema.prisma`, `app.module.ts`, the permission catalog (`leave.request`), `contracts/index.ts`, web `navigation.ts`, `routes.tsx` and `api-client.ts` (a `put` method), the test client `auth-world.ts` (a `put` method), and the pinned counts in `migrations.int.test.ts`, `schema-conformance.int.test.ts` and `constraints.int.test.ts` (its HR inserts now supply the new required columns), plus the app shell menu test.

Not in this module: leave balances and entitlements, statutory deductions, overtime, holidays and weekly offs, payslips and exports, notifications (module 5.2), switching off a login when someone leaves.

Tests (against module 4.12, run in the sandbox against PostgreSQL 16, in chunks because of a time limit): contracts 250 to 282, API 990 to 1046 in 57 files (56 new HR integration tests), web 529 to 571 in 40 files (42 new HR screen tests, run in two halves), permissions 14 (unchanged). Worker unchanged, still 22 of 23 because of the old `worker.test.ts` (see module 4.8). Type check is clean for contracts, permissions, API, web, e2e and prisma; lint and the format check are clean for the whole repository. Two bugs found and fixed while testing: the attendance correction check threw an exception on an invalid time (a malformed request would have caused a server error instead of a 400), and `GET /staff/me` returned an empty body for a person with no profile (it is now a 404). Existing tests changed only where this module changes what they pin: the schema counts, the migration list, and the HR inserts in the constraints test.

Not verified in the sandbox: Playwright (`e2e/hr.spec.ts`), `prisma migrate deploy` of migration 19 (applied with a script running the SQL), `pnpm db:drift`, Docker and CI. `docs/DATABASE.md` was not regenerated.

## Stage 4, pending items closed

Done after module 4.13: the worker test fixed (root type check clean); fitted batteries return with a vehicle on a credit note; a credit note PDF (shared drawing code now in `pdf-kit.ts`); refunding a customer's credit (migration 20, number series `RFD`, permission `payments.refund`); rescheduling a follow-up (migration 21); lead sources management (permission `leads.manage_sources`); an optional exchange approval limit (`EXCHANGE_ADMIN_APPROVAL_LIMIT`); and the **Stage 4 exit-gate journey** (`journey.int.test.ts`, 9 steps: branch scope, purchase with a short and a damaged line, transfer with a shortage, GST sale and payments, credit note and cancel-and-reissue, lead to delivery with broker payout, exchange, battery alert, stock equals ledger).

Tests, run in the sandbox against PostgreSQL 16 in chunks: contracts 282, permissions 14, API 1,096 (unit 214, integration 882, in 59 files), web 588, worker 24. Type checks, lint and format are clean.

Left out on purpose: a lead-to-quotation link (a quotation needs a customer, which exists only after conversion); regenerating `docs/DATABASE.md` (no generator script exists); an S3 adapter (needs a new dependency). Not run in the sandbox: Playwright, `prisma migrate deploy`, `db:drift`, Docker, CI. One worker relay test failed once on timing and passed on reruns.

## Stage 5, module 5.1 (Dashboards)

Implemented: migration 22 (13 read-only SQL views, all `security_invoker` except `v_item_latest_cost`, and five date-range indexes), `GET /dashboards/company` (`dashboards.view_company`) and `GET /dashboards/branch` (`dashboards.view_branch`), shared contracts, and the Dashboard page (period picker, branch picker, stat cards, a daily trend chart, a sales-by-branch chart and a branch table). See `docs/DASHBOARDS.md` for where every figure comes from.

Decisions: sales is issued invoice totals with GST; revenue is taxable value less approved credit notes; collected leaves out reversed payments and the `EXCHANGE` trade-in; purchases are approved, partly received and received orders by order date; stock value is available, reserved and in-transit units at each item's latest approved purchase cost (items never bought are counted apart); lead conversion is of leads created in the period, how many are won now; company totals are the sum of the branch lines; Staff see their own branch (existing role preset). New dependency: `recharts` (approved stack), loaded as a separate chunk.

Changed existing files: `app.module.ts`, `schema.prisma` (five indexes), `contracts/index.ts`, web `dashboard-page.tsx` (the system status card is kept), `migrations.int.test.ts` (migration list) and `schema-conformance.int.test.ts` (views are not tables).

Tests (against Stage 4 end, sandbox, PostgreSQL 16): contracts 282 to 286, API unit 214 to 219, API integration 882 to 913 (31 dashboard tests: hand-checked figures, figures equal to the source tables, agreement with the dues, low-stock and battery-alert endpoints, branch isolation through the API and through the views, permissions, validation), web 588 to 596, worker 24, permissions 14. Type check, lint and format are clean; production builds pass.

Not verified in the sandbox: Playwright (`e2e/dashboards.spec.ts`), `prisma migrate deploy` of migration 22 (applied with a script), `pnpm db:drift`, Docker and CI. `docs/DATABASE.md` was not regenerated. The main web bundle still triggers the 500 kB warning (975 kB; Stage 8 code splitting).

## Stage 5, module 5.2 (Notifications)

Implemented: migration 23 (notification columns, dedupe key, worker-only SQL functions), the in-app inbox API and page with a bell showing unread count, eight daily reminder jobs (pg-boss), outbox-based delivery of email/SMS/WhatsApp through a provider interface with a fake and a logging provider. See `docs/NOTIFICATIONS.md`.

Decisions: the worker keeps its narrow database rights and reaches data only through read-only SECURITY DEFINER functions; reminders are per person, kind, branch and day; follow-ups go to the assignee; no real provider adapter is included; users have no phone number so SMS/WhatsApp fail with a reason.

Tests (sandbox, PostgreSQL 16): 33 new API/worker integration tests (30 in `notifications.int.test.ts`), 5 worker unit tests, 3 contract tests, 9 web tests. Not verified in the sandbox: Playwright (`e2e/notifications.spec.ts`), `migrate deploy`, `db:drift`, Docker, CI.

## Stage 5, module 5.3 (Search and filtering)

Implemented: `GET /search` (items by barcode, code or name; serial numbers; invoices by number; customers by name or phone; permission-aware, branch-scoped, exact matches first), trigram indexes (migration 24), validated sorting added to eight lists that ignored `sortBy`, a conformance test over all 30 paginated lists, and a search box in the app header. See `docs/SEARCH_AND_LISTS.md`.

Decisions: the endpoint is open to any signed-in user and searches only the kinds they may view; LIKE wildcards typed by users are escaped; phone matching only when the text looks like a phone number; saved filters not built; results open the list page, not the record; no clickable column sorting in the list pages yet.

Tests (sandbox): 16 search integration tests, 99 list conformance tests, 3 contract tests, 6 web tests. Not verified in the sandbox: Playwright (`e2e/search.spec.ts`), `migrate deploy`, `db:drift`, Docker, CI.

## Stage 5, module 5.4 (Reports)

Implemented: 16 reports with date and branch filters, paging, sorting and totals; Excel and PDF export (dependency-free writers behind an interface) with an audit row per download; the Reports page. Also migration 25, which fixes a 5.1 bug: `v_daily_leads` dated leads 5 hours 30 minutes early (it read a UTC `timestamp` as India time). See `docs/REPORTS.md`.

Decisions: no new libraries for Excel or PDF (the stack lists none); each report needs its own module's view permission as well as `reports.view`; downloads need `reports.export`; a download is capped at 20,000 rows; PDF is Latin-only (`Rs.` for the rupee sign).

Changed existing files: `app.module.ts`, `contracts/index.ts`, web `routes.tsx` (adds `/reports`), `app-shell.test.tsx` (the placeholder test now uses `/settings`, so it will need changing again in 5.5), `migrations.int.test.ts`, `dashboards.int.test.ts` (boundary-date leads).

Tests (sandbox): 38 report integration tests, 15 exporter unit tests, 11 web tests, contract tests. Not verified in the sandbox: Playwright (`e2e/reports.spec.ts`), `migrate deploy`, `db:drift`, Docker, CI, Excel and Acrobat.

## Stage 5, module 5.5 (Settings and admin)

Implemented: migration 26 (`app_settings`), company details and two live approval limits (exchange and stock adjustment) that replace the env value and constant as the thing the services read, document number series (view and move forward), GST rate administration, an audit log viewer with filters and a user activity summary, and a Settings page with four tabs. See `docs/SETTINGS_AND_ADMIN.md`.

Not built: state-machine workflow configuration (needs a decision on what may be configurable). Branch settings stay in Branches.

Decisions: settings overlay defaults (env or built-in); numbers only move forward and never reuse skipped numbers; a GST percentage never changes and a rate in use cannot be switched off; `audit.view` is held by Staff in the existing presets (flagged); the Settings menu entry shows for `settings.manage` or `audit.view`.

Changed existing files: `app.module.ts`, `schema.prisma`, `contracts/index.ts`, `exchanges.service.ts` and `stock-adjustments.service.ts` (read limits from settings), web `routes.tsx`, `navigation.ts`, `app-layout.tsx`, `app-shell.test.tsx`, `migrations.int.test.ts`.

Tests (sandbox): 43 API integration, 10 contract, 14 web. Not verified in the sandbox: Playwright (`e2e/settings.spec.ts`), `migrate deploy`, `db:drift`, Docker, CI.

## Stage 6 (UI/UX completion): built and verified in the sandbox, awaiting approval

Specification: `docs/IMPLEMENTATION_PROMPT.md`, Stage 6. This section records only what was actually run.

**Baseline before any Stage 6 change (sandbox, this repository):** web 636 tests in 46 files passed; `pnpm lint` clean; web type check clean; `pnpm format:check` already flagged 3 files before this stage (`package.json`, `prisma.config.ts`, `prisma/seed/run-seed.ts`; `package.json` has Windows line endings).

**Done so far**

- Design tokens centralized in `apps/web/src/index.css`: semantic colours (including success, warning, info and destructive with subtle fills), sidebar tokens, a dark theme, standard and compact density, radii, shadows, motion durations, a focus ring, reduced-motion support. Old token names kept.
- Local preferences (favourites, recent screens, theme, density, sidebar state) in `lib/preferences.ts`, stored per user in the browser. The backend has no preferences table and none was added. Favourites are only paths and are filtered through the same permission check as the menu.
- Application shell: grouped sidebar with search, favourites and recent screens, collapsible with tooltips, mobile drawer, top bar with breadcrumbs, command palette (Ctrl/Cmd+K), user menu (account, theme, density, sign out), quick actions, skip link.
- Shared kit: `DataTable` (TanStack Table, server-side paging, sorting and filtering only), toolbar, pagination, column visibility, `StatusBadge`, `EmptyState`, `ErrorState`, `LoadingState`, `Skeleton`, `PageHeader`, `PageContainer`, `FormDialog`, `ConfirmDialog`, `UnsavedChangesDialog`, `DetailsDrawer`, `FormSection`, `FormActions`, `MoneyInput`, `BarcodeInput`, `DatePicker`, `DateRangePicker`, `SearchableCombobox`, `SearchableSelect`, `FileUpload`, toasts, `SectionTabs`/`SectionPanel`, URL-synced list state (`useListParams`).
- Screens moved to the shared kit: Branches, Users, Items, Customers, Sales (invoices list), Exchanges, Quotations, Transfers, Inventory, Purchasing (all five tabs), Payments, Leads, Brokers, HR (all five tabs), Batteries, Roles, Reports, Settings (all four sections), Notifications and the Credit notes tab. Added shared `SimpleTable` and `SectionTabs`. Tables inside dialogs moved to `SimpleTable`/`DataTable` (the quotation "Quoted lines" table is restyled in place; Reports keeps its own table because its columns and totals row are dynamic). Dashboard KPI cards and branch table moved to the shared parts. Transaction dialogs moved to `FormDialog` with sections: purchase order form, receive goods (live serial count), invoice form (unsaved-changes guard); also reschedule, payout, leave request, refund and new exchange. Purchase order detail rewritten on the design system. `features/inventory/list-state.tsx` deleted (no users left). Added shared `SimpleTable` (non-paged line tables) with tests. List requests are unchanged by default (the sort parameters are only sent after a column is clicked), so existing request-matching tests were not touched.
- `features/inventory/list-state.tsx` is deleted (no users left); every list uses `DataTable`, or `SimpleTable` for lines already on the page.

**Provenance note:** part of the shell and shared kit was already in the working tree when this session's audit finished and was not written in the visible turns. While rebuilding the foundation, ten of those files (`preferences.ts`, `button.tsx`, `input.tsx`, `card.tsx`, `dialog.tsx`, `tooltip.tsx`, `dropdown-menu.tsx`, `popover.tsx`, `sheet.tsx`, `select-field.tsx`) were overwritten and then rebuilt to the APIs their callers and tests expect; their original visual details may differ slightly.

**Dependencies added (all in the approved stack or named by the spec):** `@tanstack/react-table`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-tooltip`, `@radix-ui/react-popover`, dev: `axe-core`, root dev: `@axe-core/playwright`. `pnpm-lock.yaml` changed with them.

**Existing tests changed (assertions kept, reason: the spec moves account controls into a user dropdown):** `app-shell.test.tsx`, `auth-flows.test.tsx` and `branch-switcher.test.tsx` now open the account menu before clicking Sign out or checking Change password (helper `test/user-menu.ts`); `test/setup.ts` also resets preferences and clears toasts between tests. No test was deleted or skipped.

**Tests and checks actually run (sandbox; see "Sandbox notes" for how):**

- Web (Vitest, jsdom): baseline 636 tests in 46 files. **Final single full run after the last edits: 60 files, 775 tests passed.** New tests: preferences, section tabs, simple table, dialog primitive, shared feedback/header/toast/form components, menu search, design-token guard, and tests for each fix below. Lint clean; web and e2e type checks clean; Prettier clean except `prisma.config.ts` and `prisma/seed/run-seed.ts`, which were flagged before Stage 6.
- Contracts 308, permissions 14, API unit 234, API integration 1138 passed plus the notifications file 30 of 30 after fixing my own missing `pgboss` schema in the test database, worker 29. Packages, API, worker and web production builds pass.
- Browser (real Chromium 153, sandbox-only binary), **full e2e suite: 98 of 98 passed** on a freshly rebuilt database (14.6 minutes). That is the 55 existing workflow tests (updated where noted below), plus the new `ui-responsive` (11), `accessibility` (24: axe WCAG A/AA on nine screens and an open dialog in light and dark, Ctrl+K palette, skip link, focus return, focus indicators), `print` (2), shell (3) and `transactions` (3) specs. The accessibility and responsive specs were also run on a database holding some data (3 items, 2 customers, 3 branches, no invoices): 35 of 35. Seven existing workflow specs plus the shell were run at a 820 px touch viewport: 17 of 17. `transactions.spec.ts` buys, approves, receives, bills, issues and prints an invoice through the UI at 390, 820 and 1440 px, with every dialog's buttons on screen and no sideways scroll.

**Bugs found and fixed during Stage 6 (jsdom cannot see layout, so several were found only in the browser):**

- Audit log lost the server's own error message when moved to the shared table; restored (an existing test caught it).
- The rebuilt Dialog primitive added a default width that overrode the `max-w-*` class older dialogs set, which would have narrowed about 30 dialogs. Fixed in `components/ui/dialog.tsx` with tests.
- The old print rule printed a blank page from any screen except item labels. Print rules in `index.css` now hide the app shell and the invoice view prints as a document (verified: a list prints without menu or top bar and is never blank; the invoice print itself was not exercised because the test database has no invoice).
- `FormDialog` body did not scroll, so on a phone Cancel and Save were below the fold; fixed. The Items form had the same problem in its own layout; fixed.
- Two search boxes (sidebar "Search menu" and top bar "Find anything") set `aria-controls` to a results list that did not exist while closed (axe, critical); fixed with a unit test.
- Hidden "Actions" header text escaped the table scroll box and widened the whole page on a phone; table scroll boxes are now `relative` (unit test added).
- My dialog-conversion script dropped the "disabled until data loaded" condition on the new-exchange submit button; restored (caught by the existing e2e spec).

- My dialog-conversion script put `{transfer.toBranchCode}` into a plain string, so the transfer dispatch and receive explanations would have shown the literal braces; fixed and covered by new tests.

**E2E specs changed (intent of every assertion kept):**

- Because of the UI (user menu, new look-alike labels): `auth.spec.ts` opens the account menu; `Search`, `To`, `From`, `Unit`, `Branch`, `Report` and the `Stock` tab selectors made exact or role-based in batteries, billing, branches, customers, dashboards, inventory, items, reports and transfers specs.
- Already stale before Stage 6: `users.spec.ts` expected the Admin not to see Settings, but the Admin role holds `audit.view` (the menu rule is unchanged from the original); `branches.spec.ts` used a GSTIN with a wrong check digit, so the state-code message never appeared (now built with the contracts helper); `items.spec.ts` registered its print stub after the page loaded; `users.spec.ts` navigated before sign-in finished; `app-shell.spec.ts` expected Inventory to be a placeholder.
- `playwright.config.ts` accepts optional `PLAYWRIGHT_CHROMIUM_PATH` and `PLAYWRIGHT_CHROMIUM_ARGS`. The API in test mode needs `KYC_STORAGE_PATH`, which the config does not set; it was supplied through the environment here.

**Sandbox notes (how checks were run here):** Prisma's schema-engine binary cannot be downloaded, so `prisma generate` was run with a dummy `PRISMA_SCHEMA_ENGINE_BINARY`, the 26 migration SQL files were applied with `psql`, roles were provisioned with `pnpm db:provision`, and the API and worker suites were run with temporary vitest configs that skip the `prisma migrate deploy` global-setup step (removed afterwards). On a normal machine use `pnpm test` and `pnpm test:e2e` as usual. The worker unit test needs `WORKER_DATABASE_URL_TEST` when PostgreSQL is not on port 5432.

**Exit gate checklist (docs/IMPLEMENTATION_PROMPT.md, section 14), checked against evidence:**

| #   | Condition                                                    | Status and evidence                                                                                                                                                                                                                                                                                                                                                                                           |
| --- | ------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Coherent, modern design system                               | Met. Tokens, shared kit and every list and form screen; `docs/UI_DESIGN_SYSTEM.md`.                                                                                                                                                                                                                                                                                                                           |
| 2   | Design tokens centralized and consistently used              | Met. `index.css`; `design-tokens.test.ts` fails on raw palette classes or colour values (only the barcode SVG is exempt: it must be black on white for scanners). Dashboard charts were moved to tokens.                                                                                                                                                                                                      |
| 3   | Sidebar responsive, searchable, pinned favourites            | Met. Unit tests (shell, preferences, menu search); browser: drawer on a phone, collapse on desktop, Ctrl+K. Favourites are covered by unit tests, not driven in the browser.                                                                                                                                                                                                                                  |
| 4   | Top bar consistent navigation and account controls           | Met. Shell tests and e2e (account menu, breadcrumbs, branch switcher, notifications, search).                                                                                                                                                                                                                                                                                                                 |
| 5   | Forms and edits use shared components and suitable layouts   | **Partly met.** `FormDialog`, `ConfirmDialog`, `DetailsDrawer` and `DateRangePicker` are used. View-and-act dialogs stay on the plain dialog. Six form components (`MoneyInput`, `BarcodeInput`, `DatePicker` alone, `SearchableCombobox`, `SearchableSelect`, `FileUpload`) are built and tested but no screen uses them: screens keep their own pickers because tests and e2e flows depend on those labels. |
| 6   | Tables shared, with genuine server-side operations           | Met. `DataTable` for every server-paged list (paging, sorting, filters in the address); `SimpleTable` for lines on the page. Reports keeps its own table (dynamic columns and a totals row) with the shared header, states and pagination.                                                                                                                                                                    |
| 7   | Billing, receiving and lookup work on tablets and phones     | **Partly met.** The plain-quantity buy, receive, invoice, issue flow passes at phone, tablet and desktop sizes. Not covered: serial-numbered items, GST invoices, barcode scanning at phone width.                                                                                                                                                                                                            |
| 8   | Loading, empty, success and error feedback                   | Met. Shared `LoadingState`, `EmptyState`, `ErrorState` and toasts, unit tested; seen in browser on the screens the specs open.                                                                                                                                                                                                                                                                                |
| 9   | Keyboard, focus, labels, contrast, screen-reader names       | Met on the tested screens: axe WCAG A/AA in both themes, keyboard e2e (palette, skip link, focus return, focus indicators).                                                                                                                                                                                                                                                                                   |
| 10  | No unresolved serious or critical accessibility violations   | Met on nine screens and an open dialog in both themes, including with some data. Not scanned: screens that need invoices or serial units.                                                                                                                                                                                                                                                                     |
| 11  | Print styles for invoice and challan workflows               | **Partly met.** Lists and the issued invoice view were checked with the browser's print-media emulation (no menu or top bar, full width, buttons hidden, never blank). Not checked in a real print preview. There is no challan screen in the web app.                                                                                                                                                        |
| 12  | Component tests and responsive Playwright tests pass         | Met (775 web tests; 98 e2e).                                                                                                                                                                                                                                                                                                                                                                                  |
| 13  | All earlier tests continue to pass                           | Met: all 46 original web test files and every original test title (634 found by title, 636 run) are still there and pass (three files adapted, see above); contracts 308, permissions 14, API unit 234, API integration 1139 (one file re-run after a sandbox-setup fix), worker 29, e2e 98.                                                                                                                  |
| 14  | No logic, calculation, schema, permission or contract change | Met. `apps/api`, `apps/worker`, `prisma`, `packages/contracts` and `packages/permissions` sources are identical to the original (file-by-file comparison).                                                                                                                                                                                                                                                    |
| 15  | No placeholder buttons, fake data or unfinished interactions | Met by search and by the specs that exercise the screens. None known.                                                                                                                                                                                                                                                                                                                                         |

**Known limitations**

- Dialogs still on the plain dialog primitive: view-and-act dialogs (invoice, quotation, lead, broker, exchange, transfer, payment and order details, both ledgers, receipt view, KYC documents, categories, credit-note request and view, item labels, temporary password). They use the new tokens and widths, but their buttons sit at the bottom of a scrolling dialog, so on a phone they need a scroll. Form dialogs (role editor, record payment, battery install and details, transfer dispatch and receive, and the purchasing, billing, payments, leads, HR and exchange forms) use `FormDialog`; item, user and adjustment status confirmations use `ConfirmDialog`.
- Six shared form components exist but no screen uses them yet (see checklist item 5); adopting them means changing labelled controls that existing tests rely on.
- Finalizing payroll is irreversible but has no confirmation step; the spec says to preserve existing confirmation requirements, so none was added. Decide whether to add one.
- The main web bundle is about 1.17 MB (324 KB gzipped); left for Stage 8.
- `pnpm format:check` flagged `prisma.config.ts` and `prisma/seed/run-seed.ts` before Stage 6 and still may; they were not touched.

## Next

Reply `Approved` to close modules 4.7 to 4.13, or `Fix` with the failing output. After that, the Stage 4 exit gate: one cross-module journey (purchase and receive, transfer, bill, pay, check stock, outstanding and audit) shown working end to end.
