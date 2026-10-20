import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { ColumnDef } from '@tanstack/react-table';
import { DataTable, RowActions, actionsHeader } from './data-table';
import type { PagedQuery } from './data-table';
import { DataTableToolbar } from './data-table-toolbar';

interface Row {
  id: string;
  code: string;
  name: string;
  amount: string;
}
const ROWS: Row[] = [
  { id: '1', code: 'KOL', name: 'Kolkata', amount: '1,200.00' },
  { id: '2', code: 'MUM', name: 'Mumbai', amount: '900.00' },
];
const columns: ColumnDef<Row, unknown>[] = [
  { accessorKey: 'code', header: 'Code', meta: { sortKey: 'code', alwaysVisible: true } },
  { accessorKey: 'name', header: 'Name', meta: { sortKey: 'name' } },
  { accessorKey: 'amount', header: 'Amount', meta: { align: 'right' } },
  {
    id: 'actions',
    header: actionsHeader,
    enableHiding: false,
    cell: ({ row }) => (
      <RowActions>
        <button type="button">Edit {row.original.code}</button>
      </RowActions>
    ),
  },
];
const page = (items: Row[], over: Partial<PagedQuery<Row>['data'] & object> = {}) => ({
  items,
  page: 1,
  pageSize: 10,
  total: items.length,
  totalPages: items.length === 0 ? 0 : 1,
  ...over,
});
const ok = (items: Row[] = ROWS, over = {}): PagedQuery<Row> => ({
  data: page(items, over),
  error: null,
  isPending: false,
  isFetching: false,
  refetch: vi.fn(),
});

const base = {
  label: 'Branches',
  noun: 'branches',
  columns,
  filtered: false,
  emptyText: 'There are no branches yet.',
  onPageChange: vi.fn(),
};

describe('DataTable states', () => {
  it('announces loading and shows placeholder rows', () => {
    render(<DataTable {...base} query={{ ...ok(), data: undefined, isPending: true }} />);
    expect(screen.getByRole('status')).toHaveTextContent('Loading branches…');
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
  });

  it('shows an alert with a working Retry when the request fails', async () => {
    const refetch = vi.fn();
    render(
      <DataTable {...base} query={{ ...ok(), data: undefined, error: new Error('x'), refetch }} />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Could not load the branches.');
    await userEvent.click(screen.getByRole('button', { name: 'Retry' }));
    expect(refetch).toHaveBeenCalledOnce();
  });

  it('explains an empty list, and says "nothing matches" when a filter is active', () => {
    const { rerender } = render(<DataTable {...base} query={ok([])} />);
    expect(screen.getByText('There are no branches yet.')).toBeInTheDocument();
    rerender(<DataTable {...base} filtered query={ok([])} emptyAction={<button>Clear</button>} />);
    expect(screen.getByText(/Nothing matches your search/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Clear' })).toBeInTheDocument();
  });

  it('draws the rows with labelled columns and a named table', () => {
    render(<DataTable {...base} query={ok()} />);
    const table = screen.getByRole('table', { name: 'Branches' });
    expect(
      within(table)
        .getAllByRole('columnheader')
        .map((cell) => cell.textContent),
    ).toEqual(['Code', 'Name', 'Amount', 'Actions']);
    expect(within(table).getByRole('cell', { name: 'Kolkata' })).toBeInTheDocument();
    expect(within(table).getByRole('button', { name: 'Edit MUM' })).toBeInTheDocument();
  });

  it('puts the scrolling region in the tab order so a keyboard can reach wide tables', () => {
    render(<DataTable {...base} query={ok()} />);
    expect(screen.getByRole('region', { name: 'Branches, scrollable' })).toHaveAttribute(
      'tabindex',
      '0',
    );
  });
});

describe('DataTable paging and sorting', () => {
  it('reports the page the person asked for and disables Previous on page 1', async () => {
    const onPageChange = vi.fn();
    render(
      <DataTable
        {...base}
        onPageChange={onPageChange}
        query={ok(ROWS, { total: 25, totalPages: 3 })}
      />,
    );
    expect(screen.getByText('Showing 1–2 of 25')).toBeInTheDocument();
    expect(screen.getByText('Page 1 of 3')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Next' }));
    expect(onPageChange).toHaveBeenCalledWith(2);
  });

  it('offers a page-size choice only when asked, and reports it', async () => {
    const onPageSizeChange = vi.fn();
    const { rerender } = render(<DataTable {...base} query={ok()} />);
    expect(screen.queryByLabelText('Rows per page')).not.toBeInTheDocument();
    rerender(<DataTable {...base} query={ok()} onPageSizeChange={onPageSizeChange} />);
    await userEvent.selectOptions(screen.getByLabelText('Rows per page'), '50');
    expect(onPageSizeChange).toHaveBeenCalledWith(50);
  });

  it('cycles ascending, descending, then back to the server default, with aria-sort', async () => {
    const onSortChange = vi.fn();
    const { rerender } = render(
      <DataTable
        {...base}
        query={ok()}
        sort={{ sortBy: undefined, sortOrder: 'asc' }}
        onSortChange={onSortChange}
      />,
    );
    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveAttribute('aria-sort', 'none');
    await userEvent.click(screen.getByRole('button', { name: 'Name' }));
    expect(onSortChange).toHaveBeenLastCalledWith('name', 'asc');

    rerender(
      <DataTable
        {...base}
        query={ok()}
        sort={{ sortBy: 'name', sortOrder: 'asc' }}
        onSortChange={onSortChange}
      />,
    );
    expect(screen.getByRole('columnheader', { name: 'Name' })).toHaveAttribute(
      'aria-sort',
      'ascending',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Name' }));
    expect(onSortChange).toHaveBeenLastCalledWith('name', 'desc');

    rerender(
      <DataTable
        {...base}
        query={ok()}
        sort={{ sortBy: 'name', sortOrder: 'desc' }}
        onSortChange={onSortChange}
      />,
    );
    await userEvent.click(screen.getByRole('button', { name: 'Name' }));
    expect(onSortChange).toHaveBeenLastCalledWith(undefined, 'asc');
  });

  it('gives no sort button to a column without a sort key', () => {
    render(
      <DataTable
        {...base}
        query={ok()}
        sort={{ sortBy: undefined, sortOrder: 'asc' }}
        onSortChange={vi.fn()}
      />,
    );
    expect(screen.queryByRole('button', { name: 'Amount' })).not.toBeInTheDocument();
  });
});

describe('DataTable column visibility', () => {
  it('hides and shows a column from the Columns menu, but never an always-visible one', async () => {
    render(<DataTable {...base} query={ok()} columnVisibility />);
    expect(screen.getByRole('columnheader', { name: 'Amount' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Columns' }));
    expect(screen.getByRole('menuitemcheckbox', { name: 'Name' })).toBeChecked();
    expect(screen.queryByRole('menuitemcheckbox', { name: 'Actions' })).not.toBeInTheDocument();
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Amount' }));
    // An open menu hides the page from assistive technology, so close it before looking.
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('columnheader', { name: 'Amount' })).not.toBeInTheDocument();
    expect(screen.queryByRole('cell', { name: '900.00' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Columns' }));
    expect(screen.getByRole('menuitemcheckbox', { name: 'Amount' })).not.toBeChecked();
    await userEvent.click(screen.getByRole('menuitemcheckbox', { name: 'Amount' }));
    await userEvent.keyboard('{Escape}');
    expect(screen.getByRole('columnheader', { name: 'Amount' })).toBeInTheDocument();
    expect(screen.getByRole('cell', { name: '900.00' })).toBeInTheDocument();
  });
});

describe('DataTableToolbar', () => {
  it('reports typed search, removes one chip, and clears all filters', async () => {
    const onSearchChange = vi.fn();
    const onRemove = vi.fn();
    const onClear = vi.fn();
    render(
      <DataTableToolbar
        search=""
        onSearchChange={onSearchChange}
        chips={[{ label: 'Status: Inactive', onRemove }]}
        onClearFilters={onClear}
      />,
    );
    await userEvent.type(screen.getByRole('searchbox', { name: 'Search' }), 'k');
    expect(onSearchChange).toHaveBeenCalledWith('k');
    await userEvent.click(screen.getByRole('button', { name: 'Remove filter Status: Inactive' }));
    expect(onRemove).toHaveBeenCalledOnce();
    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(onClear).toHaveBeenCalledOnce();
  });

  it('refreshes on request and disables the button while refreshing', async () => {
    const onRefresh = vi.fn();
    const { rerender } = render(<DataTableToolbar onRefresh={onRefresh} />);
    await userEvent.click(screen.getByRole('button', { name: 'Refresh list' }));
    expect(onRefresh).toHaveBeenCalledOnce();
    rerender(<DataTableToolbar onRefresh={onRefresh} refreshing />);
    expect(screen.getByRole('button', { name: 'Refresh list' })).toBeDisabled();
  });

  it('shows no chip row when nothing is filtered', () => {
    render(<DataTableToolbar onSearchChange={vi.fn()} />);
    expect(screen.queryByRole('group', { name: 'Active filters' })).not.toBeInTheDocument();
  });
});
