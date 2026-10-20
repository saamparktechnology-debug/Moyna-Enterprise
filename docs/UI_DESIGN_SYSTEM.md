# UI design system

How the web app (`apps/web`) looks and behaves, and which piece to reach for. Built on Tailwind CSS, shadcn/ui (Radix) and TanStack Table. Nothing here changes business rules, the API or permissions: it is presentation only.

## Tokens (`src/index.css`)

Every colour, size and duration comes from CSS variables in one file. Components use the semantic names, never raw colours.

| Group           | Names                                                                                                          |
| --------------- | -------------------------------------------------------------------------------------------------------------- |
| Surfaces, text  | `background`, `foreground`, `card`, `popover`, `muted`, `muted-foreground`, `border`, `input`, `ring`          |
| Brand           | `primary`, `secondary`, `accent` (each with a `-foreground`)                                                   |
| Status          | `destructive`, `success`, `warning`, `info`, each with `-foreground` and a `-subtle` fill                      |
| Sidebar         | `sidebar`, `sidebar-foreground`, `sidebar-muted`, `sidebar-accent`, `sidebar-border`, widths                   |
| Shape and depth | `--radius-*`, `--shadow-*`, `--overlay`, `--duration-fast`, `--duration-base`                                  |
| Density         | `--control-h`, `--control-h-sm`, `--row-py`, `--cell-px`, `--page-gap` (utilities `h-control`, `size-control`) |

- **Themes:** light, dark (`.dark` on `<html>`) and system. Choose from the account menu. Text pairs are chosen for WCAG AA contrast; `--input` and `--ring` for 3:1 against the page.
- **Density:** standard or compact (`data-density="compact"` on `<html>`), also from the account menu. Compact suits high-volume entry.
- **Motion:** animations are short and switched off by `prefers-reduced-motion`.
- **Preferences:** theme, density, sidebar state, favourites and recent screens are stored in the browser per user (`lib/preferences.ts`). There is no backend table for them. Favourites are only paths and are filtered through the same permission check as the menu.

## Shell

`app/app-layout.tsx` hosts the skip link, sidebar, top bar, command palette and toasts.

- **Sidebar:** grouped by business function (`app/navigation.ts`), searchable, pinned favourites and recent screens, collapsible to icons with tooltips. Below 768px it is a drawer. Items appear only for permissions the person holds.
- **Top bar:** menu button, breadcrumbs, record search ("Find anything"), branch switcher, notifications, quick actions and the account menu (account, theme, density, sign out).
- **Keyboard:** `Ctrl/Cmd+K` opens the command palette (screens you may open); `/` focuses the page's own search; arrow keys, Enter and Escape work in every menu and list; the first Tab stop is "Skip to main content".

## Pick the right component

| Need                             | Use                                                                                                                   |
| -------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| Page title block                 | `PageContainer` + `PageHeader` (title, one-line description, actions)                                                 |
| A list the server pages          | `DataTable` with `DataTableToolbar` and `useListParams`                                                               |
| Lines already on the page        | `SimpleTable` (no paging or sorting)                                                                                  |
| Sections of one screen           | `SectionTabs` + `SectionPanel` (arrow keys, linked panels)                                                            |
| Create or edit in a modal        | `FormDialog` (title, description, scrolling body, pinned Cancel and Save, unsaved-changes guard)                      |
| Irreversible or risky action     | `ConfirmDialog`                                                                                                       |
| Preview a record without leaving | `DetailsDrawer`                                                                                                       |
| Group fields                     | `FormSection` (a labelled fieldset), `FormField` (label, hint, error), `FormActions`                                  |
| Special inputs                   | `MoneyInput`, `BarcodeInput`, `DatePicker`, `DateRangePicker`, `SearchableSelect`, `SearchableCombobox`, `FileUpload` |
| Status                           | `StatusBadge` (words plus icon, never colour alone)                                                                   |
| Loading, empty, failed           | `LoadingState`, `EmptyState`, `ErrorState`                                                                            |
| Feedback after an action         | `toast.success(...)` and friends; errors stay until dismissed                                                         |

### List screens

1. `useListParams(DEFAULTS, 'prefix')` keeps page, page size, search, sort and filters in the address, so Back, refresh and links keep the view. Use a prefix when one screen has several lists.
2. `useSearchBox` debounces the search text.
3. `DataTable` takes `label`, `noun`, `columns` (TanStack column definitions), `query`, `getRowId`, `filtered`, `emptyText`, `onPageChange`, and optionally `onPageSizeChange`, `sort`/`onSortChange`, `columnVisibility`.
4. Column `meta`: `sortKey` (a field the API's sort allowlist accepts), `alwaysVisible`, `align`, `className`, `wrap`.
5. List requests keep their original query string until the person sorts or changes the page size, so existing API contracts are untouched.

### Dialogs

Dialogs are for focused editing. Long transactions (invoice, receiving, purchase order) use a wide `FormDialog` with sections. Focus is trapped, Escape closes, and focus returns to the button that opened it. A dialog that sets its own `max-w-*` keeps it; otherwise `size` (`sm` to `xl`) sets the width. On a phone a dialog fills the width. In a `FormDialog` the body scrolls while the header and footer stay in place. `ConfirmDialog` is for yes/no questions with a stated consequence. View-and-act dialogs (record details, ledgers, KYC documents) use the plain `Dialog`: their buttons scroll with the content, so keep them short or move the actions to the top.

## Accessibility rules

- Every input has a visible label; errors are text next to the field, announced through `aria-describedby`.
- Status and warnings use words and icons as well as colour.
- A table's scroll box is focusable, named "`<label>`, scrollable" and is `relative` (otherwise hidden text can widen the page on a phone).
- Any `aria-controls` must point at an element that exists; leave it off while a list is closed.
- Touch targets are at least `--control-h` high; check-in and check-out are larger.

## Print

`index.css` has the print rules. A page prints without the menu, top bar, notices and buttons. A dialog marked `print-document` (the invoice view) prints alone, as a page. Elements that should never print take `no-print`. Item labels print through their own `label-print-root`.

## Tests

- Unit and component: `pnpm --filter @erp/web test` (Vitest, jsdom). jsdom cannot see layout, contrast or print, so those are covered in the browser.
- Browser: `pnpm test:e2e`. `e2e/ui-responsive.spec.ts` (no sideways scroll, dialogs fit, drawer and sidebar), `e2e/accessibility.spec.ts` (axe at WCAG A and AA in light and dark, keyboard, focus return) and `e2e/print.spec.ts` sit beside the workflow specs.
- To run Playwright against a browser you already have, set `PLAYWRIGHT_CHROMIUM_PATH` (and optionally `PLAYWRIGHT_CHROMIUM_ARGS`). The API in test mode also needs `KYC_STORAGE_PATH` (an absolute folder).
- In specs prefer roles and exact names (`getByRole('combobox', { name: 'Report', exact: true })`); several screens now have look-alike labels such as "Search menu" and "Find anything".
