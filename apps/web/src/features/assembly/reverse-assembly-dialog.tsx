//apps/web/src/features/assembly/reverse-assembly-dialog.tsx
import { useState } from 'react';
import { ReverseAssemblyRequestSchema } from '@erp/contracts';
import type { Assembly } from '@erp/contracts';
import { FormDialog } from '@/components/form-dialog';
import { FormField, Input } from '@/components/form-field';
import { ProblemAlert } from '../payments/payments-shared';
import { describeError } from '../purchasing/purchasing-shared';
import type { Problem } from '../purchasing/purchasing-shared';
import { useAssemblyMutations } from './use-assembly';

/** Takes an assembly apart again. A reason is needed and is kept with the audit trail. */
export function ReverseAssemblyDialog({
  assembly,
  onClose,
  onDone,
}: {
  assembly: Assembly;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { reverse } = useAssemblyMutations();
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | undefined>();
  const [problem, setProblem] = useState<Problem | null>(null);

  const submit = async () => {
    setProblem(null);
    const checked = ReverseAssemblyRequestSchema.safeParse({ reason });
    if (!checked.success) {
      setError(checked.error.issues[0]?.message);
      return;
    }
    setError(undefined);
    try {
      await reverse.mutateAsync({ id: assembly.id, values: checked.data });
      onDone(`${assembly.assemblyNo} reversed`);
    } catch (caught) {
      const described = describeError(caught);
      setProblem(described);
      setError(described.fields['reason']);
    }
  };

  return (
    <FormDialog
      open
      size="md"
      title={`Reverse ${assembly.assemblyNo}`}
      description={`${assembly.finishedItemName} leaves stock and its parts come back. This is refused if the product has already been sold or moved.`}
      onClose={onClose}
      onSubmit={submit}
      saving={reverse.isPending}
      dirty={reason !== ''}
      submitLabel="Reverse assembly"
      error={problem ? <ProblemAlert problem={problem} /> : undefined}
    >
      <FormField label="Reason" error={error}>
        {(props) => (
          <Input {...props} value={reason} onChange={(event) => setReason(event.target.value)} />
        )}
      </FormField>
    </FormDialog>
  );
}
