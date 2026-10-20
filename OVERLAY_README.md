# Overlay: Stage 6 (UI/UX completion and design system)

Goes on top of the Stage 5 overlays. Only files added or changed are included, with their paths from the repository root. **No database migration, no API change, no permission change, no contract change.** The overlay touches `apps/web`, `e2e`, `docs`, `playwright.config.ts`, `package.json`, `apps/web/package.json`, `pnpm-lock.yaml`, `README.md` and `PROGRESS.md`. One file is deleted: `apps/web/src/features/inventory/list-state.tsx` (delete it by hand after extracting; nothing imports it).

## Apply

1. Extract over the repository root.
2. `pnpm install` (new dependencies, listed below; the lockfile is included).
3. Validate: `pnpm build:packages && pnpm lint && pnpm format:check && pnpm -r --workspace-concurrency=1 test`.
4. Browser tests: `pnpm exec playwright install chromium`, then `pnpm test:e2e`. The API in test mode needs `KYC_STORAGE_PATH` set to an absolute folder. To use a browser you already have, set `PLAYWRIGHT_CHROMIUM_PATH` (and optionally `PLAYWRIGHT_CHROMIUM_ARGS`).

`pnpm format:check` also flags `prisma.config.ts` and `prisma/seed/run-seed.ts`; they were flagged before Stage 6 and were not touched.

## New dependencies

`apps/web`: `@tanstack/react-table`, `@radix-ui/react-dropdown-menu`, `@radix-ui/react-tooltip`, `@radix-ui/react-popover`; dev: `axe-core`. Root dev: `@axe-core/playwright`.

## What is in it

A centralized design-token layer with light and dark themes and two densities; a grouped, searchable, collapsible sidebar with pinned favourites, a command palette (Ctrl/Cmd+K), a top bar with breadcrumbs and an account menu; shared `DataTable`, `SimpleTable`, `FormDialog`, `ConfirmDialog`, `DetailsDrawer`, form, state and toast components; every list and form screen moved onto them; print rules; and new unit, accessibility, responsive, print and transaction tests. Read `docs/UI_DESIGN_SYSTEM.md` first. See `PROGRESS.md` (Stage 6) for what was run and what was not.

## Existing tests that changed

`app-shell.test.tsx`, `auth-flows.test.tsx` and `branch-switcher.test.tsx` open the account menu before using Sign out and Change password (the account controls moved into a menu); `test/setup.ts` clears toasts and preferences between tests. In `e2e`, several specs use exact or role-based selectors because the screens now have look-alike labels, and a few were already stale (see `PROGRESS.md`). No test was deleted or skipped.

## Not included, or not run

Not covered by any test: GST invoices and credit notes in the browser, serial-numbered items (TOTO units) in the receiving and billing flows, barcode scanning at phone width, and a real print preview or PDF (print was checked with the browser's print-media emulation). There is no challan screen in the web app. Finalizing payroll has no confirmation step (the spec says to keep existing confirmations). The main JavaScript bundle is about 1.17 MB (324 KB gzipped); left for Stage 8.
