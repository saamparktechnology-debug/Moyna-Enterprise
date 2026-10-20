import { Button } from '@/components/ui/button';
import { Select } from '@/components/select-field';

export const PAGE_SIZE_OPTIONS = [10, 25, 50, 100] as const;

interface DataTablePaginationProps {
  page: number;
  pageSize: number;
  total: number;
  totalPages: number;
  shown: number;
  isFetching: boolean;
  onPageChange: (page: number) => void;
  /** When given, a page-size selector is shown. */
  onPageSizeChange?: ((pageSize: number) => void) | undefined;
  pageSizeOptions?: readonly number[];
}

/** "Showing 1–10 of 42", Previous / Next, and (optionally) the page size. Paging is the server's. */
export function DataTablePagination({
  page,
  pageSize,
  total,
  totalPages,
  shown,
  isFetching,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = PAGE_SIZE_OPTIONS,
}: DataTablePaginationProps) {
  const first = (page - 1) * pageSize + 1;
  const options = pageSizeOptions.includes(pageSize)
    ? pageSizeOptions
    : [...pageSizeOptions, pageSize].sort((a, b) => a - b);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 text-sm">
      <p aria-live="polite" className="tabular text-muted-foreground">
        Showing {first}–{first + shown - 1} of {total}
        {isFetching ? ' · updating…' : ''}
      </p>
      <div className="flex flex-wrap items-center gap-3">
        {onPageSizeChange ? (
          <label className="flex items-center gap-2 text-muted-foreground">
            <span>Rows per page</span>
            <Select
              className="h-control-sm w-20"
              value={pageSize}
              onChange={(event) => onPageSizeChange(Number(event.target.value))}
            >
              {options.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </Select>
          </label>
        ) : null}
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            Previous
          </Button>
          <span className="tabular">
            Page {page} of {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= totalPages}
            onClick={() => onPageChange(page + 1)}
          >
            Next
          </Button>
        </div>
      </div>
    </div>
  );
}
