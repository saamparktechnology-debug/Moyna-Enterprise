import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { TRANSFER_STATUSES } from '@erp/contracts';
import type { Transfer, TransferStatus, TransferSummary } from '@erp/contracts';
import { DataTable, RowActions, actionsHeader } from '@/components/data-table/data-table';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { Select } from '@/components/select-field';
import { StatusBadge } from '@/components/status-badge';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-provider';
import { isFiltered, useListParams, useSearchBox } from '@/lib/use-list-params';
import { TransferDetailDialog } from './transfer-detail-dialog';
import { TransferDispatchDialog } from './transfer-dispatch-dialog';
import { TransferFormDialog } from './transfer-form-dialog';
import { TransferReceiveDialog } from './transfer-receive-dialog';
import { TRANSFER_STATUS_TEXT } from './transfers-shared';
import { useTransfers } from './use-transfers';

const DEFAULTS = { pageSize: 10, filters: { status: 'all', direction: 'all' } };
const DIRECTION_TEXT: Record<string, string> = {
  incoming: 'Coming to my branches',
  outgoing: 'Going from my branches',
};

type Dialog =
  | { kind: 'new' }
  | { kind: 'view'; id: string }
  | { kind: 'dispatch'; transfer: Transfer }
  | { kind: 'receive'; transfer: Transfer }
  | null;

export function TransfersPage() {
  const { can } = useAuth();
  const [params, set] = useListParams(DEFAULTS);
  const [searchText, setSearchText, clearSearchText] = useSearchBox(params, set);
  const [dialog, setDialog] = useState<Dialog>(null);
  const status = params.filters['status'] ?? 'all';
  const direction = params.filters['direction'] ?? 'all';
  const query = useTransfers({
    page: params.page,
    pageSize: params.pageSize,
    search: params.search,
    status,
    direction,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
  });
  const filtered = isFiltered(params, DEFAULTS);
  const done = (message: string) => {
    toast.success(message);
    setDialog(null);
  };
  const clearFilters = () => {
    clearSearchText();
    set.clear();
  };

  const columns: ColumnDef<TransferSummary, unknown>[] = [
    {
      accessorKey: 'transferNo',
      header: 'Transfer',
      meta: { sortKey: 'transferNo', alwaysVisible: true, className: 'font-medium break-id' },
    },
    { accessorKey: 'fromBranchCode', header: 'From' },
    { accessorKey: 'toBranchCode', header: 'To' },
    {
      id: 'status',
      header: 'Status',
      meta: { sortKey: 'status' },
      cell: ({ row }) => (
        <StatusBadge
          status={row.original.status}
          label={TRANSFER_STATUS_TEXT[row.original.status]}
        />
      ),
    },
    { accessorKey: 'itemCount', header: 'Items', meta: { align: 'right', className: 'tabular' } },
    { accessorKey: 'unitCount', header: 'Units', meta: { align: 'right', className: 'tabular' } },
    {
      accessorKey: 'openDiscrepancies',
      header: 'Waiting for a decision',
      meta: { align: 'right', className: 'tabular' },
    },
    { accessorKey: 'requestedByName', header: 'Asked by', meta: { wrap: true } },
    {
      id: 'date',
      header: 'Date',
      meta: { sortKey: 'createdAt' },
      cell: ({ row }) => row.original.createdAt.slice(0, 10),
    },
    {
      id: 'actions',
      header: actionsHeader,
      enableHiding: false,
      cell: ({ row }) => (
        <RowActions>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Open ${row.original.transferNo}`}
            onClick={() => setDialog({ kind: 'view', id: row.original.id })}
          >
            Open
          </Button>
        </RowActions>
      ),
    },
  ];

  const chips = [
    ...(status !== 'all'
      ? [
          {
            label: `Status: ${TRANSFER_STATUS_TEXT[status as TransferStatus] ?? status}`,
            onRemove: () => set.setFilter('status', 'all'),
          },
        ]
      : []),
    ...(direction !== 'all'
      ? [
          {
            label: `Direction: ${DIRECTION_TEXT[direction] ?? direction}`,
            onRemove: () => set.setFilter('direction', 'all'),
          },
        ]
      : []),
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Transfers"
        description="Stock moving between branches, from request to receipt."
        actions={
          can('transfers.request') ? (
            <Button onClick={() => setDialog({ kind: 'new' })}>Ask for stock</Button>
          ) : undefined
        }
      />
      <DataTableToolbar
        search={searchText}
        onSearchChange={setSearchText}
        searchPlaceholder="Transfer number"
        chips={chips}
        onClearFilters={clearFilters}
        onRefresh={query.refetch}
        refreshing={query.isFetching}
      >
        <label className="space-y-1 text-sm font-medium">
          <span>Status</span>
          <Select
            className="w-full sm:w-44"
            value={status}
            onChange={(event) => set.setFilter('status', event.target.value)}
          >
            <option value="all">All statuses</option>
            {TRANSFER_STATUSES.map((value) => (
              <option key={value} value={value}>
                {TRANSFER_STATUS_TEXT[value]}
              </option>
            ))}
          </Select>
        </label>
        <label className="space-y-1 text-sm font-medium">
          <span>Direction</span>
          <Select
            className="w-full sm:w-56"
            value={direction}
            onChange={(event) => set.setFilter('direction', event.target.value)}
          >
            <option value="all">All transfers</option>
            <option value="incoming">Coming to my branches</option>
            <option value="outgoing">Going from my branches</option>
          </Select>
        </label>
      </DataTableToolbar>
      <DataTable
        label="Transfers"
        noun="transfers"
        columns={columns}
        query={query}
        getRowId={(row) => row.id}
        filtered={filtered}
        emptyText="There are no transfers yet."
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
      {dialog?.kind === 'new' ? (
        <TransferFormDialog onClose={() => setDialog(null)} onSaved={done} />
      ) : null}
      {dialog?.kind === 'view' ? (
        <TransferDetailDialog
          transferId={dialog.id}
          onClose={() => setDialog(null)}
          onChanged={done}
          onDispatch={(transfer) => setDialog({ kind: 'dispatch', transfer })}
          onReceive={(transfer) => setDialog({ kind: 'receive', transfer })}
        />
      ) : null}
      {dialog?.kind === 'dispatch' ? (
        <TransferDispatchDialog
          transfer={dialog.transfer}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      ) : null}
      {dialog?.kind === 'receive' ? (
        <TransferReceiveDialog
          transfer={dialog.transfer}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      ) : null}
    </PageContainer>
  );
}
