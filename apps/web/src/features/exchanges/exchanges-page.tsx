import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { EXCHANGE_KINDS, EXCHANGE_STATUSES } from '@erp/contracts';
import type { ExchangeKindName, ExchangeStatusName, ExchangeSummary } from '@erp/contracts';
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
import { ExchangeDetailDialog } from './exchange-detail-dialog';
import { ExchangeRequestDialog } from './exchange-request-dialog';
import { KIND_TEXT, STATUS_TEXT, settlementText } from './exchanges-shared';
import { useExchanges } from './use-exchanges';

const DEFAULTS = { pageSize: 10, filters: { status: '', kind: '' } };

type Dialogs = { kind: 'request' } | { kind: 'detail'; id: string } | null;

export function ExchangesPage() {
  const [params, set] = useListParams(DEFAULTS);
  const [searchText, setSearchText, clearSearchText] = useSearchBox(params, set);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const status = params.filters['status'] ?? '';
  const kind = params.filters['kind'] ?? '';
  const query = useExchanges({
    page: params.page,
    pageSize: params.pageSize,
    search: params.search,
    status,
    kind,
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

  const columns: ColumnDef<ExchangeSummary, unknown>[] = [
    {
      id: 'exchangeNo',
      header: 'Exchange',
      meta: { sortKey: 'exchangeNo', alwaysVisible: true, className: 'font-medium break-id' },
      cell: ({ row }) => (
        <>
          {row.original.exchangeNo}
          <span className="block text-xs font-normal text-muted-foreground">
            {KIND_TEXT[row.original.kind]}
          </span>
        </>
      ),
    },
    { accessorKey: 'customerName', header: 'Customer', meta: { wrap: true } },
    { accessorKey: 'oldSerialNo', header: 'Old vehicle', meta: { className: 'break-id' } },
    { accessorKey: 'newSerialNo', header: 'New vehicle', meta: { className: 'break-id' } },
    {
      id: 'difference',
      header: 'Difference',
      meta: { sortKey: 'differenceAmount', align: 'right', className: 'tabular' },
      cell: ({ row }) => (
        <>
          {row.original.differenceAmount}
          <span className="block text-xs text-muted-foreground">
            {settlementText(row.original.differenceAmount)}
          </span>
        </>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <StatusBadge status={row.original.status} label={STATUS_TEXT[row.original.status]} />
      ),
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
            aria-label={`Open exchange ${row.original.exchangeNo}`}
            onClick={() => setDialog({ kind: 'detail', id: row.original.id })}
          >
            Open
          </Button>
        </RowActions>
      ),
    },
  ];

  const chips = [
    ...(status !== ''
      ? [
          {
            label: `Status: ${STATUS_TEXT[status as ExchangeStatusName] ?? status}`,
            onRemove: () => set.setFilter('status', ''),
          },
        ]
      : []),
    ...(kind !== ''
      ? [
          {
            label: `Kind: ${KIND_TEXT[kind as ExchangeKindName] ?? kind}`,
            onRemove: () => set.setFilter('kind', ''),
          },
        ]
      : []),
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Exchanges"
        description="Old-for-new and new-for-new vehicle exchanges, with their approval status."
        actions={
          <Can permission="exchanges.request">
            <Button onClick={() => setDialog({ kind: 'request' })}>New exchange</Button>
          </Can>
        }
      />

      <DataTableToolbar
        search={searchText}
        onSearchChange={setSearchText}
        searchLabel="Search exchanges"
        searchPlaceholder="Number, customer or serial number"
        chips={chips}
        onClearFilters={clearFilters}
        onRefresh={query.refetch}
        refreshing={query.isFetching}
      >
        <label className="space-y-1 text-sm font-medium">
          <span>Exchange status</span>
          <Select
            className="w-full sm:w-44"
            value={status}
            onChange={(event) => set.setFilter('status', event.target.value)}
          >
            <option value="">All</option>
            {EXCHANGE_STATUSES.map((value) => (
              <option key={value} value={value}>
                {STATUS_TEXT[value]}
              </option>
            ))}
          </Select>
        </label>
        <label className="space-y-1 text-sm font-medium">
          <span>Kind of exchange</span>
          <Select
            className="w-full sm:w-48"
            value={kind}
            onChange={(event) => set.setFilter('kind', event.target.value)}
          >
            <option value="">All</option>
            {EXCHANGE_KINDS.map((value) => (
              <option key={value} value={value}>
                {KIND_TEXT[value]}
              </option>
            ))}
          </Select>
        </label>
      </DataTableToolbar>

      <DataTable
        label="Exchanges"
        noun="exchanges"
        columns={columns}
        query={query}
        getRowId={(row) => row.id}
        filtered={filtered}
        emptyText="No exchange has been asked for yet."
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

      {dialog?.kind === 'request' ? (
        <ExchangeRequestDialog onClose={() => setDialog(null)} onRequested={done} />
      ) : null}
      {dialog?.kind === 'detail' ? (
        <ExchangeDetailDialog
          key={dialog.id}
          exchangeId={dialog.id}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      ) : null}
    </PageContainer>
  );
}
