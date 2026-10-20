import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { GoodsReceipt, GoodsReceiptListResponse } from '@erp/contracts';

type GoodsReceiptSummary = GoodsReceiptListResponse['items'][number];
import { DataTable, RowActions, actionsHeader } from '@/components/data-table/data-table';
import { SimpleTable } from '@/components/data-table/simple-table';
import { ErrorState } from '@/components/error-state';
import { LoadingState } from '@/components/loading-state';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/features/auth/auth-provider';
import { useListParams } from '@/lib/use-list-params';
import { label } from './purchasing-shared';
import { useReceipt, useReceipts } from './use-purchasing';

const DEFAULTS = { pageSize: 10 };

export function ReceiptsTab() {
  const { user } = useAuth();
  const [params, set] = useListParams(DEFAULTS, 'receipts');
  const [openId, setOpenId] = useState<string | null>(null);
  const query = useReceipts({
    page: params.page,
    pageSize: params.pageSize,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
  });
  const showBranch = (user?.branches.length ?? 0) > 1 || (user?.isSuperAdmin ?? false);

  const columns: ColumnDef<GoodsReceiptSummary, unknown>[] = [
    {
      accessorKey: 'grnNo',
      header: 'Receipt',
      meta: { sortKey: 'grnNo', alwaysVisible: true, className: 'font-medium break-id' },
    },
    { id: 'order', header: 'Order', cell: ({ row }) => row.original.poNo ?? '—' },
    {
      id: 'supplier',
      header: 'Supplier',
      meta: { wrap: true },
      cell: ({ row }) => row.original.supplierName ?? '—',
    },
    ...(showBranch ? [{ accessorKey: 'branchCode', header: 'Branch' } as const] : []),
    {
      id: 'received',
      header: 'Received',
      meta: { sortKey: 'receivedAt' },
      cell: ({ row }) => row.original.receivedAt.slice(0, 10),
    },
    { accessorKey: 'receivedByName', header: 'By' },
    { accessorKey: 'lineCount', header: 'Lines', meta: { align: 'right' } },
    {
      accessorKey: 'openDiscrepancies',
      header: 'Waiting for a decision',
      meta: { align: 'right' },
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
            aria-label={`Open ${row.original.grnNo}`}
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
      <DataTable
        label="Goods receipts"
        noun="goods receipts"
        columns={columns}
        query={query}
        getRowId={(row) => row.id}
        filtered={false}
        emptyText="No goods have been received yet."
        onPageChange={set.setPage}
        onPageSizeChange={set.setPageSize}
        sort={{ sortBy: params.sortBy, sortOrder: params.sortOrder }}
        onSortChange={set.setSort}
        columnVisibility
      />
      {openId ? <ReceiptDialog id={openId} onClose={() => setOpenId(null)} /> : null}
    </>
  );
}

function ReceiptDialog({ id, onClose }: { id: string; onClose: () => void }) {
  const query = useReceipt(id);
  const receipt: GoodsReceipt | undefined = query.data;
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="lg">
        <DialogTitle>{receipt ? `Goods receipt ${receipt.grnNo}` : 'Goods receipt'}</DialogTitle>
        <DialogDescription>
          {receipt
            ? `${receipt.poNo ?? 'No order'} · ${receipt.supplierName ?? ''} · ${receipt.branchCode} · received by ${receipt.receivedByName}`
            : 'Loading the receipt'}
        </DialogDescription>
        <div className="mt-4 space-y-3">
          {query.isPending ? <LoadingState label="Loading the receipt…" rows={3} /> : null}
          {query.isError ? (
            <ErrorState onRetry={query.refetch}>Could not load the receipt.</ErrorState>
          ) : null}
          {receipt ? (
            <>
              {receipt.deliveryNoteNo ? (
                <p className="text-sm">Delivery note {receipt.deliveryNoteNo}</p>
              ) : null}
              {receipt.note ? <p className="text-sm">{receipt.note}</p> : null}
              <SimpleTable
                label="Receipt lines"
                rows={receipt.lines}
                getRowKey={(line) => line.id}
                columns={[
                  {
                    header: 'Item',
                    cell: (line) => (
                      <>
                        {line.itemCode} · {line.itemName}
                      </>
                    ),
                  },
                  { header: 'Arrived', align: 'right', cell: (line) => line.qtyReceived },
                  { header: 'Accepted', align: 'right', cell: (line) => line.qtyAccepted },
                  {
                    header: 'Problems',
                    cell: (line) =>
                      line.discrepancies.length === 0
                        ? '—'
                        : line.discrepancies
                            .map(
                              (item) =>
                                `${label(item.type)} ${item.qty} (${item.status === 'OPEN' ? 'waiting' : 'settled'})`,
                            )
                            .join(', '),
                  },
                ]}
              />
            </>
          ) : null}
        </div>
        <div className="mt-6 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
