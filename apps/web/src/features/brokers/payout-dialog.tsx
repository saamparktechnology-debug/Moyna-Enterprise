import { useState } from 'react';
import type { Commission } from '@erp/contracts';
import { FormField, Input } from '@/components/form-field';
import { FormDialog } from '@/components/form-dialog';
import { describeError } from '../purchasing/purchasing-shared';
import type { Problem } from '../purchasing/purchasing-shared';
import { ProblemAlert } from '../payments/payments-shared';
import { useBrokerMutations } from './use-brokers';

interface Props {
  commissions: Commission[];
  onClose: () => void;
  onPaid: (message: string) => void;
}

/** Pays the chosen commissions to their broker, each at what it is worth now. */
export function PayoutDialog({ commissions, onClose, onPaid }: Props) {
  const { payout } = useBrokerMutations();
  const [reference, setReference] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  const brokerName = commissions[0]?.brokerName ?? '';
  const total = commissions.reduce((sum, item) => sum + Number(item.effective), 0).toFixed(2);

  const submit = async () => {
    setProblem(null);
    try {
      const result = await payout.mutateAsync({
        commissionIds: commissions.map((item) => item.id),
        ...(reference.trim() ? { reference: reference.trim() } : {}),
      });
      onPaid(`${result.total} paid out to ${result.brokerName}`);
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  return (
    <FormDialog
      open
      title="Pay out commission"
      description={`${commissions.length} ${commissions.length === 1 ? 'commission' : 'commissions'} to ${brokerName}.`}
      onClose={onClose}
      onSubmit={submit}
      saving={payout.isPending}
      savingLabel="Paying…"
      submitLabel="Pay out"
      error={problem ? <ProblemAlert problem={problem} /> : undefined}
    >
      <ul
        aria-label="Commissions to pay"
        className="space-y-1 rounded-lg border bg-muted/30 p-3 text-sm"
      >
        {commissions.map((item) => (
          <li key={item.id} className="tabular flex justify-between gap-3">
            <span>{item.invoiceNo ?? 'Invoice'}</span>
            <span>{item.effective}</span>
          </li>
        ))}
      </ul>
      <p className="tabular text-sm font-semibold">Total to pay: {total}</p>
      <FormField label="Reference" hint="Optional. Cheque, UPI or bank transfer number">
        {(props) => (
          <Input
            {...props}
            value={reference}
            onChange={(event) => setReference(event.target.value)}
          />
        )}
      </FormField>
    </FormDialog>
  );
}
