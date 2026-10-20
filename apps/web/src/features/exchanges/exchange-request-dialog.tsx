import { useState } from 'react';
import { EXCHANGE_DISPOSITIONS, RequestExchangeRequestSchema } from '@erp/contracts';
import type { ExchangeDispositionName, ExchangeKindName } from '@erp/contracts';
import { FormField, Input } from '@/components/form-field';
import { Select } from '@/components/select-field';
import { FormDialog } from '@/components/form-dialog';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useInvoices } from '../billing/use-billing';
import { ProblemAlert } from '../payments/payments-shared';
import { describeError } from '../purchasing/purchasing-shared';
import type { Problem } from '../purchasing/purchasing-shared';
import { DISPOSITION_TEXT, KIND_TEXT, differenceOf, settlementText } from './exchanges-shared';
import { useExchangeMutations, useExchangeOptions } from './use-exchanges';

const SEARCH_DELAY_MS = 300;

interface Props {
  onClose: () => void;
  onRequested: (message: string) => void;
}

/** Asks to take back a vehicle the customer was sold, against a vehicle on an issued delivery invoice. */
export function ExchangeRequestDialog({ onClose, onRequested }: Props) {
  const { request } = useExchangeMutations();
  const [invoiceText, setInvoiceText] = useState('');
  const [invoiceId, setInvoiceId] = useState('');
  const [newUnitId, setNewUnitId] = useState('');
  const [oldUnitId, setOldUnitId] = useState('');
  const [kind, setKind] = useState<ExchangeKindName>('OLD_FOR_NEW');
  const [valuation, setValuation] = useState('');
  const [disposition, setDisposition] = useState<ExchangeDispositionName>('STOCK');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<Problem | null>(null);

  const typed = useDebouncedValue(invoiceText.trim(), SEARCH_DELAY_MS);
  const invoices = useInvoices({
    page: 1,
    pageSize: 10,
    search: typed,
    status: 'ISSUED',
    type: '',
  });
  const options = useExchangeOptions(invoiceId);
  const data = options.data;
  const newUnit = data?.newUnits.find((unit) => unit.unitId === newUnitId);
  const oldUnit = data?.oldUnits.find((unit) => unit.unitId === oldUnitId);
  const worth = kind === 'NEW_FOR_NEW' ? oldUnit?.lineAmount : valuation.trim();
  const showDifference = Boolean(newUnit && oldUnit && worth && /^\d+(\.\d{1,2})?$/.test(worth));

  const submit = async () => {
    setProblem(null);
    const values = {
      invoiceId,
      newSerialUnitId: newUnitId,
      oldSerialUnitId: oldUnitId,
      kind,
      ...(kind === 'OLD_FOR_NEW' && valuation.trim() !== ''
        ? { valuationAmount: valuation.trim() }
        : {}),
      disposition,
      reason: reason.trim(),
    };
    const parsed = RequestExchangeRequestSchema.safeParse(values);
    if (!parsed.success) {
      const found: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path.join('.') || 'form';
        if (!found[field]) found[field] = issue.message;
      }
      setErrors(found);
      return;
    }
    setErrors({});
    try {
      const exchange = await request.mutateAsync(values);
      onRequested(`Exchange ${exchange.exchangeNo} is waiting for approval`);
    } catch (error) {
      const described = describeError(error);
      setProblem(described);
      setErrors(described.fields);
    }
  };

  return (
    <FormDialog
      open
      size="lg"
      title="New exchange"
      description={
        <>
          Take back a vehicle the customer was sold, against the vehicle on the invoice that
          delivers the new one.
        </>
      }
      onClose={onClose}
      onSubmit={submit}
      saving={request.isPending}
      submitDisabled={!data}
      savingLabel="Asking…"
      submitLabel="Ask for approval"
      error={problem ? <ProblemAlert problem={problem} /> : undefined}
    >
      <FormField
        label="Delivery invoice"
        error={errors['invoiceId']}
        hint="The issued invoice of the new vehicle. Type its number or the customer's name"
      >
        {(props) => (
          <>
            <Input
              {...props}
              autoComplete="off"
              value={invoiceText}
              onChange={(event) => setInvoiceText(event.target.value)}
            />
            {typed.length >= 2 && invoices.data ? (
              invoices.data.items.length > 0 ? (
                <Select
                  aria-label="Matching invoices"
                  value={invoiceId}
                  onChange={(event) => {
                    setInvoiceId(event.target.value);
                    setNewUnitId('');
                    setOldUnitId('');
                  }}
                >
                  <option value="">Choose an invoice</option>
                  {invoices.data.items.map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.invoiceNo} · {item.customerName} · {item.total}
                    </option>
                  ))}
                </Select>
              ) : (
                <p className="text-sm text-muted-foreground">No issued invoice matches.</p>
              )
            ) : null}
          </>
        )}
      </FormField>

      {invoiceId !== '' && options.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading the vehicles…
        </p>
      ) : null}
      {options.isError ? (
        <p role="alert" className="text-sm text-destructive">
          This invoice cannot take part in an exchange.
        </p>
      ) : null}

      {data ? (
        <>
          <p className="text-sm text-muted-foreground">Customer: {data.customerName}</p>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="New vehicle" error={errors['newSerialUnitId']}>
              {(props) => (
                <Select
                  {...props}
                  value={newUnitId}
                  onChange={(event) => setNewUnitId(event.target.value)}
                >
                  <option value="">Choose a vehicle</option>
                  {data.newUnits.map((unit) => (
                    <option key={unit.unitId} value={unit.unitId}>
                      {unit.serialNo} · {unit.itemCode} · {unit.lineAmount}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField label="Old vehicle taken back" error={errors['oldSerialUnitId']}>
              {(props) => (
                <Select
                  {...props}
                  value={oldUnitId}
                  onChange={(event) => setOldUnitId(event.target.value)}
                >
                  <option value="">Choose a vehicle</option>
                  {data.oldUnits.map((unit) => (
                    <option key={unit.unitId} value={unit.unitId}>
                      {unit.serialNo} · bought for {unit.lineAmount}
                      {unit.originalInvoiceNo ? ` on ${unit.originalInvoiceNo}` : ''}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          </div>
          {data.oldUnits.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              This customer has no vehicle sold to them that can be taken back.
            </p>
          ) : null}
          {oldUnit && oldUnit.batteries.length > 0 ? (
            <p className="text-sm text-muted-foreground">
              Comes back with its batteries: {oldUnit.batteries.map((b) => b.serialNo).join(', ')}
            </p>
          ) : null}

          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Kind of exchange</legend>
            {(['OLD_FOR_NEW', 'NEW_FOR_NEW'] as const).map((value) => (
              <label key={value} className="flex items-center gap-2 text-sm">
                <input
                  type="radio"
                  name="kind"
                  checked={kind === value}
                  onChange={() => setKind(value)}
                />
                {KIND_TEXT[value]}
                {value === 'NEW_FOR_NEW'
                  ? ' (taken back at the price paid)'
                  : ' (you decide its value)'}
              </label>
            ))}
          </fieldset>

          {kind === 'OLD_FOR_NEW' ? (
            <FormField
              label="What the old vehicle is worth"
              error={errors['valuationAmount']}
              hint={oldUnit ? `At most ${oldUnit.lineAmount}, what the customer paid` : undefined}
            >
              {(props) => (
                <Input
                  {...props}
                  inputMode="decimal"
                  value={valuation}
                  onChange={(event) => setValuation(event.target.value)}
                />
              )}
            </FormField>
          ) : null}

          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="What becomes of the old vehicle" error={errors['disposition']}>
              {(props) => (
                <Select
                  {...props}
                  value={disposition}
                  onChange={(event) =>
                    setDisposition(event.target.value as ExchangeDispositionName)
                  }
                >
                  {EXCHANGE_DISPOSITIONS.map((value) => (
                    <option key={value} value={value}>
                      {DISPOSITION_TEXT[value]}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField label="Reason" error={errors['reason']}>
              {(props) => (
                <Input
                  {...props}
                  value={reason}
                  onChange={(event) => setReason(event.target.value)}
                />
              )}
            </FormField>
          </div>

          {showDifference && newUnit && worth ? (
            <div
              role="region"
              aria-label="What the exchange comes to"
              className="rounded-md border p-3 text-sm"
            >
              <p>New vehicle: {newUnit.lineAmount}</p>
              <p>Old vehicle taken back at: {worth}</p>
              <p className="font-medium">
                {settlementText(differenceOf(newUnit.lineAmount, worth))}
                {Number(differenceOf(newUnit.lineAmount, worth)) !== 0
                  ? ` (${differenceOf(newUnit.lineAmount, worth)})`
                  : ''}
              </p>
            </div>
          ) : null}
        </>
      ) : null}
    </FormDialog>
  );
}
