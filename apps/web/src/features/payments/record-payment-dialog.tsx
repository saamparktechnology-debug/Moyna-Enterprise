import { SimpleTable } from '@/components/data-table/simple-table';
import { useRef, useState } from 'react';
import { RecordPaymentRequestSchema, todayInIndia } from '@erp/contracts';
import type { RecordPaymentRequest } from '@erp/contracts';
import { FormField, Input } from '@/components/form-field';
import { Select } from '@/components/select-field';
import { FormDialog } from '@/components/form-dialog';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useCustomers } from '../customers/use-customers';
import { BranchField, describeError, useBranchChoice } from '../purchasing/purchasing-shared';
import type { Problem } from '../purchasing/purchasing-shared';
import { usePaymentModes } from '../purchasing/use-purchasing';
import { ProblemAlert } from './payments-shared';
import { useDues, usePaymentMutations } from './use-payments';

const SEARCH_DELAY_MS = 300;

type Allocation = 'auto' | 'none' | 'manual';

interface Props {
  /** Start with this customer already chosen. */
  customer?: { id: string; name: string } | null;
  onClose: () => void;
  onRecorded: (message: string) => void;
}

/** Takes money from a customer and says which invoices it settles. */
export function RecordPaymentDialog({ customer: initial = null, onClose, onRecorded }: Props) {
  const { record } = usePaymentMutations();
  const choice = useBranchChoice();
  const modes = usePaymentModes();
  const [customer, setCustomer] = useState(initial);
  const [customerText, setCustomerText] = useState('');
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('CASH');
  const [paidOn, setPaidOn] = useState(todayInIndia());
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [allocation, setAllocation] = useState<Allocation>('auto');
  const [manual, setManual] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<Problem | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  // One key for one intended payment: a retry after a dropped connection reuses it, so the money is taken once.
  const key = useRef(crypto.randomUUID());
  const typed = useDebouncedValue(customerText.trim(), SEARCH_DELAY_MS);
  const customers = useCustomers({ page: 1, pageSize: 10, search: typed, kycStatus: '' });
  const dues = useDues(
    { page: 1, pageSize: 50, search: '', scope: 'outstanding', customerId: customer?.id ?? '' },
    Boolean(customer) && allocation === 'manual',
  );

  const edited =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      key.current = crypto.randomUUID();
      set(value);
    };

  const submit = async () => {
    setProblem(null);
    const allocations = Object.entries(manual)
      .filter(([, value]) => value.trim() !== '')
      .map(([invoiceId, value]) => ({ invoiceId, amount: value.trim() }));
    const request: RecordPaymentRequest = {
      customerId: customer?.id ?? '',
      mode,
      amount: amount.trim(),
      paidOn,
      idempotencyKey: key.current,
      allocateAutomatically: allocation === 'auto',
      allocations: allocation === 'manual' ? allocations : [],
      ...(choice.mustChoose ? { branchId: choice.branchId } : {}),
      ...(reference.trim() ? { reference: reference.trim() } : {}),
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    const parsed = RecordPaymentRequestSchema.safeParse(request);
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
      const payment = await record.mutateAsync(request);
      onRecorded(`Receipt ${payment.receiptNo} recorded for ${payment.customerName}`);
    } catch (error) {
      const described = describeError(error);
      setProblem(described);
      setErrors(described.fields);
    }
  };

  const allocationError =
    errors['allocations'] ??
    Object.entries(errors).find(([field]) => field.startsWith('allocations.'))?.[1];
  const applied = Object.values(manual).reduce((sum, value) => sum + (Number(value) || 0), 0);

  const dirty =
    customerText !== '' ||
    amount !== '' ||
    reference !== '' ||
    note !== '' ||
    allocation !== 'auto' ||
    Object.values(manual).some((value) => value !== '');

  return (
    <FormDialog
      open
      size="lg"
      title="Record a payment"
      description="Money received from a customer. It can settle invoices now or be kept as an advance."
      onClose={onClose}
      onSubmit={submit}
      saving={record.isPending}
      savingLabel="Recording…"
      dirty={dirty}
      submitLabel="Record payment"
      error={problem ? <ProblemAlert problem={problem} /> : undefined}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FormField
            label="Customer"
            error={errors['customerId']}
            hint={customer ? `Chosen: ${customer.name}` : 'Type a name or phone number'}
          >
            {(props) => (
              <>
                <Input
                  {...props}
                  autoComplete="off"
                  value={customerText}
                  onChange={(event) => setCustomerText(event.target.value)}
                />
                {typed.length >= 2 && customers.data ? (
                  customers.data.items.length > 0 ? (
                    <Select
                      aria-label="Matching customers"
                      value={customer?.id ?? ''}
                      onChange={(event) => {
                        const found = customers.data?.items.find(
                          (item) => item.id === event.target.value,
                        );
                        edited(setCustomer)(found ? { id: found.id, name: found.name } : null);
                        setManual({});
                      }}
                    >
                      <option value="">Choose a customer</option>
                      {customers.data.items.map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.name} · {item.phone}
                        </option>
                      ))}
                    </Select>
                  ) : (
                    <p className="text-sm text-muted-foreground">No customer matches.</p>
                  )
                ) : null}
              </>
            )}
          </FormField>
        </div>
        <BranchField choice={choice} error={errors['branchId']} />
        <FormField label="Amount received" error={errors['amount']}>
          {(props) => (
            <Input
              {...props}
              inputMode="decimal"
              value={amount}
              onChange={(event) => edited(setAmount)(event.target.value)}
            />
          )}
        </FormField>
        <FormField label="Paid by" error={errors['mode']}>
          {(props) => (
            <Select
              {...props}
              value={mode}
              onChange={(event) => edited(setMode)(event.target.value)}
            >
              {(modes.data ?? [{ code: 'CASH', name: 'Cash' }]).map((item) => (
                <option key={item.code} value={item.code}>
                  {item.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField label="Date received" error={errors['paidOn']}>
          {(props) => (
            <Input
              {...props}
              type="date"
              max={todayInIndia()}
              value={paidOn}
              onChange={(event) => edited(setPaidOn)(event.target.value)}
            />
          )}
        </FormField>
        <FormField
          label="Reference"
          error={errors['reference']}
          hint="Cheque, UPI or bank transaction number"
        >
          {(props) => (
            <Input
              {...props}
              value={reference}
              onChange={(event) => edited(setReference)(event.target.value)}
            />
          )}
        </FormField>
        <div className="sm:col-span-2">
          <FormField label="Note" error={errors['note']}>
            {(props) => (
              <Input
                {...props}
                value={note}
                onChange={(event) => edited(setNote)(event.target.value)}
              />
            )}
          </FormField>
        </div>
      </div>

      <fieldset className="space-y-2">
        <legend className="text-sm font-medium">What the money settles</legend>
        {(
          [
            ['auto', 'Oldest dues first'],
            ['manual', 'Choose the invoices'],
            ['none', 'Keep as an advance'],
          ] as const
        ).map(([value, text]) => (
          <label key={value} className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="allocation"
              checked={allocation === value}
              onChange={() => edited(setAllocation)(value)}
            />
            {text}
          </label>
        ))}
        {allocationError ? <p className="text-sm text-destructive">{allocationError}</p> : null}
      </fieldset>

      {allocation === 'manual' ? (
        <div>
          {!customer ? (
            <p className="text-sm text-muted-foreground">Choose the customer to see their dues.</p>
          ) : dues.isPending ? (
            <p role="status" className="text-sm text-muted-foreground">
              Loading the dues…
            </p>
          ) : dues.data && dues.data.items.length > 0 ? (
            <>
              <SimpleTable
                label="Invoices to settle"
                rows={dues.data.items}
                getRowKey={(due) => due.invoiceId}
                columns={[
                  { header: 'Invoice', className: 'break-id', cell: (due) => due.invoiceNo },
                  { header: 'Due date', cell: (due) => due.dueDate ?? '—' },
                  { header: 'Owed', align: 'right', cell: (due) => due.outstanding },
                  {
                    header: 'Apply',
                    cell: (due) => {
                      const index = dues.data.items.indexOf(due);
                      return (
                        <Input
                          aria-label={`Amount for ${due.invoiceNo ?? 'invoice'}`}
                          aria-invalid={Boolean(errors[`allocations.${index}.amount`])}
                          inputMode="decimal"
                          className="h-control-sm w-28"
                          value={manual[due.invoiceId] ?? ''}
                          onChange={(event) =>
                            edited((value: string) =>
                              setManual((current) => ({ ...current, [due.invoiceId]: value })),
                            )(event.target.value)
                          }
                        />
                      );
                    },
                  },
                ]}
              />
              <p className="mt-2 text-sm text-muted-foreground">
                Applied to invoices: {applied.toFixed(2)}
              </p>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              This customer has no invoice with a balance due.
            </p>
          )}
        </div>
      ) : null}
    </FormDialog>
  );
}
