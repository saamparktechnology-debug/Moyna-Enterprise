import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export interface SimpleColumn<T> {
  /** Column heading. Use a visually hidden element for an actions column. */
  header: ReactNode;
  cell: (row: T) => ReactNode;
  align?: 'left' | 'right' | 'center';
  className?: string;
}

interface SimpleTableProps<T> {
  /** The table's accessible name. */
  label: string;
  columns: readonly SimpleColumn<T>[];
  rows: readonly T[];
  getRowKey: (row: T, index: number) => string;
  /** Shown instead of the table when there are no rows. */
  emptyText?: string;
  /** Rows to emphasise, for example a total or a problem line. */
  rowClassName?: ((row: T) => string | undefined) | undefined;
  className?: string;
}

/**
 * A plain table for lines that are already on the page (invoice lines, receipt lines, a ledger
 * excerpt). It has the look of `DataTable` but no paging, sorting or column menu: use `DataTable`
 * for anything the server pages.
 */
export function SimpleTable<T>({
  label,
  columns,
  rows,
  getRowKey,
  emptyText,
  rowClassName,
  className,
}: SimpleTableProps<T>) {
  if (rows.length === 0 && emptyText)
    return (
      <p className="rounded-lg border p-4 text-center text-sm text-muted-foreground">{emptyText}</p>
    );
  return (
    <div
      role="region"
      aria-label={`${label}, scrollable`}
      tabIndex={0}
      className={cn('relative overflow-x-auto rounded-lg border bg-card', className)}
    >
      <table aria-label={label} className="w-full text-left text-sm">
        <thead className="border-b bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
          <tr>
            {columns.map((column, index) => (
              <th
                key={index}
                scope="col"
                className={cn(
                  'px-(--cell-px) py-2.5 font-medium',
                  column.align === 'right' && 'text-right',
                  column.align === 'center' && 'text-center',
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row, rowIndex) => (
            <tr
              key={getRowKey(row, rowIndex)}
              className={cn('border-b last:border-0', rowClassName?.(row))}
            >
              {columns.map((column, index) => (
                <td
                  key={index}
                  className={cn(
                    'px-(--cell-px) py-(--row-py) align-middle',
                    column.align === 'right' && 'tabular text-right',
                    column.align === 'center' && 'text-center',
                    column.className,
                  )}
                >
                  {column.cell(row)}
                </td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
