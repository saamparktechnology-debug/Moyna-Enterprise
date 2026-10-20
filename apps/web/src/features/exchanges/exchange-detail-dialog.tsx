import { useState } from 'react';
import type { ExchangeUnit } from '@erp/contracts';
import { FormField, Input } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/features/auth/auth-provider';
import { formatWhen } from '../leads/leads-shared';
import { ProblemAlert } from '../payments/payments-shared';
import { describeError } from '../purchasing/purchasing-shared';
import type { Problem } from '../purchasing/purchasing-shared';
import { DISPOSITION_TEXT, KIND_TEXT, STATUS_TEXT, settlementText } from './exchanges-shared';
import { useExchange, useExchangeMutations } from './use-exchanges';

interface Props {
  exchangeId: string;
  onClose: () => void;
  onDone: (message: string) => void;
}

function UnitCard({ title, unit }: { title: string; unit: ExchangeUnit }) {
  return (
    <section aria-label={title} className="rounded-md border p-3 text-sm">
      <h3 className="font-semibold">{title}</h3>
      <p>
        {unit.serialNo} · {unit.itemCode}
      </p>
      <p className="text-muted-foreground">
        Chassis {unit.chassisNo ?? '—'} · Motor {unit.motorNo ?? '—'}
      </p>
      <p className="text-muted-foreground">Now {unit.state.toLowerCase().replace('_', ' ')}</p>
      {unit.batteries.length > 0 ? (
        <p className="text-muted-foreground">
          Batteries: {unit.batteries.map((b) => b.serialNo).join(', ')}
        </p>
      ) : null}
    </section>
  );
}

/** One exchange: the two vehicles, the money, and for those who may, approving, rejecting or withdrawing it. */
export function ExchangeDetailDialog({ exchangeId, onClose, onDone }: Props) {
  const { can } = useAuth();
  const query = useExchange(exchangeId);
  const exchange = query.data;
  const { approve, reject, cancel } = useExchangeMutations();
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const busy = approve.isPending || reject.isPending || cancel.isPending;

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
        <DialogTitle>{exchange ? `Exchange ${exchange.exchangeNo}` : 'Exchange'}</DialogTitle>
        <DialogDescription>
          {exchange
            ? `${STATUS_TEXT[exchange.status]} · ${exchange.customerName}`
            : 'Loading the exchange'}
        </DialogDescription>
        {query.isPending ? (
          <p role="status" className="mt-4 text-sm text-muted-foreground">
            Loading the exchange…
          </p>
        ) : query.isError || !exchange ? (
          <div role="alert" className="mt-4 flex items-center gap-3 text-destructive">
            <p>Could not load the exchange.</p>
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
              <dt className="text-muted-foreground">Kind</dt>
              <dd>{KIND_TEXT[exchange.kind]}</dd>
              <dt className="text-muted-foreground">Delivery invoice</dt>
              <dd>{exchange.invoiceNo ?? '—'}</dd>
              <dt className="text-muted-foreground">Old vehicle sold on</dt>
              <dd>{exchange.originalInvoiceNo ?? '—'}</dd>
              <dt className="text-muted-foreground">Reason</dt>
              <dd>{exchange.reason}</dd>
              <dt className="text-muted-foreground">Asked by</dt>
              <dd>{exchange.createdByName ?? 'Unknown'}</dd>
              <dt className="text-muted-foreground">Old vehicle</dt>
              <dd>{DISPOSITION_TEXT[exchange.disposition]}</dd>
            </dl>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <UnitCard title="Old vehicle taken back" unit={exchange.oldUnit} />
              <UnitCard title="New vehicle" unit={exchange.newUnit} />
            </div>
            <section aria-label="The money" className="mt-4 rounded-md border p-3 text-sm">
              <p>Customer paid for the old vehicle: {exchange.returnedAmount}</p>
              <p>Valued at: {exchange.valuationAmount}</p>
              <p>New vehicle: {exchange.newAmount}</p>
              <p className="font-medium">
                {settlementText(exchange.differenceAmount)}
                {Number(exchange.differenceAmount) !== 0 ? ` (${exchange.differenceAmount})` : ''}
              </p>
              {exchange.tradeInPayment ? (
                <p className="mt-1 text-muted-foreground">
                  Receipt {exchange.tradeInPayment.receiptNo}: {exchange.tradeInPayment.amount} paid
                  in, of which {exchange.tradeInPayment.appliedToInvoice} went against the delivery
                  invoice.
                </p>
              ) : null}
            </section>
            {exchange.decidedAt ? (
              <p className="mt-3 text-sm text-muted-foreground">
                {STATUS_TEXT[exchange.status]} by {exchange.decidedByName ?? 'someone'} on{' '}
                {formatWhen(exchange.decidedAt)}
                {exchange.decisionNote ? ` · ${exchange.decisionNote}` : ''}
              </p>
            ) : null}

            {exchange.status === 'PENDING' && can('exchanges.approve') ? (
              <div className="mt-4 max-w-md">
                <FormField
                  label="Note"
                  error={noteError ?? undefined}
                  hint="Optional when approving. Needed to reject"
                >
                  {(props) => (
                    <Input
                      {...props}
                      value={note}
                      onChange={(event) => setNote(event.target.value)}
                    />
                  )}
                </FormField>
              </div>
            ) : null}

            <div className="mt-6 flex flex-wrap justify-end gap-2">
              <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
                Close
              </Button>
              {exchange.status === 'PENDING' && can('exchanges.request') ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      await cancel.mutateAsync({
                        id: exchange.id,
                        values: { rowVersion: exchange.rowVersion },
                      });
                      onDone(`Exchange ${exchange.exchangeNo} withdrawn`);
                    })
                  }
                >
                  Withdraw request
                </Button>
              ) : null}
              {exchange.status === 'PENDING' && can('exchanges.approve') ? (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      if (note.trim().length < 3) {
                        setNoteError('Give a reason of at least 3 characters');
                        return;
                      }
                      setNoteError(null);
                      void run(async () => {
                        await reject.mutateAsync({
                          id: exchange.id,
                          values: { rowVersion: exchange.rowVersion, note: note.trim() },
                        });
                        onDone(`Exchange ${exchange.exchangeNo} rejected`);
                      });
                    }}
                  >
                    {reject.isPending ? 'Rejecting…' : 'Reject'}
                  </Button>
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await approve.mutateAsync({
                          id: exchange.id,
                          values: {
                            rowVersion: exchange.rowVersion,
                            ...(note.trim() ? { note: note.trim() } : {}),
                          },
                        });
                        onDone(`Exchange ${exchange.exchangeNo} approved`);
                      })
                    }
                  >
                    {approve.isPending ? 'Approving…' : 'Approve'}
                  </Button>
                </>
              ) : null}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
