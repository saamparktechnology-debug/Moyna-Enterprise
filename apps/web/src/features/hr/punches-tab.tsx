//apps/web/src/features/hr/punches-tab.tsx
import { useState } from 'react';
import { CreatePunchRequestSchema, UpdatePunchRequestSchema, todayInIndia } from '@erp/contracts';
import type { Punch } from '@erp/contracts';
import { Can } from '@/components/can';
import { Alert } from '@/components/alert';
import { SimpleTable } from '@/components/data-table/simple-table';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import { FormDialog } from '@/components/form-dialog';
import { FormField, Input } from '@/components/form-field';
import { LoadingState } from '@/components/loading-state';
import { Select } from '@/components/select-field';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-provider';
import { ProblemAlert } from '../payments/payments-shared';
import { describeError } from '../purchasing/purchasing-shared';
import type { Problem } from '../purchasing/purchasing-shared';
import { isoToLocal, localToIso, minutesText, timeOf } from './hr-shared';
import { useHrMutations, usePunches, useStaffList } from './use-hr';

type Target = { kind: 'add' } | { kind: 'edit'; punch: Punch } | { kind: 'remove'; punch: Punch };

/** Adds, changes or removes one punch. Every change needs a reason, which is kept with the old times. */
function PunchDialog({
  target,
  date,
  onClose,
  onDone,
}: {
  target: Target;
  date: string;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { addPunch, editPunch, deletePunch } = useHrMutations();
  const people = useStaffList({ page: 1, pageSize: 100, search: '', status: '', department: '' });
  const current = target.kind === 'add' ? null : target.punch;
  const [staffId, setStaffId] = useState('');
  const [punchedIn, setPunchedIn] = useState(
    current ? isoToLocal(current.punchedInAt) : `${date}T09:00`,
  );
  const [punchedOut, setPunchedOut] = useState(
    current?.punchedOutAt ? isoToLocal(current.punchedOutAt) : '',
  );
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<Problem | null>(null);
  const saving = addPunch.isPending || editPunch.isPending || deletePunch.isPending;

  const fail = (error: unknown) => {
    const described = describeError(error);
    setProblem(described);
    setErrors(described.fields);
  };

  const submit = async () => {
    setProblem(null);
    setErrors({});
    try {
      if (target.kind === 'remove') {
        if (reason.trim() === '') {
          setErrors({ reason: 'Enter the reason' });
          return;
        }
        await deletePunch.mutateAsync({
          id: target.punch.id,
          values: { reason: reason.trim(), rowVersion: target.punch.rowVersion },
        });
        onDone('Punch removed');
        return;
      }
      if (target.kind === 'add') {
        const values = {
          staffId,
          punchedInAt: punchedIn ? localToIso(punchedIn) : '',
          punchedOutAt: punchedOut ? localToIso(punchedOut) : null,
          reason: reason.trim(),
        };
        const checked = CreatePunchRequestSchema.safeParse(values);
        if (!checked.success) {
          setErrors(
            Object.fromEntries(
              checked.error.issues.map((i) => [String(i.path[0] ?? ''), i.message]),
            ),
          );
          return;
        }
        await addPunch.mutateAsync(values);
        onDone('Punch added');
        return;
      }
      const values = {
        punchedInAt: localToIso(punchedIn),
        punchedOutAt: punchedOut ? localToIso(punchedOut) : null,
        reason: reason.trim(),
        rowVersion: target.punch.rowVersion,
      };
      const checked = UpdatePunchRequestSchema.safeParse(values);
      if (!checked.success) {
        setErrors(
          Object.fromEntries(checked.error.issues.map((i) => [String(i.path[0] ?? ''), i.message])),
        );
        return;
      }
      await editPunch.mutateAsync({ id: target.punch.id, values });
      onDone('Punch saved');
    } catch (error) {
      fail(error);
    }
  };

  const title =
    target.kind === 'add'
      ? 'Add a punch'
      : target.kind === 'edit'
        ? 'Change a punch'
        : 'Remove a punch';
  return (
    <FormDialog
      open
      size="md"
      title={title}
      description={
        target.kind === 'remove'
          ? `Takes away the punch of ${target.punch.staffName} from ${timeOf(target.punch.punchedInAt)}. What it was is kept in the audit trail.`
          : 'Times are in India time. Leave the punch out empty while the person is still in.'
      }
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      dirty={reason !== '' || staffId !== ''}
      submitLabel={target.kind === 'remove' ? 'Remove punch' : 'Save punch'}
      error={problem ? <ProblemAlert problem={problem} /> : undefined}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {target.kind === 'add' ? (
          <div className="sm:col-span-2">
            <FormField label="Person" error={errors['staffId']}>
              {(props) => (
                <Select
                  {...props}
                  value={staffId}
                  onChange={(event) => setStaffId(event.target.value)}
                >
                  <option value="">Choose a person</option>
                  {(people.data?.items ?? []).map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.fullName} · {person.employeeCode}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          </div>
        ) : null}
        {target.kind !== 'remove' ? (
          <>
            <FormField label="Punch in" error={errors['punchedInAt']}>
              {(props) => (
                <Input
                  {...props}
                  type="datetime-local"
                  value={punchedIn}
                  onChange={(event) => setPunchedIn(event.target.value)}
                />
              )}
            </FormField>
            <FormField
              label="Punch out"
              error={errors['punchedOutAt']}
              hint="Empty while the person is still in"
            >
              {(props) => (
                <Input
                  {...props}
                  type="datetime-local"
                  value={punchedOut}
                  onChange={(event) => setPunchedOut(event.target.value)}
                />
              )}
            </FormField>
          </>
        ) : null}
        <div className="sm:col-span-2">
          <FormField label="Reason" error={errors['reason']} hint="Kept with the change">
            {(props) => (
              <Input
                {...props}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            )}
          </FormField>
        </div>
      </div>
    </FormDialog>
  );
}

/** Everyone's punches for one day, for managers. Those allowed to edit punch times can add, change and remove them. */
export function PunchesTab() {
  const { can } = useAuth();
  const [date, setDate] = useState(todayInIndia());
  const [staffId, setStaffId] = useState('');
  const [target, setTarget] = useState<Target | null>(null);
  const query = usePunches(date, staffId);
  const people = useStaffList({ page: 1, pageSize: 100, search: '', status: '', department: '' });
  const canEdit = can('attendance.edit_punches');

  const columns = [
    {
      header: 'Person',
      cell: (row: Punch) => (
        <>
          <span className="font-medium">{row.staffName}</span>
          <span className="block text-xs text-muted-foreground">{row.employeeCode}</span>
        </>
      ),
    },
    { header: 'Punch in', cell: (row: Punch) => timeOf(row.punchedInAt) },
    {
      header: 'Punch out',
      cell: (row: Punch) => (row.punchedOutAt ? timeOf(row.punchedOutAt) : 'Still in'),
    },
    {
      header: 'Time',
      align: 'right' as const,
      cell: (row: Punch) => (row.minutes === null ? '—' : minutesText(row.minutes)),
    },
    {
      header: 'Changed',
      cell: (row: Punch) =>
        row.editReason ? `${row.editReason} (${row.editedByName ?? 'a manager'})` : '—',
    },
    ...(canEdit
      ? [
          {
            header: 'Actions',
            cell: (row: Punch) => (
              <span className="flex gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={`Change punch of ${row.staffName} at ${timeOf(row.punchedInAt)}`}
                  onClick={() => setTarget({ kind: 'edit', punch: row })}
                >
                  Change
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  aria-label={`Remove punch of ${row.staffName} at ${timeOf(row.punchedInAt)}`}
                  onClick={() => setTarget({ kind: 'remove', punch: row })}
                >
                  Remove
                </Button>
              </span>
            ),
          },
        ]
      : []),
  ];

  return (
    <>
      <DataTableToolbar
        onRefresh={query.refetch}
        refreshing={query.isFetching}
        actions={
          <Can permission="attendance.edit_punches">
            <Button onClick={() => setTarget({ kind: 'add' })}>Add a punch</Button>
          </Can>
        }
      >
        <label className="space-y-1 text-sm font-medium">
          <span>Day</span>
          <Input
            type="date"
            className="w-full sm:w-44"
            value={date}
            onChange={(event) => setDate(event.target.value || todayInIndia())}
          />
        </label>
        <label className="space-y-1 text-sm font-medium">
          <span>Person</span>
          <Select
            className="w-full sm:w-56"
            value={staffId}
            onChange={(event) => setStaffId(event.target.value)}
          >
            <option value="">Everyone</option>
            {(people.data?.items ?? []).map((person) => (
              <option key={person.id} value={person.id}>
                {person.fullName}
              </option>
            ))}
          </Select>
        </label>
      </DataTableToolbar>
      {query.isPending ? (
        <LoadingState label="Loading the punches…" rows={3} />
      ) : query.isError ? (
        <Alert tone="error">Could not load the punches.</Alert>
      ) : (query.data?.items.length ?? 0) === 0 ? (
        <p className="text-sm text-muted-foreground">No one punched in on this day.</p>
      ) : (
        <SimpleTable
          label="Punches"
          rows={query.data?.items ?? []}
          getRowKey={(row) => row.id}
          columns={columns}
        />
      )}
      {target ? (
        <PunchDialog
          target={target}
          date={date}
          onClose={() => setTarget(null)}
          onDone={(message) => {
            toast.success(message);
            setTarget(null);
          }}
        />
      ) : null}
    </>
  );
}
