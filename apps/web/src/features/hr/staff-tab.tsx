import { useState } from 'react';
import { CreateStaffRequestSchema, STAFF_STATUSES, todayInIndia } from '@erp/contracts';
import type { Staff } from '@erp/contracts';
import type { ColumnDef } from '@tanstack/react-table';
import { Can } from '@/components/can';
import { DataTable, RowActions, actionsHeader } from '@/components/data-table/data-table';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import { FormDialog } from '@/components/form-dialog';
import { FormField, Input } from '@/components/form-field';
import { Select } from '@/components/select-field';
import { StatusBadge } from '@/components/status-badge';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-provider';
import { isFiltered, useListParams, useSearchBox } from '@/lib/use-list-params';
import { ProblemAlert } from '../payments/payments-shared';
import { describeError } from '../purchasing/purchasing-shared';
import type { Problem } from '../purchasing/purchasing-shared';
import { STAFF_STATUS_TEXT } from './hr-shared';
import { useCandidates, useDepartments, useHrMutations, useStaffList } from './use-hr';

const DEFAULTS = { pageSize: 10, filters: { status: '', department: '' } };

interface FormProps {
  existing: Staff | null;
  onClose: () => void;
  onDone: (message: string) => void;
}

function StaffFormDialog({ existing, onClose, onDone }: FormProps) {
  const { createStaff, updateStaff } = useHrMutations();
  const departments = useDepartments();
  const candidates = useCandidates(existing === null);
  const [userId, setUserId] = useState('');
  const [employeeCode, setEmployeeCode] = useState(existing?.employeeCode ?? '');
  const [department, setDepartment] = useState(existing?.department ?? '');
  const [designation, setDesignation] = useState(existing?.designation ?? '');
  const [joinDate, setJoinDate] = useState(todayInIndia());
  const [salary, setSalary] = useState(existing?.monthlySalary ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<Problem | null>(null);
  const pending = createStaff.isPending || updateStaff.isPending;

  const submit = async () => {
    setProblem(null);
    const values = {
      userId,
      employeeCode: employeeCode.trim(),
      department: department || null,
      designation: designation.trim() || null,
      joinDate,
      monthlySalary: salary.trim(),
    };
    if (existing === null) {
      const parsed = CreateStaffRequestSchema.safeParse(values);
      if (!parsed.success) {
        const found: Record<string, string> = {};
        for (const issue of parsed.error.issues) {
          const field = issue.path.join('.') || 'form';
          if (!found[field]) found[field] = issue.message;
        }
        setErrors(found);
        return;
      }
    }
    setErrors({});
    try {
      if (existing === null) {
        await createStaff.mutateAsync(values);
        onDone(`${values.employeeCode} added as staff`);
      } else {
        await updateStaff.mutateAsync({
          id: existing.id,
          values: {
            employeeCode: values.employeeCode,
            department: values.department,
            designation: values.designation,
            monthlySalary: values.monthlySalary,
            rowVersion: (existing as Staff).rowVersion ?? 1,
          },
        });
        onDone(`${existing.fullName} updated`);
      }
    } catch (error) {
      const described = describeError(error);
      setProblem(described);
      setErrors(described.fields);
    }
  };

  const dirty =
    userId !== '' ||
    employeeCode !== (existing?.employeeCode ?? '') ||
    department !== (existing?.department ?? '') ||
    designation !== (existing?.designation ?? '') ||
    salary !== (existing?.monthlySalary ?? '');

  return (
    <FormDialog
      open
      size="md"
      title={existing ? `Edit ${existing.fullName}` : 'Add staff'}
      description={
        existing
          ? 'A raise applies to payroll made from now on.'
          : 'Choose a person who works in this branch and is not staff yet.'
      }
      onClose={onClose}
      onSubmit={submit}
      saving={pending}
      dirty={dirty}
      submitLabel={existing ? 'Save changes' : 'Add staff'}
      error={problem ? <ProblemAlert problem={problem} /> : undefined}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {existing === null ? (
          <div className="sm:col-span-2">
            <FormField label="Person" error={errors['userId']}>
              {(props) => (
                <Select
                  {...props}
                  value={userId}
                  onChange={(event) => setUserId(event.target.value)}
                >
                  <option value="">Choose a person</option>
                  {(candidates.data ?? []).map((person) => (
                    <option key={person.userId} value={person.userId}>
                      {person.fullName} ({person.username})
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          </div>
        ) : null}
        <FormField label="Employee code" error={errors['employeeCode']}>
          {(props) => (
            <Input
              {...props}
              value={employeeCode}
              onChange={(event) => setEmployeeCode(event.target.value)}
            />
          )}
        </FormField>
        <FormField label="Department" error={errors['department']}>
          {(props) => (
            <Select
              {...props}
              value={department}
              onChange={(event) => setDepartment(event.target.value)}
            >
              <option value="">None</option>
              {(departments.data ?? []).map((item) => (
                <option key={item.code} value={item.code}>
                  {item.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField label="Designation" error={errors['designation']} hint="Optional">
          {(props) => (
            <Input
              {...props}
              value={designation}
              onChange={(event) => setDesignation(event.target.value)}
            />
          )}
        </FormField>
        {existing === null ? (
          <FormField label="Join date" error={errors['joinDate']}>
            {(props) => (
              <Input
                {...props}
                type="date"
                value={joinDate}
                onChange={(event) => setJoinDate(event.target.value)}
              />
            )}
          </FormField>
        ) : null}
        <FormField label="Monthly salary" error={errors['monthlySalary']}>
          {(props) => (
            <Input
              {...props}
              inputMode="decimal"
              value={salary}
              onChange={(event) => setSalary(event.target.value)}
            />
          )}
        </FormField>
      </div>
    </FormDialog>
  );
}

function StatusDialog({
  person,
  onClose,
  onDone,
}: {
  person: Staff;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { deactivate, reactivate } = useHrMutations();
  const leaving = person.status === 'ACTIVE';
  const [date, setDate] = useState(todayInIndia());
  const [problem, setProblem] = useState<Problem | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pending = deactivate.isPending || reactivate.isPending;

  const submit = async () => {
    setProblem(null);
    if (!date) {
      setError('Choose a date');
      return;
    }
    setError(null);
    const rowVersion = person.rowVersion;
    try {
      if (leaving) {
        await deactivate.mutateAsync({ id: person.id, values: { leftOn: date, rowVersion } });
        onDone(`${person.fullName} marked as having left on ${date}`);
      } else {
        await reactivate.mutateAsync({ id: person.id, values: { joinDate: date, rowVersion } });
        onDone(`${person.fullName} is back from ${date}`);
      }
    } catch (caught) {
      const described = describeError(caught);
      setProblem(described);
      setError(described.fields[leaving ? 'leftOn' : 'joinDate'] ?? null);
    }
  };

  return (
    <FormDialog
      open
      title={leaving ? 'Mark as left' : 'Bring back'}
      description={
        leaving
          ? `${person.fullName} keeps their attendance, leave and payroll. They can no longer mark attendance or ask for leave.`
          : `${person.fullName} left on ${person.leftOn}. They start again from the date you choose.`
      }
      onClose={onClose}
      onSubmit={submit}
      saving={pending}
      submitLabel={leaving ? 'Mark as left' : 'Bring back'}
      error={problem ? <ProblemAlert problem={problem} /> : undefined}
    >
      <FormField
        label={leaving ? 'Last working day' : 'Date they rejoin'}
        error={error ?? undefined}
      >
        {(props) => (
          <Input
            {...props}
            type="date"
            value={date}
            onChange={(event) => setDate(event.target.value)}
          />
        )}
      </FormField>
    </FormDialog>
  );
}

type Dialogs = { kind: 'form'; person: Staff | null } | { kind: 'status'; person: Staff } | null;

export function StaffTab() {
  const { can } = useAuth();
  const manager = can('hr.manage');
  const [params, set] = useListParams(DEFAULTS, 'staff');
  const [searchText, setSearchText, clearSearchText] = useSearchBox(params, set);
  const [dialog, setDialog] = useState<Dialogs>(null);
  const status = params.filters['status'] ?? '';
  const department = params.filters['department'] ?? '';
  const departments = useDepartments();
  const query = useStaffList({
    page: params.page,
    pageSize: params.pageSize,
    search: params.search,
    status,
    department,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
  });
  const filtered = isFiltered(params, DEFAULTS);
  const done = (message: string) => {
    toast.success(message);
    setDialog(null);
  };
  const clearFilters = () => {
    clearSearchText();
    set.clear();
  };

  const columns: ColumnDef<Staff, unknown>[] = [
    {
      id: 'person',
      header: 'Person',
      meta: { sortKey: 'employeeCode', alwaysVisible: true, className: 'font-medium', wrap: true },
      cell: ({ row }) => (
        <>
          {row.original.fullName}
          <span className="block text-xs font-normal text-muted-foreground">
            {row.original.employeeCode}
            {row.original.designation ? ` · ${row.original.designation}` : ''}
          </span>
        </>
      ),
    },
    {
      id: 'department',
      header: 'Department',
      cell: ({ row }) => row.original.departmentName ?? '—',
    },
    { accessorKey: 'joinDate', header: 'Joined', meta: { sortKey: 'joinDate' } },
    { accessorKey: 'monthlySalary', header: 'Salary', meta: { align: 'right' } },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <>
          <StatusBadge
            status={row.original.status}
            label={STAFF_STATUS_TEXT[row.original.status]}
          />
          {row.original.leftOn ? (
            <span className="mt-1 block text-xs text-muted-foreground">
              on {row.original.leftOn}
            </span>
          ) : null}
        </>
      ),
    },
    {
      id: 'actions',
      header: actionsHeader,
      enableHiding: false,
      cell: ({ row }) =>
        manager ? (
          <RowActions>
            <Button
              size="sm"
              variant="secondary"
              aria-label={`Edit ${row.original.fullName}`}
              onClick={() => setDialog({ kind: 'form', person: row.original })}
            >
              Edit
            </Button>
            <Button
              size="sm"
              variant="ghost"
              aria-label={`${row.original.status === 'ACTIVE' ? 'Mark as left' : 'Bring back'} ${row.original.fullName}`}
              onClick={() => setDialog({ kind: 'status', person: row.original })}
            >
              {row.original.status === 'ACTIVE' ? 'Mark as left' : 'Bring back'}
            </Button>
          </RowActions>
        ) : null,
    },
  ];

  const chips = [
    ...(status !== ''
      ? [
          {
            label: `Status: ${STAFF_STATUS_TEXT[status as keyof typeof STAFF_STATUS_TEXT] ?? status}`,
            onRemove: () => set.setFilter('status', ''),
          },
        ]
      : []),
    ...(department !== ''
      ? [
          {
            label: `Department: ${(departments.data ?? []).find((item) => item.code === department)?.name ?? department}`,
            onRemove: () => set.setFilter('department', ''),
          },
        ]
      : []),
  ];

  return (
    <>
      <DataTableToolbar
        {...(manager
          ? {
              search: searchText,
              onSearchChange: setSearchText,
              searchLabel: 'Search staff',
              searchPlaceholder: 'Name, code or designation',
              chips,
              onClearFilters: clearFilters,
            }
          : {})}
        onRefresh={query.refetch}
        refreshing={query.isFetching}
        actions={
          <Can permission="hr.manage">
            <Button onClick={() => setDialog({ kind: 'form', person: null })}>Add staff</Button>
          </Can>
        }
      >
        {manager ? (
          <>
            <label className="space-y-1 text-sm font-medium">
              <span>Staff status</span>
              <Select
                className="w-full sm:w-40"
                value={status}
                onChange={(event) => set.setFilter('status', event.target.value)}
              >
                <option value="">All</option>
                {STAFF_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {STAFF_STATUS_TEXT[value]}
                  </option>
                ))}
              </Select>
            </label>
            <label className="space-y-1 text-sm font-medium">
              <span>Department</span>
              <Select
                className="w-full sm:w-44"
                value={department}
                onChange={(event) => set.setFilter('department', event.target.value)}
              >
                <option value="">All</option>
                {(departments.data ?? []).map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.name}
                  </option>
                ))}
              </Select>
            </label>
          </>
        ) : null}
      </DataTableToolbar>
      <DataTable
        label="Staff"
        noun="staff"
        columns={columns}
        query={query}
        getRowId={(row) => row.id}
        filtered={filtered}
        emptyText="No staff profile has been made yet."
        emptyAction={
          filtered ? (
            <Button variant="outline" size="sm" onClick={clearFilters}>
              Clear filters
            </Button>
          ) : undefined
        }
        onPageChange={set.setPage}
        onPageSizeChange={set.setPageSize}
        sort={{ sortBy: params.sortBy, sortOrder: params.sortOrder }}
        onSortChange={set.setSort}
        columnVisibility
      />
      {dialog?.kind === 'form' ? (
        <StaffFormDialog existing={dialog.person} onClose={() => setDialog(null)} onDone={done} />
      ) : null}
      {dialog?.kind === 'status' ? (
        <StatusDialog person={dialog.person} onClose={() => setDialog(null)} onDone={done} />
      ) : null}
    </>
  );
}
