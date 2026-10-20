import { useState } from 'react';
import { PAYROLL_STATUSES } from '@erp/contracts';
import type { Payroll } from '@erp/contracts';
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
import { useListParams } from '@/lib/use-list-params';
import { ProblemAlert } from '../payments/payments-shared';
import { describeError } from '../purchasing/purchasing-shared';
import type { Problem } from '../purchasing/purchasing-shared';
import { PAYROLL_STATUS_TEXT, lastMonth } from './hr-shared';
import { useHrMutations, usePayroll } from './use-hr';

const DEFAULTS = { pageSize: 10, filters: { month: lastMonth(), status: '' } };

function EditDialog({
  record,
  onClose,
  onDone,
}: {
  record: Payroll;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { updatePayroll } = useHrMutations();
  const [deductions, setDeductions] = useState(record.deductions);
  const [note, setNote] = useState(record.deductionNote ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<Problem | null>(null);

  const submit = async () => {
    setProblem(null);
    if (!/^\d+(\.\d{1,2})?$/.test(deductions.trim())) {
      setErrors({ deductions: 'Enter an amount in rupees, such as 500 or 500.50' });
      return;
    }
    setErrors({});
    try {
      await updatePayroll.mutateAsync({
        id: record.id,
        values: {
          deductions: deductions.trim(),
          ...(note.trim() ? { deductionNote: note.trim() } : {}),
          rowVersion: record.rowVersion,
        },
      });
      onDone(`Deductions for ${record.staffName} saved`);
    } catch (error) {
      const described = describeError(error);
      setProblem(described);
      setErrors(described.fields);
    }
  };

  return (
    <FormDialog
      open
      title="Deductions"
      description={`${record.staffName}, ${record.month}. Pay for the days worked is ${record.gross}.`}
      onClose={onClose}
      onSubmit={submit}
      saving={updatePayroll.isPending}
      dirty={deductions !== record.deductions || note !== (record.deductionNote ?? '')}
      submitLabel="Save deductions"
      error={problem ? <ProblemAlert problem={problem} /> : undefined}
    >
      <FormField label="Deductions" error={errors['deductions']}>
        {(props) => (
          <Input
            {...props}
            inputMode="decimal"
            value={deductions}
            onChange={(event) => setDeductions(event.target.value)}
          />
        )}
      </FormField>
      <FormField label="Note" error={errors['deductionNote']} hint="Optional">
        {(props) => (
          <Input {...props} value={note} onChange={(event) => setNote(event.target.value)} />
        )}
      </FormField>
    </FormDialog>
  );
}

export function PayrollTab() {
  const { can } = useAuth();
  const manager = can('hr.manage');
  const [params, set] = useListParams(DEFAULTS, 'pay');
  const [editing, setEditing] = useState<Payroll | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const month = params.filters['month'] || lastMonth();
  const status = params.filters['status'] ?? '';
  const query = usePayroll({
    page: params.page,
    pageSize: params.pageSize,
    month,
    status,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
  });
  const { generate, finalize } = useHrMutations();
  const busy = generate.isPending || finalize.isPending;

  const run = async (action: () => Promise<string>) => {
    setProblem(null);
    try {
      toast.success(await action());
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  const columns: ColumnDef<Payroll, unknown>[] = [
    {
      id: 'person',
      header: 'Person',
      meta: { alwaysVisible: true, className: 'font-medium', wrap: true },
      cell: ({ row }) => (
        <>
          {row.original.staffName}
          <span className="block text-xs font-normal text-muted-foreground">
            {row.original.employeeCode} · {row.original.month}
          </span>
        </>
      ),
    },
    {
      id: 'days',
      header: 'Days',
      cell: ({ row }) => (
        <>
          {row.original.daysEmployed} of {row.original.daysInMonth}
          <span className="block text-xs text-muted-foreground">
            {row.original.daysPresent} present
          </span>
        </>
      ),
    },
    {
      id: 'leave',
      header: 'Leave',
      cell: ({ row }) => (
        <>
          {row.original.paidLeaveDays} paid, {row.original.unpaidLeaveDays} unpaid
        </>
      ),
    },
    { accessorKey: 'gross', header: 'Pay', meta: { align: 'right' } },
    {
      id: 'deductions',
      header: 'Deductions',
      meta: { align: 'right' },
      cell: ({ row }) => (
        <>
          {row.original.deductions}
          {row.original.deductionNote ? (
            <span className="block text-xs text-muted-foreground">
              {row.original.deductionNote}
            </span>
          ) : null}
        </>
      ),
    },
    {
      accessorKey: 'net',
      header: 'Net',
      meta: { sortKey: 'net', align: 'right', className: 'font-medium' },
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <>
          <StatusBadge
            status={row.original.status}
            label={PAYROLL_STATUS_TEXT[row.original.status]}
          />
          {row.original.finalizedByName ? (
            <span className="mt-1 block text-xs text-muted-foreground">
              by {row.original.finalizedByName}
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
        manager && row.original.status === 'DRAFT' ? (
          <RowActions>
            <Button
              size="sm"
              variant="secondary"
              disabled={busy}
              aria-label={`Change deductions of ${row.original.staffName}`}
              onClick={() => setEditing(row.original)}
            >
              Deductions
            </Button>
            <Button
              size="sm"
              disabled={busy}
              aria-label={`Finalize pay of ${row.original.staffName}`}
              onClick={() =>
                void run(async () => {
                  await finalize.mutateAsync({
                    id: row.original.id,
                    values: { rowVersion: row.original.rowVersion },
                  });
                  return `Pay of ${row.original.staffName} for ${row.original.month} is final`;
                })
              }
            >
              Finalize
            </Button>
          </RowActions>
        ) : null,
    },
  ];

  return (
    <>
      <DataTableToolbar
        chips={
          status !== ''
            ? [
                {
                  label: `Status: ${PAYROLL_STATUS_TEXT[status as keyof typeof PAYROLL_STATUS_TEXT] ?? status}`,
                  onRemove: () => set.setFilter('status', ''),
                },
              ]
            : []
        }
        onClearFilters={set.clear}
        onRefresh={query.refetch}
        refreshing={query.isFetching}
        actions={
          <Can permission="hr.manage">
            <Button
              disabled={busy}
              onClick={() =>
                void run(async () => {
                  const result = await generate.mutateAsync({ month });
                  return result.created === 0
                    ? `Nothing new to make for ${month}. ${result.alreadyHad} already had a record`
                    : `Made ${result.created} draft ${result.created === 1 ? 'record' : 'records'} for ${month}`;
                })
              }
            >
              {generate.isPending ? 'Making…' : 'Make payroll for the month'}
            </Button>
          </Can>
        }
      >
        <label className="space-y-1 text-sm font-medium">
          <span>Payroll month</span>
          <Input
            type="month"
            className="w-full sm:w-44"
            value={month}
            onChange={(event) => set.setFilter('month', event.target.value || lastMonth())}
          />
        </label>
        <label className="space-y-1 text-sm font-medium">
          <span>Payroll status</span>
          <Select
            className="w-full sm:w-44"
            value={status}
            onChange={(event) => set.setFilter('status', event.target.value)}
          >
            <option value="">All</option>
            {PAYROLL_STATUSES.map((value) => (
              <option key={value} value={value}>
                {PAYROLL_STATUS_TEXT[value]}
              </option>
            ))}
          </Select>
        </label>
      </DataTableToolbar>
      {problem ? <ProblemAlert problem={problem} /> : null}
      {query.data ? (
        <p className="tabular rounded-lg bg-muted px-3 py-2 text-sm">
          Pay {query.data.totals.gross} · deductions {query.data.totals.deductions} · net{' '}
          {query.data.totals.net}
        </p>
      ) : null}
      <DataTable
        label="Payroll"
        noun="payroll records"
        columns={columns}
        query={query}
        getRowId={(row) => row.id}
        filtered={status !== ''}
        emptyText="No payroll has been made for this month."
        onPageChange={set.setPage}
        onPageSizeChange={set.setPageSize}
        sort={{ sortBy: params.sortBy, sortOrder: params.sortOrder }}
        onSortChange={set.setSort}
        columnVisibility
      />
      {editing ? (
        <EditDialog
          record={editing}
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
