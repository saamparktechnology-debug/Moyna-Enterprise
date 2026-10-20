import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { Branch } from '@erp/contracts';
import { Can } from '@/components/can';
import { DataTable, RowActions, actionsHeader } from '@/components/data-table/data-table';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { Select } from '@/components/select-field';
import { StatusBadge } from '@/components/status-badge';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { isFiltered, useListParams, useSearchBox } from '@/lib/use-list-params';
import { BranchFormDialog } from './branch-form-dialog';
import { BranchStatusDialog } from './branch-status-dialog';
import { useBranches } from './use-branches';
import type { BranchListParams } from './branches-api';

const DEFAULTS = { pageSize: 10, filters: { status: 'active' } };
const STATUS_LABEL: Record<string, string> = { inactive: 'Inactive branches', all: 'All branches' };

type FormTarget = { kind: 'create' } | { kind: 'edit'; branch: Branch } | null;

export function BranchesPage() {
  const [params, set] = useListParams(DEFAULTS);
  const [searchText, setSearchText, clearSearchText] = useSearchBox(params, set);
  const [formTarget, setFormTarget] = useState<FormTarget>(null);
  const [statusTarget, setStatusTarget] = useState<Branch | null>(null);
  const status = params.filters['status'] as BranchListParams['status'];
  const query = useBranches({
    page: params.page,
    pageSize: params.pageSize,
    search: params.search,
    status,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
  });
  const filtered = isFiltered(params, DEFAULTS);

  const done = (message: string) => {
    toast.success(message);
    setFormTarget(null);
    setStatusTarget(null);
  };
  const clearFilters = () => {
    clearSearchText();
    set.clear();
  };

  const columns: ColumnDef<Branch, unknown>[] = [
    {
      accessorKey: 'code',
      header: 'Code',
      meta: { sortKey: 'code', alwaysVisible: true, className: 'font-medium' },
    },
    { accessorKey: 'name', header: 'Name', meta: { sortKey: 'name' } },
    { accessorKey: 'stateName', header: 'State' },
    {
      id: 'gstin',
      header: 'GSTIN',
      cell: ({ row }) => row.original.gstin ?? '—',
      meta: { className: 'font-mono text-xs' },
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <StatusBadge
          status={row.original.isActive ? 'ACTIVE' : 'INACTIVE'}
          label={row.original.isActive ? 'Active' : 'Inactive'}
        />
      ),
    },
    {
      id: 'actions',
      header: actionsHeader,
      enableHiding: false,
      cell: ({ row }) => (
        <Can permission="branches.manage">
          <RowActions>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Edit ${row.original.code}`}
              onClick={() => setFormTarget({ kind: 'edit', branch: row.original })}
            >
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`${row.original.isActive ? 'Deactivate' : 'Reactivate'} ${row.original.code}`}
              onClick={() => setStatusTarget(row.original)}
            >
              {row.original.isActive ? 'Deactivate' : 'Reactivate'}
            </Button>
          </RowActions>
        </Can>
      ),
    },
  ];

  const chips = [
    ...(status !== 'active'
      ? [
          {
            label: `Show: ${STATUS_LABEL[status] ?? status}`,
            onRemove: () => set.setFilter('status', 'active'),
          },
        ]
      : []),
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Branches"
        description="Each branch has its own stock, invoices and document numbers."
        actions={
          <Can permission="branches.manage">
            <Button onClick={() => setFormTarget({ kind: 'create' })}>New branch</Button>
          </Can>
        }
      />
      <DataTableToolbar
        search={searchText}
        onSearchChange={setSearchText}
        searchPlaceholder="Code or name"
        chips={chips}
        onClearFilters={clearFilters}
        onRefresh={query.refetch}
        refreshing={query.isFetching}
      >
        <label className="space-y-1 text-sm font-medium">
          <span>Show</span>
          <Select
            className="w-full sm:w-48"
            value={status}
            onChange={(event) => set.setFilter('status', event.target.value)}
          >
            <option value="active">Active branches</option>
            <option value="inactive">Inactive branches</option>
            <option value="all">All branches</option>
          </Select>
        </label>
      </DataTableToolbar>

      <DataTable
        label="Branches"
        noun="branches"
        columns={columns}
        query={query}
        getRowId={(branch) => branch.id}
        filtered={filtered}
        emptyText="There are no branches yet."
        filteredEmptyText="No branches match your search. Clear the search or change the filter."
        emptyAction={
          filtered ? (
            <Button variant="outline" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : undefined
        }
        onPageChange={set.setPage}
        onPageSizeChange={set.setPageSize}
        sort={{ sortBy: params.sortBy, sortOrder: params.sortOrder }}
        onSortChange={set.setSort}
        columnVisibility
      />

      {formTarget ? (
        <BranchFormDialog
          key={formTarget.kind === 'edit' ? formTarget.branch.id : 'new'}
          branch={formTarget.kind === 'edit' ? formTarget.branch : null}
          open
          onClose={() => setFormTarget(null)}
          onSaved={done}
        />
      ) : null}
      <BranchStatusDialog
        branch={statusTarget}
        onClose={() => setStatusTarget(null)}
        onDone={done}
      />
    </PageContainer>
  );
}
