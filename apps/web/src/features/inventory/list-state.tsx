import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';

interface PagedResult<T> {
  items: T[];
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
}

interface ListStateProps<T> {
  noun: string;
  query: {
    data: PagedResult<T> | undefined;
    error: unknown;
    isPending: boolean;
    isFetching: boolean;
    refetch: () => unknown;
  };
  filtered: boolean;
  emptyText: string;
  onPage: (page: number) => void;
  children: (items: T[]) => ReactNode;
}

/** Loading, error, empty and paging in one place, so every list tells the user the same things. */
export function ListState<T>({
  noun,
  query,
  filtered,
  emptyText,
  onPage,
  children,
}: ListStateProps<T>) {
  const { data, error, isPending, isFetching, refetch } = query;
  if (isPending)
    return (
      <p role="status" className="text-sm text-muted-foreground">
        Loading {noun}…
      </p>
    );
  if (error || !data)
    return (
      <div role="alert" className="flex items-center gap-4 text-destructive">
        <p>Could not load the {noun}.</p>
        <Button variant="secondary" size="sm" onClick={() => void refetch()}>
          Retry
        </Button>
      </div>
    );
  if (data.items.length === 0)
    return (
      <div className="rounded-md border p-6 text-center text-sm text-muted-foreground">
        {filtered ? (
          <p>Nothing matches your search. Clear the search or change the filter.</p>
        ) : (
          <p>{emptyText}</p>
        )}
      </div>
    );
  const first = (data.page - 1) * data.pageSize + 1;
  return (
    <>
      <div className="overflow-x-auto rounded-md border">{children(data.items)}</div>
      <div className="flex items-center justify-between text-sm">
        <p aria-live="polite">
          Showing {first}–{first + data.items.length - 1} of {data.total}
          {isFetching ? ' · updating…' : ''}
        </p>
        <div className="flex items-center gap-2">
          <Button
            variant="secondary"
            size="sm"
            disabled={data.page <= 1}
            onClick={() => onPage(data.page - 1)}
          >
            Previous
          </Button>
          <span>
            Page {data.page} of {data.totalPages}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={data.page >= data.totalPages}
            onClick={() => onPage(data.page + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </>
  );
}

export function Th({ children }: { children: ReactNode }) {
  return (
    <th scope="col" className="px-3 py-2 font-medium">
      {children}
    </th>
  );
}
