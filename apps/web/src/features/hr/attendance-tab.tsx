import { useState } from 'react';
import { CorrectAttendanceRequestSchema } from '@erp/contracts';
import type { Attendance } from '@erp/contracts';
import type { ColumnDef } from '@tanstack/react-table';
import { Can } from '@/components/can';
import { DataTable } from '@/components/data-table/data-table';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import { FormDialog } from '@/components/form-dialog';
import { FormField, Input } from '@/components/form-field';
import { Select } from '@/components/select-field';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { useListParams } from '@/lib/use-list-params';
import { ProblemAlert } from '../payments/payments-shared';
import { describeError } from '../purchasing/purchasing-shared';
import type { Problem } from '../purchasing/purchasing-shared';
import { localToIso, thisMonth, timeOf } from './hr-shared';
import { useAttendance, useHrMutations, useStaffList } from './use-hr';

const DEFAULTS = { pageSize: 20, filters: { month: thisMonth() } };

function CorrectDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { correct } = useHrMutations();
  const people = useStaffList({ page: 1, pageSize: 100, search: '', status: '', department: '' });
  const [staffId, setStaffId] = useState('');
  const [workDate, setWorkDate] = useState('');
  const [checkIn, setCheckIn] = useState('');
  const [checkOut, setCheckOut] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<Problem | null>(null);

  const submit = async () => {
    setProblem(null);
    const values = {
      staffId,
      workDate,
      checkIn: checkIn ? localToIso(checkIn) : '',
      checkOut: checkOut ? localToIso(checkOut) : null,
      reason: reason.trim(),
    };
    const parsed = CorrectAttendanceRequestSchema.safeParse(values);
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
      await correct.mutateAsync(values);
      onDone(`Attendance for ${workDate} saved`);
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
      title="Correct attendance"
      description="Sets or changes one day. The check-in must be on that day; the check-out can follow after midnight."
      onClose={onClose}
      onSubmit={submit}
      saving={correct.isPending}
      dirty={
        staffId !== '' || workDate !== '' || checkIn !== '' || checkOut !== '' || reason !== ''
      }
      submitLabel="Save attendance"
      error={problem ? <ProblemAlert problem={problem} /> : undefined}
    >
      <div className="grid gap-4 sm:grid-cols-2">
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
        <FormField label="Working day" error={errors['workDate']}>
          {(props) => (
            <Input
              {...props}
              type="date"
              value={workDate}
              onChange={(event) => setWorkDate(event.target.value)}
            />
          )}
        </FormField>
        <FormField label="Check-in" error={errors['checkIn']}>
          {(props) => (
            <Input
              {...props}
              type="datetime-local"
              value={checkIn}
              onChange={(event) => setCheckIn(event.target.value)}
            />
          )}
        </FormField>
        <FormField
          label="Check-out"
          error={errors['checkOut']}
          hint="Leave empty while the shift is open"
        >
          {(props) => (
            <Input
              {...props}
              type="datetime-local"
              value={checkOut}
              onChange={(event) => setCheckOut(event.target.value)}
            />
          )}
        </FormField>
        <FormField label="Reason" error={errors['reason']}>
          {(props) => (
            <Input {...props} value={reason} onChange={(event) => setReason(event.target.value)} />
          )}
        </FormField>
      </div>
    </FormDialog>
  );
}

export function AttendanceTab() {
  const [params, set] = useListParams(DEFAULTS, 'attend');
  const [correcting, setCorrecting] = useState(false);
  const month = params.filters['month'] || thisMonth();
  const query = useAttendance({ page: params.page, pageSize: params.pageSize, month });

  const columns: ColumnDef<Attendance, unknown>[] = [
    { accessorKey: 'workDate', header: 'Day', meta: { alwaysVisible: true } },
    {
      id: 'person',
      header: 'Person',
      meta: { className: 'font-medium', wrap: true },
      cell: ({ row }) => (
        <>
          {row.original.staffName}
          <span className="block text-xs font-normal text-muted-foreground">
            {row.original.employeeCode}
          </span>
        </>
      ),
    },
    { id: 'in', header: 'In', cell: ({ row }) => timeOf(row.original.checkIn) },
    {
      id: 'out',
      header: 'Out',
      cell: ({ row }) =>
        row.original.state === 'OPEN' ? 'Still open' : timeOf(row.original.checkOut),
    },
    {
      id: 'hours',
      header: 'Hours',
      meta: { align: 'right' },
      cell: ({ row }) => row.original.hoursWorked ?? '—',
    },
    {
      id: 'correction',
      header: 'Correction',
      meta: { className: 'text-xs text-muted-foreground', wrap: true },
      cell: ({ row }) =>
        row.original.correctionReason
          ? `${row.original.correctionReason} (${row.original.correctedByName ?? 'a manager'})`
          : '—',
    },
  ];

  return (
    <>
      <DataTableToolbar
        onRefresh={query.refetch}
        refreshing={query.isFetching}
        actions={
          <Can permission="hr.manage">
            <Button onClick={() => setCorrecting(true)}>Correct attendance</Button>
          </Can>
        }
      >
        <label className="space-y-1 text-sm font-medium">
          <span>Attendance month</span>
          <Input
            type="month"
            className="w-full sm:w-44"
            value={month}
            onChange={(event) => set.setFilter('month', event.target.value || thisMonth())}
          />
        </label>
      </DataTableToolbar>
      {query.data ? (
        <p className="text-sm text-muted-foreground">
          {query.data.daysPresent} {query.data.daysPresent === 1 ? 'day' : 'days'} present in{' '}
          {month}
        </p>
      ) : null}
      <DataTable
        label="Attendance"
        noun="attendance"
        columns={columns}
        query={query}
        getRowId={(row) => row.id}
        filtered={false}
        emptyText="No attendance was recorded in this month."
        onPageChange={set.setPage}
        onPageSizeChange={set.setPageSize}
        columnVisibility
      />
      {correcting ? (
        <CorrectDialog
          onClose={() => setCorrecting(false)}
          onDone={(message) => {
            toast.success(message);
            setCorrecting(false);
          }}
        />
      ) : null}
    </>
  );
}
