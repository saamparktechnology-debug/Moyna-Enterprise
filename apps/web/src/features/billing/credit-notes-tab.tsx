import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { CREDIT_NOTE_STATUSES } from '@erp/contracts';
import type { CreditNoteSummary } from '@erp/contracts';
import { DataTable, RowActions, actionsHeader } from '@/components/data-table/data-table';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import { Select } from '@/components/select-field';
import { StatusBadge } from '@/components/status-badge';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { isFiltered, useListParams, useSearchBox } from '@/lib/use-list-params';
import { CREDIT_STATUS_TEXT, CreditNoteDialog } from './credit-note-dialogs';
import { useCreditNotes } from './use-credit-notes';

const DEFAULTS = { pageSize: 10, filters: { status: '' } };

export function CreditNotesTab() {
  const [params, set] = useListParams(DEFAULTS, 'cn');
  const [searchText, setSearchText, clearSearchText] = useSearchBox(params, set);
  const [openId, setOpenId] = useState<string | null>(null);
  const status = params.filters['status'] ?? '';
  const query = useCreditNotes({
    page: params.page,
    pageSize: params.pageSize,
    search: params.search,
    status,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
  });
  const filtered = isFiltered(params, DEFAULTS);
  const clearFilters = () => {
    clearSearchText();
    set.clear();
  };

  const columns: ColumnDef<CreditNoteSummary, unknown>[] = [
    {
      id: 'creditNoteNo',
      header: 'Credit note',
      meta: { sortKey: 'creditNoteNo', alwaysVisible: true, className: 'font-medium break-id' },
      cell: ({ row }) => row.original.creditNoteNo ?? 'Not numbered',
    },
    {
      id: 'invoice',
      header: 'Invoice',
      meta: { className: 'break-id' },
      cell: ({ row }) => row.original.invoiceNo ?? '—',
    },
    { accessorKey: 'customerName', header: 'Customer', meta: { wrap: true } },
    {
      accessorKey: 'amount',
      header: 'Amount',
      meta: { sortKey: 'amount', align: 'right', className: 'tabular' },
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <StatusBadge status={row.original.status} label={CREDIT_STATUS_TEXT[row.original.status]} />
      ),
    },
    { id: 'askedBy', header: 'Asked by', cell: ({ row }) => row.original.requestedByName ?? '—' },
    {
      id: 'actions',
      header: actionsHeader,
      enableHiding: false,
      cell: ({ row }) => (
        <RowActions>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Open credit note ${row.original.creditNoteNo ?? `for ${row.original.customerName}`}`}
            onClick={() => setOpenId(row.original.id)}
          >
            Open
          </Button>
        </RowActions>
      ),
    },
  ];

  return (
    <>
      <DataTableToolbar
        search={searchText}
        onSearchChange={setSearchText}
        searchLabel="Search credit notes"
        searchPlaceholder="Number, invoice or customer"
        chips={
          status !== ''
            ? [
                {
                  label: `Status: ${CREDIT_STATUS_TEXT[status as keyof typeof CREDIT_STATUS_TEXT] ?? status}`,
                  onRemove: () => set.setFilter('status', ''),
                },
              ]
            : []
        }
        onClearFilters={clearFilters}
        onRefresh={query.refetch}
        refreshing={query.isFetching}
      >
        <label className="space-y-1 text-sm font-medium">
          <span>Credit note status</span>
          <Select
            className="w-full sm:w-48"
            value={status}
            onChange={(event) => set.setFilter('status', event.target.value)}
          >
            <option value="">All</option>
            {CREDIT_NOTE_STATUSES.map((value) => (
              <option key={value} value={value}>
                {CREDIT_STATUS_TEXT[value]}
              </option>
            ))}
          </Select>
        </label>
      </DataTableToolbar>
      <DataTable
        label="Credit notes"
        noun="credit notes"
        columns={columns}
        query={query}
        getRowId={(row) => row.id}
        filtered={filtered}
        emptyText="There are no credit notes yet."
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
      {openId ? (
        <CreditNoteDialog
          key={openId}
          creditNoteId={openId}
          onClose={() => setOpenId(null)}
          onDecided={(message) => {
            toast.success(message);
            setOpenId(null);
          }}
        />
      ) : null}
    </>
  );
}
