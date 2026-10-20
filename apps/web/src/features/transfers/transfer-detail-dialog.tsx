import { SimpleTable } from '@/components/data-table/simple-table';
import { useState } from 'react';
import type { Transfer } from '@erp/contracts';
import { RECEIVABLE_STATUSES } from '@erp/contracts';
import { Alert } from '@/components/alert';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/features/auth/auth-provider';
import { describeError } from '../purchasing/purchasing-shared';
import type { Problem } from '../purchasing/purchasing-shared';
import { TRANSFER_STATUS_TEXT, useWorksIn } from './transfers-shared';
import { useTransfer, useTransferMutations } from './use-transfers';

interface TransferDetailDialogProps {
  transferId: string;
  onClose: () => void;
  onChanged: (message: string) => void;
  onDispatch: (transfer: Transfer) => void;
  onReceive: (transfer: Transfer) => void;
}

type Asking = 'reject' | 'cancel' | null;

export function TransferDetailDialog({
  transferId,
  onClose,
  onChanged,
  onDispatch,
  onReceive,
}: TransferDetailDialogProps) {
  const { can } = useAuth();
  const worksIn = useWorksIn();
  const query = useTransfer(transferId);
  const { approve, reject, cancel } = useTransferMutations();
  const [asking, setAsking] = useState<Asking>(null);
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  const transfer = query.data;
  const busy = approve.isPending || reject.isPending || cancel.isPending;

  const run = async (action: () => Promise<unknown>, message: string) => {
    setProblem(null);
    try {
      await action();
      onChanged(message);
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  const sender = transfer ? worksIn(transfer.fromBranchId) : false;
  const receiver = transfer ? worksIn(transfer.toBranchId) : false;
  const openProblems =
    transfer?.lines.reduce(
      (sum, line) => sum + line.discrepancies.filter((entry) => entry.status === 'OPEN').length,
      0,
    ) ?? 0;

  return (
    <Dialog open onOpenChange={(next) => (next || busy ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogTitle>{transfer ? `Transfer ${transfer.transferNo}` : 'Transfer'}</DialogTitle>
        <DialogDescription>
          {transfer
            ? `${transfer.fromBranchCode} · ${transfer.fromBranchName} to ${transfer.toBranchCode} · ${transfer.toBranchName} · ${TRANSFER_STATUS_TEXT[transfer.status]}`
            : 'Loading the transfer'}
        </DialogDescription>
        {query.isPending ? (
          <p role="status" className="mt-4 text-sm text-muted-foreground">
            Loading the transfer…
          </p>
        ) : null}
        {query.isError ? (
          <div role="alert" className="mt-4 flex items-center gap-3 text-destructive">
            <p>Could not load the transfer.</p>
            <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
              Retry
            </Button>
          </div>
        ) : null}
        {problem ? (
          <div className="mt-4">
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
          </div>
        ) : null}
        {transfer ? (
          <div className="mt-4 space-y-4">
            <SimpleTable
              label="Transfer lines"
              rows={transfer.lines}
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
                {
                  header: 'Serial number',
                  className: 'break-id',
                  cell: (line) => line.serialNo ?? '—',
                },
                { header: 'Asked for', align: 'right', cell: (line) => line.qtyRequested },
                { header: 'Sent', align: 'right', cell: (line) => line.qtySent },
                { header: 'Arrived', align: 'right', cell: (line) => line.qtyReceived },
                { header: 'Damaged', align: 'right', cell: (line) => line.qtyDamaged },
                {
                  header: 'Problems',
                  cell: (line) =>
                    line.discrepancies.length === 0
                      ? '—'
                      : line.discrepancies
                          .map(
                            (entry) =>
                              `${entry.type.toLowerCase().replaceAll('_', ' ')} ${entry.qty} (${entry.status === 'OPEN' ? 'waiting' : 'settled'})`,
                          )
                          .join(', '),
                },
              ]}
            />
            {openProblems > 0 ? (
              <Alert tone="info">
                {openProblems} problem{openProblems === 1 ? ' waits' : 's wait'} for a decision.
                Settle {openProblems === 1 ? 'it' : 'them'} under Purchasing, Discrepancies.
              </Alert>
            ) : null}
            <section aria-label="History">
              <h2 className="text-sm font-medium">History</h2>
              <ol className="mt-1 space-y-1 text-sm">
                {transfer.events.map((event) => (
                  <li key={event.id}>
                    {TRANSFER_STATUS_TEXT[event.status]} · {event.userName} ·{' '}
                    {event.at.slice(0, 10)}
                    {event.note ? ` · ${event.note}` : ''}
                  </li>
                ))}
              </ol>
            </section>
            {asking ? (
              <form
                aria-label={asking === 'reject' ? 'Reject this transfer' : 'Cancel this transfer'}
                className="space-y-2"
                onSubmit={(event) => {
                  event.preventDefault();
                  const trimmed = note.trim();
                  if (asking === 'reject')
                    void run(
                      () =>
                        reject.mutateAsync({
                          id: transfer.id,
                          values: { rowVersion: transfer.rowVersion, note: trimmed },
                        }),
                      `Transfer ${transfer.transferNo} rejected`,
                    );
                  else
                    void run(
                      () =>
                        cancel.mutateAsync({
                          id: transfer.id,
                          values: {
                            rowVersion: transfer.rowVersion,
                            ...(trimmed ? { note: trimmed } : {}),
                          },
                        }),
                      `Transfer ${transfer.transferNo} cancelled`,
                    );
                }}
              >
                <label className="block space-y-1 text-sm font-medium">
                  <span>
                    {asking === 'reject' ? 'Reason for rejecting' : 'Reason for cancelling'}
                  </span>
                  <Input
                    autoComplete="off"
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                </label>
                {problem?.fields.note ? (
                  <p role="alert" className="text-sm text-destructive">
                    {problem.fields.note}
                  </p>
                ) : null}
                <div className="flex justify-end gap-2">
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => setAsking(null)}
                  >
                    Go back
                  </Button>
                  <Button type="submit" disabled={busy}>
                    {asking === 'reject' ? 'Reject the transfer' : 'Cancel the transfer'}
                  </Button>
                </div>
              </form>
            ) : (
              <div className="flex flex-wrap justify-end gap-2">
                {transfer.status === 'REQUESTED' && sender && can('transfers.approve') ? (
                  <>
                    <Button
                      disabled={busy}
                      onClick={() =>
                        void run(
                          () =>
                            approve.mutateAsync({
                              id: transfer.id,
                              rowVersion: transfer.rowVersion,
                            }),
                          `Transfer ${transfer.transferNo} approved`,
                        )
                      }
                    >
                      {approve.isPending ? 'Approving…' : 'Approve'}
                    </Button>
                    <Button variant="secondary" onClick={() => setAsking('reject')}>
                      Reject
                    </Button>
                  </>
                ) : null}
                {transfer.status === 'APPROVED' && sender && can('transfers.dispatch') ? (
                  <Button onClick={() => onDispatch(transfer)}>Dispatch</Button>
                ) : null}
                {RECEIVABLE_STATUSES.includes(transfer.status) &&
                receiver &&
                can('transfers.receive') ? (
                  <Button onClick={() => onReceive(transfer)}>Receive goods</Button>
                ) : null}
                {(transfer.status === 'REQUESTED' || transfer.status === 'APPROVED') &&
                (sender || receiver) &&
                can('transfers.request') ? (
                  <Button variant="secondary" onClick={() => setAsking('cancel')}>
                    Cancel transfer
                  </Button>
                ) : null}
                <Button variant="secondary" onClick={onClose}>
                  Close
                </Button>
              </div>
            )}
          </div>
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
