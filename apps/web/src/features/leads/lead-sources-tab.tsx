import { useState } from 'react';
import { CreateLeadSourceRequestSchema } from '@erp/contracts';
import type { LeadSourceAdmin } from '@erp/contracts';
import { SimpleTable } from '@/components/data-table/simple-table';
import { ErrorState } from '@/components/error-state';
import { FormDialog } from '@/components/form-dialog';
import { FormField, Input } from '@/components/form-field';
import { LoadingState } from '@/components/loading-state';
import { StatusBadge } from '@/components/status-badge';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { ProblemAlert } from '../payments/payments-shared';
import { describeError } from '../purchasing/purchasing-shared';
import type { Problem } from '../purchasing/purchasing-shared';
import { useLeadSourceAdmin, useLeadSourceMutations } from './use-leads';

type Editing = { kind: 'new' } | { kind: 'rename'; source: LeadSourceAdmin } | null;

function SourceDialog({
  editing,
  onClose,
  onDone,
}: {
  editing: Exclude<Editing, null>;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { create, update } = useLeadSourceMutations();
  const existing = editing.kind === 'rename' ? editing.source : null;
  const [code, setCode] = useState('');
  const [name, setName] = useState(existing?.name ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<Problem | null>(null);
  const pending = create.isPending || update.isPending;

  const submit = async () => {
    setProblem(null);
    try {
      if (existing) {
        if (name.trim().length < 2) {
          setErrors({ name: 'Use at least 2 characters' });
          return;
        }
        await update.mutateAsync({
          code: existing.code,
          values: { name: name.trim(), rowVersion: existing.rowVersion },
        });
        onDone(`${existing.code} is now called ${name.trim()}`);
        return;
      }
      const parsed = CreateLeadSourceRequestSchema.safeParse({
        code: code.trim(),
        name: name.trim(),
      });
      if (!parsed.success) {
        const found: Record<string, string> = {};
        for (const issue of parsed.error.issues)
          if (!found[issue.path.join('.')]) found[issue.path.join('.')] = issue.message;
        setErrors(found);
        return;
      }
      await create.mutateAsync(parsed.data);
      onDone(`${name.trim()} added as a lead source`);
    } catch (error) {
      const described = describeError(error);
      setProblem(described);
      setErrors(described.fields);
    }
  };

  return (
    <FormDialog
      open
      title={existing ? `Rename ${existing.code}` : 'Add a lead source'}
      description={
        existing
          ? 'The code never changes, so leads keep their source.'
          : 'Choose a short code in capitals, such as TRADE_SHOW.'
      }
      onClose={onClose}
      onSubmit={submit}
      saving={pending}
      dirty={name !== (existing?.name ?? '') || code !== ''}
      submitLabel={existing ? 'Save name' : 'Add source'}
      error={problem ? <ProblemAlert problem={problem} /> : undefined}
    >
      {existing ? null : (
        <FormField label="Code" error={errors['code']}>
          {(props) => (
            <Input {...props} value={code} onChange={(event) => setCode(event.target.value)} />
          )}
        </FormField>
      )}
      <FormField label="Name" error={errors['name']}>
        {(props) => (
          <Input {...props} value={name} onChange={(event) => setName(event.target.value)} />
        )}
      </FormField>
    </FormDialog>
  );
}

/** Where leads come from: added, renamed and switched on or off, never deleted. */
export function LeadSourcesTab() {
  const query = useLeadSourceAdmin();
  const { update } = useLeadSourceMutations();
  const [editing, setEditing] = useState<Editing>(null);
  const [problem, setProblem] = useState<Problem | null>(null);

  const toggle = async (source: LeadSourceAdmin) => {
    setProblem(null);
    try {
      await update.mutateAsync({
        code: source.code,
        values: { isActive: !source.isActive, rowVersion: source.rowVersion },
      });
      toast.success(`${source.name} switched ${source.isActive ? 'off' : 'on'}`);
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  return (
    <>
      <div className="flex justify-end">
        <Button onClick={() => setEditing({ kind: 'new' })}>Add source</Button>
      </div>
      {problem ? <ProblemAlert problem={problem} /> : null}
      {query.isPending ? (
        <LoadingState label="Loading the sources…" rows={3} />
      ) : query.isError ? (
        <ErrorState onRetry={query.refetch}>Could not load the lead sources.</ErrorState>
      ) : (
        <SimpleTable
          label="Lead sources"
          rows={query.data}
          getRowKey={(source) => source.code}
          emptyText="No lead sources yet."
          columns={[
            {
              header: 'Source',
              className: 'font-medium',
              cell: (source) => (
                <>
                  {source.name}
                  <span className="block text-xs font-normal text-muted-foreground">
                    {source.code}
                  </span>
                </>
              ),
            },
            { header: 'Leads', align: 'right', cell: (source) => source.leadCount },
            {
              header: 'Status',
              cell: (source) => (
                <StatusBadge
                  status={source.isActive ? 'ACTIVE' : 'INACTIVE'}
                  label={source.isActive ? 'On' : 'Off'}
                />
              ),
            },
            {
              header: <span className="sr-only">Actions</span>,
              align: 'right',
              cell: (source) => (
                <div className="flex justify-end gap-1">
                  <Button
                    size="sm"
                    variant="secondary"
                    aria-label={`Rename ${source.name}`}
                    onClick={() => setEditing({ kind: 'rename', source })}
                  >
                    Rename
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    disabled={update.isPending}
                    aria-label={`Switch ${source.isActive ? 'off' : 'on'} ${source.name}`}
                    onClick={() => void toggle(source)}
                  >
                    {source.isActive ? 'Switch off' : 'Switch on'}
                  </Button>
                </div>
              ),
            },
          ]}
        />
      )}
      {editing ? (
        <SourceDialog
          editing={editing}
          onClose={() => setEditing(null)}
          onDone={(message) => {
            toast.success(message);
            setEditing(null);
          }}
        />
      ) : null}
    </>
  );
}
