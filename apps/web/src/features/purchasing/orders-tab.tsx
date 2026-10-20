import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { PO_STATUSES } from '@erp/contracts';
import type { PurchaseOrder, PurchaseOrderSummary } from '@erp/contracts';
import { DataTable, RowActions, actionsHeader } from '@/components/data-table/data-table';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import { Select } from '@/components/select-field';
import { StatusBadge } from '@/components/status-badge';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-provider';
import { isFiltered, useListParams, useSearchBox } from '@/lib/use-list-params';
import { OrderDetailDialog } from './order-detail-dialog';
import { OrderFormDialog } from './order-form-dialog';
import { ReceiveDialog } from './receive-dialog';
import { STATUS_TEXT } from './purchasing-shared';
import { useOrders } from './use-purchasing';

const DEFAULTS = { pageSize: 10, filters: { status: 'all' } };

type Dialog =
  | { kind: 'new' }
  | { kind: 'edit'; order: PurchaseOrder }
  | { kind: 'view'; orderId: string }
  | { kind: 'receive'; order: PurchaseOrder }
  | null;

export function OrdersTab() {
  const { can, user } = useAuth();
  const [params, set] = useListParams(DEFAULTS, 'orders');
  const [searchText, setSearchText, clearSearchText] = useSearchBox(params, set);
  const [dialog, setDialog] = useState<Dialog>(null);
  const status = params.filters['status'] ?? 'all';
  const query = useOrders({
    page: params.page,
    pageSize: params.pageSize,
    search: params.search,
    status,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
  });
  const showBranch = (user?.branches.length ?? 0) > 1 || (user?.isSuperAdmin ?? false);
  const filtered = isFiltered(params, DEFAULTS);
  const done = (message: string) => {
    toast.success(message);
    setDialog(null);
  };
  const clearFilters = () => {
    clearSearchText();
    set.clear();
  };

  const columns: ColumnDef<PurchaseOrderSummary, unknown>[] = [
    {
      accessorKey: 'poNo',
      header: 'Order',
      meta: { sortKey: 'poNo', alwaysVisible: true, className: 'font-medium break-id' },
    },
    { accessorKey: 'supplierName', header: 'Supplier', meta: { wrap: true } },
    ...(showBranch ? [{ accessorKey: 'branchCode', header: 'Branch' } as const] : []),
    { accessorKey: 'orderDate', header: 'Date', meta: { sortKey: 'orderDate' } },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <StatusBadge status={row.original.status} label={STATUS_TEXT[row.original.status]} />
      ),
    },
    { accessorKey: 'orderedQty', header: 'Ordered', meta: { align: 'right' } },
    { accessorKey: 'remainingQty', header: 'Still to come', meta: { align: 'right' } },
    { accessorKey: 'total', header: 'Total', meta: { align: 'right' } },
    {
      id: 'actions',
      header: actionsHeader,
      enableHiding: false,
      cell: ({ row }) => (
        <RowActions>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Open ${row.original.poNo}`}
            onClick={() => setDialog({ kind: 'view', orderId: row.original.id })}
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
        searchPlaceholder="Order number or supplier"
        chips={
          status !== 'all'
            ? [
                {
                  label: `Status: ${status === 'open' ? 'Open (waiting for goods)' : (STATUS_TEXT[status as keyof typeof STATUS_TEXT] ?? status)}`,
                  onRemove: () => set.setFilter('status', 'all'),
                },
              ]
            : []
        }
        onClearFilters={clearFilters}
        onRefresh={query.refetch}
        refreshing={query.isFetching}
        actions={
          can('purchases.create') ? (
            <Button onClick={() => setDialog({ kind: 'new' })}>New purchase order</Button>
          ) : undefined
        }
      >
        <label className="space-y-1 text-sm font-medium">
          <span>Status</span>
          <Select
            className="w-full sm:w-56"
            value={status}
            onChange={(event) => set.setFilter('status', event.target.value)}
          >
            <option value="all">All orders</option>
            <option value="open">Open (waiting for goods)</option>
            {PO_STATUSES.map((value) => (
              <option key={value} value={value}>
                {STATUS_TEXT[value]}
              </option>
            ))}
          </Select>
        </label>
      </DataTableToolbar>
      <DataTable
        label="Purchase orders"
        noun="purchase orders"
        columns={columns}
        query={query}
        getRowId={(row) => row.id}
        filtered={filtered}
        emptyText="There are no purchase orders yet."
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
        <OrderFormDialog order={null} onClose={() => setDialog(null)} onSaved={done} />
      ) : null}
      {dialog?.kind === 'edit' ? (
        <OrderFormDialog order={dialog.order} onClose={() => setDialog(null)} onSaved={done} />
      ) : null}
      {dialog?.kind === 'view' ? (
        <OrderDetailDialog
          orderId={dialog.orderId}
          onClose={() => setDialog(null)}
          onChanged={done}
          onEdit={(order) => setDialog({ kind: 'edit', order })}
          onReceive={(order) => setDialog({ kind: 'receive', order })}
        />
      ) : null}
      {dialog?.kind === 'receive' ? (
        <ReceiveDialog order={dialog.order} onClose={() => setDialog(null)} onDone={done} />
      ) : null}
    </>
  );
}
