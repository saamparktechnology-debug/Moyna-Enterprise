# Chunk 17: promised date and guarantor on dues

Apply over chunks 1 to 16 (chunk 14's overlay already includes 15 and 16). Paths are relative to the project root.

1. Unzip over the project (overwrites files).
2. `pnpm install --frozen-lockfile` (no new dependencies).
3. `pnpm db:migrate` — applies `20261007003800_due_promises_guarantors` (tables `due_promises`, `invoice_guarantors`).
4. `pnpm build:packages`, then restart the API.

What you get: Payments → Invoices due has a "Next promised" column and a "Follow up" button (needs `payments.create`) that opens a dialog to note a promised date, the guarantor (name, phone, optional relation and address) and an optional KYC file (needs `kyc.upload`; opening needs `kyc.view` and is audited). No permission codes or role presets changed.

Checks run in the sandbox: contracts 324 tests, API unit 284, web 935 pass (5 known failures in billing/invoice-broker and transfers-page, which this chunk did not touch), tsc and ESLint clean for api, web and contracts, Prettier clean on changed files.
Not run (no PostgreSQL in the sandbox): API integration tests (`payments.int.test.ts` has new cases, `migrations.int.test.ts` lists the migration), applying the migration, the drift check. Please run `pnpm test:integration` on your side.
