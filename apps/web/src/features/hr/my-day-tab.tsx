import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { Attendance } from '@erp/contracts';
import { Alert } from '@/components/alert';
import { DataTable } from '@/components/data-table/data-table';
import { LoadingState } from '@/components/loading-state';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { useListParams } from '@/lib/use-list-params';
import { ProblemAlert } from '../payments/payments-shared';
import { describeError } from '../purchasing/purchasing-shared';
import type { Problem } from '../purchasing/purchasing-shared';
import { thisMonth, timeOf } from './hr-shared';
import { useAttendance, useHrMutations, useMyAttendance, useMyStaff } from './use-hr';

const DEFAULTS = { pageSize: 31 };

const COLUMNS: ColumnDef<Attendance, unknown>[] = [
  { accessorKey: 'workDate', header: 'Day', meta: { alwaysVisible: true } },
  { id: 'in', header: 'In', cell: ({ row }) => timeOf(row.original.checkIn) },
  { id: 'out', header: 'Out', cell: ({ row }) => timeOf(row.original.checkOut) },
  {
    id: 'hours',
    header: 'Hours',
    meta: { align: 'right' },
    cell: ({ row }) => row.original.hoursWorked ?? '—',
  },
];

/** Marking one's own attendance, and the month so far. Used on phones at the shop door, so the buttons are large. */
export function MyDayTab() {
  const profile = useMyStaff();
  const day = useMyAttendance(Boolean(profile.data));
  const { checkIn, checkOut } = useHrMutations();
  const [params, set] = useListParams(DEFAULTS, 'myday');
  const [problem, setProblem] = useState<Problem | null>(null);
  const month = thisMonth();
  const list = useAttendance({ page: params.page, pageSize: params.pageSize, month });
  const current = day.data?.current ?? null;
  const busy = checkIn.isPending || checkOut.isPending;

  const run = async (action: () => Promise<unknown>, done: string) => {
    setProblem(null);
    try {
      await action();
      toast.success(done);
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  if (profile.isPending) return <LoadingState label="Loading…" rows={2} />;
  if (!profile.data)
    return (
      <Alert tone="error">
        You have no staff profile yet, so you cannot mark attendance. Ask a manager to add you as
        staff.
      </Alert>
    );

  return (
    <>
      {problem ? <ProblemAlert problem={problem} /> : null}
      <section aria-label="Today" className="space-y-3 rounded-lg border bg-card p-4">
        <h2 className="section-title">Today, {day.data?.today ?? ''}</h2>
        {profile.data.status !== 'ACTIVE' ? (
          <p className="text-sm text-muted-foreground">
            You left on {profile.data.leftOn}, so attendance can no longer be marked.
          </p>
        ) : current && current.state === 'OPEN' ? (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <p className="text-sm">
              Checked in at {timeOf(current.checkIn)}
              {current.workDate !== day.data?.today ? ` on ${current.workDate}` : ''}.
            </p>
            <Button
              className="h-12 w-full text-base sm:h-control sm:w-auto sm:text-sm"
              disabled={busy}
              onClick={() => void run(() => checkOut.mutateAsync(), 'Checked out')}
            >
              {checkOut.isPending ? 'Checking out…' : 'Check out'}
            </Button>
          </div>
        ) : current ? (
          <p className="text-sm">
            Done for today: {timeOf(current.checkIn)} to {timeOf(current.checkOut)}
            {current.hoursWorked ? ` (${current.hoursWorked} hours)` : ''}.
          </p>
        ) : (
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
            <p className="text-sm text-muted-foreground">You have not checked in today.</p>
            <Button
              className="h-12 w-full text-base sm:h-control sm:w-auto sm:text-sm"
              disabled={busy}
              onClick={() => void run(() => checkIn.mutateAsync(), 'Checked in')}
            >
              {checkIn.isPending ? 'Checking in…' : 'Check in'}
            </Button>
          </div>
        )}
      </section>

      <h2 className="section-title">My attendance in {month}</h2>
      <DataTable
        label="My attendance"
        noun="attendance"
        columns={COLUMNS}
        query={list}
        getRowId={(row) => row.id}
        filtered={false}
        emptyText="No attendance has been recorded this month."
        onPageChange={set.setPage}
        onPageSizeChange={set.setPageSize}
      />
    </>
  );
}
