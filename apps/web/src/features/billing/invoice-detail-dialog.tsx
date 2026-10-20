import { SimpleTable } from '@/components/data-table/simple-table';
import { useState } from 'react';
import type { Invoice } from '@erp/contracts';
import { Alert } from '@/components/alert';
import { FormField, Input } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/features/auth/auth-provider';
import { describeError } from '../purchasing/purchasing-shared';
import type { Problem } from '../purchasing/purchasing-shared';
import { downloadInvoicePdf } from './billing-api';
import { STATUS_TEXT, TYPE_TEXT } from './billing-shared';
import { useInvoice, useInvoiceMutations } from './use-billing';

interface InvoiceDetailDialogProps {
  invoiceId: string;
  onClose: () => void;
  onEdit: (invoice: Invoice) => void;
  /** Opens the credit note request for an issued invoice. */
  onCreditNote?: ((invoice: Invoice) => void) | undefined;
  /** Called after the invoice was issued, cancelled or discarded. A reissue also hands over the new draft. */
  onChanged: (message: string, draft?: Invoice) => void;
}

const MIN_REASON = 3;

export function InvoiceDetailDialog({
  invoiceId,
  onClose,
  onEdit,
  onCreditNote,
  onChanged,
}: InvoiceDetailDialogProps) {
  const { can } = useAuth();
  const query = useInvoice(invoiceId);
  const { issue, discard, cancel, reissue } = useInvoiceMutations();
  const [problem, setProblem] = useState<Problem | null>(null);
  const [overrideReason, setOverrideReason] = useState('');
  const [unpaidReason, setUnpaidReason] = useState('');
  const [reason, setReason] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  const invoice = query.data;
  const busy = issue.isPending || discard.isPending || cancel.isPending || reissue.isPending;

  const run = async (action: () => Promise<void>) => {
    setProblem(null);
    try {
      await action();
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  const needReason = (): string | null => {
    if (reason.trim().length < MIN_REASON) {
      setReasonError(`Give a reason of at least ${MIN_REASON} characters`);
      return null;
    }
    setReasonError(null);
    return reason.trim();
  };

  const download = () =>
    run(async () => {
      if (!invoice) return;
      const blob = await downloadInvoicePdf(invoice.id);
      const link = document.createElement('a');
      link.href = URL.createObjectURL(blob);
      link.download = `${(invoice.invoiceNo ?? 'draft-invoice').replace(/\//g, '-')}.pdf`;
      link.click();
    });

  return (
    <Dialog open onOpenChange={(next) => (next || busy ? undefined : onClose())}>
      <DialogContent size="xl" className="print-document">
        <DialogTitle>{invoice ? (invoice.invoiceNo ?? 'Draft invoice') : 'Invoice'}</DialogTitle>
        <DialogDescription>
          {invoice
            ? `${TYPE_TEXT[invoice.type]} · ${STATUS_TEXT[invoice.status]}`
            : 'Loading the invoice'}
        </DialogDescription>

        {query.isPending ? (
          <p role="status" className="mt-4 text-sm text-muted-foreground">
            Loading the invoice…
          </p>
        ) : query.isError || !invoice ? (
          <div role="alert" className="mt-4 flex items-center gap-3 text-destructive">
            <p>Could not load the invoice.</p>
            <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
              Retry
            </Button>
          </div>
        ) : (
          <>
            {problem ? (
              <div className="mt-3">
                <Alert tone="error">
                  <p>{problem.message}</p>
                  {problem.reasons.length > 0 ? (
                    <ul className="mt-1 list-disc pl-5">
                      {problem.reasons.map((item) => (
                        <li key={item}>{item}</li>
                      ))}
                    </ul>
                  ) : null}
                </Alert>
              </div>
            ) : null}

            <dl className="mt-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <dt className="text-muted-foreground">Customer</dt>
              <dd>
                {invoice.customerName}
                {invoice.customerGstin ? ` · GSTIN ${invoice.customerGstin}` : ''}
              </dd>
              {invoice.quotationNo ? (
                <>
                  <dt className="text-muted-foreground">Quotation</dt>
                  <dd>{invoice.quotationNo}</dd>
                </>
              ) : null}
              {invoice.brokerName ? (
                <>
                  <dt className="text-muted-foreground">Broker</dt>
                  <dd>{invoice.brokerName}</dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">Branch</dt>
              <dd>
                {invoice.branchCode}
                {invoice.branchGstin ? ` · GSTIN ${invoice.branchGstin}` : ''}
              </dd>
              {invoice.placeOfSupply ? (
                <>
                  <dt className="text-muted-foreground">Place of supply</dt>
                  <dd>
                    {invoice.placeOfSupply}
                    {invoice.interState
                      ? ' (another state, so IGST)'
                      : ' (same state, so CGST and SGST)'}
                  </dd>
                </>
              ) : null}
              <dt className="text-muted-foreground">Date</dt>
              <dd>{invoice.issuedOn ?? 'Not issued yet'}</dd>
              {invoice.dueDate ? (
                <>
                  <dt className="text-muted-foreground">Due</dt>
                  <dd>{invoice.dueDate}</dd>
                </>
              ) : null}
              {invoice.replacesInvoiceNo ? (
                <>
                  <dt className="text-muted-foreground">Replaces</dt>
                  <dd>{invoice.replacesInvoiceNo}</dd>
                </>
              ) : null}
            </dl>

            {invoice.status === 'CANCELLED' ? (
              <div className="mt-3">
                <Alert tone="info">
                  Cancelled{invoice.cancelledByName ? ` by ${invoice.cancelledByName}` : ''}:{' '}
                  {invoice.cancelReason}
                </Alert>
              </div>
            ) : null}

            <SimpleTable
              label="Invoice lines"
              rows={invoice.lines}
              getRowKey={(line) => line.id ?? line.itemId}
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
                { header: 'Price', align: 'right', cell: (line) => line.unitPrice },
                { header: 'Discount', align: 'right', cell: (line) => line.discountAmount },
                { header: 'Taxable', align: 'right', cell: (line) => line.taxableAmount },
                {
                  header: 'Tax',
                  align: 'right',
                  cell: (line) =>
                    line.taxRate
                      ? `${(Number(line.cgstAmount) + Number(line.sgstAmount) + Number(line.igstAmount)).toFixed(2)} (${line.taxRate}%)`
                      : '—',
                },
                { header: 'Amount', align: 'right', cell: (line) => line.amount },
              ]}
            />

            <dl
              aria-label="Invoice totals"
              className="mt-4 grid grid-cols-2 gap-x-6 gap-y-1 text-sm sm:ml-auto sm:max-w-xs"
            >
              <dt>Subtotal</dt>
              <dd className="text-right">{invoice.subtotal}</dd>
              <dt>Discount</dt>
              <dd className="text-right">{invoice.discountTotal}</dd>
              <dt>Taxable value</dt>
              <dd className="text-right">{invoice.taxableValue}</dd>
              {invoice.type === 'GST' ? (
                invoice.interState ? (
                  <>
                    <dt>IGST</dt>
                    <dd className="text-right">{invoice.igstAmount}</dd>
                  </>
                ) : (
                  <>
                    <dt>CGST</dt>
                    <dd className="text-right">{invoice.cgstAmount}</dd>
                    <dt>SGST</dt>
                    <dd className="text-right">{invoice.sgstAmount}</dd>
                  </>
                )
              ) : null}
              <dt>Round off</dt>
              <dd className="text-right">{invoice.roundOff}</dd>
              <dt className="font-semibold">Total</dt>
              <dd className="text-right font-semibold">{invoice.total}</dd>
            </dl>

            {invoice.status === 'DRAFT' && can('invoices.create') ? (
              <div className="mt-4 max-w-md">
                <FormField
                  label="Reason to sell an expired battery"
                  hint="Only if a battery has passed its expiry date. A manager must give this."
                >
                  {(props) => (
                    <Input
                      {...props}
                      value={overrideReason}
                      onChange={(event) => setOverrideReason(event.target.value)}
                    />
                  )}
                </FormField>
              </div>
            ) : null}

            {invoice.status === 'DRAFT' &&
            invoice.quotationId &&
            can('quotations.deliver_unpaid') ? (
              <div className="mt-4 max-w-md">
                <FormField
                  label="Reason to deliver before it is fully paid"
                  hint="Only if less than the total has been paid on the quotation. It is recorded."
                >
                  {(props) => (
                    <Input
                      {...props}
                      value={unpaidReason}
                      onChange={(event) => setUnpaidReason(event.target.value)}
                    />
                  )}
                </FormField>
              </div>
            ) : null}

            {invoice.status === 'ISSUED' && can('invoices.cancel') ? (
              <div className="mt-4 max-w-md">
                <FormField label="Reason for cancelling" error={reasonError ?? undefined}>
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

            <div className="no-print mt-6 flex flex-wrap justify-end gap-2">
              <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
                Close
              </Button>
              <Button
                type="button"
                variant="secondary"
                onClick={() => void download()}
                disabled={busy}
              >
                Download PDF
              </Button>
              {invoice.status === 'DRAFT' && can('invoices.create') ? (
                <>
                  {confirmDiscard ? (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={busy}
                      onClick={() =>
                        void run(async () => {
                          await discard.mutateAsync({
                            id: invoice.id,
                            rowVersion: invoice.rowVersion,
                          });
                          onChanged('Draft discarded');
                        })
                      }
                    >
                      Yes, discard it
                    </Button>
                  ) : (
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={busy}
                      onClick={() => setConfirmDiscard(true)}
                    >
                      Discard draft
                    </Button>
                  )}
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => onEdit(invoice)}
                  >
                    Edit
                  </Button>
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        const issued = await issue.mutateAsync({
                          id: invoice.id,
                          values: {
                            rowVersion: invoice.rowVersion,
                            ...(overrideReason.trim()
                              ? { overrideReason: overrideReason.trim() }
                              : {}),
                            ...(unpaidReason.trim()
                              ? { unpaidDeliveryReason: unpaidReason.trim() }
                              : {}),
                          },
                        });
                        onChanged(`Invoice ${issued.invoiceNo ?? ''} issued`.replace('  ', ' '));
                      })
                    }
                  >
                    {issue.isPending ? 'Issuing…' : 'Issue invoice'}
                  </Button>
                </>
              ) : null}
              {invoice.status === 'ISSUED' && onCreditNote && can('credit_notes.create') ? (
                <Button
                  type="button"
                  variant="secondary"
                  disabled={busy}
                  onClick={() => onCreditNote(invoice)}
                >
                  Raise credit note
                </Button>
              ) : null}
              {invoice.status === 'ISSUED' && can('invoices.cancel') ? (
                <>
                  <Button
                    type="button"
                    variant="secondary"
                    disabled={busy}
                    onClick={() => {
                      const given = needReason();
                      if (!given) return;
                      void run(async () => {
                        await cancel.mutateAsync({
                          id: invoice.id,
                          values: { rowVersion: invoice.rowVersion, reason: given },
                        });
                        onChanged(`Invoice ${invoice.invoiceNo ?? ''} cancelled`);
                      });
                    }}
                  >
                    Cancel invoice
                  </Button>
                  <Button
                    type="button"
                    disabled={busy}
                    onClick={() => {
                      const given = needReason();
                      if (!given) return;
                      void run(async () => {
                        const draft = await reissue.mutateAsync({
                          id: invoice.id,
                          values: { rowVersion: invoice.rowVersion, reason: given },
                        });
                        onChanged(
                          `Invoice ${invoice.invoiceNo ?? ''} cancelled and a new draft made`,
                          draft,
                        );
                      });
                    }}
                  >
                    Cancel and reissue
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
