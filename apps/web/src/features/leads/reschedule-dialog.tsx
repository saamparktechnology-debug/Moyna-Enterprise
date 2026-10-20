import { useState } from 'react';
import { RescheduleFollowupRequestSchema } from '@erp/contracts';
import type { Followup } from '@erp/contracts';
import { FormDialog } from '@/components/form-dialog';
import { FormField, Input } from '@/components/form-field';
import { ProblemAlert } from '../payments/payments-shared';
import { describeError } from '../purchasing/purchasing-shared';
import type { Problem } from '../purchasing/purchasing-shared';
import { formatWhen } from './leads-shared';
import { useLeadMutations } from './use-leads';

interface Props {
  followup: Followup;
  onClose: () => void;
  onMoved: (message: string) => void;
}

/** Moves a follow-up that is still waiting to another time, with the reason it was moved. */
export function RescheduleDialog({ followup, onClose, onMoved }: Props) {
  const { reschedule } = useLeadMutations();
  const [dueAt, setDueAt] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<Problem | null>(null);

  const submit = async () => {
    setProblem(null);
    const values = {
      dueAt: dueAt ? new Date(dueAt).toISOString() : '',
      rowVersion: followup.rowVersion,
      reason: reason.trim(),
    };
    const parsed = RescheduleFollowupRequestSchema.safeParse(values);
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
      await reschedule.mutateAsync({ id: followup.id, values });
      onMoved(`Follow-up for ${followup.leadName} moved to ${formatWhen(values.dueAt)}`);
    } catch (error) {
      const described = describeError(error);
      setProblem(described);
      setErrors(described.fields);
    }
  };

  return (
    <FormDialog
      open
      title="Move follow-up"
      description={`${followup.leadName}, now due ${formatWhen(followup.dueAt)}${
        followup.rescheduledCount > 0
          ? `. Moved ${followup.rescheduledCount} ${followup.rescheduledCount === 1 ? 'time' : 'times'} already`
          : ''
      }`}
      onClose={onClose}
      onSubmit={submit}
      saving={reschedule.isPending}
      savingLabel="Moving…"
      dirty={dueAt !== '' || reason !== ''}
      submitLabel="Move follow-up"
      error={problem ? <ProblemAlert problem={problem} /> : undefined}
    >
      <FormField label="New date and time" error={errors['dueAt']}>
        {(props) => (
          <Input
            {...props}
            type="datetime-local"
            value={dueAt}
            onChange={(event) => setDueAt(event.target.value)}
          />
        )}
      </FormField>
      <FormField label="Why it is moved" error={errors['reason']}>
        {(props) => (
          <Input {...props} value={reason} onChange={(event) => setReason(event.target.value)} />
        )}
      </FormField>
    </FormDialog>
  );
}
