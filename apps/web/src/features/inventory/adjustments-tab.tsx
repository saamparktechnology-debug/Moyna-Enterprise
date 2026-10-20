import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { StockAdjustment } from '@erp/contracts';
import { DataTable, RowActions, actionsHeader } from '@/components/data-table/data-table';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import { Select } from '@/components/select-field';
import { StatusBadge } from '@/components/status-badge';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-provider';
import { isFiltered, useListParams } from '@/lib/use-list-params';
import { AdjustmentDecisionDialog, describeAdjustment } from './adjustment-decision-dialog';
import type { Decision } from './adjustment-decision-dialog';
import { AdjustmentFormDialog } from './adjustment-form-dialog';
import { useAdjustments } from './use-inventory';

const DEFAULTS = { pageSize: 10, filters: { status: 'PENDING' } };
const STATUS_LABELS: Record<string, string> = {
  PENDING: 'Waiting for approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
  CANCELLED: 'Cancelled',
};

export function AdjustmentsTab() {
  const { user, can } = useAuth();
  const [params, set] = useListParams(DEFAULTS, 'adj');
  const [creating, setCreating] = useState(false);
  const [deciding, setDeciding] = useState<{
    adjustment: StockAdjustment;
    decision: Decision;
  } | null>(null);
  const status = params.filters['status'] ?? 'PENDING';
  const query = useAdjustments({
    page: params.page,
    pageSize: params.pageSize,
    status,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
  });
  const showBranch = (user?.branches.length ?? 0) > 1 || (user?.isSuperAdmin ?? false);
  const filtered = isFiltered(params, DEFAULTS);
  const done = (message: string) => {
    toast.success(message);
    setCreating(false);
    setDeciding(null);
  };

  const decide = (adjustment: StockAdjustment, decision: Decision) =>
    setDeciding({ adjustment, decision });

  const columns: ColumnDef<StockAdjustment, unknown>[] = [
    {
      id: 'requested',
      header: 'Requested',
      meta: { sortKey: 'createdAt', alwaysVisible: true, className: 'whitespace-nowrap' },
      cell: ({ row }) => new Date(row.original.createdAt).toLocaleDateString(),
    },
    ...(showBranch ? [{ accessorKey: 'branchCode', header: 'Branch' } as const] : []),
    {
      id: 'adjustment',
      header: 'Adjustment',
      meta: { wrap: true },
      cell: ({ row }) => describeAdjustment(row.original),
    },
    { accessorKey: 'reason', header: 'Reason', meta: { wrap: true } },
    { accessorKey: 'requestedByName', header: 'By' },
    {
      id: 'status',
      header: 'Status',
      meta: { sortKey: 'status' },
      cell: ({ row }) => (
        <>
          <StatusBadge
            status={row.original.status}
            label={STATUS_LABELS[row.original.status] ?? row.original.status}
          />
          {row.original.decisionNote ? (
            <span className="mt-1 block text-xs text-muted-foreground">
              {row.original.decisionNote}
            </span>
          ) : null}
        </>
      ),
    },
    {
      id: 'actions',
      header: actionsHeader,
      enableHiding: false,
      cell: ({ row }) => {
        const adjustment = row.original;
        if (adjustment.status !== 'PENDING') return null;
        const name = describeAdjustment(adjustment);
        return (
          <RowActions>
            {can('stock.adjust_approve') ? (
              <>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Approve ${name}`}
                  onClick={() => decide(adjustment, 'approve')}
                >
                  Approve
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Reject ${name}`}
                  onClick={() => decide(adjustment, 'reject')}
                >
                  Reject
                </Button>
              </>
            ) : null}
            {adjustment.requestedById === user?.id && can('stock.adjust') ? (
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Cancel ${name}`}
                onClick={() => decide(adjustment, 'cancel')}
              >
                Cancel
              </Button>
            ) : null}
          </RowActions>
        );
      },
    },
  ];

  return (
    <>
      <DataTableToolbar
        chips={
          status !== 'PENDING'
            ? [
                {
                  label: `Show: ${status === 'all' ? 'All requests' : (STATUS_LABELS[status] ?? status)}`,
                  onRemove: () => set.setFilter('status', 'PENDING'),
                },
              ]
            : []
        }
        onClearFilters={set.clear}
        onRefresh={query.refetch}
        refreshing={query.isFetching}
        actions={
          can('stock.adjust') ? (
            <Button onClick={() => setCreating(true)}>Request adjustment</Button>
          ) : undefined
        }
      >
        <label className="space-y-1 text-sm font-medium">
          <span>Show</span>
          <Select
            className="w-full sm:w-52"
            value={status}
            onChange={(event) => set.setFilter('status', event.target.value)}
          >
            <option value="PENDING">Waiting for approval</option>
            <option value="all">All requests</option>
            <option value="APPROVED">Approved</option>
            <option value="REJECTED">Rejected</option>
            <option value="CANCELLED">Cancelled</option>
          </Select>
        </label>
      </DataTableToolbar>
      <DataTable
        label="Adjustments"
        noun="adjustments"
        columns={columns}
        query={query}
        getRowId={(row) => row.id}
        filtered={filtered}
        emptyText="No adjustments are waiting for approval."
        onPageChange={set.setPage}
        onPageSizeChange={set.setPageSize}
        sort={{ sortBy: params.sortBy, sortOrder: params.sortOrder }}
        onSortChange={set.setSort}
        columnVisibility
      />
      {creating ? <AdjustmentFormDialog onClose={() => setCreating(false)} onSaved={done} /> : null}
      {deciding ? (
        <AdjustmentDecisionDialog
          adjustment={deciding.adjustment}
          decision={deciding.decision}
          onClose={() => setDeciding(null)}
          onDone={done}
        />
      ) : null}
    </>
  );
}
