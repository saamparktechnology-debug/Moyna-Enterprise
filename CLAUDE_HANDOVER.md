# CLAUDE_HANDOVER.md

Handover for a fresh Claude conversation. Written 2026-11-05 from one long conversation that covered both the backend and the frontend.

## Read this first (instructions for Claude)

1. Before changing anything, read **this file**, then **`CLAUDE.md`** if one exists (none was in the project zip analysed in this conversation, so check the project root), then `PROGRESS.md` (source of truth for stage status) and `docs/IMPLEMENTATION_PROMPT.md` (the working rules and the 9-stage spec). The module notes in `docs/*.md` explain each feature.
2. This file records what was read and done in the earlier conversation. Where it says "not verified" or "unknown", do not assume. Open the code and check.
3. Do not invent behaviour. Do not add dependencies or new permissions without asking (PROGRESS says the owner's rules require asking about new dependencies first).
4. Work one change at a time. The owner's working method in this conversation: they list requirements, we do them **in small numbered chunks**, and each chunk is delivered as a **zip of only the changed and new files** (an overlay to unzip over the project root), not the whole project.
5. Report only: what changed, files and migration IDs, exact commands and tests actually run, pass or fail, blockers, decisions needed.

## What the project is

A multi-branch ERP for an Indian business (README ends with a stray line naming it "Moyna Enterprise") selling customized TOTOs (e-rickshaws), spare parts and batteries. GST invoicing, branch-wise stock, KYC, brokers and commission, quotations, exchanges, HR, dashboards and reports. Built stage by stage under approval gates.

## Stack and layout (pnpm monorepo, TypeScript strict, no `any` in non-test code)

| Path | Stack |
|---|---|
| `apps/api` | NestJS 12 modular monolith, Prisma 7 plus raw SQL, Zod (via `@erp/contracts`), Pino, OpenAPI at `/docs`. 25 feature modules in `src/features`, shared code in `src/common` |
| `apps/web` | React 19, Vite 8, React Router 8, TanStack Query and Table, React Hook Form plus Zod, Tailwind 4, Radix, Recharts. Feature folders in `src/features` mirror the API |
| `apps/worker` | pg-boss, outbox relay, daily reminder jobs (IST), notification consumer. Default notification provider only logs |
| `packages/contracts` | Zod schemas and types shared by API and web (the API contract). Web validates every response against them |
| `packages/permissions` | 74 permission codes, 3 role presets (Super Admin, Admin, Staff), tier rules |
| `prisma/` | `schema.prisma`, migrations (29 after chunk 5), seed, `seed/data.ts` |
| `e2e/` | Playwright specs. `scripts/` (db.mjs, check-schema-drift.mjs, demo/). `docs/` module notes |

Infra: Docker Compose (PostgreSQL 16 plus Adminer), CI workflow in `.github/workflows/ci.yml`.

Useful commands (root `package.json`): `pnpm dev`, `pnpm db:up`, `pnpm db:migrate`, `pnpm db:provision`, `pnpm db:seed`, `pnpm db:setup`, `pnpm db:generate`, `pnpm build:packages`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check`, `pnpm test`, `pnpm test:e2e`, `pnpm db:drift`, `pnpm demo:seed`. After changing contracts run `pnpm build:packages`; after changing `schema.prisma` run `prisma generate`.

Environment keys are listed in `.env.example` (NODE_ENV, API_PORT, WEB_ORIGIN, SESSION_SECRET, three database URLs, DATABASE_URL_TEST, seed super admin and branch values, KYC_STORAGE_PATH, STORAGE_DRIVER). **A real `.env` was inside the uploaded zip; its values differ from the example. Treat its secrets as exposed, rotate them, and never ship `.env`.**

## Backend architecture (verified by reading code)

- **Request path:** global guards in order: `AuthGuard` (server-side session cookie), `CsrfGuard` (origin check plus HMAC token tied to the session), `PermissionGuard` (deny by default). All 216 endpoints declare a rule via `@RequirePermission(...)`, `@Authenticated()` or `@Public()`. Exception: `POST /credit-notes/:id/reject` is only `@Authenticated`; the service decides.
- **Auth:** Argon2id, sessions stored as a SHA-256 hash of the token, 30 min idle and 12 h absolute timeout, lockout after 5 failures for 15 min plus an IP throttle (20 failures per 15 min, counted from `audit_log`), dummy hash for unknown users, sessions revoked on password change.
- **Branch isolation, twice:** a Prisma extension injects branch filters on 36 branch-scoped models using `AsyncLocalStorage` branch context, and every transaction sets `app.user_id`, `app.branch_ids`, `app.is_super` for PostgreSQL row-level security policies.
- **DB hardening (migration 2 onward):** three roles (owner for migrations, `erp_app` for the API, `erp_worker`); `audit_log`, `stock_ledger`, `outbox_events` are append-only for the app role; about 44 CHECK constraints; freeze triggers on issued invoices, decided credit notes and final payroll; `row_version` triggers for optimistic concurrency (requests carry `rowVersion`).
- **Stock:** only `StockPostingService` changes stock: one conditional `UPDATE ... WHERE quantity + delta >= 0` plus a ledger insert in one transaction; serial units are `FOR UPDATE` locked. Stock states include Available, Reserved, In transit, Quarantine, Returned and more; serial states include SOLD.
- **Money:** `Decimal` everywhere (`common/money/money.ts`). GST per line, total rounded to the rupee with round-off stored, odd paisa to SGST, IGST when place of supply differs from branch state. Credit notes and commission reductions use proportional allocation with the last unit taking the remainder.
- **Document numbers:** gap-free per branch, document type and financial year, taken with a row-locked update inside the business transaction. GST invoice and credit note numbers are at most 16 characters.
- **Services** parse the request body with the shared Zod schema themselves (no global validation pipe). Mappers turn rows into DTOs. Domain errors live in `common/errors/domain-errors.ts`. Business actions write audit rows via `AuditService` and outbox events in the same transaction.
- **Payments:** append-only, reversal is a new row, allocation auto (oldest due first) or manual, overpayment stays as customer credit, refunds have their own number series.
- **Roles:** Super Admin (everything), Admin (everything except branches, roles, settings, company dashboard), Staff (day-to-day). Tiers: you can only manage a strictly lower tier. Staff may discount up to 5%.

## Frontend architecture (verified by reading code)

- Typed API client validates responses against contract schemas. All routes are imported eagerly (main bundle about 1.17 MB, no code splitting). `/settings` route has no `RequirePermission` wrapper (page and API still enforce).
- Shared kit: `DataTable` (server-side paging, sorting, filters kept in the URL via `useListParams`), toolbar, `FormDialog`, `ConfirmDialog`, `StatusBadge`, `SimpleTable`, `FormField`, `Select`, toasts, `SectionTabs`. A test fails the build on hardcoded colours (design tokens). Command palette (Ctrl or Cmd+K), grouped sidebar, favourites and recents, theme and density saved in browser localStorage per user.
- Permissions on the client: `useAuth()` gives `user` (includes `isSuperAdmin`) and `can(permission)`; `<Can>` wraps content.
- Web test helpers: `@/test/fetch-mock` (`routeFetch`, `signedIn`, `makeSession`, `jsonResponse`) and `@/test/render-app`; each feature has a `test-data.ts`.

## Completed stages (per PROGRESS.md, author-reported)

| Stage | Status |
|---|---|
| 1 to 3 (foundation, database, auth, branches, users and roles) | Built and re-verified in the author's sandbox |
| 4 (13 core modules: items and barcodes, inventory and ledger, batteries, purchasing, transfers, customers and KYC, billing, payments and dues, leads, brokers and commission, quotations, exchanges, staff and HR) | All built. 4.7 to 4.12 approved pending the owner's local checks; exit-gate journey test exists (`journey.int.test.ts`) |
| 5 (dashboards, notifications, search, reports, settings) | Built. Workflow configuration (5.5 state-machine config) not built |
| 6 (UI/UX completion) | Built and verified in the sandbox, awaiting approval; two exit-gate items only partly met (see PROGRESS) |
| 7 (end-to-end journeys), 8 (security and performance), 9 (final verification) | **Not started** |

Counts reported in PROGRESS at its last update: web 775 tests, API integration about 913 and unit about 219, contracts 286 (our run of contracts in this conversation: 308), worker 24, permissions 14, 27 Playwright specs. Not every claim in PROGRESS was re-run.

Main feature areas and key entry points (all under `apps/api/src/features/<module>`, `apps/web/src/features/<module>`, `packages/contracts/src/<module>.ts`): items, stock, batteries, purchasing, transfers, customers (`kyc.service.ts`), billing (`billing.service.ts`, `invoice-calc.ts`, `billing.mapper.ts`), payments (`allocation.ts`, `balances.ts`), leads, brokers, quotations (largest service, about 1,040 lines), exchanges, hr, dashboards (SQL views), reports (PDF and Excel written without libraries), search, settings, notifications, audit, auth, roles.

Database: 68 models, 25 enums (before chunk 1). Chunk 1 added columns: `items.actual_purchase_price`, `items.display_purchase_price`, `invoice_lines.unit_cost_actual`, `invoice_lines.unit_cost_display`. Unused or incomplete: `Attachment` table has no service; `approvals.view` permission has no endpoint.

## Work done in this conversation: Chunk 1 (delivered as `erp-chunk1-overlay.zip`)

Owner requirements 1 and 2.

1. **Two purchase prices.** Super Admin sets an actual price and a "shown" price on an item. Only a Super Admin may set or see the actual price (server returns 403 to others who send one; the DTO returns `actualPurchasePrice: null` to everyone else). Cost is snapshotted on each invoice line when the invoice is issued (`unit_cost_actual`, `unit_cost_display`). Profit = taxable amount (after discount, before GST) minus qty times unit cost; Super Admin uses actual cost, everyone else uses the shown cost. Profit is shown only for ISSUED invoices, as `null` if any line lacks a cost. Shown in the Sales list (Profit column), invoice detail (Profit row, hidden when printing) and Items list (Purchase price column). The invoice PDF never carries profit. The audit log records the shown price and only "actualPurchasePriceSet" (never the actual value). A shown price requires an actual price (DB check plus contract rule).
2. **Documents.** New KYC document type `DECLARATION` ("Declaration form") via migration and seed. The KYC dialog "View" now previews the file inside the dialog (iframe for PDF, img for images) with "Open in new tab" and "Close preview", because opening a pop-up after an async download is often blocked. This was our interpretation of "Add document View option"; the owner has not confirmed it.

Files: migration `prisma/migrations/20261007002700_purchase_price_declaration/migration.sql`; API `billing/{billing.controller,billing.mapper,billing.service,profit}.ts`, `items/{items.controller,items.mapper,items.service}.ts`; contracts `billing.ts`, `items.ts`; web `items/{item-form-dialog,items-page}.tsx`, `billing/{invoices-page,invoice-detail-dialog}.tsx`, `customers/kyc-dialog.tsx`; `prisma/schema.prisma`, `prisma/seed/data.ts`; tests added or changed (`profit.test.ts`, `purchase-price.int.test.ts`, web `profit.test.tsx`, `purchase-price.test.tsx`, `kyc.test.tsx`, billing `test-data.ts`, `seed.int.test.ts` kyc types 8 to 9, `migrations.int.test.ts` migration list).

Verified in this conversation's sandbox: typecheck (API, web, contracts), ESLint and Prettier on changed files, contracts tests, profit unit test, and the focused web tests (items purchase-price, billing profit, KYC) passed; one full web run gave 783 of 788 passing. **Not run:** API integration tests (no PostgreSQL in that sandbox), the new migration on a real database, Playwright, Docker, CI. The owner has not yet reported applying the zip.

## Work done in this conversation: Chunk 2 (owner requirements 3 and 4: brokers and commission)

Owner decisions: the broker's cut is **not** set when the broker is created; it is decided **at billing time**, and a fixed amount or a gift is optional. A new invoice with a broker therefore starts as "No commission".

- **Broker details (migration `20261007002800_broker_details_negotiated_commission`):** `brokers.address`; new table `broker_files` (one `PHOTO` per broker via a partial unique index, any number of `DOCUMENT`s up to 20; JPEG or PNG for the photo, PDF, JPEG or PNG for documents, 5 MB; files kept through the existing storage service under `brokers/<id>/`; `erp_app` has DELETE on it). API: `POST/DELETE/GET /brokers/:id/photo`, `POST /brokers/:id/documents`, `DELETE /brokers/:id/documents/:fileId`, `GET /brokers/:id/documents/:fileId/file` (views of documents are audited). Web: address in the broker form; photo, documents with in-dialog View, add and remove in the broker dialog.
- **Commission agreed on the invoice:** draft invoices carry `commission: { type: NONE | FIXED | GIFT, amount?, giftName? }` (columns `invoices.commission_type/amount/gift_name/gift_photo_*`, frozen with the issued invoice by the existing guard). A GIFT photo is added to a **saved draft** from the invoice detail (`POST/DELETE/GET /invoices/:id/gift-photo`) and copied onto a reissued draft. On issue, `CommissionsService.accrue` writes a `commissions` row with `kind` `FIXED` or `GIFT` (`rule_id` is now optional; a gift keeps its name and photo), capped at the invoice's taxable value; `NONE` writes nothing. Where nothing was agreed (`commission_type` NULL, older drafts and quotation conversions) the broker's standing rule is still used if one exists. A gift is not stock: nothing is posted to the stock ledger for it. A gift commission is paid out like any other. `GET /commissions/:id/gift-photo` serves the photo. A broker no longer needs a rule to be put on an invoice or quotation.
- **Web:** commission section in the invoice form (type, amount or gift value, gift name); commission and gift photo in the invoice detail (hidden when printing); commission list shows Gift/Fixed/Rule and a "View gift photo" button; shared `components/file-preview.tsx` (`useBlobUrl`, `FilePreview`); `api.delete` added to the API client.
- **Tests:** new `broker-commission.int.test.ts` (API integration, **not run**: no PostgreSQL), web tests in `brokers.test.tsx` and new `invoice-commission.test.tsx`; updated the old "broker with no rule is refused" API test and three web broker tests; migration and table lists in `migrations.int.test.ts`.
- **Verified in the sandbox:** contracts, API and web type checks; ESLint on the changed folders (one error that already existed: unused `index` in `SerialSelect` of `invoice-form-dialog.tsx`); broker web tests 31 of 31, invoice commission web tests 13 of 13; one full web run 805 of 810 (the 5 failures are the known existing ones listed below).

## Work done in this conversation: Chunk 3 (owner requirements 5 and 6: sale filters and HSN)

No migration. Requirement 5: the Sales (invoice) list can be filtered by **group**, **product category** and **broker** (`GET /invoices?groupId=&categoryId=&brokerId=`, validated as ids; combinable with the existing filters). Interpretation (not confirmed by the owner): a *group* is a top-level item category and matches invoices that sold anything from it or from a category under it; a *product category* is the item's own category. The page shows the selects only when the person may view items (`items.view`) or brokers (`brokers.view`), narrows the category list to the chosen group, and shows a chip for each filter.

Requirement 6 ("HSN is not working") was vague, so the code was checked and these defects were fixed (the owner has not confirmed which symptom they saw): (1) only 7 four-digit HSN codes were stored and any other code was refused with "Choose an HSN code from the list", so a real 8-digit code could not be entered — now any 4 to 8 digit code is accepted and is added to the list when the item is saved (with the item's GST rate if it has one; a switched-off code is still refused); (2) editing an item to a new HSN did not bring its GST rate — now it does, only for an item with no rate that was not given one; (3) the HSN was not visible in the app — the Items list has an HSN column and the invoice detail shows the HSN of each line on a GST invoice. Not changed: GST invoices are still allowed for items without an HSN code (enforcing it would break existing flows; ask the owner).

Tests added: `hsn-and-sales-filters.int.test.ts` (API integration, **not run**: no PostgreSQL), web `sales-filters.test.tsx` and `hsn.test.tsx`; the old "unknown HSN is refused" API test now uses a switched-off code. Verified in the sandbox: type checks, ESLint and Prettier on the changed files, focused web tests (billing, items, brokers: 154 of 157 pass, the 3 failures are the known existing `invoice-broker` ones).

## Work done in this conversation: Chunk 4 (owner requirements 7 and 8: barcode print and follow-ups card)

No migration. Requirement 7 (barcode print): labels already existed (tick items, "Print labels", Prepare, Print) but were hard to find and could print a stale run. Now: every item row that has a barcode has a **Print label** button (also for read-only staff); it opens the label dialog and prepares one label at once; **Print** prepares and prints in one click when needed (it prints only after the prepared labels are on the page); changing the number of copies clears labels prepared for another number; a refused preparation prints nothing and shows the reason. The server label endpoint and the 50 x 25 mm label are unchanged. Not verified: a real printer, a label printer's page size, or the browser print preview (jsdom tests spy on `window.print`). The owner's exact complaint about barcode print was not given, so this is an interpretation.

Requirement 8 (follow-up count for today): the branch dashboard already had "Follow-ups overdue" and "Follow-ups today", but "today" counted only follow-ups whose time had not come yet (earlier ones today were counted as overdue), and the company dashboard (what a Super Admin sees by default) had no follow-up figure at all. Added `followups.dueToday` (open follow-ups due any time today, India time) to the branch dashboard and to the company dashboard (summed from `followupsDueToday` on each branch row). The branch card is now "Follow-ups due today" with "N still to come · M later" as its hint; the company dashboard has a new "Follow-ups due today" card. The overdue figure and the chart are unchanged.

Tests: new web `items/label-print.test.tsx` and a dashboard test; updated `dashboards.int.test.ts` (API integration, **not run**: no PostgreSQL) and fixtures in `dashboard.test.tsx`; new API unit test for `todayStartInIndia`. Verified in the sandbox: type checks, ESLint and Prettier on the changed files (the dashboard folder has 4 ESLint errors that already existed: unused `salesTotal`, unused `s`, a reassigned variable in `dashboard-charts.tsx`), focused web tests (items, dashboard) and the dashboard API unit tests.

## Work done in this conversation: Chunk 5 (owner requirement 9: lead Age; requirement 10 not started)

Migration `20261007002900_lead_age`: `leads.age` (smallint, optional, CHECK 1 to 120). Contract `LeadAgeSchema` (whole number 1 to 120); `age` on create, update (null clears) and in the lead summary and detail; the audit snapshot includes it. Web: an optional "Age" field in the lead form (checked before sending, in years) and an "Age" line in the lead detail ("—" when unknown). Not added: an Age column in the leads list, search by age, or carrying the age to the customer on conversion (customers have no age field).

Requirement 10 ("Invoice issue: Advance payment -> Quotation -> No invoice issued") has **not been changed**. The code already works this way: an advance is taken against an accepted quotation (`POST /quotations/:id/advance`) and no invoice is issued until delivery, when the advances are applied to the invoice. The owner has not said what is wrong with that flow. Question asked: is it (a) a way to take an advance without first creating, sending and accepting a quotation, (b) the Payments screens not showing which quotation an advance belongs to (known gap in docs/QUOTATIONS.md), or (c) something else.

Tests: web `leads.test.tsx` (6 new cases) and API `leads.int.test.ts` (1 new case, **not run**: no PostgreSQL); the migration list in `migrations.int.test.ts` updated. Verified in the sandbox: type checks, ESLint and Prettier on the changed files and the leads web tests (40 of 40).

## Work done in this conversation: Chunk 6 (owner requirement 10: advance receipt)

No migration. The owner's complaint: when an advance is taken on a quotation, no document is issued to the customer. Every payment already had a receipt number (`payments.receipt_no`, series `PAYMENT_RECEIPT`, prefix `RCT`) but there was no printable paper. Added `GET /payments/:id/receipt` (permission `payments.view`): an A4 PDF built with the existing `pdf-kit`. For an advance on a quotation it is titled **ADVANCE RECEIPT** and shows the quotation number, the quoted total, the advances still held and the balance still to pay; any other payment is a **PAYMENT RECEIPT**; a reversed payment says "REVERSED on <date> - this receipt is no longer valid". Both say it is a receipt for money received and **not a tax invoice**: a tax invoice is still issued on delivery and the advance is adjusted against it. This was chosen on purpose and not as the owner's literal "advance payment invoice": under GST an advance for goods is not a taxable supply needing a tax invoice, and an invoice number in the invoice series would break the gap-free numbering and the rule that an invoice exists only on delivery. The owner has not confirmed this reading. Web: the quotation's advance table has a **View receipt** button per advance (for people who may view payments); taking an advance opens its receipt at once (best effort: a failure to fetch it never blocks the advance); the payment detail has **View receipt**. The receipt is shown in-page (`FilePreview`, with "Open in new tab" for printing). New shared hook `useFilePreview` in `components/file-preview.tsx`.

Tests: API unit `payments/receipt-pdf.test.ts` (4 pass), API integration cases in `quotations.int.test.ts` (**not run**: no PostgreSQL), web tests in `quotations.test.tsx` and `payments.test.tsx`. Verified in the sandbox: type checks, ESLint and Prettier on the changed files, and the quotation and payment web tests (61 of 61).

## Planned: Manufacturing / assembly section (added by the owner, not started)

The owner's words: this is an e-rickshaw (TOTO) shop; the owner buys spare parts individually and makes a **new product** from them to sell, so there must be a section to **manufacture by selecting existing stock** "with all its ..." (the sentence was cut off; ask what follows). Nothing is built. Proposed design for the owner to confirm (not decided): a *production order* (branch, date, finished item, quantity, the parts taken from available stock with their quantities, optional extra costs such as labour) that, in one transaction through `StockPostingService`, takes the parts out of Available stock and puts the finished item in; the finished item's cost is the parts cost plus extras; a finished vehicle gets a serial unit (chassis and motor numbers, as in quotations); a reusable recipe (bill of materials) per finished item; reversal by a new document; document numbers from the document-number service; audit and permissions as elsewhere. Open questions for the owner: what "with all its" continues with; whether to keep reusable recipes; whether extra costs and labour are needed; whether the finished item is an existing item or a new one made on the spot; who may manufacture; whether disassembling is needed.

## Unresolved issues and risks

Known failing web tests that also fail on the untouched project: `billing/invoice-broker.test.tsx` (3 tests, "Matching items" label) and `transfers/transfers-page.test.tsx` (2 tests). Also an existing ESLint error: unused `index` in `SerialSelect` (`billing/invoice-form-dialog.tsx`). Running `prettier --write` on a whole folder converts files to LF line endings; run it only on the files you changed, and keep CRLF.

Chunk 1 decisions still open:
- Purchase order lines still show unit cost to Admins, and the stock-value dashboard uses those costs, so the real price still leaks there.
- Credit notes do not reduce profit. Old invoices show no profit (no cost was recorded).

Findings from the code review (not fixed):
- `.env` shipped in the zip (see above).
- Zod request schemas are not strict (about 220 `z.object`, 11 `.strict()`): unknown fields are stripped, not rejected, although Stage 8 requires rejection.
- No security headers (no helmet) and no general rate limiting; only login throttling. CSRF/CORS uses a single `WEB_ORIGIN`.
- KYC files are stored on local disk and not encrypted at rest (spec asked for encrypted, S3-compatible storage).
- `bootstrap.ts` registers the raw body parser twice.
- No route-level code splitting.
- Documentation drift: PROGRESS statements about who holds `audit.view` conflict with each other; stage table partly stale; `docs/DATABASE.md` not regenerated; README ends with a stray UTF-16 fragment.
- `apps/api/dist` in the zip is older than the source.
- Never verified by the original author: `prisma migrate deploy`, `pnpm db:drift`, Docker Compose, CI; Playwright ran only in a sandbox; GST invoices, serial-numbered TOTOs and barcode scanning at phone width untested in a real browser.
- Functionally incomplete per PROGRESS: workflow configuration (5.5), real email/SMS/WhatsApp provider (users have no phone field for SMS), payroll finalization confirmation, broker clawback refund, quotation PDF, challan screen.

## Pending tasks: owner's requirement list (transcribed from their notes)

Done: items 1 and 2 (chunk 1), 3 and 4 (chunk 2), 5 and 6 (chunk 3), 7 and 8 (chunk 4), 9 (chunk 5) and 10 (chunk 6). **Next, in order, as the owner chooses (start at 11):**

3. (done in chunk 2) Broker: entry with document, address and photo.
4. (done in chunk 2) Commission: agreed at selling time as a fixed price or a gift (name, amount, photo); no stock for gifts.
5. (done in chunk 3) Sale history filters: product category, group, broker.
6. (done in chunk 3, symptom unconfirmed) HSN is not working: see the chunk 3 notes above.
7. (done in chunk 4, interpretation) Barcode print option.
8. (done in chunk 4) Dashboard: add a card for today's follow-up count.
9. (done in chunk 5) Lead form: add an Age field.
10. (done in chunk 6, interpretation) Advance payment from a quotation: a printable advance receipt; no invoice is issued until delivery.
11. Invoice due: add a next promised date; for due, add guarantor contact details with optional KYC.
12. Mail feature not working (worker notification provider only logs by default).
13. HR section has "full problem": the owner will give the details; wait for them.
14. NEW: Manufacturing / assembly section (build a new product from existing stock); see "Planned" above.

After the requirement list, the project plan still has Stages 7, 8 and 9 and approval of Stage 6.

## Conventions and technical decisions to follow

- Follow existing patterns: contract schema in `packages/contracts`, service parses with it, mapper builds the DTO, controller declares a permission, audit and outbox written in the same transaction, stock only through `StockPostingService`, money only as `Decimal`, document numbers via the document number service.
- Schema change = new numbered migration folder under `prisma/migrations` plus matching `schema.prisma` change (a conformance test compares them) plus update of pinned lists in `migrations.int.test.ts` and any seed count in `seed.int.test.ts`. Add new columns nullable or with defaults.
- Hide data by viewer in the mapper or service (as done for the actual purchase price); do not rely on the UI. Keep sensitive values out of the audit log.
- Tests: Vitest for API, web, contracts; API integration tests need PostgreSQL and use `createAuthWorld` and `loggedIn` helpers in `apps/api/test/support`. Prettier and ESLint (`--max-warnings 0`) are enforced.
- Existing files use Windows (CRLF) line endings; preserve them when editing. Paths in some file headers use backslashes.
- Decisions recorded by the original author: commission on taxable value before GST; a credit note takes back its share of commission; exchange approval by a different manager; KYC files kept on disk by default (`STORAGE_DRIVER`, `KYC_STORAGE_PATH`); permission and role presets from Stage 1 are not to be changed casually.
- Sandbox notes from this conversation: `pnpm install --frozen-lockfile --ignore-scripts` works; `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true pnpm exec prisma generate` works; no PostgreSQL was available, so API integration tests could not run there.
