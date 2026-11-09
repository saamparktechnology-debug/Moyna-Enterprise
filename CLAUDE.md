# CLAUDE.md

Permanent instructions for Claude on this project. They apply to every conversation, backend and frontend. Project progress, history, open issues and the pending requirement list live in `CLAUDE_HANDOVER.md`; this file does not repeat them.

## 0. Before you change anything

1. Read `CLAUDE_HANDOVER.md` (current state), this file (rules), `PROGRESS.md` (stage status) and the relevant `docs/<MODULE>.md`. The full owner rules and stage specs are in `docs/IMPLEMENTATION_PROMPT.md`; if anything here conflicts with it, stop and ask.
2. Look at the code before writing. Find the existing module, helper, component or test that already does something similar and follow it.
3. Do not invent facts about the project. If something is not in the code or docs, say it is unknown and check, or ask.
4. Change only what the current request needs. Do not rewrite working code. Name every existing file you modify and why.
5. Ask before adding a dependency, adding or changing a permission code or role preset, or changing an applied migration (never edit an applied migration; add a new one).

## 1. What this system is

A multi-branch ERP for an Indian business selling customized TOTOs (e-rickshaws), spare parts and batteries: GST invoicing, branch-wise stock, KYC, brokers and commission, quotations, exchanges, HR, dashboards and reports. It is a pnpm monorepo in TypeScript (strict): `apps/api` (NestJS, Prisma 7 plus raw SQL, PostgreSQL 16), `apps/web` (React 19, Vite, TanStack Query and Table, React Hook Form, Tailwind 4, Radix), `apps/worker` (pg-boss), `packages/contracts` (shared Zod schemas), `packages/permissions`, `prisma/`, `e2e/` (Playwright), `docs/`.

## 2. Architecture rules (do not break)

- **Contracts are the API.** Every request and response is a Zod schema in `packages/contracts/src`, imported by both API and web. Never hand-write a matching type on one side only. After editing contracts run `pnpm build:packages`.
- **API layering:** controller declares the permission and passes `@CurrentAuth()`; service parses the body with the shared schema and runs the business action in a transaction; mapper builds the DTO. No business logic in controllers or mappers beyond presentation.
- **Every endpoint declares a rule** (`@RequirePermission`, `@Authenticated`, or `@Public`). Deny by default. Prefer an existing permission; do not add new ones without asking.
- **Branch isolation is double-enforced** (Prisma branch-scope extension plus PostgreSQL row-level security). Use the scoped Prisma service and transaction service; never bypass them, never use the owner connection in application code, and never trust a client-supplied branch id, user id or price.
- **Stock is a ledger.** Change stock only through `StockPostingService` (conditional update plus ledger insert in one transaction, serial units row-locked). Never update stock balances or serial states directly. Ledger rows, payments and audit rows are append-only: reverse with a new row.
- **Money is `Decimal`** (`common/money/money.ts`). Never use JavaScript floating-point numbers for amounts. Amounts cross the API as strings with two decimals. GST is per line, totals rounded to the rupee with the round-off stored; proportional splits give the last unit the exact remainder.
- **Documents:** issued invoices are never edited (cancel and reissue, or a credit note). Document numbers are gap-free and taken only via the document-number service inside the business transaction. GST invoice and credit note numbers must stay within 16 characters.
- **Concurrency:** editable records carry `rowVersion`; updates must send the version that was read and return a conflict when it is stale. Use row locks for stock and numbering.
- **Events:** side effects (notifications, reminders) go through the outbox written in the same transaction; the worker relays them. Do not call external services from inside a request transaction.
- **Database changes** are numbered migrations under `prisma/migrations` plus the matching `schema.prisma` change (a conformance test compares them). Add columns nullable or with defaults. Update the pinned migration list in `apps/api/test/integration/migrations.int.test.ts` and any pinned seed counts in `seed.int.test.ts`. Add database CHECK constraints or triggers for rules that must never be violated, not only application checks. Reference data added to existing databases needs a migration as well as the seed.
- **Frontend structure:** one folder per feature under `apps/web/src/features`, mirroring the API module (page, dialogs, `*-api.ts`, `use-*.ts` hooks, `test-data.ts`). Reuse the shared kit (`DataTable`, `FormDialog`, `ConfirmDialog`, `StatusBadge`, `FormField`, `Select`, toasts). Server state in TanStack Query; list state (page, sort, filters, search) in the URL via `useListParams`.

## 3. Coding standards

- TypeScript strict. No `any`, no `@ts-ignore`, no commented-out code, no unused exports, no placeholder or TODO logic in delivered code.
- Follow existing names, file layout and patterns. Prefer small functions and components. Comments explain why, not what.
- Validate every input on the server even if the form already validates it. Use the domain error classes in `common/errors/domain-errors.ts`; error responses carry a code, message and field-level details. Show server messages next to the field in the UI.
- Handle edge cases explicitly: empty data, duplicates, concurrent edits, large lists (always paginate on the server), invalid state transitions, missing permissions, null or missing optional values.
- UI text is plain, short and kind to non-technical staff. Use design tokens, never hardcoded colours (a test enforces this). Forms and dialogs must work on a phone.
- Formatting and lint are enforced: Prettier and ESLint with `--max-warnings 0`. Existing files use Windows (CRLF) line endings; preserve them when editing. Keep import style and `.js` suffixes in API imports as the surrounding files do.

## 4. Security requirements

- Never expose a value to a viewer who must not see it by hiding it in the UI. Decide in the API mapper or service per viewer (example in this codebase: the real purchase price is returned only to a Super Admin). Check for the same value in lists, details, PDFs, exports, reports, dashboards, search and audit rows before calling it hidden.
- Never write passwords, tokens, session ids, full KYC or ID numbers, or other secrets to logs, audit values or error messages. Audit snapshots may hold only what every audit reader may see.
- Use parameterized queries only (Prisma or `$queryRaw` tagged templates). No string-built SQL. Escape output; never render raw HTML from data.
- Authentication, CSRF, session and lockout code is security-critical: do not weaken it, and do not skip guards in tests or code.
- KYC files and secrets stay out of the repository. Never commit `.env`. Treat any `.env` found in a shared archive as exposed.
- Refuse, do not silently ignore, a forbidden field sent by a client (return 403 or a validation error).
- Every important change writes an audit row. Reversals and overrides (expired battery sale, delivery before full payment, exchange approval) require a reason and are audited.
- Approvals follow the rule already in the code: nobody approves their own request except a Super Admin.

## 5. Testing conventions

- Every change ships with tests: API unit tests, API integration tests against a real PostgreSQL test database, web component and interaction tests, and Playwright for main workflows. Cover success, validation errors, permission denial for each role (Super Admin, Admin, Staff), branch isolation and the edge cases of the change.
- Never delete or weaken an existing test to make it pass. If behaviour changes on purpose, update the test and say so.
- Tools: Vitest everywhere; web tests use `routeFetch`, `signedIn`, `makeSession` from `@/test/fetch-mock` and `renderApp`; API integration tests use `createAuthWorld`, `loggedIn` and `createTestApp` from `apps/api/test/support`. Keep test data helpers in the feature's `test-data.ts`.
- Run focused tests while developing (the single file or feature). Run the full suite once at a milestone gate, not repeatedly without a reason.
- Before declaring a change done run, and report honestly: `pnpm build:packages`, type checks for the packages you touched (API, web, contracts), ESLint and `prettier --check` on changed files, and the focused tests. State clearly what you could not run (for example API integration tests when no PostgreSQL is available).
- A change is not complete until its tests pass and earlier tests still pass. Report pre-existing failures separately, after checking them against the untouched code.

## 6. How to work and report

- Plan briefly, then implement in small phases. One module or one numbered requirement at a time.
- When the owner works through a requirement list, deliver each chunk as a **zip containing only the changed and new files**, with paths relative to the project root, plus the apply commands (migrate, `prisma generate`, `pnpm build:packages`).
- Completion reports contain only: what changed; files and migration IDs; exact commands and tests actually run; pass or fail; blockers; decisions needed. Never claim something was verified that was not run.
- If a request is ambiguous, state the interpretation you chose and why, make the safest reading, and flag it. Do not stall on questions you can answer from the code.
- When you find a bug or risk outside the current request, report it; do not fix it silently inside an unrelated change.
- Keep `PROGRESS.md` and the relevant `docs/<MODULE>.md` accurate when a module's behaviour changes, and update `CLAUDE_HANDOVER.md` when asked at the end of a session.

## 7. Environment notes for working in a sandbox

- `pnpm install --frozen-lockfile --ignore-scripts` works; generate the Prisma client with `PRISMA_SCHEMA_ENGINE_BINARY=/bin/true pnpm exec prisma generate`.
- A sandbox may have no PostgreSQL, Docker or browser: say so, and do not claim integration or end-to-end results you did not produce.
- Local setup commands, environment keys and the full script list are in `package.json`, `.env.example` and `CLAUDE_HANDOVER.md`.
