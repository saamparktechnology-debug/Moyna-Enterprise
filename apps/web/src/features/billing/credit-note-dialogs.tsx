import { SimpleTable } from '@/components/data-table/simple-table';
import { useState } from 'react';
import type { CreditNote } from '@erp/contracts';
import { Alert } from '@/components/alert';
import { FormField, Input } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/features/auth/auth-provider';
import { describeError } from '../purchasing/purchasing-shared';
import type { Problem } from '../purchasing/purchasing-shared';
import { downloadCreditNotePdf } from './credit-notes-api';
import { useCreditNote, useCreditNoteMutations, useReturnable } from './use-credit-notes';

export const CREDIT_STATUS_TEXT: Record<CreditNote['status'], string> = {
  PENDING: 'Waiting for approval',
  APPROVED: 'Approved',
  REJECTED: 'Rejected',
};

function ProblemAlert({ problem }: { problem: Problem }) {
  return (
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
  );
}

interface RequestDialogProps {
  invoiceId: string;
  invoiceNo: string | null;
  onClose: () => void;
  onRequested: (note: CreditNote) => void;
}

/** Asks for a credit note: how many of each sold line are coming back, and why. */
export function CreditNoteRequestDialog({
  invoiceId,
  invoiceNo,
  onClose,
  onRequested,
}: RequestDialogProps) {
  const returnable = useReturnable(invoiceId);
  const { request } = useCreditNoteMutations();
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const lines = returnable.data ?? [];

  const submit = async () => {
    setProblem(null);
    const chosen = lines.flatMap((line) => {
      const qty = Number(quantities[line.invoiceLineId] ?? '0');
      return qty > 0 ? [{ invoiceLineId: line.invoiceLineId, qty }] : [];
    });
    if (chosen.length === 0) return setFormError('Choose at least one line to credit');
    if (reason.trim().length < 3) return setFormError('Give a reason of at least 3 characters');
    setFormError(null);
    try {
      onRequested(await request.mutateAsync({ invoiceId, reason: reason.trim(), lines: chosen }));
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  return (
    <Dialog open onOpenChange={(next) => (next || request.isPending ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogTitle>Credit note for {invoiceNo ?? 'the invoice'}</DialogTitle>
        <DialogDescription>
          Choose how many of each line are coming back. Returned goods wait in the Returned state
          until someone inspects them.
        </DialogDescription>
        {returnable.isPending ? (
          <p role="status" className="mt-4 text-sm text-muted-foreground">
            Loading the invoice lines…
          </p>
        ) : returnable.isError ? (
          <div role="alert" className="mt-4 flex items-center gap-3 text-destructive">
            <p>Could not load the invoice lines.</p>
            <Button variant="secondary" size="sm" onClick={() => void returnable.refetch()}>
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
            <SimpleTable
              label="Lines to credit"
              rows={lines}
              getRowKey={(line) => line.invoiceLineId}
              className="mt-4"
              columns={[
                {
                  header: 'Item',
                  cell: (line) =>
                    `${line.itemCode} ${line.itemName}${line.serialNo ? ` S/N: ${line.serialNo}` : ''}`,
                },
                { header: 'Sold', align: 'right', cell: (line) => line.soldQty },
                { header: 'Already credited', align: 'right', cell: (line) => line.creditedQty },
                {
                  header: 'To credit',
                  cell: (line) =>
                    line.returnableQty === 0 ? (
                      <span className="text-muted-foreground">Nothing left</span>
                    ) : (
                      <Input
                        aria-label={`Quantity to credit for ${line.itemCode}`}
                        className="w-24"
                        inputMode="numeric"
                        value={quantities[line.invoiceLineId] ?? ''}
                        placeholder={`up to ${line.returnableQty}`}
                        onChange={(event) =>
                          setQuantities({
                            ...quantities,
                            [line.invoiceLineId]: event.target.value,
                          })
                        }
                      />
                    ),
                },
              ]}
            />
            <div className="mt-4 max-w-md">
              <FormField label="Reason" error={formError ?? problem?.fields.reason}>
                {(props) => (
                  <Input
                    {...props}
                    value={reason}
                    onChange={(event) => setReason(event.target.value)}
                  />
                )}
              </FormField>
            </div>
            <div className="mt-6 flex justify-end gap-2">
              <Button
                type="button"
                variant="secondary"
                onClick={onClose}
                disabled={request.isPending}
              >
                Cancel
              </Button>
              <Button type="button" onClick={() => void submit()} disabled={request.isPending}>
                {request.isPending ? 'Sending…' : 'Request credit note'}
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

interface DecisionDialogProps {
  creditNoteId: string;
  onClose: () => void;
  onDecided: (message: string) => void;
}

/** A credit note with its lines and totals, and Approve and Reject while it waits for a decision. */
export function CreditNoteDialog({ creditNoteId, onClose, onDecided }: DecisionDialogProps) {
  const { can } = useAuth();
  const query = useCreditNote(creditNoteId);
  const { approve, reject } = useCreditNoteMutations();
  const [problem, setProblem] = useState<Problem | null>(null);
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const note = query.data;
  const busy = approve.isPending || reject.isPending;

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
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogTitle>
          {note ? (note.creditNoteNo ?? 'Credit note request') : 'Credit note'}
        </DialogTitle>
        <DialogDescription>
          {note
            ? `${CREDIT_STATUS_TEXT[note.status]} · for invoice ${note.invoiceNo ?? ''}`
            : 'Loading the credit note'}
        </DialogDescription>
        {query.isPending ? (
          <p role="status" className="mt-4 text-sm text-muted-foreground">
            Loading the credit note…
          </p>
        ) : query.isError || !note ? (
          <div role="alert" className="mt-4 flex items-center gap-3 text-destructive">
            <p>Could not load the credit note.</p>
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
              <dt className="text-muted-foreground">Customer</dt>
              <dd>{note.customerName}</dd>
              <dt className="text-muted-foreground">Reason</dt>
              <dd>{note.reason}</dd>
              <dt className="text-muted-foreground">Asked by</dt>
              <dd>{note.requestedByName ?? 'Unknown'}</dd>
              {note.decidedByName ? (
                <>
                  <dt className="text-muted-foreground">Decided by</dt>
                  <dd>
                    {note.decidedByName}
                    {note.decisionNote ? ` · ${note.decisionNote}` : ''}
                  </dd>
                </>
              ) : null}
            </dl>
            <SimpleTable
              label="Credit note lines"
              rows={note.lines}
              getRowKey={(line) => line.id}
              className="mt-4"
              columns={[
                {
                  header: 'Item',
                  cell: (line) => (
                    <>
                      {line.itemCode} · {line.itemName}
                      {line.serialNo ? (
                        <span className="block text-xs text-muted-foreground">
                          S/N: {line.serialNo}
                        </span>
                      ) : null}
                    </>
                  ),
                },
                { header: 'Qty', align: 'right', cell: (line) => line.qty },
                { header: 'Taxable', align: 'right', cell: (line) => line.taxableAmount },
                {
                  header: 'Tax',
                  align: 'right',
                  cell: (line) =>
                    (
                      Number(line.cgstAmount) +
                      Number(line.sgstAmount) +
                      Number(line.igstAmount)
                    ).toFixed(2),
                },
                { header: 'Amount', align: 'right', cell: (line) => line.amount },
              ]}
            />
            <p className="mt-3 text-right text-sm font-semibold">Total credited: {note.amount}</p>

            {note.status === 'PENDING' &&
            (can('credit_notes.approve') || can('credit_notes.create')) ? (
              <div className="mt-4 max-w-md">
                <FormField label="Reason for rejecting" error={reasonError ?? undefined}>
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
              <Button
                type="button"
                variant="secondary"
                disabled={busy}
                onClick={() =>
                  void run(async () => {
                    const blob = await downloadCreditNotePdf(note.id);
                    const link = document.createElement('a');
                    link.href = URL.createObjectURL(blob);
                    link.download = `${(note.creditNoteNo ?? 'credit-note-request').replace(/\//g, '-')}.pdf`;
                    link.click();
                  })
                }
              >
                Download PDF
              </Button>
              {note.status === 'PENDING' &&
              (can('credit_notes.approve') || can('credit_notes.create')) ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    if (reason.trim().length < 3)
                      return setReasonError('Give a reason of at least 3 characters');
                    setReasonError(null);
                    void run(async () => {
                      await reject.mutateAsync({
                        id: note.id,
                        values: { rowVersion: note.rowVersion, reason: reason.trim() },
                      });
                      onDecided(
                        `Credit note request for ${note.invoiceNo ?? 'the invoice'} rejected`,
                      );
                    });
                  }}
                >
                  Reject
                </Button>
              ) : null}
              {note.status === 'PENDING' && can('credit_notes.approve') ? (
                <Button
                  type="button"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const approved = await approve.mutateAsync({
                        id: note.id,
                        rowVersion: note.rowVersion,
                      });
                      onDecided(
                        `Credit note ${approved.creditNoteNo ?? ''} approved`.replace('  ', ' '),
                      );
                    })
                  }
                >
                  {approve.isPending ? 'Approving…' : 'Approve'}
                </Button>
              ) : null}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
