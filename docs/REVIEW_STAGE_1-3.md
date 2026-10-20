# Review of Stages 1 to 3

Reviewed from the uploaded `erp.zip` before any Stage 4 work. Everything below was run, not just read.

## Result: Stages 1 to 3 are sound

| Check (PostgreSQL 16, clean database)                                                                    | Result     |
| -------------------------------------------------------------------------------------------------------- | ---------- |
| `@erp/contracts` tests                                                                                   | 68 passed  |
| `@erp/permissions` tests                                                                                 | 14 passed  |
| `@erp/web` tests                                                                                         | 112 passed |
| `@erp/worker` tests (including relay and pg-boss)                                                        | 22 passed  |
| `@erp/api` unit tests                                                                                    | 143 passed |
| `@erp/api` integration tests (migrations, constraints, row-level security, auth, branches, users, roles) | 304 passed |
| Type check, lint (zero warnings), format check                                                           | clean      |

Module 3.3 (users, roles, permissions) was still marked "awaiting verification" in `PROGRESS.md`. It passes everything above, so it is ready for you to approve.

## What is done well

- Branch isolation is enforced twice (application filter and database row-level security) and tested, including nested relations, transactions and concurrent requests.
- Ledgers are append-only for the application role at the database level, not just in code.
- Optimistic concurrency (`row_version` maintained by a trigger), gap-free document numbers and the outbox are in place and tested, so Stage 4 modules can reuse them as they are.
- Every endpoint is deny-by-default (authentication, CSRF and permission guards), and the permission catalogue already contains every permission Stage 4 needs.
- Errors, pagination, audit and money handling are consistent helpers, not repeated code.

## Findings (none blocks Stage 4)

| #   | Finding                                                                                                                                                                                                       | Severity                    | Suggested handling                                                                                                                                 |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Several service methods (`BranchesService`, `UsersService`) take an `info: RequestInfo` parameter they never use, because the audit service reads the request details from the branch context.                | Low                         | Remove in Stage 8 (code quality). Module 4.1 does not copy the pattern.                                                                            |
| 2   | `TestClient` in `test/support/auth-world.ts` had `get` and `post` only, so tests needing `PATCH` called the agent directly.                                                                                   | Low                         | A `patch` helper was added (module 4.1). Existing tests were left as they are.                                                                     |
| 3   | `prisma migrate deploy`, `pnpm db:drift`, Playwright, Docker Compose and CI cannot run in the review sandbox (Prisma's engine download is blocked). Migrations were applied with SQL files in the same order. | Info                        | Run `pnpm db:setup`, `pnpm db:drift` and `pnpm test:e2e` on your machine. Module 4.1 adds one migration and one allowed index to the drift script. |
| 4   | The approved schema has no price on `items`, no quotation lines table, no purchase-return table and no stock-adjustment request table.                                                                        | Info, affects later modules | Per your rules, each affected module (4.2 adjustments, 4.4 returns, 4.11 quotations) will propose its migration before any code.                   |

## How the review was run

Dependencies installed from the lockfile, `prisma generate` with the engine download bypassed, PostgreSQL 16 installed locally, and a throwaway sandbox-only stand-in for `prisma migrate deploy` that applies `prisma/migrations/*/migration.sql` in order. None of that is part of the repository.
