import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { QUOTATION_STATUSES } from '@erp/contracts';
import type { Quotation, QuotationStatusName, QuotationSummary } from '@erp/contracts';
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
import { QuotationDetailDialog } from './quotation-detail-dialog';
import { QuotationFormDialog } from './quotation-form-dialog';
import { BUILD_STAGE_TEXT, QUOTATION_STATUS_TEXT } from './quotations-shared';
import { useQuotations } from './use-quotations';

const DEFAULTS = { pageSize: 10, filters: { status: 'open', custom: '' } };

type Dialogs =
  { kind: 'form'; quotation: Quotation | undefined } | { kind: 'detail'; id: string } | null;

export function QuotationsPage() {
  const [params, set] = useListParams(DEFAULTS);
  const [searchText, setSearchText, clearSearchText] = useSearchBox(params, set);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const status = params.filters['status'] ?? 'open';
  const customOnly = params.filters['custom'] === '1';
  const query = useQuotations({
    page: params.page,
    pageSize: params.pageSize,
    search: params.search,
    status,
    customOnly,
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

  const columns: ColumnDef<QuotationSummary, unknown>[] = [
    {
      accessorKey: 'quotationNo',
      header: 'Quotation',
      meta: { sortKey: 'quotationNo', alwaysVisible: true, className: 'font-medium break-id' },
    },
    { accessorKey: 'customerName', header: 'Customer', meta: { wrap: true } },
    { accessorKey: 'validUntil', header: 'Valid until', meta: { sortKey: 'validUntil' } },
    {
      accessorKey: 'total',
      header: 'Total',
      meta: { sortKey: 'total', align: 'right', className: 'tabular' },
    },
    {
      accessorKey: 'advancePaid',
      header: 'Advance paid',
      meta: { align: 'right', className: 'tabular' },
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <>
          <StatusBadge
            status={row.original.status}
            label={QUOTATION_STATUS_TEXT[row.original.status]}
          />
          {row.original.isCustomBuild ? (
            <span className="mt-1 block text-xs text-muted-foreground">
              Build: {BUILD_STAGE_TEXT[row.original.buildStage]}
            </span>
          ) : null}
        </>
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
            aria-label={`Open quotation ${row.original.quotationNo}`}
            onClick={() => setDialog({ kind: 'detail', id: row.original.id })}
          >
            Open
          </Button>
        </RowActions>
      ),
    },
  ];

  const chips = [
    ...(status !== 'open'
      ? [
          {
            label: `Status: ${status === 'all' ? 'All' : (QUOTATION_STATUS_TEXT[status as QuotationStatusName] ?? status)}`,
            onRemove: () => set.setFilter('status', 'open'),
          },
        ]
      : []),
    ...(customOnly
      ? [{ label: 'Only customized builds', onRemove: () => set.setFilter('custom', '') }]
      : []),
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Quotations"
        description="Priced offers to customers, including customized TOTO builds and their advances."
        actions={
          <Can permission="quotations.manage">
            <Button onClick={() => setDialog({ kind: 'form', quotation: undefined })}>
              New quotation
            </Button>
          </Can>
        }
      />

      <DataTableToolbar
        search={searchText}
        onSearchChange={setSearchText}
        searchLabel="Search quotations"
        searchPlaceholder="Number or customer"
        chips={chips}
        onClearFilters={clearFilters}
        onRefresh={query.refetch}
        refreshing={query.isFetching}
      >
        <label className="space-y-1 text-sm font-medium">
          <span>Quotation status</span>
          <Select
            className="w-full sm:w-44"
            value={status}
            onChange={(event) => set.setFilter('status', event.target.value)}
          >
            <option value="open">Still open</option>
            <option value="all">All</option>
            {QUOTATION_STATUSES.map((value) => (
              <option key={value} value={value}>
                {QUOTATION_STATUS_TEXT[value]}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex min-h-control items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={customOnly}
            onChange={(event) => set.setFilter('custom', event.target.checked ? '1' : '')}
          />
          Only customized builds
        </label>
      </DataTableToolbar>

      <DataTable
        label="Quotations"
        noun="quotations"
        columns={columns}
        query={query}
        getRowId={(row) => row.id}
        filtered={filtered}
        emptyText="There are no quotations yet."
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

      {dialog?.kind === 'form' ? (
        <QuotationFormDialog
          quotation={dialog.quotation}
          onClose={() => setDialog(null)}
          onSaved={done}
        />
      ) : null}
      {dialog?.kind === 'detail' ? (
        <QuotationDetailDialog
          key={dialog.id}
          quotationId={dialog.id}
          onClose={() => setDialog(null)}
          onEdit={(quotation) => setDialog({ kind: 'form', quotation })}
          onDone={done}
        />
      ) : null}
    </PageContainer>
  );
}
