import { SimpleTable } from '@/components/data-table/simple-table';
import { StatusBadge } from '@/components/status-badge';
import { useState } from 'react';
import {
  CancelQuotationRequestSchema,
  TakeAdvanceRequestSchema,
  allowedNextBuildStages,
  todayInIndia,
} from '@erp/contracts';
import type { BuildStageName, Quotation, QuotationLine } from '@erp/contracts';
import { FormField, Input } from '@/components/form-field';
import { Select } from '@/components/select-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/features/auth/auth-provider';
import { useSellableUnits } from '../billing/use-billing';
import { formatWhen } from '../leads/leads-shared';
import { ProblemAlert } from '../payments/payments-shared';
import { describeError } from '../purchasing/purchasing-shared';
import type { Problem } from '../purchasing/purchasing-shared';
import { usePaymentModes } from '../purchasing/use-purchasing';
import { BUILD_STAGE_TEXT, QUOTATION_STATUS_TEXT } from './quotations-shared';
import { useQuotation, useQuotationMutations } from './use-quotations';

interface Props {
  quotationId: string;
  onClose: () => void;
  onEdit: (quotation: Quotation) => void;
  onDone: (message: string) => void;
}

export function QuotationDetailDialog({ quotationId, onClose, onEdit, onDone }: Props) {
  const { can } = useAuth();
  const query = useQuotation(quotationId);
  const q = query.data;
  const manage = can('quotations.manage');
  const m = useQuotationMutations();
  const modes = usePaymentModes();
  const [problem, setProblem] = useState<Problem | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [reason, setReason] = useState('');
  const [advance, setAdvance] = useState({ amount: '', mode: 'CASH', reference: '' });
  const [stage, setStage] = useState('');
  const [stageNote, setStageNote] = useState('');
  const [dueDate, setDueDate] = useState('');
  const busy = Object.values(m).some((mutation) => mutation.isPending);
  const open = q ? q.status === 'DRAFT' || q.status === 'SENT' || q.status === 'ACCEPTED' : false;

  const run = async (action: () => Promise<unknown>, done?: () => void) => {
    setProblem(null);
    setErrors({});
    try {
      await action();
      done?.();
    } catch (error) {
      const described = describeError(error);
      setProblem(described);
      setErrors(described.fields);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => (next || busy ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] max-w-4xl overflow-y-auto">
        <DialogTitle>{q ? q.quotationNo : 'Quotation'}</DialogTitle>
        <DialogDescription>
          {q
            ? `${QUOTATION_STATUS_TEXT[q.status]} · ${q.customerName} · valid until ${q.validUntil}`
            : 'Loading the quotation'}
        </DialogDescription>
        {query.isPending ? (
          <p role="status" className="mt-4 text-sm text-muted-foreground">
            Loading the quotation…
          </p>
        ) : query.isError || !q ? (
          <div role="alert" className="mt-4 flex items-center gap-3 text-destructive">
            <p>Could not load the quotation.</p>
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
            {q.status === 'EXPIRED' ? (
              <p role="status" className="mt-3 text-sm text-destructive">
                This quotation passed its last day with nothing paid, so its prices are no longer
                held. Write a new one.
              </p>
            ) : null}

            <div
              role="region"
              aria-label="Quoted lines, scrollable"
              tabIndex={0}
              className="relative mt-4 overflow-x-auto rounded-lg border bg-card"
            >
              <table aria-label="Quoted lines" className="w-full text-left text-sm">
                <thead className="border-b bg-muted/60 text-xs uppercase tracking-wide text-muted-foreground">
                  <tr>
                    {['Item', 'Qty', 'Price', 'Discount', 'Amount'].map((heading, index) => (
                      <th
                        key={heading}
                        scope="col"
                        className={`px-(--cell-px) py-2.5 font-medium ${index > 0 ? 'text-right' : ''}`}
                      >
                        {heading}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {q.lines.map((line) => (
                    <LineRow
                      key={line.id}
                      quotation={q}
                      line={line}
                      manage={manage}
                      busy={busy}
                      onAssign={(values) =>
                        run(() =>
                          m.unit.mutateAsync({
                            id: q.id,
                            lineId: line.id,
                            values: { ...values, rowVersion: q.rowVersion },
                          }),
                        )
                      }
                      errors={errors}
                    />
                  ))}
                </tbody>
              </table>
            </div>
            <dl className="mt-3 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <dt className="text-muted-foreground">Total to pay</dt>
              <dd className="font-medium">{q.total}</dd>
              <dt className="text-muted-foreground">Taxable value</dt>
              <dd>{q.taxableValue}</dd>
              <dt className="text-muted-foreground">Advance paid</dt>
              <dd>{q.advancePaid}</dd>
              <dt className="text-muted-foreground">Still to pay</dt>
              <dd>{q.balanceDue}</dd>
              {q.brokerName ? (
                <>
                  <dt className="text-muted-foreground">Broker</dt>
                  <dd>{q.brokerName}</dd>
                </>
              ) : null}
              {q.specification ? (
                <>
                  <dt className="text-muted-foreground">To be built</dt>
                  <dd>{q.specification}</dd>
                </>
              ) : null}
              {q.invoiceId ? (
                <>
                  <dt className="text-muted-foreground">Invoice</dt>
                  <dd>{q.invoiceNo ?? 'Draft, not yet issued'}</dd>
                </>
              ) : null}
              {q.cancelReason ? (
                <>
                  <dt className="text-muted-foreground">Cancelled because</dt>
                  <dd>{q.cancelReason}</dd>
                </>
              ) : null}
            </dl>

            {manage && q.status === 'DRAFT' ? (
              <div className="mt-4 flex gap-2">
                <Button variant="secondary" size="sm" onClick={() => onEdit(q)}>
                  Edit quotation
                </Button>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      m.send.mutateAsync({ id: q.id, values: { rowVersion: q.rowVersion } }),
                    )
                  }
                >
                  Send to customer
                </Button>
              </div>
            ) : null}
            {manage && q.status === 'SENT' ? (
              <div className="mt-4">
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void run(() =>
                      m.accept.mutateAsync({ id: q.id, values: { rowVersion: q.rowVersion } }),
                    )
                  }
                >
                  Customer accepted
                </Button>
              </div>
            ) : null}

            {q.status === 'ACCEPTED' || q.advances.length > 0 ? (
              <>
                <h3 className="mt-6 text-sm font-semibold">Advance payments</h3>
                {q.advances.length > 0 ? (
                  <SimpleTable
                    label="Advances"
                    rows={q.advances}
                    getRowKey={(item) => item.paymentId}
                    className="mt-2"
                    columns={[
                      { header: 'Receipt', className: 'break-id', cell: (item) => item.receiptNo },
                      { header: 'Date', cell: (item) => item.paidOn },
                      { header: 'Paid by', cell: (item) => item.modeName },
                      { header: 'Amount', align: 'right', cell: (item) => item.amount },
                      {
                        header: 'Status',
                        cell: (item) => (
                          <StatusBadge
                            status={item.status}
                            label={item.status === 'ACTIVE' ? 'Held' : 'Reversed'}
                          />
                        ),
                      },
                    ]}
                  />
                ) : (
                  <p className="mt-1 text-sm text-muted-foreground">No advance has been taken.</p>
                )}
              </>
            ) : null}
            {can('payments.create') &&
            manage &&
            q.status === 'ACCEPTED' &&
            Number(q.balanceDue) > 0 ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_1fr_1fr_auto] sm:items-end">
                <FormField label="Advance amount" error={errors['amount']}>
                  {(props) => (
                    <Input
                      {...props}
                      inputMode="decimal"
                      value={advance.amount}
                      onChange={(event) => setAdvance({ ...advance, amount: event.target.value })}
                    />
                  )}
                </FormField>
                <FormField label="Paid by" error={errors['mode']}>
                  {(props) => (
                    <Select
                      {...props}
                      value={advance.mode}
                      onChange={(event) => setAdvance({ ...advance, mode: event.target.value })}
                    >
                      {(modes.data ?? [{ code: 'CASH', name: 'Cash' }]).map((item) => (
                        <option key={item.code} value={item.code}>
                          {item.name}
                        </option>
                      ))}
                    </Select>
                  )}
                </FormField>
                <FormField label="Advance reference" error={errors['reference']}>
                  {(props) => (
                    <Input
                      {...props}
                      value={advance.reference}
                      onChange={(event) =>
                        setAdvance({ ...advance, reference: event.target.value })
                      }
                    />
                  )}
                </FormField>
                <Button
                  disabled={busy}
                  onClick={() => {
                    const request = {
                      mode: advance.mode,
                      amount: advance.amount.trim(),
                      paidOn: todayInIndia(),
                      idempotencyKey: crypto.randomUUID(),
                      ...(advance.reference.trim() ? { reference: advance.reference.trim() } : {}),
                    };
                    const parsed = TakeAdvanceRequestSchema.safeParse(request);
                    if (!parsed.success) {
                      setErrors({ amount: parsed.error.issues[0]?.message ?? 'Check the amount' });
                      return;
                    }
                    void run(
                      () => m.advance.mutateAsync({ id: q.id, values: request }),
                      () => setAdvance({ amount: '', mode: advance.mode, reference: '' }),
                    );
                  }}
                >
                  {m.advance.isPending ? 'Taking…' : 'Take advance'}
                </Button>
              </div>
            ) : null}

            {q.isCustomBuild && (q.status === 'ACCEPTED' || q.status === 'CONVERTED') ? (
              <>
                <h3 className="mt-6 text-sm font-semibold">
                  Build: {BUILD_STAGE_TEXT[q.buildStage]}
                </h3>
                {manage &&
                q.status === 'ACCEPTED' &&
                allowedNextBuildStages(q.buildStage).length > 0 ? (
                  <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
                    <FormField label="Move the build to" error={errors['stage']}>
                      {(props) => (
                        <Select
                          {...props}
                          value={stage}
                          onChange={(event) => setStage(event.target.value)}
                        >
                          <option value="">Choose a stage</option>
                          {allowedNextBuildStages(q.buildStage).map((item) => (
                            <option key={item} value={item}>
                              {BUILD_STAGE_TEXT[item]}
                            </option>
                          ))}
                        </Select>
                      )}
                    </FormField>
                    <FormField label="Build note" error={errors['note']}>
                      {(props) => (
                        <Input
                          {...props}
                          value={stageNote}
                          onChange={(event) => setStageNote(event.target.value)}
                        />
                      )}
                    </FormField>
                    <Button
                      variant="secondary"
                      disabled={busy || stage === ''}
                      onClick={() =>
                        void run(
                          () =>
                            m.build.mutateAsync({
                              id: q.id,
                              values: {
                                stage: stage as BuildStageName,
                                rowVersion: q.rowVersion,
                                ...(stageNote.trim() ? { note: stageNote.trim() } : {}),
                              },
                            }),
                          () => {
                            setStage('');
                            setStageNote('');
                          },
                        )
                      }
                    >
                      Update build
                    </Button>
                  </div>
                ) : null}
                <ul aria-label="Build history" className="mt-2 space-y-1 text-sm">
                  {q.buildUpdates.map((update) => (
                    <li key={update.id} className="rounded-md border px-3 py-1">
                      {BUILD_STAGE_TEXT[update.stage]}
                      {update.note ? ` · ${update.note}` : ''}
                      <span className="block text-xs text-muted-foreground">
                        {update.createdByName ?? 'Unknown'} · {formatWhen(update.createdAt)}
                      </span>
                    </li>
                  ))}
                  {q.buildUpdates.length === 0 ? (
                    <li className="text-muted-foreground">No build update yet.</li>
                  ) : null}
                </ul>
              </>
            ) : null}

            {manage && can('invoices.create') && q.status === 'ACCEPTED' && !q.invoiceId ? (
              <div className="mt-6 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <FormField label="Invoice due date" hint="Optional" error={errors['dueDate']}>
                  {(props) => (
                    <Input
                      {...props}
                      type="date"
                      value={dueDate}
                      onChange={(event) => setDueDate(event.target.value)}
                    />
                  )}
                </FormField>
                <Button
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const invoice = await m.convert.mutateAsync({
                        quotationId: q.id,
                        rowVersion: q.rowVersion,
                        dueDate: dueDate === '' ? null : dueDate,
                      });
                      onDone(
                        `A draft invoice was made from ${q.quotationNo} (${invoice.customerName}). Issue it under Sales to deliver.`,
                      );
                    })
                  }
                >
                  {m.convert.isPending ? 'Making the invoice…' : 'Make the invoice'}
                </Button>
              </div>
            ) : null}

            {manage && open ? (
              <div className="mt-6 grid gap-3 sm:grid-cols-[2fr_auto] sm:items-end">
                <FormField label="Reason for cancelling" error={errors['reason']}>
                  {(props) => (
                    <Input
                      {...props}
                      value={reason}
                      onChange={(event) => setReason(event.target.value)}
                    />
                  )}
                </FormField>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    const request = { reason: reason.trim(), rowVersion: q.rowVersion };
                    const parsed = CancelQuotationRequestSchema.safeParse(request);
                    if (!parsed.success) {
                      setErrors({ reason: parsed.error.issues[0]?.message ?? 'Give a reason' });
                      return;
                    }
                    void run(async () => {
                      await m.cancel.mutateAsync({ id: q.id, values: request });
                      onDone(`${q.quotationNo} cancelled`);
                    });
                  }}
                >
                  Cancel quotation
                </Button>
              </div>
            ) : null}
            <div className="mt-6 flex justify-end">
              <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
                Close
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function LineRow({
  quotation,
  line,
  manage,
  busy,
  onAssign,
  errors,
}: {
  quotation: Quotation;
  line: QuotationLine;
  manage: boolean;
  busy: boolean;
  onAssign: (values: {
    serialUnitId: string;
    chassisNo?: string;
    motorNo?: string;
  }) => Promise<void>;
  errors: Record<string, string>;
}) {
  const choosable =
    manage && line.isSerialized && (quotation.status === 'SENT' || quotation.status === 'ACCEPTED');
  const [unitId, setUnitId] = useState('');
  const [chassis, setChassis] = useState('');
  const [motor, setMotor] = useState('');
  const units = useSellableUnits(choosable ? line.itemId : '', quotation.branchId);
  return (
    <>
      <tr className="border-b">
        <td className="px-(--cell-px) py-(--row-py)">
          {line.itemCode} {line.itemName}
        </td>
        <td className="tabular px-(--cell-px) py-(--row-py) text-right">{line.qty}</td>
        <td className="tabular px-(--cell-px) py-(--row-py) text-right">{line.unitPrice}</td>
        <td className="tabular px-(--cell-px) py-(--row-py) text-right">{line.discountAmount}</td>
        <td className="tabular px-(--cell-px) py-(--row-py) text-right">{line.amount}</td>
      </tr>
      {line.isSerialized ? (
        <tr className="border-b last:border-0">
          <td colSpan={5} className="px-2 pb-2 text-xs text-muted-foreground">
            {line.unit ? (
              <span>
                Vehicle {line.unit.serialNo} · chassis {line.unit.chassisNo ?? 'not recorded'} ·
                motor {line.unit.motorNo ?? 'not recorded'}
                {line.unit.batteries.length > 0
                  ? ` · batteries ${line.unit.batteries.map((b) => b.serialNo).join(', ')}`
                  : ''}
              </span>
            ) : (
              <span>No vehicle chosen yet</span>
            )}
            {choosable ? (
              <span className="mt-2 grid gap-2 sm:grid-cols-[2fr_1fr_1fr_auto] sm:items-end">
                <label className="space-y-1 text-sm font-medium text-foreground">
                  <span>Vehicle for {line.itemCode}</span>
                  <Select value={unitId} onChange={(event) => setUnitId(event.target.value)}>
                    <option value="">Choose a vehicle</option>
                    {(units.data?.items ?? []).map((unit) => (
                      <option key={unit.id} value={unit.id}>
                        {unit.serialNo}
                      </option>
                    ))}
                  </Select>
                </label>
                <label className="space-y-1 text-sm font-medium text-foreground">
                  <span>Chassis number for {line.itemCode}</span>
                  <Input value={chassis} onChange={(event) => setChassis(event.target.value)} />
                </label>
                <label className="space-y-1 text-sm font-medium text-foreground">
                  <span>Motor number for {line.itemCode}</span>
                  <Input value={motor} onChange={(event) => setMotor(event.target.value)} />
                </label>
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy || unitId === ''}
                  aria-label={`Set the vehicle for ${line.itemCode}`}
                  onClick={() =>
                    void onAssign({
                      serialUnitId: unitId,
                      ...(chassis.trim() ? { chassisNo: chassis.trim() } : {}),
                      ...(motor.trim() ? { motorNo: motor.trim() } : {}),
                    }).then(() => {
                      setUnitId('');
                      setChassis('');
                      setMotor('');
                    })
                  }
                >
                  Set vehicle
                </Button>
              </span>
            ) : null}
            {errors['serialUnitId'] || errors['chassisNo'] || errors['motorNo'] ? (
              <span className="block text-destructive">
                {errors['serialUnitId'] ?? errors['chassisNo'] ?? errors['motorNo']}
              </span>
            ) : null}
          </td>
        </tr>
      ) : null}
    </>
  );
}
