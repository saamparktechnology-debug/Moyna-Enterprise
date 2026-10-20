import type { ColumnDef, RowData } from '@tanstack/react-table';

declare module '@tanstack/react-table' {
  // The type parameters are required by the library's declaration; they are not used here.
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  interface ColumnMeta<TData extends RowData, TValue> {
    /** Right-align numbers, quantities and currency. */
    align?: 'left' | 'right' | 'center';
    /** Extra classes for the cell, for example a minimum width. */
    className?: string;
    /** The server's name for this column when sorting, if sorting is supported. */
    sortKey?: string;
    /** The column cannot be hidden from the Columns menu. */
    alwaysVisible?: boolean;
    /** Wrap long values instead of keeping them on one line. */
    wrap?: boolean;
  }
}

export function columnLabel<T>(def: ColumnDef<T, unknown>): string {
  return typeof def.header === 'string' ? def.header : (def.id ?? '');
}
