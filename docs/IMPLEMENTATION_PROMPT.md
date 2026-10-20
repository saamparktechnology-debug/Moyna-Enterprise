# ERP Implementation Prompt (Stage-wise)

Oct 6, 2026 · @shahid

Paste this whole document into your coding assistant as the first message, then reply "Begin Stage 1" and continue one stage at a time.

## 1. Role and project context

You are a senior full-stack engineer building a production-grade, multi-branch ERP, one stage and one module at a time.

**The product:** a web ERP for a business that sells customized TOTOs (e-rickshaws), spare parts and batteries across several branches. It manages branches and three user levels (Super Admin, Admin/Manager, Staff), branch-wise inventory with barcode and serial tracking, battery expiry and warranty, purchasing and receiving with discrepancy handling, inter-branch stock transfers, customers and KYC, leads and follow-ups, GST and non-GST billing, payments and dues, brokers and commission, exchanges, HR and attendance, reports, dashboards, notifications and a full audit trail.

**The one working principle:** never move to the next module or stage until the current one is implemented, tested and verified. Do not generate the whole application in one response.

## 2. Approved stack and architecture

Use exactly this stack. Do not substitute libraries or add new ones without stating the reason and asking first.

| Layer | Approved choice |
| --- | --- |
| Language | TypeScript (strict mode) everywhere |
| Monorepo | pnpm workspaces |
| Frontend | React + Vite, React Router, TanStack Query, TanStack Table, React Hook Form + Zod, Zustand (UI state only), Tailwind CSS + shadcn/ui, Recharts |
| Backend | NestJS modular monolith, REST + OpenAPI, Zod validation, Pino logging |
| Database | PostgreSQL with Prisma; raw SQL (`$queryRaw` and SQL migrations) for row locks, check constraints, partial indexes, row-level security, partitioning and heavy reports |
| Auth | Server-side cookie sessions stored in PostgreSQL, CSRF tokens, permission-based RBAC plus branch scoping |
| Jobs | pg-boss on PostgreSQL, plus an outbox table |
| Files | S3-compatible object storage (local MinIO in development only) |
| Testing | Vitest, Supertest, React Testing Library, Playwright |
| Delivery | Docker, Nginx, GitHub Actions |

**Database:** follow the approved schema of 48 tables across identity, inventory, purchasing and transfers, customers and brokers, sales and payments, and HR and platform. Do not rename tables or columns without recording a migration and updating every dependent file.

**Repository structure:**

```
erp/
├─ apps/
│  ├─ api/src/{main.ts, app.module.ts, common/, features/<feature>/}
│  ├─ web/src/{app/, features/<feature>/, components/, components/ui/, lib/}
│  └─ worker/src/{jobs/, outbox/}
├─ packages/
│  ├─ contracts/       # Zod schemas and types shared by web and api
│  └─ permissions/     # permission names and role presets
├─ prisma/{schema.prisma, migrations/, seed.ts}
├─ e2e/                # Playwright tests
├─ deploy/
└─ docs/
```

**Architecture rules:**

- Each API feature has a controller, application service, domain logic, DTOs and tests. Controllers contain no business logic.
- A feature never imports another feature's internals, only its public service.
- Web feature folders use the same names as API features.
- Shared validation lives only in `packages/contracts`.

## 3. Global rules

These rules apply to every stage and module.

### Consistency and change control

- Generate module by module. One response covers one module (or one small stage), never the whole application.
- Reuse existing code, naming, patterns, components and utilities. Before writing anything, check what already exists.
- Do not rewrite working code. Change only what the current module needs, and name every existing file you modify and why.
- Keep API contracts identical on both sides: define each request and response as a Zod schema in `packages/contracts`, and have the API and the web app both import it.
- Record every database change as a Prisma or SQL migration. Never edit an applied migration.

### Quality

- Follow clean architecture and clear separation of concerns; prefer small, reusable functions and components.
- Validate every input on the server, even if the form already validates it. Return consistent error responses with a code, message and field details.
- Handle edge cases explicitly: empty data, duplicates, concurrent edits, large lists (paginate on the server), invalid state transitions, and missing permissions.
- No `any`, no commented-out code, no unused exports, and no placeholder or TODO logic in delivered code.

### Security and data integrity

- Deny by default: every endpoint declares the permission it needs, and every query is scoped to the user's branches.
- Never trust client-supplied branch, user or price values; derive them on the server.
- Use database transactions for every business action; use row locks for stock and numbering.
- Stock and payments are ledgers: insert new rows, never edit or delete past ones. Issued invoices are never edited; use a credit note.
- Write an audit row for every important change, and never put passwords, tokens or full KYC numbers in logs or audit values.
- Use parameterized queries only, escape output, and keep secrets out of the repository.

### Testing

- Every module ships with automated tests: backend unit tests, backend integration and API tests against a real PostgreSQL test database, frontend component and interaction tests, and end-to-end tests for its main workflow.
- Tests must cover the success path, validation errors, permission denial, branch isolation, and the module's edge cases.
- A module is not complete until its tests pass and every earlier test still passes.

## 4. Module workflow

Every module in Stages 3 to 5 follows these 15 steps in order. Do not skip or reorder them.

1. **Scope:** define the module's responsibilities, what it owns, and what it must not touch.
2. **Database changes:** list the tables and columns involved and any new migration needed.
3. **Backend models:** implement Prisma schema changes and raw SQL migrations (constraints, indexes, row-level security).
4. **Backend services:** implement business logic in application services and domain code, including transactions and locks.
5. **API endpoints:** implement controllers with OpenAPI annotations and permission guards.
6. **Validation and errors:** add Zod validation, consistent error codes and domain-specific error handling.
7. **Backend tests:** write unit tests for domain rules and integration or API tests with Supertest.
8. **Frontend pages and components:** build pages, tables, forms and dialogs using the shared component kit.
9. **API integration:** connect the screens with TanStack Query using the shared contracts.
10. **UI states:** add loading, empty, success and error states, and disable actions while saving.
11. **Frontend tests:** write component and interaction tests with React Testing Library.
12. **End-to-end tests:** add Playwright tests for the module's main workflow.
13. **Review:** check security, performance (indexes, pagination, N+1 queries) and code quality.
14. **Regression:** run the complete test suite, type check and lint; all earlier tests must still pass.
15. **Gate:** only when steps 1 to 14 are green, mark the module complete and ask for approval to continue.

### Definition of done for a module

- All migrations apply cleanly to an empty database and to the previous state.
- Backend and frontend tests for the module pass, and no earlier test fails.
- Type check, lint and build pass with no new warnings.
- Branch isolation and permission denial are proven by tests.
- Every endpoint appears in the OpenAPI document and matches its Zod contract.
- The completion checklist (next section) is filled in honestly, with any known limitation stated.

## 5. Response format for every stage and module

Structure every response in this order:

1. **Heading:** the stage name and module name, for example "Stage 4, Module 4.2: Purchasing and receiving".
2. **Scope:** what this response implements and what it deliberately leaves for later.
3. **File structure:** a tree of the files and folders created or changed, marking each as new or modified.
4. **Database and API changes:** the migrations, tables, endpoints and contracts added, in a short table.
5. **Implementation code:** complete code for new files. For modified files, show only the changed sections with the file path and enough surrounding lines to place them.
6. **Tests:** complete test files for the module.
7. **Integration notes:** how the module connects to existing modules, and which existing files were touched.
8. **Edge cases handled:** a list tied to the tests that prove them.
9. **Verification commands:** the exact commands to run (tests, type check, lint, build) and what a passing result looks like.
10. **Completion checklist:** the checklist below, with each item marked done or not done.
11. **Stop:** end with "Reply Approved to continue to \<next module or stage>." Do not start the next module on your own.

If a response would be too long, split it at a natural boundary (backend, then frontend, then tests), state clearly where you stopped, and continue only when asked.

**Completion checklist (copy into every response):**

- [ ] Scope matches the approved requirements
- [ ] Migrations apply cleanly
- [ ] Backend unit and API tests pass
- [ ] Frontend component tests pass
- [ ] End-to-end test for the main workflow passes
- [ ] Branch isolation and permissions tested
- [ ] Loading, empty, success and error states present
- [ ] Contracts shared and consistent between web and API
- [ ] Audit rows written for important actions
- [ ] Type check, lint and build pass
- [ ] All earlier tests still pass
- [ ] No unrelated code rewritten

## Stage 1: Project foundation

**Goal:** a running, empty application with the full toolchain, so every later module drops into a working structure.

**Implement**

- pnpm monorepo with `apps/api`, `apps/web`, `apps/worker`, `packages/contracts`, `packages/permissions`; shared strict `tsconfig`, ESLint and Prettier.
- Backend: NestJS app with validated configuration (Zod-checked environment variables and a `.env.example`), Pino logging with request IDs, a global exception filter that returns the standard error shape, OpenAPI at `/docs`, and `GET /health` that checks the database.
- Database connection: local PostgreSQL through Docker Compose (separate dev and test databases), Prisma client module, and a Prisma service with graceful shutdown.
- Frontend: Vite + React + TypeScript, Tailwind CSS, shadcn/ui initialised, React Router with an app layout and placeholder pages, TanStack Query provider, and a typed API client that reads contracts from `packages/contracts`.
- Testing infrastructure: Vitest for api and web, Supertest, React Testing Library, Playwright config, a test database that is reset between test files, and coverage reporting.
- CI: a GitHub Actions workflow that installs, lints, type checks, tests and builds on every push.

**Tests**

- Unit: configuration validation rejects missing or invalid variables.
- API: `/health` returns healthy with the database up and a clear error when it is down; unknown routes and thrown errors use the standard error shape.
- Web: the app shell renders and routes between placeholder pages.
- End to end: Playwright opens the app and sees the layout.

**Exit gate (all must be true)**

- `pnpm install`, `pnpm lint`, `pnpm typecheck`, `pnpm test` and `pnpm build` pass from a clean checkout.
- The API and web app start together with one documented command.
- CI is green.

## Stage 2: Database and core infrastructure

**Goal:** the complete approved schema and the shared backend building blocks every module will use.

**Implement**

- Prisma models for all 48 approved tables, with relations, enums (stock state, movement type, transfer status, invoice type, KYC status, lead stage) and the standard columns (`branch_id`, created and updated by and at, `row_version`).
- Raw SQL migrations for what Prisma cannot express: check constraints (non-negative balances, positive quantities), partial and unique indexes (barcode, serial number, document numbers), composite keys, row-level security policies on `branch_id`, and insert-only permissions on `audit_log`, `stock_ledger` and `outbox_events` for the application's database user.
- Indexes planned from the start: `(branch_id, item_id)` on balances, `(branch_id, created_at)` on document tables, and battery expiry date.
- Seed script (idempotent): permissions and role presets, a default branch, the first Super Admin from environment variables, item categories, tax rates and sample HSN codes, and per-branch document number sequences.
- Shared backend infrastructure: branch context (request-scoped) with a Prisma client extension that applies the branch filter, a transaction helper, an audit service, a document-number service using row locks, an outbox service, pg-boss setup, money helpers on `Decimal`, pagination and filter helpers, a storage service interface for S3, and domain error classes.

**Tests**

- Migrations apply to an empty database and to the previous migration state.
- Constraints reject bad data: negative stock, duplicate barcode or serial, invalid status values.
- The branch extension never returns another branch's rows, including through relations.
- `audit_log` and `stock_ledger` reject updates and deletes by the application user.
- Document numbers stay unique and gap-free under parallel requests.
- Seed can run twice without duplicates; money rounding and pagination helpers behave correctly at the edges.

**Exit gate (all must be true)**

- `prisma migrate reset` followed by seed succeeds from scratch.
- Every table in the approved diagrams exists with the documented columns and relationships.
- All Stage 1 and Stage 2 tests pass.

## Stage 3: Authentication and authorization

**Goal:** secure login and a complete permission system, with users and branches managed through the UI. Follow the module workflow, with these modules in order: 3.1 Authentication, 3.2 Branches, 3.3 Users, roles and permissions.

**Registration:** an ERP has no public sign-up. Accounts are created by a Super Admin (Admin/Manager accounts) or by an Admin/Manager (Staff accounts in their own branches). Do not build open registration.

**Implement**

- **3.1 Authentication:** login and logout with server-side sessions in PostgreSQL and secure HttpOnly cookies; CSRF protection on all state-changing requests; Argon2id password hashing, password strength rules, login throttling and lockout, new session ID at login, idle and absolute timeouts, revoke all sessions on password change; change-password and admin-initiated reset; audit rows for login, failed login, logout and password changes.
- **3.2 Branches:** Super Admin creates, edits and deactivates branches (code, name, GSTIN, state).
- **3.3 Users, roles and permissions:** user create, edit and deactivate (never delete); assign branches and roles; role editor that groups permissions; permission names from `packages/permissions`; a permission guard decorator (`@RequirePermission('stock.adjust')`) and the branch-scoping interceptor; rules that Super Admin manages Admin/Manager and Admin manages Staff only inside their own branches.
- **Frontend:** login page, session-aware app shell, route guards, a `Can` component and permission-aware navigation, branch switcher for users with several branches, user list and form, role and permission editor, branch management screens, automatic redirect on an expired session.

**Tests**

- Login success and failure, lockout after repeated failures, expired and revoked sessions, logout.
- A request without a CSRF token is rejected; a tampered or foreign cookie is rejected.
- Every protected endpoint returns 401 without a session and 403 without the permission.
- An Admin cannot create or edit an Admin or Super Admin, or touch another branch's Staff.
- A deactivated user cannot log in and loses existing sessions.
- Frontend: guarded routes redirect, navigation hides what the user cannot access, forms show validation and server errors.
- End to end: Super Admin creates a branch, an Admin and a Staff user, and each sees only what they should.

**Exit gate (all must be true)**

- All three roles log in and see only their permitted modules and branches.
- A permission matrix test covers every protected endpoint.
- All earlier tests pass.

## Stage 4: Core feature modules

**Goal:** the primary business modules, built one at a time in dependency order. Each module is its own response and its own approval gate, and follows all 15 steps of the module workflow, frontend and backend.

If a module needs a table or column that is not in the approved schema, stop and propose the migration before writing code.

| Module | Scope (backend and frontend) | Edge cases that must be tested |
| --- | --- | --- |
| 4.1 Item master and barcodes | Items, categories, HSN and tax rate, units, reorder level, barcode generation, scan lookup, label printing | Duplicate code or barcode, serialized versus non-serialized items, inactive items |
| 4.2 Inventory and stock ledger | Ledger entries, balances by state, stock in and out, adjustments with approval, serial units, low-stock alerts, movement history | Negative stock blocked, concurrent issues on the same item, balance equals ledger sum, adjustment approval limits |
| 4.3 Batteries | Battery serials, issue and installation, expiry and warranty dates, expiry report and alert data | Expired battery cannot be sold without override, warranty date maths, duplicate serial |
| 4.4 Purchasing and receiving | Suppliers, purchase orders, goods receipt with line verification, shared discrepancy workflow, purchase return, supplier payments and ledger | Short, excess, wrong and damaged lines, partial receipts, over-receiving, quarantine resolution |
| 4.5 Inter-branch transfers | Request, approve, dispatch, in transit, receive, scan-based verification, discrepancies, event history | Stock leaves sender only on dispatch, arrives only on verified receipt, receiver cannot receive another branch's transfer, cancel after dispatch |
| 4.6 Customers and KYC | Customer master, KYC documents with upload to object storage, status workflow, history | Rejected then resubmitted documents, file type and size limits, masked sensitive values, access logging |
| 4.7 Billing and invoicing | GST and non-GST invoices, tax calculation, discounts, branch-wise number series, PDF, cancel-and-reissue, credit notes | Rounding, inter-state versus intra-state tax split, number gaps under concurrency, no edit after issue, stock effect of returns |
| 4.8 Payments and dues | Payments by mode, allocation across invoices, partial and full payment, customer ledger, outstanding and overdue | Overpayment, one payment split across invoices, payment reversal, outstanding after credit note |
| 4.9 Leads and follow-ups | Leads, sources, stages, assignment, follow-up reminders, notes, conversion to customer | Invalid stage transitions, conversion without duplicating the customer, overdue follow-ups |
| 4.10 Brokers and commission | Broker master, commission rules, calculation per invoice, payable and paid status, ledger | Percentage versus fixed rules, reversal on credit note or exchange, rule changes not altering old commissions |
| 4.11 Quotations and customized TOTO orders | Quotations, conversion to invoice, advance payment, build tracking, delivery with chassis, motor and battery serials | Price changes after quotation, partial advance, delivery before full payment rules |
| 4.12 Exchange | Old-for-new and new-for-new flow, valuation, difference payable or refundable, stock adjustment, approval | Old unit enters stock or scrap correctly, approval limits, serial tracked end to end, commission effect |
| 4.13 Staff and HR | Staff profile, attendance, leave, monthly payroll records | Overlapping leave, attendance for deactivated staff, month boundaries |

**Exit gate for Stage 4 (all must be true)**

- Every module above has passed its own gate and is approved.
- The core workflow works end to end: purchase and receive stock, transfer it to another branch, bill a customer, record payment, and see correct stock, outstanding and audit history.
- All earlier tests pass.

## Stage 5: Supporting modules

**Goal:** the features that sit on top of the core modules. Same rule as Stage 4: one module per response, full 15-step workflow, one approval gate each.

**Modules**

- **5.1 Dashboards:** Super Admin dashboard (branches, sales, purchases, stock value, outstanding, revenue, branch performance, lead conversion, commissions, stock and battery alerts) and branch dashboard (sales, purchases, current stock, low stock, pending transfers, dues, follow-ups). Read from SQL views or materialized views, not from page-level calculations.
- **5.2 Notifications:** in-app notifications plus pg-boss jobs for follow-up reminders, payment dues, low stock, battery expiry, pending transfers, purchase mismatches, pending KYC and unpaid commission. Send email, SMS or WhatsApp through a provider interface with a fake provider for tests, using the outbox pattern.
- **5.3 Search and filtering:** global search by barcode, serial, invoice number, customer name or phone; server-side filters, sorting and pagination on every list; saved filters are optional.
- **5.4 Reports:** the monthly reports (sales, purchases, stock, transfers, adjustments, exchanges, dues, payments, GST and non-GST, commissions, leads, attendance, branch performance, battery expiry, damaged or short stock), with date and branch filters and PDF and Excel export.
- **5.5 Settings and admin:** company and branch settings, document number series, tax rates, approval limits, state-machine workflow configuration, audit log viewer with filters, and user activity history.

**Tests**

- Dashboard and report figures equal the totals computed directly from the source tables, for several branches and date ranges.
- A branch user cannot see another branch's dashboard, report or notification.
- Jobs are idempotent: running a reminder job twice sends one notification; a failed send retries and then reports failure.
- Search handles empty input, partial matches, special characters and large result sets with paging.
- Exports match the on-screen data and respect permissions.
- Settings changes are audited and take effect without a restart.

**Exit gate (all must be true)**

- Every figure on a dashboard can be traced to a report and to its source records.
- Notifications fire for every alert type in a test run.
- All earlier tests pass.

# Stage 6: Modern UI/UX Completion & Design System

## Goal

Transform the entire ERP application into a **modern, polished, responsive, accessible, and production-ready enterprise application** with a consistent design system and excellent daily data-entry experience.

Upgrade the visual design and user experience across all modules, including dashboards, inventory, branches, stock transfers, purchases, billing, payments, dues, reports, user management, and settings.

Follow modern enterprise SaaS design principles inspired by high-quality admin dashboards and applications such as Linear, Vercel, Stripe, and contemporary ERP systems.

**Important constraints:**
- Read `PROGRESS.md`, `docs/IMPLEMENTATION_PROMPT.md`, and the existing implementation before making changes.
- Follow the current frontend architecture, technology stack, routing, permissions, and established coding conventions.
- Change presentation, shared UI components, interaction patterns, and frontend usability only.
- Do not change business logic, API contracts, database schemas, authorization rules, calculations, or established workflows.
- Preserve existing functionality and all previously implemented stages.
- Do not replace working features with static mockups or placeholder data.
- Implement the actual UI, interactions, responsive layouts, and tests in the repository.

---

## 1. Modern Enterprise Design System

Create a centralized design system using the existing Tailwind CSS version and configuration conventions.

Define reusable design tokens for:

- Primary, secondary, accent, background, surface, border, muted, success, warning, destructive, and informational colours.
- Typography scale, font weights, line heights, and readable text widths.
- Spacing, container widths, grid layouts, and consistent component dimensions.
- Border radii, shadows, overlays, focus rings, transitions, and animation durations.
- Form control heights, table row heights, button sizes, and icon sizes.
- Light and dark themes if the current architecture supports them without unnecessary complexity.
- Standard and compact density modes suitable for high-volume ERP data entry.

Use a restrained professional palette, neutral backgrounds, subtle borders, clear hierarchy, and consistent spacing. Avoid excessive gradients, unnecessary animations, oversized cards, and distracting colours.

Use semantic design tokens rather than hardcoding colours throughout individual components.

The result should feel modern and premium while remaining practical for staff who use the application for hours every day.

## 2. Application Shell: Sidebar, Top Bar, and Main Content

Redesign the global application layout consistently across all authenticated screens.

### 2.1 Responsive Sidebar Navigation

Implement a modern, collapsible sidebar with:

- Application logo, product name, and optional branch context.
- Navigation groups organized by business function.
- Expandable and collapsible navigation sections.
- Clear active-route highlighting and intuitive icons.
- Searchable navigation that filters menu items as the user types.
- Keyboard-accessible navigation and visible focus indicators.
- Pinned and favourite navigation items.
- A dedicated Favorites or Pinned section near the top.
- Recently visited screens, if this can be implemented without introducing unnecessary complexity or persistence changes.
- Tooltips when the sidebar is collapsed.
- A mobile drawer that opens and closes accessibly.
- Responsive behaviour for desktop, tablet, and mobile.
- Role-based visibility that preserves existing permission checks.

**Sidebar search requirements:**

1. Provide a clearly accessible search field with a keyboard shortcut such as `Ctrl+K` / `Cmd+K`.
2. Search available screens and navigation labels immediately.
3. Show matching navigation results with their relevant module names.
4. Allow keyboard navigation using arrow keys, Enter, and Escape.
5. Navigate to the selected screen without breaking routing or access controls.
6. Display an appropriate empty state when no results match.

**Pinned and favourite navigation requirements:**

- Allow users to pin or unpin frequently used screens.
- Show pinned screens in a clearly identifiable Favorites section.
- Support rearranging favourites when practical.
- Use existing user preferences or an appropriate existing persistence mechanism.
- If persistence is unavailable, implement a clean abstraction for local preferences without changing the backend schema.
- Ensure favourites never bypass role-based permissions.

### 2.2 Modern Top Navigation Bar

Create a consistent top bar containing:

- Sidebar toggle.
- Breadcrumb navigation showing the current module and screen.
- Global search or command palette.
- Current branch selector only where appropriate and consistent with existing permissions.
- Notifications entry if notifications already exist.
- Quick actions for frequently used workflows where appropriate.
- User avatar or initials with a dropdown menu.
- Profile, account settings, theme options if supported, and logout.
- Responsive behaviour that prioritizes essential controls on smaller screens.

Keep the top bar compact and uncluttered. Use accessible icon buttons with tooltips and descriptive screen-reader labels.

Do not add nonfunctional notification icons, branch selectors, or controls that imply features the application does not support.

### 2.3 Main Content Layout

Use a consistent page structure:

- Breadcrumbs where useful.
- Page title and short description.
- Primary action positioned consistently near the page heading.
- Secondary actions grouped into a contextual action menu when appropriate.
- Optional KPI summaries for relevant dashboards and list screens.
- Search, filters, and bulk actions in a predictable toolbar.
- Main content with consistent margins and responsive width.
- Clear loading, empty, error, and success states.

Avoid nesting too many cards or placing every piece of information inside a separate bordered container.

---

## 3. Reusable Component Kit

Create or improve the shared component library under the existing `components/` structure, using shadcn/ui and the application's existing form, validation, and table libraries where available.

Do not create duplicate implementations of components that already exist and meet the requirements.

### Required components

**Layout and navigation**
- `AppSidebar`
- `SidebarSearch`
- `FavoritesNav`
- `AppTopbar`
- `Breadcrumbs`
- `PageHeader`
- `PageContainer`
- `CommandPalette`

**Forms and inputs**
- `FormField`
- `FormSection`
- `FormActions`
- `MoneyInput`
- `BarcodeInput`
- `DatePicker`
- `DateRangePicker`
- `SearchableCombobox`
- `SearchableSelect`
- `FileUpload` if file upload workflows already exist.

**Tables and data display**
- `DataTable`
- `DataTableToolbar`
- `DataTablePagination`
- `DataTableColumnVisibility`
- `StatusBadge`
- `EmptyState`
- `ErrorState`
- `Skeleton`
- `LoadingState`

**Dialogs and feedback**
- `ConfirmDialog`
- `FormDialog`
- `DetailsDrawer`
- `Toast` / notification utilities.
- `UnsavedChangesDialog`

Reuse the application's existing toast library and modal primitives if present.

Every component must have clear TypeScript types, predictable props, appropriate composition patterns, and documented usage where necessary.

### Component quality requirements

- No unnecessary duplication.
- No `any` types unless unavoidable and explicitly justified.
- Accessible labels and descriptions.
- Consistent error handling.
- Keyboard support.
- Responsive behaviour.
- Testable interactions.
- Proper loading and disabled states.

---

## 4. Modern Forms and Data Entry

Redesign forms to be clean, compact, readable, and efficient for staff processing large numbers of transactions.

### Form layout

- Use consistent label placement and input heights.
- Group related fields into logical sections.
- Use responsive grids, generally one column on phones and two columns on larger screens where appropriate.
- Use full-width fields for long text, addresses, notes, and other fields that benefit from additional space.
- Clearly distinguish required fields from optional fields.
- Display helper text only when useful.
- Display validation messages next to the relevant fields.
- Preserve entered values when validation fails.
- Prevent accidental duplicate submissions.
- Disable submission while saving and show clear progress feedback.
- Focus the first invalid field when practical.
- Maintain logical keyboard tab order.

### Create and edit workflows

Use a consistent interaction pattern based on the size and complexity of the form.

- **Small forms:** Use a modal dialog for quick creation and editing.
- **Medium forms:** Use a larger responsive modal with clearly separated sections.
- **Complex forms:** Use a full-page form or side drawer when that provides a better experience.
- **Transactional workflows:** Preserve existing business steps and validations; do not force a complex transaction into a cramped modal.

Edit dialogs must load the selected record's actual data, display validation errors correctly, prevent duplicate submissions, and refresh the affected data after a successful save.

Use explicit Cancel and Save actions, with consistent placement and button styling.

Warn users before discarding unsaved changes. Do not display the warning when nothing has changed.

Do not silently reset forms or discard user input following failed requests.

### Specialized inputs

**MoneyInput**
- Support the application's existing currency and decimal precision.
- Format values consistently without breaking numeric parsing or calculations.
- Handle empty, invalid, negative, and zero values according to existing business rules.
- Avoid floating-point rounding changes in financial calculations.

**BarcodeInput**
- Support keyboard-wedge barcode scanners that behave like keyboard input.
- Preserve fast scanner entry without opening an unnecessary on-screen keyboard or stealing focus.
- Provide clear feedback for successful and unsuccessful lookups.
- Support camera-based scanning on compatible devices only if a suitable existing library or dependency is available.
- Request camera permission only when the user initiates camera scanning.
- Provide a manual-entry fallback.

**SearchableCombobox**
- Support large lists with search, keyboard navigation, loading, empty, and error states.
- Debounce server-backed searches where appropriate.
- Preserve existing API contracts and authorization.

---

## 5. Modern Data Tables

Replace duplicated ad hoc table implementations with a reusable DataTable built on the existing supported table library.

### Visual design

- Clean headers with clear column labels.
- Consistent row heights and cell spacing.
- Subtle dividers and restrained hover states.
- Readable alignment for text, dates, quantities, and currency.
- Status badges with accessible contrast.
- Clear selected-row styling.
- Optional sticky headers where useful.
- Sensible column widths and truncation with access to full values.
- Consistent action menus for row-level operations.

### Table functionality

Implement only the capabilities relevant to each screen:

- Server-side pagination.
- Server-side sorting.
- Search and filtering.
- Filter chips and a Clear Filters action.
- Column visibility controls.
- Row selection and bulk actions where supported.
- Page-size selection.
- Loading skeletons.
- Empty results and request-error states.
- Refresh controls where appropriate.
- URL-synchronized filters and pagination if compatible with existing routing.
- Preservation of filter and sorting state during navigation where practical.

**Critical:** Server-side paging, sorting, and filtering must use the existing backend capabilities. Do not load every record into the browser and simulate server pagination.

Never change the meaning of table actions or bypass existing permission checks.

### Responsive tables

- Desktop: show the most useful columns with optional horizontal scrolling.
- Tablet: prioritize important columns and keep row actions accessible.
- Mobile: use horizontal scrolling or a responsive row/card presentation depending on the screen's complexity.
- Keep critical identifiers, status, quantity, amount, and primary actions accessible.
- Do not silently hide important information or actions on smaller screens.

---

## 6. Consistent Modal, Drawer, and Confirmation Patterns

Use shared dialog primitives for all creation, editing, deletion, and confirmation workflows.

### Modal editing

- Consistent dialog title, description, form body, and footer.
- Responsive width based on the task's complexity.
- Appropriate maximum height with internal scrolling.
- Correct focus management when opening and closing.
- Escape and outside-click behaviour consistent with whether the form contains unsaved changes.
- Clear Save and Cancel buttons.
- Loading state during save operations.
- Accessible field errors and focus restoration.

### Drawers

Use side drawers for record previews, contextual details, and quick actions when appropriate.

Do not use drawers as a replacement for every complex form.

### Confirmations

Use confirmation dialogs for destructive or irreversible actions, including deletion and other existing high-impact workflows.

Include the action's consequence in the dialog text. Preserve existing confirmation requirements and authorization.

Avoid unnecessary confirmation dialogs for routine, reversible actions.

---

## 7. Dashboard, Lists, and Status Indicators

Improve dashboards and overview pages with restrained visual hierarchy.

- Use concise KPI cards where the information is genuinely useful.
- Make figures readable and distinguish labels from values.
- Display loading skeletons while data is fetched.
- Provide useful empty states when there is no data.
- Show actionable errors when a widget fails.
- Use consistent status colours and labels.
- Avoid decorative charts or fake statistics.
- Preserve existing data sources and calculations.

Standardize status badges for existing business states such as pending, approved, rejected, completed, cancelled, active, inactive, overdue, and low stock.

Use existing status values and business terminology rather than inventing new states.

---

## 8. ERP-Specific UX Improvements

Optimize the interface for real operational workflows.

### Billing and invoices

- Keep customer selection, barcode entry, item selection, quantities, and totals easy to access.
- Make the transaction total visually prominent without overwhelming the interface.
- Optimize keyboard flow for rapid item entry.
- Preserve existing pricing, tax, discount, payment, and invoice calculations.
- Support printing with clean invoice-specific print styles.
- Hide navigation, interactive controls, and irrelevant screen elements when printing.

### Purchase and stock receiving

- Make supplier selection, reference details, item entry, quantities, and discrepancies easy to review.
- Clearly distinguish entered quantities from mismatches, shortages, and excess quantities using existing business rules.
- Make validation errors visible beside the affected fields.
- Support efficient barcode scanning and keyboard-based data entry.

### Stock lookup and inventory

- Prioritize barcode, item name, item code, branch, quantity, and relevant status.
- Make branch-specific availability easy to understand.
- Display stock information using existing API responses.
- Provide useful filters without cluttering the screen.

### Stock transfers

- Make source branch, destination branch, item quantities, and existing discrepancy information easy to review.
- Preserve all existing approval and validation workflows.
- Provide clear transaction states and confirmation feedback.

### Payments and dues

- Make payment amounts, outstanding balances, payment status, and transaction references readable.
- Use consistent currency formatting.
- Preserve all existing financial calculations, validations, and transaction rules.

### Print layouts

Add print-specific styles for existing invoices, challans, and relevant transaction documents.

- Use appropriate page sizes and margins.
- Hide navigation, buttons, and nonessential controls.
- Avoid clipped tables and split totals where practical.
- Preserve existing transaction details and calculations.

---

## 9. Keyboard Shortcuts and Productivity

Introduce a small, documented set of useful shortcuts.

Suggested defaults:

- `Ctrl+K` / `Cmd+K`: Open global navigation search.
- `/`: Focus the current page's search field when focus is not already inside an editable control.
- `Ctrl+S` / `Cmd+S`: Save the active form only when saving is valid in the current context.
- `Escape`: Close an appropriate dialog or command palette.
- A scanning shortcut only when it does not conflict with browser or operating-system shortcuts.

Requirements:

- Do not intercept normal typing.
- Do not trigger actions while the user is entering text into unrelated inputs.
- Display shortcut hints in tooltips or contextual help.
- Ensure all functionality remains available without keyboard shortcuts.
- Prevent accidental submissions or duplicate transactions.

---

## 10. Responsive Design

Validate the application at representative viewport widths:

- Phone: 375–430 px.
- Tablet: 768–1024 px.
- Desktop: 1280–1440 px and above.

Check:

- Sidebar collapse and mobile drawer.
- Top bar overflow.
- Forms and modal dimensions.
- Table readability and horizontal scrolling.
- Dropdown and combobox positioning.
- Dialog footer visibility.
- Billing and stock-receiving workflows.
- Touch target sizes.
- Text wrapping, long identifiers, and currency values.

The application must remain functional and comfortable to use on desktop computers, tablets used by branch staff, and mobile devices.

---

## 11. Accessibility

Target WCAG 2.2 AA for the screens and components covered by this stage.

- Semantic HTML.
- Accessible names for icon-only controls.
- Correct label and description associations.
- Visible keyboard focus.
- Logical focus order.
- Keyboard-accessible menus, tables, dialogs, and comboboxes.
- Correct focus trapping and restoration in modal dialogs.
- Sufficient text and interactive-control contrast.
- Accessible validation and error announcements.
- Appropriate live regions for important save and status feedback.
- Reduced-motion support.
- No reliance on colour alone to communicate status.
- No serious or critical automated accessibility violations on the main workflows.

Do not solve accessibility issues by removing functionality or weakening validation.

---

## 12. Testing Requirements

Use the existing testing stack and project conventions.

### Component tests

Add or update tests for every shared component introduced or materially changed.

Cover:
- Default, loading, empty, disabled, and error states.
- Form validation and error associations.
- Keyboard navigation and focus behaviour.
- Modal open, close, cancel, and save interactions.
- Search, filtering, sorting, and pagination.
- Barcode keyboard input.
- Accessible names and labels.
- Unsaved-changes warnings.
- Responsive menu interactions where practical.

### Accessibility tests

Use axe or the existing compatible accessibility-testing library.

Run automated checks on the main screens, including:

- Dashboard.
- Inventory and stock lookup.
- Billing.
- Purchase and stock receiving.
- Stock transfers.
- Payments and dues.
- Relevant user and branch management screens.

Resolve serious and critical violations. Document any remaining known limitations rather than silently ignoring them.

### Playwright tests

Test the application at phone, tablet, and desktop widths.

Verify:
- Sidebar search and navigation.
- Pinning and unpinning favourites.
- Top bar and mobile menu.
- Table filtering and pagination.
- Opening and editing records through modal forms.
- Validation failures and successful submissions.
- Billing keyboard flow and barcode input.
- Stock-receiving workflows.
- Loading, empty, and error states.
- Print layouts where feasible.

Use stable selectors and realistic test fixtures. Do not make tests dependent on production data.

### Regression tests

- Run all existing frontend and backend tests.
- Preserve all existing API contracts and business behaviour.
- Fix regressions caused by the UI refactor.
- Do not delete, skip, or weaken existing tests just to make the suite pass.

---

## 13. Implementation Strategy

Work incrementally, screen group by screen group.

### Step 1: Audit

Inspect the existing repository, design conventions, components, routes, permissions, forms, tables, and tests.

Identify duplicated UI patterns and create a concise implementation checklist.

### Step 2: Foundation

Implement design tokens, typography, density, application shell, sidebar, top bar, navigation search, favourites, and responsive page layouts.

### Step 3: Shared Components

Build and test the reusable form, table, dialog, status, loading, error, and empty-state components.

### Step 4: Screen Migration

Migrate existing screens to shared components in logical groups:

1. Dashboard and navigation.
2. Master data and branch management.
3. Inventory and stock lookup.
4. Purchases and stock receiving.
5. Stock transfers and adjustments.
6. Billing, invoices, and challans.
7. Payments and dues.
8. Reports, users, roles, and settings.

Adjust the order to match the actual repository and implemented modules.

### Step 5: Polish

Improve keyboard workflows, responsive behaviour, loading and feedback states, accessibility, and print layouts.

### Step 6: Verification

Run type checking, linting, component tests, accessibility checks, Playwright tests, and all existing regression tests.

Do not stop after updating only the dashboard. Apply the shared design system consistently across the entire application.

---

## 14. Exit Gate — All Conditions Must Pass

- [ ] The entire application follows a coherent, modern enterprise design system.
- [ ] Design tokens are centralized and consistently used.
- [ ] Sidebar navigation is responsive, searchable, and supports pinned favourites.
- [ ] The top bar provides consistent navigation and account controls.
- [ ] Forms and edit workflows use shared components and appropriate modal, drawer, or full-page layouts.
- [ ] Tables use shared components with genuine server-side operations wherever supported.
- [ ] Billing, stock receiving, and inventory lookup work well on tablets and phones.
- [ ] Every applicable screen provides appropriate loading, empty, success, and error feedback.
- [ ] Keyboard navigation, focus handling, labels, contrast, and screen-reader names are implemented.
- [ ] Main-screen accessibility checks have no unresolved serious or critical violations.
- [ ] Print styles work for the existing invoice and challan workflows.
- [ ] Component tests and responsive Playwright tests pass.
- [ ] All earlier tests continue to pass.
- [ ] No business logic, financial calculation, database schema, permission rule, or API contract has been unintentionally changed.
- [ ] No placeholder buttons, fake data, or unfinished interactions remain.

## Final Deliverables

At completion, provide:

1. A summary of the UI/UX improvements implemented.
2. A list of changed and added files grouped by purpose.
3. The reusable component inventory.
4. The screens migrated to the new design system.
5. Test commands executed and their actual results.
6. Any known limitations or blocked requirements.
7. Confirmation that earlier functionality and tests have been preserved, based on actual verification.
8. A ZIP overlay containing only the changed and newly added project files, preserving their original directory structure, so the changes can be applied to the existing repository.

**Execution instruction:** Implement this stage in the actual codebase. Inspect existing code before deciding component APIs or dependencies. Prefer existing dependencies and established patterns over unnecessary package additions. Do not merely provide recommendations, sample code, screenshots, or a proposed plan. Complete the implementation and verify it before reporting success.

## Stage 7: Integration and end-to-end testing

**Goal:** prove that the modules work together as the business actually uses them. Write tests first for each journey, then fix any defect found in the module that caused it, without rewriting unrelated code.

**Critical journeys (each is a Playwright test against a seeded database)**

1. **Branch setup:** Super Admin creates a branch, an Admin and a Staff user; each logs in and sees only their scope.
2. **Purchase to stock:** create a purchase order, receive it with one short and one damaged line, resolve the discrepancies, and confirm stock, supplier payable and audit rows.
3. **Transfer:** request, approve, dispatch and receive stock between two branches with a mismatch, and confirm both branches' balances and the in-transit state.
4. **Sale to payment:** create a customer with KYC, bill a GST invoice with barcode scanning, take a partial payment, then the rest, and confirm outstanding at each step.
5. **Return and correction:** issue a credit note, and cancel and reissue an invoice, confirming stock, tax and commission effects.
6. **Lead to delivery:** convert a lead to a customer, quote a customized TOTO, take an advance, deliver with serial numbers, and pay broker commission.
7. **Exchange:** old TOTO for new TOTO with a price difference and approval.
8. **Battery expiry:** a battery nearing expiry raises a notification and appears in the expiry report.
9. **Month end:** run the monthly reports and confirm they match the dashboards.

**Also test**

- API workflows without the browser (Supertest sequences) for the same journeys.
- Authentication flows: expiry, concurrent sessions, deactivation mid-session.
- Concurrency: two users issuing the last unit, two users receiving the same transfer, parallel invoice numbering.
- Regression suite: the full set of earlier tests runs on every change.

**Exit gate (all must be true)**

- All nine journeys pass reliably (no flaky tests) in CI.
- Frontend and backend contracts match: a contract-drift check passes.
- All earlier tests pass.

## Stage 8: Security, performance and code quality

**Goal:** harden and tidy the finished application. Every change in this stage must be backed by a test or a measurement, and must not alter behaviour that already passes its tests.

**Security review**

- Walk the OWASP Top 10 against the codebase and record each finding and fix.
- Authorization: an automated check that every endpoint has a permission guard and branch scoping; test horizontal access (one branch reading another's records by ID).
- Validation: every endpoint rejects unknown fields, oversized payloads and wrong types.
- Sessions and CSRF: cookie flags, timeouts and token checks verified; rate limits on login and sensitive endpoints.
- Data: security headers and Content Security Policy, CORS limited to approved origins, upload checks (type, size, scanning), encrypted KYC storage, no secrets or personal data in logs, dependency and container image vulnerability scans in CI.

**Performance**

- Database: review query plans for the slowest endpoints and reports; add missing indexes; remove N+1 queries; confirm partitioning plans for `stock_ledger` and `audit_log`.
- API: pagination everywhere, response times measured under load with realistic data (for example 100 000 items and 1 million ledger rows), caching only where measured.
- Frontend: route-level code splitting, virtualised long tables, no unnecessary re-renders, bundle size checked.

**Code quality**

- Remove duplicated code, dead code and unused dependencies; replace repeated logic with shared helpers.
- Keep module boundaries: a dependency check fails if one feature imports another's internals.
- Check naming, error messages and comments for consistency; confirm OpenAPI documents match the code.

**Exit gate (all must be true)**

- No open critical or high security findings.
- Performance targets are written down and met: key screens respond in under 2 seconds with the test data volume.
- The full test suite passes after every refactor, with coverage not lower than before.

## Stage 9: Final verification

**Goal:** confirm, with evidence, that the complete application is production-ready. Run every check below on a clean checkout, record the actual output, and fix every critical issue before declaring completion.

**Verification checklist**

- [ ] Frontend tests: all component and interaction tests pass
- [ ] Backend tests: all unit, integration and API tests pass
- [ ] End-to-end tests: all journeys from Stage 7 pass, three runs in a row
- [ ] Type check passes for every package with no errors
- [ ] Lint passes with no errors and no new warnings
- [ ] Production builds succeed for the API, web app and worker
- [ ] Docker images build and the full stack starts with Docker Compose
- [ ] Migrations apply cleanly to an empty database and upgrade the previous release; the rollback plan is documented
- [ ] Seed runs safely in production mode (no demo data, no default passwords)
- [ ] A backup is taken and restored into a fresh database, and the data matches
- [ ] Security scans (dependencies and images) show no critical or high findings
- [ ] Performance targets from Stage 8 are met on the large test dataset
- [ ] OpenAPI documents match the implemented endpoints and contracts
- [ ] Environment variables, deployment steps and the operations runbook are documented in `docs/`

**Final report (required)**

- The result of each check above, with the command used and its output summary.
- Test counts and coverage by package.
- A list of known limitations and decisions deferred, each with its risk.
- Any critical issue found, how it was fixed, and the test that now guards it.

**Exit gate: production-ready means all of these are true**

- Every item in the verification checklist is ticked with evidence.
- There are no open critical or high issues.
- The application can be deployed, backed up, restored and rolled back by following the written runbook.

## How to start

The order never changes: Stage 1 Foundation → Stage 2 Database → Stage 3 Authentication → Stage 4 Core modules (4.1 to 4.13) → Stage 5 Supporting modules → Stage 6 UI/UX → Stage 7 End-to-end testing → Stage 8 Security and performance → Stage 9 Final verification.

**First message to send, after pasting this document:**

```
Begin Stage 1. Follow the response format in section 5 exactly.
Generate only Stage 1, include its tests, and stop at its exit gate.
Do not start Stage 2 until I reply Approved.
```

**Between stages and modules**

1. Run the verification commands the assistant gives you and check the output.
2. If everything passes, reply `Approved`. The assistant moves to the next module or stage.
3. If anything fails, paste the failing output and reply `Fix`. The assistant must fix only the defect, add a test that would have caught it, re-run the full suite, and report. It must not rewrite unrelated code.
4. If a requirement is unclear or the schema needs to change, the assistant must stop and ask instead of guessing.

**Standing instructions for the assistant**

- Always state the current stage and module at the top of the response.
- Never skip a gate, and never declare something complete without the checklist and verification commands.
- Keep every module consistent with the approved stack, the approved schema and the code already written.
