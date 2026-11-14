//apps/web/src/features/hr/my-day-tab.tsx
import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { Attendance } from '@erp/contracts';
import { Alert } from '@/components/alert';
import { DataTable } from '@/components/data-table/data-table';
import { SimpleTable } from '@/components/data-table/simple-table';
import { LoadingState } from '@/components/loading-state';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { useListParams } from '@/lib/use-list-params';
import { ProblemAlert } from '../payments/payments-shared';
import { describeError } from '../purchasing/purchasing-shared';
import type { Problem } from '../purchasing/purchasing-shared';
import { MyAgreements } from './agreements-tab';
import { minutesText, offDayText, thisMonth, timeOf } from './hr-shared';
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
  const punches = day.data?.punches ?? [];
  const openPunch = punches.find((punch) => punch.punchedOutAt === null);
  const isOpen = Boolean(openPunch) || (!day.data?.punches && current?.state === 'OPEN');
  const openAt = openPunch?.punchedInAt ?? current?.checkIn ?? null;
  const openDay = openPunch?.workDate ?? current?.workDate ?? null;
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
        You have no staff profile yet, so you cannot punch in. Ask a manager to add you as staff.
      </Alert>
    );

  return (
    <>
      {problem ? <ProblemAlert problem={problem} /> : null}
      <section aria-label="Today" className="space-y-3 rounded-lg border bg-card p-4">
        <h2 className="section-title">Today, {day.data?.today ?? ''}</h2>
        {day.data?.offDay ? (
          <Alert tone="info">
            {offDayText(day.data.offDay)} You can still punch in if you are asked to work.
          </Alert>
        ) : null}
        {profile.data.status !== 'ACTIVE' ? (
          <p className="text-sm text-muted-foreground">
            You left on {profile.data.leftOn}, so you can no longer punch in.
          </p>
        ) : (
          <>
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <p className="text-sm">
                {isOpen
                  ? `Punched in at ${timeOf(openAt)}${openDay && openDay !== day.data?.today ? ` on ${openDay}` : ''}.`
                  : punches.length > 0 || current
                    ? 'You are punched out.'
                    : 'You have not punched in today.'}
              </p>
              <Button
                className="h-12 w-full text-base sm:h-control sm:w-auto sm:text-sm"
                disabled={busy}
                onClick={() =>
                  void (isOpen
                    ? run(() => checkOut.mutateAsync(), 'Punched out')
                    : run(() => checkIn.mutateAsync(), 'Punched in'))
                }
              >
                {isOpen
                  ? checkOut.isPending
                    ? 'Punching out…'
                    : 'Punch out'
                  : checkIn.isPending
                    ? 'Punching in…'
                    : 'Punch in'}
              </Button>
            </div>
            {day.data?.workedMinutesToday !== undefined && day.data.dutyMinutes ? (
              <p className="text-sm text-muted-foreground">
                Worked today: {minutesText(day.data.workedMinutesToday)} of{' '}
                {minutesText(day.data.dutyMinutes)} (a full day). You can punch in and out as often
                as you need.
              </p>
            ) : current && current.state === 'COMPLETE' ? (
              <p className="text-sm text-muted-foreground">
                {timeOf(current.checkIn)} to {timeOf(current.checkOut)}
                {current.hoursWorked ? ` (${current.hoursWorked} hours)` : ''}.
              </p>
            ) : null}
          </>
        )}
        {punches.length > 0 ? (
          <SimpleTable
            label="Today’s punches"
            rows={punches}
            getRowKey={(punch) => punch.id}
            columns={[
              { header: 'Punch in', cell: (punch) => timeOf(punch.punchedInAt) },
              {
                header: 'Punch out',
                cell: (punch) => (punch.punchedOutAt ? timeOf(punch.punchedOutAt) : 'Still in'),
              },
              {
                header: 'Time',
                align: 'right',
                cell: (punch) => (punch.minutes === null ? '—' : minutesText(punch.minutes)),
              },
            ]}
          />
        ) : null}
      </section>

      <MyAgreements />
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
