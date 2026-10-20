import { RefreshCw, Search, X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export interface FilterChip {
  /** For example "Status: Inactive". */
  label: string;
  onRemove: () => void;
}

interface DataTableToolbarProps {
  /** The search box. Omit `onSearchChange` for a list that has no search. */
  search?: string;
  onSearchChange?: ((value: string) => void) | undefined;
  searchLabel?: string;
  searchPlaceholder?: string;
  /** The screen's own filter controls (selects, date ranges). */
  children?: ReactNode;
  /** One chip per active filter, each with its own remove button. */
  chips?: readonly FilterChip[];
  onClearFilters?: (() => void) | undefined;
  /** Refresh the list from the server. */
  onRefresh?: (() => unknown) | undefined;
  refreshing?: boolean;
  /** Column visibility, export and other controls that sit at the right. */
  actions?: ReactNode;
  className?: string;
}

/** Search, filters, active-filter chips and refresh in one predictable row above a table. */
export function DataTableToolbar({
  search,
  onSearchChange,
  searchLabel = 'Search',
  searchPlaceholder,
  children,
  chips = [],
  onClearFilters,
  onRefresh,
  refreshing = false,
  actions,
  className,
}: DataTableToolbarProps) {
  return (
    <div className={cn('space-y-3', className)}>
      <div className="flex flex-wrap items-end gap-3">
        {onSearchChange ? (
          <label className="space-y-1 text-sm font-medium">
            <span>{searchLabel}</span>
            <span className="relative block">
              <Search
                className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
                aria-hidden="true"
              />
              <Input
                type="search"
                className="w-full pl-8 sm:w-64"
                placeholder={searchPlaceholder}
                value={search ?? ''}
                onChange={(event) => onSearchChange(event.target.value)}
              />
            </span>
          </label>
        ) : null}
        {children}
        <div className="ml-auto flex items-center gap-2">
          {actions}
          {onRefresh ? (
            <Button
              variant="outline"
              size="sm"
              onClick={() => void onRefresh()}
              disabled={refreshing}
              aria-label="Refresh list"
            >
              <RefreshCw className={cn(refreshing && 'animate-spin')} aria-hidden="true" />
              Refresh
            </Button>
          ) : null}
        </div>
      </div>
      {chips.length > 0 ? (
        <div className="flex flex-wrap items-center gap-2" aria-label="Active filters" role="group">
          {chips.map((chip) => (
            <span
              key={chip.label}
              className="inline-flex items-center gap-1 rounded-full border bg-secondary py-0.5 pl-2.5 pr-1 text-xs font-medium"
            >
              {chip.label}
              <button
                type="button"
                className="rounded-full p-0.5 hover:bg-accent"
                aria-label={`Remove filter ${chip.label}`}
                onClick={chip.onRemove}
              >
                <X className="size-3" aria-hidden="true" />
              </button>
            </span>
          ))}
          {onClearFilters ? (
            <Button variant="link" size="sm" onClick={onClearFilters}>
              Clear filters
            </Button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
