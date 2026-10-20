# Applying Stage 4, module 4.7 (invoices, Sales screens and credit notes)

Copy this folder over the root of your repository (the folder with `package.json`), keeping the paths. Modules 4.1 to 4.6 must be applied first. This replaces the earlier 4.7 zip that held parts A and B only.

```
cp -R overlay/. /path/to/erp/
pnpm install
pnpm db:setup        # applies migrations 12 and 13, gives the roles their passwords, seeds
pnpm db:drift        # expected: "No drift"
pnpm test
pnpm typecheck && pnpm lint && pnpm format:check
pnpm test:e2e        # includes e2e/billing.spec.ts (needs Playwright browsers)
```

**Still open from module 4.6.** KYC files are kept by the in-memory storage stand-in and are lost when the API restarts. Do not use real customer documents until a real S3-compatible adapter exists.

Existing files that changed (everything else is new):

| File                                                                                                            | Change                                                                       |
| --------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| `prisma/schema.prisma`                                                                                          | invoice cancel columns, `lineNo`, credit note columns and `CreditNoteLine`   |
| `apps/api/src/app.module.ts`                                                                                    | imports `BillingModule`                                                      |
| `apps/api/src/common/prisma/branch-scope.ts`, `branch-scope.test.ts`                                            | `CreditNoteLine` is branch-scoped (36 models)                                |
| `apps/api/src/features/batteries/batteries.service.ts`                                                          | one new public method, `assertSellable`, which billing calls                 |
| `apps/api/test/integration/migrations.int.test.ts`, `schema-conformance.int.test.ts`, `constraints.int.test.ts` | migration list, the new table (61 models, 135 foreign keys), new constraints |
| `apps/web/src/app/routes.tsx`                                                                                   | the Sales page                                                               |
| `apps/web/src/app/app-shell.test.tsx`                                                                           | its "not built yet" example is now `/reports`, because `/sales` is built     |
| `packages/contracts/src/index.ts`                                                                               | exports the billing and credit note contracts                                |
| `PROGRESS.md`                                                                                                   | module 4.7 notes                                                             |

Read `docs/BILLING.md` first. `docs/DATABASE.md` is generated from the Stage 2 specification and was not edited.

Not run by the author: the main type check after the final small test edits, Playwright, `prisma migrate deploy`, `db:drift` and CI. Run them on your machine.
