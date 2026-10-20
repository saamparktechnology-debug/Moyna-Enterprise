import { SimpleTable } from '@/components/data-table/simple-table';
import { useState } from 'react';
import { FormField, Input } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/features/auth/auth-provider';
import { describeError } from '../purchasing/purchasing-shared';
import type { Problem } from '../purchasing/purchasing-shared';
import { ProblemAlert } from './payments-shared';
import { usePayment, usePaymentMutations } from './use-payments';

interface Props {
  paymentId: string;
  onClose: () => void;
  onDone: (message: string) => void;
}

/** One payment: what it was, which invoices it settled, and (for those who may) reversing it or applying what is left. */
export function PaymentDetailDialog({ paymentId, onClose, onDone }: Props) {
  const { can } = useAuth();
  const query = usePayment(paymentId);
  const { apply, reverse } = usePaymentMutations();
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const payment = query.data;
  const busy = apply.isPending || reverse.isPending;

  const run = async (action: () => Promise<void>) => {
    setProblem(null);
    try {
      await action();
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  return (
    <Dialog open onOpenChange={(next) => (next || busy ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogTitle>{payment ? `Receipt ${payment.receiptNo}` : 'Payment'}</DialogTitle>
        <DialogDescription>
          {payment
            ? `${payment.status === 'REVERSED' ? 'Reversed' : 'Active'} · ${payment.customerName}`
            : 'Loading the payment'}
        </DialogDescription>
        {query.isPending ? (
          <p role="status" className="mt-4 text-sm text-muted-foreground">
            Loading the payment…
          </p>
        ) : query.isError || !payment ? (
          <div role="alert" className="mt-4 flex items-center gap-3 text-destructive">
            <p>Could not load the payment.</p>
            <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
              Retry
            </Button>
          </div>
        ) : (
          <>
            {problem ? (
              <div className="mt-3">
                <ProblemAlert problem={problem} />
              </div>
            ) : null}
            <dl className="mt-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <dt className="text-muted-foreground">Amount</dt>
              <dd>
                {payment.amount} · {payment.modeName}
              </dd>
              <dt className="text-muted-foreground">Date received</dt>
              <dd>{payment.paidOn}</dd>
              <dt className="text-muted-foreground">Branch</dt>
              <dd>{payment.branchCode}</dd>
              <dt className="text-muted-foreground">Reference</dt>
              <dd>{payment.reference ?? '—'}</dd>
              <dt className="text-muted-foreground">Recorded by</dt>
              <dd>{payment.createdByName ?? 'Unknown'}</dd>
              {payment.note ? (
                <>
                  <dt className="text-muted-foreground">Note</dt>
                  <dd>{payment.note}</dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">Applied to invoices</dt>
              <dd>{payment.allocated}</dd>
              <dt className="text-muted-foreground">Held as credit</dt>
              <dd>{payment.unallocated}</dd>
              {payment.reversal ? (
                <>
                  <dt className="text-muted-foreground">Reversed</dt>
                  <dd>
                    {payment.reversal.reversedOn}
                    {payment.reversal.reversedByName
                      ? ` by ${payment.reversal.reversedByName}`
                      : ''}
                    {` · ${payment.reversal.reason}`}
                  </dd>
                </>
              ) : null}
            </dl>

            {payment.allocations.length > 0 ? (
              <SimpleTable
                label="Invoices settled"
                rows={payment.allocations}
                getRowKey={(row) => row.invoiceId}
                className="mt-4"
                columns={[
                  { header: 'Invoice', className: 'break-id', cell: (row) => row.invoiceNo ?? '—' },
                  { header: 'Amount', align: 'right', cell: (row) => row.amount },
                ]}
              />
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">
                This payment is not applied to any invoice.
              </p>
            )}

            {payment.status === 'ACTIVE' && can('payments.reverse') ? (
              <div className="mt-4 max-w-md">
                <FormField label="Reason for reversing" error={reasonError ?? undefined}>
                  {(props) => (
                    <Input
                      {...props}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  )}
                </FormField>
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
                Close
              </Button>
              {payment.status === 'ACTIVE' && can('payments.reverse') ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    if (reason.trim().length < 3)
                      return setReasonError('Give a reason of at least 3 characters');
                    setReasonError(null);
                    void run(async () => {
                      await reverse.mutateAsync({
                        id: payment.id,
                        values: { reason: reason.trim() },
                      });
                      onDone(`Receipt ${payment.receiptNo} reversed`);
                    });
                  }}
                >
                  {reverse.isPending ? 'Reversing…' : 'Reverse payment'}
                </Button>
              ) : null}
              {payment.status === 'ACTIVE' &&
              Number(payment.unallocated) > 0 &&
              can('payments.create') ? (
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await apply.mutateAsync({
                        id: payment.id,
                        values: { allocateAutomatically: true },
                      });
                      onDone(
                        `The rest of receipt ${payment.receiptNo} was applied to the oldest dues`,
                      );
                    })
                  }
                >
                  {apply.isPending ? 'Applying…' : 'Apply the rest to the oldest dues'}
                </Button>
              ) : null}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
