//apps/web/src/features/items/hsn-codes-dialog.tsx
import { useState } from 'react';
import { CreateHsnRequestSchema, UpdateHsnRequestSchema } from '@erp/contracts';
import type { ManagedHsn } from '@erp/contracts';
import { Alert } from '@/components/alert';
import { SimpleTable } from '@/components/data-table/simple-table';
import { FormDialog } from '@/components/form-dialog';
import { FormField, Input } from '@/components/form-field';
import { LoadingState } from '@/components/loading-state';
import { Select } from '@/components/select-field';
import { StatusBadge } from '@/components/status-badge';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { ProblemAlert } from '../payments/payments-shared';
import { describeError } from '../purchasing/purchasing-shared';
import type { Problem } from '../purchasing/purchasing-shared';
import { useGstRates, useHsnMutations, useManagedHsn } from './use-items';

type Target = { kind: 'add' } | { kind: 'edit'; hsn: ManagedHsn };

/** Adds an HSN code, or changes the description and GST rate of one. The code itself never changes. */
function HsnFormDialog({
  target,
  onClose,
  onDone,
}: {
  target: Target;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { create, update } = useHsnMutations();
  const rates = useGstRates().data ?? [];
  const current = target.kind === 'edit' ? target.hsn : null;
  const [code, setCode] = useState(current?.code ?? '');
  const [description, setDescription] = useState(current?.description ?? '');
  const [gstRate, setGstRate] = useState(current?.gstRate ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<Problem | null>(null);

  const submit = async () => {
    setProblem(null);
    const rate = gstRate === '' ? null : gstRate;
    const values =
      target.kind === 'add'
        ? { code: code.trim(), description: description.trim(), gstRate: rate }
        : {
            description: description.trim(),
            gstRate: rate,
            rowVersion: target.hsn.rowVersion,
          };
    const checked =
      target.kind === 'add'
        ? CreateHsnRequestSchema.safeParse(values)
        : UpdateHsnRequestSchema.safeParse(values);
    if (!checked.success) {
      setErrors(
        Object.fromEntries(checked.error.issues.map((i) => [String(i.path[0] ?? ''), i.message])),
      );
      return;
    }
    setErrors({});
    try {
      if (target.kind === 'add') {
        await create.mutateAsync(
          values as { code: string; description: string; gstRate: string | null },
        );
        onDone(`HSN code ${code.trim()} added`);
      } else {
        await update.mutateAsync({ code: target.hsn.code, values: values as never });
        onDone(`HSN code ${target.hsn.code} saved`);
      }
    } catch (error) {
      const described = describeError(error);
      setProblem(described);
      setErrors(described.fields);
    }
  };

  return (
    <FormDialog
      open
      size="md"
      title={target.kind === 'add' ? 'Add an HSN code' : `Change HSN code ${target.hsn.code}`}
      description="An HSN code has 4 to 8 digits. The GST rate is only a starting point: the biller chooses the rate on each bill."
      onClose={onClose}
      onSubmit={submit}
      saving={create.isPending || update.isPending}
      dirty={code !== (current?.code ?? '') || description !== (current?.description ?? '')}
      submitLabel="Save HSN code"
      error={problem ? <ProblemAlert problem={problem} /> : undefined}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {target.kind === 'add' ? (
          <FormField label="HSN code" error={errors['code']} hint="4 to 8 digits">
            {(props) => (
              <Input
                {...props}
                inputMode="numeric"
                autoComplete="off"
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            )}
          </FormField>
        ) : null}
        <FormField label="GST rate" error={errors['gstRate']} hint="Optional">
          {(props) => (
            <Select {...props} value={gstRate} onChange={(event) => setGstRate(event.target.value)}>
              <option value="">None</option>
              {rates.map((rate) => (
                <option key={rate.rate} value={rate.rate}>
                  {rate.label}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <div className="sm:col-span-2">
          <FormField label="Description" error={errors['description']}>
            {(props) => (
              <Input
                {...props}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            )}
          </FormField>
        </div>
      </div>
    </FormDialog>
  );
}

/** The list of HSN codes: search it, add a code, change one, or switch one off. */
export function HsnCodesDialog({ onClose }: { onClose: () => void }) {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('all');
  const [page, setPage] = useState(1);
  const [target, setTarget] = useState<Target | null>(null);
  const { update } = useHsnMutations();
  const debounced = useDebouncedValue(search, 250);
  const query = useManagedHsn({ page, pageSize: 10, search: debounced, status });
  const [problem, setProblem] = useState<Problem | null>(null);

  const toggle = async (hsn: ManagedHsn) => {
    setProblem(null);
    try {
      await update.mutateAsync({
        code: hsn.code,
        values: { isActive: !hsn.isActive, rowVersion: hsn.rowVersion },
      });
      toast.success(`HSN code ${hsn.code} ${hsn.isActive ? 'switched off' : 'switched on'}`);
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogTitle>HSN codes</DialogTitle>
        <DialogDescription>
          The codes you can give an item or an invoice line. Any 4 to 8 digit code can be typed on
          an item or a bill; it is added here when it is first used. Switching a code off keeps it
          on the items that have it.
        </DialogDescription>
        {problem ? <ProblemAlert problem={problem} /> : null}
        <div className="mt-4 flex flex-wrap items-end gap-3">
          <label className="space-y-1 text-sm font-medium">
            <span>Search HSN codes</span>
            <input
              className="h-control w-full rounded-md border bg-card px-3 sm:w-60"
              value={search}
              placeholder="Code or description"
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
            />
          </label>
          <label className="space-y-1 text-sm font-medium">
            <span>Show</span>
            <Select
              className="w-full sm:w-36"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value);
                setPage(1);
              }}
            >
              <option value="all">All</option>
              <option value="active">Switched on</option>
              <option value="inactive">Switched off</option>
            </Select>
          </label>
          <Button className="ml-auto" onClick={() => setTarget({ kind: 'add' })}>
            Add an HSN code
          </Button>
        </div>
        <div className="mt-3">
          {query.isPending ? (
            <LoadingState label="Loading the HSN codes…" rows={3} />
          ) : query.isError ? (
            <Alert tone="error">Could not load the HSN codes.</Alert>
          ) : (query.data?.items.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No HSN code matches.</p>
          ) : (
            <SimpleTable
              label="HSN codes"
              rows={query.data?.items ?? []}
              getRowKey={(row) => row.code}
              columns={[
                { header: 'Code', cell: (row) => <span className="font-medium">{row.code}</span> },
                { header: 'Description', cell: (row) => row.description },
                { header: 'GST rate', align: 'right', cell: (row) => row.gstRate ?? '—' },
                { header: 'Items', align: 'right', cell: (row) => row.usedBy },
                {
                  header: 'Status',
                  cell: (row) => (
                    <StatusBadge
                      status={row.isActive ? 'ACTIVE' : 'INACTIVE'}
                      label={row.isActive ? 'On' : 'Off'}
                    />
                  ),
                },
                {
                  header: 'Actions',
                  cell: (row) => (
                    <span className="flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        aria-label={`Change HSN code ${row.code}`}
                        onClick={() => setTarget({ kind: 'edit', hsn: row })}
                      >
                        Change
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        disabled={update.isPending}
                        aria-label={`${row.isActive ? 'Switch off' : 'Switch on'} HSN code ${row.code}`}
                        onClick={() => void toggle(row)}
                      >
                        {row.isActive ? 'Switch off' : 'Switch on'}
                      </Button>
                    </span>
                  ),
                },
              ]}
            />
          )}
        </div>
        {(query.data?.totalPages ?? 0) > 1 ? (
          <div className="mt-3 flex items-center justify-between text-sm">
            <span className="text-muted-foreground">
              Page {query.data?.page} of {query.data?.totalPages}
            </span>
            <span className="flex gap-2">
              <Button
                variant="secondary"
                size="sm"
                disabled={page <= 1}
                onClick={() => setPage(page - 1)}
              >
                Previous
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={page >= (query.data?.totalPages ?? 1)}
                onClick={() => setPage(page + 1)}
              >
                Next
              </Button>
            </span>
          </div>
        ) : null}
        <div className="mt-6 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
        {target ? (
          <HsnFormDialog
            target={target}
            onClose={() => setTarget(null)}
            onDone={(message) => {
              toast.success(message);
              setTarget(null);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
