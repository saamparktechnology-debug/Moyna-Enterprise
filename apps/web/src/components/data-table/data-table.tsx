import { ArrowDown, ArrowUp, ArrowUpDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { flexRender, getCoreRowModel, useReactTable } from '@tanstack/react-table';
import type { ColumnDef, VisibilityState } from '@tanstack/react-table';
import { EmptyState } from '@/components/empty-state';
import { ErrorState } from '@/components/error-state';
import { LoadingState } from '@/components/loading-state';
import { cn } from '@/lib/utils';
import './column-meta';
import { DataTableColumnVisibility } from './data-table-column-visibility';
import { DataTablePagination } from './data-table-pagination';

export interface PagedData<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

/** The parts of a TanStack Query result a table needs. */
export interface PagedQuery<T> {
  data: PagedData<T> | undefined;
  error: unknown;
  isPending: boolean;
  isFetching: boolean;
  refetch: () => unknown;
}

export interface SortState {
  sortBy: string | undefined;
  sortOrder: 'asc' | 'desc';
}

export interface DataTableProps<T> {
  /** The table's accessible name, for example "Branches". */
  label: string;
  /** Lower-case plural used in messages: "Loading branches…". */
  noun: string;
  columns: ColumnDef<T, unknown>[];
  query: PagedQuery<T>;
  getRowId?: ((row: T) => string) | undefined;
  /** A search or filter is active, so an empty result means "nothing matches", not "nothing yet". */
  filtered: boolean;
  /** What to say when the list is empty and no filter is active. */
  emptyText: string;
  filteredEmptyText?: string;
  /** Shown in the empty state, for example a Clear filters button or a "New …" button. */
  emptyAction?: ReactNode;
  onPageChange: (page: number) => void;
  onPageSizeChange?: ((pageSize: number) => void) | undefined;
  /** When both are given, columns that declare a `sortKey` get a sort button. The server sorts. */
  sort?: SortState | undefined;
  onSortChange?: ((sortBy: string | undefined, sortOrder: 'asc' | 'desc') => void) | undefined;
  /** Offer a Columns menu to hide columns. */
  columnVisibility?: boolean;
  /** Keep the header in view while the body scrolls. */
  stickyHeader?: boolean;
  /** Classes for one row, for example to mark an overdue row. */
  rowClassName?: ((row: T) => string | undefined) | undefined;
  /** Rows to draw while the first page loads. */
  skeletonRows?: number;
  className?: string;
}

/**
 * The one table every list uses. Paging, sorting and filtering belong to the server: this component
 * shows one page and reports what the person asked for. It never loads every record to page them
 * in the browser. Loading, error and empty states, and "Showing 1–10 of 42", are the same everywhere.
 */
export function DataTable<T>({
  label,
  noun,
  columns,
  query,
  getRowId,
  filtered,
  emptyText,
  filteredEmptyText = 'Nothing matches your search. Clear the search or change the filter.',
  emptyAction,
  onPageChange,
  onPageSizeChange,
  sort,
  onSortChange,
  columnVisibility = false,
  stickyHeader = false,
  rowClassName,
  skeletonRows = 5,
  className,
}: DataTableProps<T>) {
  const { data, error, isPending, isFetching, refetch } = query;
  const [visibility, setVisibility] = useState<VisibilityState>({});
  const rows = useMemo(() => data?.items ?? [], [data]);

  // TanStack Table returns functions the React Compiler cannot memoise; the table is rebuilt each render by design.
  // eslint-disable-next-line react-hooks/incompatible-library
  const table = useReactTable<T>({
    data: rows,
    columns,
    state: { columnVisibility: visibility },
    onColumnVisibilityChange: setVisibility,
    getCoreRowModel: getCoreRowModel(),
    ...(getRowId ? { getRowId } : {}),
    manualPagination: true,
    manualSorting: true,
    manualFiltering: true,
  });

  if (isPending) return <LoadingState label={`Loading ${noun}…`} rows={skeletonRows} />;
  if (error || !data) return <ErrorState onRetry={refetch}>Could not load the {noun}.</ErrorState>;
  if (data.items.length === 0)
    return <EmptyState action={emptyAction}>{filtered ? filteredEmptyText : emptyText}</EmptyState>;

  const sortable = Boolean(onSortChange);
  const nextSort = (key: string) => {
    if (!onSortChange) return;
    if (sort?.sortBy !== key) onSortChange(key, 'asc');
    else if (sort.sortOrder === 'asc') onSortChange(key, 'desc');
    else onSortChange(undefined, 'asc');
  };

  return (
    <div className={cn('space-y-3', className)}>
      {columnVisibility ? (
        <div className="flex justify-end">
          <DataTableColumnVisibility table={table} />
        </div>
      ) : null}
      <div
        role="region"
        aria-label={`${label}, scrollable`}
        tabIndex={0}
        className={cn(
          'relative overflow-x-auto rounded-lg border bg-card',
          stickyHeader && 'max-h-[70dvh] overflow-y-auto',
        )}
      >
        <table aria-label={label} aria-busy={isFetching} className="w-full text-left text-sm">
          <thead
            className={cn(
              'border-b bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground',
              stickyHeader && 'sticky top-0 z-10 bg-muted',
            )}
          >
            {table.getHeaderGroups().map((group) => (
              <tr key={group.id}>
                {group.headers.map((header) => {
                  const meta = header.column.columnDef.meta;
                  const key = meta?.sortKey;
                  const active = key !== undefined && sort?.sortBy === key;
                  const ariaSort = active
                    ? sort?.sortOrder === 'desc'
                      ? 'descending'
                      : 'ascending'
                    : undefined;
                  const content = header.isPlaceholder
                    ? null
                    : flexRender(header.column.columnDef.header, header.getContext());
                  return (
                    <th
                      key={header.id}
                      scope="col"
                      aria-sort={key !== undefined && sortable ? (ariaSort ?? 'none') : undefined}
                      className={cn(
                        'px-(--cell-px) py-2.5 font-medium',
                        meta?.align === 'right' && 'text-right',
                        meta?.align === 'center' && 'text-center',
                      )}
                    >
                      {key !== undefined && sortable ? (
                        <button
                          type="button"
                          className={cn(
                            'inline-flex items-center gap-1 rounded-sm uppercase tracking-wide hover:text-foreground',
                            active && 'text-foreground',
                          )}
                          onClick={() => nextSort(key)}
                        >
                          {content}
                          {active ? (
                            sort?.sortOrder === 'desc' ? (
                              <ArrowDown className="size-3.5" aria-hidden="true" />
                            ) : (
                              <ArrowUp className="size-3.5" aria-hidden="true" />
                            )
                          ) : (
                            <ArrowUpDown className="size-3.5 opacity-60" aria-hidden="true" />
                          )}
                        </button>
                      ) : (
                        content
                      )}
                    </th>
                  );
                })}
              </tr>
            ))}
          </thead>
          <tbody>
            {table.getRowModel().rows.map((row) => (
              <tr
                key={row.id}
                className={cn(
                  'border-b last:border-0 hover:bg-muted/40',
                  rowClassName?.(row.original),
                )}
              >
                {row.getVisibleCells().map((cell) => {
                  const meta = cell.column.columnDef.meta;
                  return (
                    <td
                      key={cell.id}
                      className={cn(
                        'px-(--cell-px) py-(--row-py) align-middle',
                        meta?.align === 'right' && 'tabular text-right',
                        meta?.align === 'center' && 'text-center',
                        meta?.wrap && 'break-id',
                        meta?.className,
                      )}
                    >
                      {flexRender(cell.column.columnDef.cell, cell.getContext())}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <DataTablePagination
        page={data.page}
        pageSize={data.pageSize}
        total={data.total}
        totalPages={data.totalPages}
        shown={data.items.length}
        isFetching={isFetching}
        onPageChange={onPageChange}
        onPageSizeChange={onPageSizeChange}
      />
    </div>
  );
}

/** The right-aligned buttons at the end of a row. Buttons stay visible: no hidden menu to open. */
export function RowActions({ children }: { children: ReactNode }) {
  return <div className="flex flex-wrap justify-end gap-1">{children}</div>;
}

/** The empty header cell above a row-actions column, readable to screen readers. */
export const actionsHeader = (): ReactNode => <span className="sr-only">Actions</span>;
