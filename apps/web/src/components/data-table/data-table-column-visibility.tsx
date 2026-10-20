import { Columns3 } from 'lucide-react';
import type { Table } from '@tanstack/react-table';
import { Button } from '@/components/ui/button';
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuLabel,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { columnLabel } from './column-meta';

interface DataTableColumnVisibilityProps<T> {
  table: Table<T>;
}

/** Lets a person hide columns they do not need. Columns marked `alwaysVisible` are not offered. */
export function DataTableColumnVisibility<T>({ table }: DataTableColumnVisibilityProps<T>) {
  const columns = table.getAllLeafColumns().filter((column) => column.getCanHide());
  if (columns.length === 0) return null;
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" size="sm">
          <Columns3 aria-hidden="true" />
          Columns
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>Show columns</DropdownMenuLabel>
        {columns.map((column) => (
          <DropdownMenuCheckboxItem
            key={column.id}
            checked={column.getIsVisible()}
            onCheckedChange={(visible) => column.toggleVisibility(visible)}
            onSelect={(event) => event.preventDefault()}
          >
            {columnLabel(column.columnDef)}
          </DropdownMenuCheckboxItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
