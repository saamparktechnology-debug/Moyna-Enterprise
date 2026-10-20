import { useState } from 'react';
import type { PurchaseOrder } from '@erp/contracts';
import { Alert } from '@/components/alert';
import { SimpleTable } from '@/components/data-table/simple-table';
import { ErrorState } from '@/components/error-state';
import { FormField, Input } from '@/components/form-field';
import { LoadingState } from '@/components/loading-state';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { useAuth } from '@/features/auth/auth-provider';
import { STATUS_TEXT, describeError } from './purchasing-shared';
import type { Problem } from './purchasing-shared';
import { useOrder, usePurchasingMutations } from './use-purchasing';

interface OrderDetailDialogProps {
  orderId: string;
  onClose: () => void;
  onChanged: (message: string) => void;
  onEdit: (order: PurchaseOrder) => void;
  onReceive: (order: PurchaseOrder) => void;
}

export function OrderDetailDialog({
  orderId,
  onClose,
  onChanged,
  onEdit,
  onReceive,
}: OrderDetailDialogProps) {
  const { can } = useAuth();
  const query = useOrder(orderId);
  const { approve, cancel } = usePurchasingMutations();
  const [cancelling, setCancelling] = useState(false);
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  const order = query.data;
  const busy = approve.isPending || cancel.isPending;

  const run = async (action: () => Promise<unknown>, message: string) => {
    setProblem(null);
    try {
      await action();
      onChanged(message);
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  return (
    <Dialog open onOpenChange={(next) => (next || busy ? undefined : onClose())}>
      <DialogContent size="lg">
        <DialogTitle>{order ? `Purchase order ${order.poNo}` : 'Purchase order'}</DialogTitle>
        <DialogDescription>
          {order
            ? `${order.supplierName} · ${order.branchCode} · ${order.orderDate} · ${STATUS_TEXT[order.status]}`
            : 'Loading the order'}
        </DialogDescription>
        <div className="mt-4 space-y-4">
          {query.isPending ? <LoadingState label="Loading the order…" rows={3} /> : null}
          {query.isError ? (
            <ErrorState onRetry={query.refetch}>Could not load the order.</ErrorState>
          ) : null}
          {problem ? (
            <Alert tone="error">
              <p>{problem.message}</p>
              {problem.reasons.length > 0 ? (
                <ul className="mt-1 list-disc pl-5">
                  {problem.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              ) : null}
            </Alert>
          ) : null}
          {order ? (
            <>
              <SimpleTable
                label="Order lines"
                rows={order.lines}
                getRowKey={(line) => line.id}
                columns={[
                  {
                    header: 'Item',
                    cell: (line) => (
                      <>
                        {line.itemCode} · {line.itemName}
                        {line.isSerialized ? ' (serial numbers)' : ''}
                      </>
                    ),
                  },
                  { header: 'Ordered', align: 'right', cell: (line) => line.qtyOrdered },
                  { header: 'Accepted', align: 'right', cell: (line) => line.accepted },
                  { header: 'Closed', align: 'right', cell: (line) => line.closed },
                  { header: 'Still to come', align: 'right', cell: (line) => line.remaining },
                  { header: 'Unit cost', align: 'right', cell: (line) => line.unitCost },
                  { header: 'Line total', align: 'right', cell: (line) => line.lineTotal },
                ]}
              />
              <p className="tabular text-sm font-medium">
                Total {order.total} · {order.receiptCount} goods receipt
                {order.receiptCount === 1 ? '' : 's'}
              </p>
              {cancelling ? (
                <form
                  aria-label="Cancel this order"
                  className="space-y-4 rounded-lg border bg-muted/40 p-4"
                  onSubmit={(event) => {
                    event.preventDefault();
                    void run(
                      () =>
                        cancel.mutateAsync({
                          id: order.id,
                          values: { rowVersion: order.rowVersion, reason: reason.trim() },
                        }),
                      `Purchase order ${order.poNo} cancelled`,
                    );
                  }}
                >
                  <FormField label="Reason for cancelling" error={problem?.fields.reason}>
                    {(props) => (
                      <Input
                        {...props}
                        autoComplete="off"
                        value={reason}
                        onChange={(event) => setReason(event.target.value)}
                      />
                    )}
                  </FormField>
                  <DialogFooter className="mt-0">
                    <Button
                      type="button"
                      variant="secondary"
                      onClick={() => setCancelling(false)}
                      disabled={busy}
                    >
                      Keep the order
                    </Button>
                    <Button type="submit" variant="destructive" disabled={busy}>
                      {cancel.isPending ? 'Cancelling…' : 'Cancel the order'}
                    </Button>
                  </DialogFooter>
                </form>
              ) : (
                <DialogFooter className="mt-0">
                  <Button variant="secondary" onClick={onClose}>
                    Close
                  </Button>
                  {(order.status === 'DRAFT' || order.status === 'APPROVED') &&
                  can('purchases.approve') ? (
                    <Button variant="secondary" onClick={() => setCancelling(true)}>
                      Cancel order
                    </Button>
                  ) : null}
                  {order.status === 'DRAFT' && can('purchases.create') ? (
                    <Button variant="secondary" onClick={() => onEdit(order)}>
                      Edit
                    </Button>
                  ) : null}
                  {order.status === 'DRAFT' && can('purchases.approve') ? (
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () => approve.mutateAsync({ id: order.id, rowVersion: order.rowVersion }),
                          `Purchase order ${order.poNo} approved`,
                        )
                      }
                    >
                      {approve.isPending ? 'Approving…' : 'Approve'}
                    </Button>
                  ) : null}
                  {(order.status === 'APPROVED' || order.status === 'PARTIALLY_RECEIVED') &&
                  can('purchases.receive') ? (
                    <Button onClick={() => onReceive(order)}>Receive goods</Button>
                  ) : null}
                </DialogFooter>
              )}
            </>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  );
}
