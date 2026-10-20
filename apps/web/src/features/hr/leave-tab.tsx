import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { LEAVE_STATUSES } from '@erp/contracts';
import type { Leave } from '@erp/contracts';
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
import { isFiltered, useListParams } from '@/lib/use-list-params';
import { ProblemAlert } from '../payments/payments-shared';
import { describeError } from '../purchasing/purchasing-shared';
import type { Problem } from '../purchasing/purchasing-shared';
import { LEAVE_KIND_TEXT, LEAVE_STATUS_TEXT } from './hr-shared';
import { LeaveRequestDialog } from './leave-request-dialog';
import { useHrMutations, useLeave } from './use-hr';

const DEFAULTS = { pageSize: 10, filters: { status: '', month: '' } };

type Decision = { leave: Leave; action: 'reject' | 'cancel' } | null;

export function LeaveTab() {
  const { can } = useAuth();
  const manager = can('hr.manage');
  const [params, set] = useListParams(DEFAULTS, 'leave');
  const [asking, setAsking] = useState(false);
  const [decision, setDecision] = useState<Decision>(null);
  const [note, setNote] = useState('');
  const [noteError, setNoteError] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const status = params.filters['status'] ?? '';
  const month = params.filters['month'] ?? '';
  const query = useLeave({
    page: params.page,
    pageSize: params.pageSize,
    status,
    month,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
  });
  const { approveLeave, rejectLeave, cancelLeave } = useHrMutations();
  const busy = approveLeave.isPending || rejectLeave.isPending || cancelLeave.isPending;
  const filtered = isFiltered(params, DEFAULTS);

  const run = async (action: () => Promise<unknown>, done: string) => {
    setProblem(null);
    try {
      await action();
      toast.success(done);
      setDecision(null);
      setNote('');
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  const columns: ColumnDef<Leave, unknown>[] = [
    {
      id: 'person',
      header: 'Person',
      meta: { alwaysVisible: true, className: 'font-medium', wrap: true },
      cell: ({ row }) => (
        <>
          {row.original.staffName}
          <span className="block text-xs font-normal text-muted-foreground">
            {row.original.employeeCode}
          </span>
        </>
      ),
    },
    {
      id: 'days',
      header: 'Days',
      meta: { sortKey: 'fromDate' },
      cell: ({ row }) => (
        <>
          {row.original.fromDate === row.original.toDate
            ? row.original.fromDate
            : `${row.original.fromDate} to ${row.original.toDate}`}
          <span className="block text-xs text-muted-foreground">
            {row.original.days} {row.original.days === 1 ? 'day' : 'days'}
          </span>
        </>
      ),
    },
    { id: 'kind', header: 'Kind', cell: ({ row }) => LEAVE_KIND_TEXT[row.original.kind] },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <>
          <StatusBadge
            status={row.original.status}
            label={LEAVE_STATUS_TEXT[row.original.status]}
          />
          {row.original.decidedByName ? (
            <span className="mt-1 block text-xs text-muted-foreground">
              by {row.original.decidedByName}
            </span>
          ) : null}
        </>
      ),
    },
    {
      id: 'reason',
      header: 'Reason',
      meta: { wrap: true },
      cell: ({ row }) => (
        <>
          {row.original.reason ?? '—'}
          {row.original.decisionNote ? (
            <span className="block text-xs text-muted-foreground">{row.original.decisionNote}</span>
          ) : null}
        </>
      ),
    },
    {
      id: 'actions',
      header: actionsHeader,
      enableHiding: false,
      cell: ({ row }) => {
        const leave = row.original;
        return (
          <RowActions>
            {leave.status === 'PENDING' && manager ? (
              <Button
                size="sm"
                disabled={busy}
                aria-label={`Approve leave of ${leave.staffName}`}
                onClick={() =>
                  void run(
                    () =>
                      approveLeave.mutateAsync({
                        id: leave.id,
                        values: { rowVersion: leave.rowVersion },
                      }),
                    `Leave of ${leave.staffName} approved`,
                  )
                }
              >
                Approve
              </Button>
            ) : null}
            {leave.status === 'PENDING' && manager ? (
              <Button
                size="sm"
                variant="secondary"
                disabled={busy}
                aria-label={`Reject leave of ${leave.staffName}`}
                onClick={() => setDecision({ leave, action: 'reject' })}
              >
                Reject
              </Button>
            ) : null}
            {leave.status === 'PENDING' || leave.status === 'APPROVED' ? (
              <Can permission="leave.request">
                <Button
                  size="sm"
                  variant="ghost"
                  disabled={busy}
                  aria-label={`Withdraw leave of ${leave.staffName}`}
                  onClick={() => setDecision({ leave, action: 'cancel' })}
                >
                  Withdraw
                </Button>
              </Can>
            ) : null}
          </RowActions>
        );
      },
    },
  ];

  const submitDecision = async () => {
    if (!decision) return;
    if (decision.action === 'reject' && note.trim().length < 3) {
      setNoteError('Give a reason of at least 3 characters');
      return;
    }
    setNoteError(null);
    const values = {
      rowVersion: decision.leave.rowVersion,
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    await (decision.action === 'reject'
      ? run(
          () =>
            rejectLeave.mutateAsync({
              id: decision.leave.id,
              values: { ...values, note: note.trim() },
            }),
          `Leave of ${decision.leave.staffName} rejected`,
        )
      : run(() => cancelLeave.mutateAsync({ id: decision.leave.id, values }), 'Leave withdrawn'));
  };

  return (
    <>
      <DataTableToolbar
        chips={[
          ...(status !== ''
            ? [
                {
                  label: `Status: ${LEAVE_STATUS_TEXT[status as keyof typeof LEAVE_STATUS_TEXT] ?? status}`,
                  onRemove: () => set.setFilter('status', ''),
                },
              ]
            : []),
          ...(month !== ''
            ? [{ label: `Month: ${month}`, onRemove: () => set.setFilter('month', '') }]
            : []),
        ]}
        onClearFilters={set.clear}
        onRefresh={query.refetch}
        refreshing={query.isFetching}
        actions={
          <Can permission="leave.request">
            <Button onClick={() => setAsking(true)}>Ask for leave</Button>
          </Can>
        }
      >
        <label className="space-y-1 text-sm font-medium">
          <span>Leave status</span>
          <Select
            className="w-full sm:w-44"
            value={status}
            onChange={(event) => set.setFilter('status', event.target.value)}
          >
            <option value="">All</option>
            {LEAVE_STATUSES.map((value) => (
              <option key={value} value={value}>
                {LEAVE_STATUS_TEXT[value]}
              </option>
            ))}
          </Select>
        </label>
        <label className="space-y-1 text-sm font-medium">
          <span>Leave in month</span>
          <Input
            type="month"
            className="w-full sm:w-44"
            value={month}
            onChange={(event) => set.setFilter('month', event.target.value)}
          />
        </label>
      </DataTableToolbar>
      {problem ? <ProblemAlert problem={problem} /> : null}
      <DataTable
        label="Leave"
        noun="leave"
        columns={columns}
        query={query}
        getRowId={(row) => row.id}
        filtered={filtered}
        emptyText="No leave has been asked for."
        emptyAction={
          filtered ? (
            <Button variant="outline" size="sm" onClick={set.clear}>
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

      {asking ? (
        <LeaveRequestDialog
          onClose={() => setAsking(false)}
          onRequested={(message) => {
            toast.success(message);
            setAsking(false);
          }}
        />
      ) : null}
      {decision ? (
        <FormDialog
          open
          title={decision.action === 'reject' ? 'Reject leave' : 'Withdraw leave'}
          description={`${decision.leave.staffName}, ${decision.leave.fromDate} to ${decision.leave.toDate}`}
          onClose={() => {
            setDecision(null);
            setNote('');
            setNoteError(null);
          }}
          onSubmit={submitDecision}
          saving={busy}
          dirty={note !== ''}
          submitLabel={decision.action === 'reject' ? 'Reject leave' : 'Withdraw leave'}
          cancelLabel="Back"
        >
          <FormField
            label={decision.action === 'reject' ? 'Reason' : 'Note'}
            error={noteError ?? undefined}
            hint={decision.action === 'cancel' ? 'Optional' : undefined}
          >
            {(props) => (
              <Input {...props} value={note} onChange={(event) => setNote(event.target.value)} />
            )}
          </FormField>
        </FormDialog>
      ) : null}
    </>
  );
}
