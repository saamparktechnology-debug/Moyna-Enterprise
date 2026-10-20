import { useState } from 'react';
import { CreateBrokerRequestSchema } from '@erp/contracts';
import type { Broker } from '@erp/contracts';
import { FormField, Input } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { describeError } from '../purchasing/purchasing-shared';
import type { Problem } from '../purchasing/purchasing-shared';
import { ProblemAlert } from '../payments/payments-shared';
import { useBrokerMutations } from './use-brokers';

interface Props {
  /** Edit this broker; leave out to add a new one. */
  broker?: Broker;
  onClose: () => void;
  onSaved: (message: string) => void;
}

export function BrokerFormDialog({ broker, onClose, onSaved }: Props) {
  const { create, update } = useBrokerMutations();
  const [name, setName] = useState(broker?.name ?? '');
  const [phone, setPhone] = useState(broker?.phone ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<Problem | null>(null);
  const busy = create.isPending || update.isPending;

  const submit = async () => {
    setProblem(null);
    const request = { name: name.trim(), phone: phone.trim() === '' ? null : phone.trim() };
    const parsed = CreateBrokerRequestSchema.safeParse(request);
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
      if (broker)
        await update.mutateAsync({
          id: broker.id,
          values: { ...request, rowVersion: broker.rowVersion },
        });
      else await create.mutateAsync(request);
      onSaved(broker ? `${request.name} updated` : `Broker ${request.name} added`);
    } catch (error) {
      const described = describeError(error);
      setProblem(described);
      setErrors(described.fields);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => (next || busy ? undefined : onClose())}>
      <DialogContent className="max-w-lg">
        <DialogTitle>{broker ? 'Edit broker' : 'New broker'}</DialogTitle>
        <DialogDescription>
          {broker
            ? 'Change who the broker is.'
            : 'Someone who brings sales and is paid a commission.'}
        </DialogDescription>
        {problem ? (
          <div className="mt-3">
            <ProblemAlert problem={problem} />
          </div>
        ) : null}
        <div className="mt-4 grid gap-4">
          <FormField label="Name" error={errors['name']}>
            {(props) => (
              <Input {...props} value={name} onChange={(event) => setName(event.target.value)} />
            )}
          </FormField>
          <FormField label="Phone" error={errors['phone']} hint="Optional. 10-digit mobile number">
            {(props) => (
              <Input
                {...props}
                inputMode="numeric"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            )}
          </FormField>
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Saving…' : broker ? 'Save changes' : 'Add broker'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
