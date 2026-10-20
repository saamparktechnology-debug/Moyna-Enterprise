import { useRef, useState } from 'react';
import { CreateRefundRequestSchema, todayInIndia } from '@erp/contracts';
import { FormField, Input } from '@/components/form-field';
import { Select } from '@/components/select-field';
import { FormDialog } from '@/components/form-dialog';
import { BranchField, describeError, useBranchChoice } from '../purchasing/purchasing-shared';
import type { Problem } from '../purchasing/purchasing-shared';
import { usePaymentModes } from '../purchasing/use-purchasing';
import { ProblemAlert } from './payments-shared';
import { useCustomerCredit, useRefund } from './use-payments';

interface Props {
  customerId: string;
  customerName: string;
  onClose: () => void;
  onPaid: (message: string) => void;
}

/** Pays a customer back money they hold as credit. Money held for an accepted order cannot be paid back. */
export function RefundDialog({ customerId, customerName, onClose, onPaid }: Props) {
  const choice = useBranchChoice();
  const credit = useCustomerCredit(customerId, choice.branchId);
  const modes = usePaymentModes();
  const refund = useRefund();
  const key = useRef(crypto.randomUUID());
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState('CASH');
  const [paidOn, setPaidOn] = useState(todayInIndia());
  const [reference, setReference] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<Problem | null>(null);

  const submit = async () => {
    setProblem(null);
    const values = {
      customerId,
      ...(choice.mustChoose ? { branchId: choice.branchId } : {}),
      amount: amount.trim(),
      mode,
      paidOn,
      ...(reference.trim() ? { reference: reference.trim() } : {}),
      reason: reason.trim(),
      idempotencyKey: key.current,
    };
    const parsed = CreateRefundRequestSchema.safeParse(values);
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
      const made = await refund.mutateAsync(values);
      key.current = crypto.randomUUID();
      onPaid(`Refund ${made.refundNo} of ${made.amount} paid to ${customerName}`);
    } catch (error) {
      const described = describeError(error);
      setProblem(described);
      setErrors(described.fields);
    }
  };

  const data = credit.data;
  return (
    <FormDialog
      open
      size="md"
      title={`Refund ${customerName}`}
      description="Pay back money this customer holds as credit."
      onClose={onClose}
      onSubmit={submit}
      saving={refund.isPending}
      savingLabel="Paying…"
      submitLabel="Pay refund"
      error={problem ? <ProblemAlert problem={problem} /> : undefined}
    >
      <BranchField choice={choice} error={errors['branchId']} />
      {data ? (
        <div role="region" aria-label="Credit held" className="rounded-md border p-3 text-sm">
          <p>Credit held: {data.credit}</p>
          {Number(data.heldForOrders) > 0 ? (
            <p className="text-muted-foreground">
              {data.heldForOrders} is held for an accepted order and cannot be refunded.
            </p>
          ) : null}
          <p className="font-medium">Can be refunded: {data.refundable}</p>
        </div>
      ) : credit.isError ? (
        <p role="alert" className="text-sm text-destructive">
          Could not work out the credit.
        </p>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
        <FormField label="Amount" error={errors['amount']}>
          {(props) => (
            <Input
              {...props}
              inputMode="decimal"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
            />
          )}
        </FormField>
        <FormField label="Paid back by" error={errors['mode']}>
          {(props) => (
            <Select {...props} value={mode} onChange={(event) => setMode(event.target.value)}>
              {(modes.data ?? [{ code: 'CASH', name: 'Cash' }]).map((item) => (
                <option key={item.code} value={item.code}>
                  {item.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField label="Date" error={errors['paidOn']}>
          {(props) => (
            <Input
              {...props}
              type="date"
              value={paidOn}
              onChange={(event) => setPaidOn(event.target.value)}
            />
          )}
        </FormField>
        <FormField label="Reference" error={errors['reference']} hint="Optional">
          {(props) => (
            <Input
              {...props}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
          )}
        </FormField>
      </div>
      <FormField label="Reason" error={errors['reason']}>
        {(props) => (
          <Input {...props} value={reason} onChange={(event) => setReason(event.target.value)} />
        )}
      </FormField>
    </FormDialog>
  );
}
