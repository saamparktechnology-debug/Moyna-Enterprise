import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { FOLLOWUP_SCOPES } from '@erp/contracts';
import type { Followup } from '@erp/contracts';
import { Can } from '@/components/can';
import { DataTable, RowActions, actionsHeader } from '@/components/data-table/data-table';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import { Select } from '@/components/select-field';
import { StatusBadge } from '@/components/status-badge';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { isFiltered, useListParams } from '@/lib/use-list-params';
import { describeError } from '../purchasing/purchasing-shared';
import type { Problem } from '../purchasing/purchasing-shared';
import { ProblemAlert } from '../payments/payments-shared';
import { RescheduleDialog } from './reschedule-dialog';
import { FOLLOWUP_SCOPE_TEXT, FOLLOWUP_STATUS_TEXT, STAGE_TEXT, formatWhen } from './leads-shared';
import { useFollowupCounts, useFollowups, useLeadMutations } from './use-leads';

const DEFAULTS = { pageSize: 10, filters: { scope: 'open', all: '' } };

export function FollowupsTab({ onOpenLead }: { onOpenLead: (leadId: string) => void }) {
  const [params, set] = useListParams(DEFAULTS, 'follow');
  const [problem, setProblem] = useState<Problem | null>(null);
  const [moving, setMoving] = useState<Followup | null>(null);
  const scope = params.filters['scope'] ?? 'open';
  // "Only my leads" is the default; the address records the exception.
  const mine = params.filters['all'] !== '1';
  const query = useFollowups({
    page: params.page,
    pageSize: params.pageSize,
    scope,
    mine,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
  });
  const counts = useFollowupCounts(mine);
  const { complete } = useLeadMutations();
  const filtered = isFiltered(params, DEFAULTS);

  const columns: ColumnDef<Followup, unknown>[] = [
    {
      id: 'due',
      header: 'Due',
      meta: { sortKey: 'dueAt', alwaysVisible: true },
      cell: ({ row }) => formatWhen(row.original.dueAt),
    },
    {
      id: 'lead',
      header: 'Lead',
      meta: { className: 'font-medium', wrap: true },
      cell: ({ row }) => (
        <>
          {row.original.leadName}
          <span className="block text-xs font-normal text-muted-foreground">
            {row.original.leadPhone}
          </span>
        </>
      ),
    },
    {
      id: 'stage',
      header: 'Stage',
      cell: ({ row }) => (
        <StatusBadge status={row.original.leadStage} label={STAGE_TEXT[row.original.leadStage]} />
      ),
    },
    {
      id: 'todo',
      header: 'What to do',
      meta: { wrap: true },
      cell: ({ row }) => row.original.note ?? '—',
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <StatusBadge
          status={row.original.status}
          label={FOLLOWUP_STATUS_TEXT[row.original.status]}
        />
      ),
    },
    {
      id: 'actions',
      header: actionsHeader,
      enableHiding: false,
      cell: ({ row }) => (
        <RowActions>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Open lead ${row.original.leadName}`}
            onClick={() => onOpenLead(row.original.leadId)}
          >
            Open lead
          </Button>
          {row.original.status !== 'COMPLETED' ? (
            <Can permission="leads.manage">
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Move the follow-up for ${row.original.leadName}`}
                onClick={() => setMoving(row.original)}
              >
                Move
              </Button>
              <Button
                variant="secondary"
                size="sm"
                disabled={complete.isPending}
                aria-label={`Mark the follow-up for ${row.original.leadName} done`}
                onClick={async () => {
                  setProblem(null);
                  try {
                    await complete.mutateAsync({ id: row.original.id, values: {} });
                  } catch (error) {
                    setProblem(describeError(error));
                  }
                }}
              >
                Mark done
              </Button>
            </Can>
          ) : null}
        </RowActions>
      ),
    },
  ];

  return (
    <>
      <DataTableToolbar
        chips={[
          ...(scope !== 'open'
            ? [
                {
                  label: `Show: ${FOLLOWUP_SCOPE_TEXT[scope as keyof typeof FOLLOWUP_SCOPE_TEXT] ?? scope}`,
                  onRemove: () => set.setFilter('scope', 'open'),
                },
              ]
            : []),
          ...(!mine
            ? [{ label: 'Everyone’s leads', onRemove: () => set.setFilter('all', '') }]
            : []),
        ]}
        onClearFilters={set.clear}
        onRefresh={query.refetch}
        refreshing={query.isFetching}
      >
        <label className="space-y-1 text-sm font-medium">
          <span>Show follow-ups</span>
          <Select
            className="w-full sm:w-48"
            value={scope}
            onChange={(event) => set.setFilter('scope', event.target.value)}
          >
            {FOLLOWUP_SCOPES.map((value) => (
              <option key={value} value={value}>
                {FOLLOWUP_SCOPE_TEXT[value]}
              </option>
            ))}
          </Select>
        </label>
        <label className="flex min-h-control items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={mine}
            onChange={(event) => set.setFilter('all', event.target.checked ? '' : '1')}
          />
          Only my leads
        </label>
      </DataTableToolbar>
      {counts.data ? (
        <p className="tabular rounded-lg bg-muted px-3 py-2 text-sm" aria-live="polite">
          {counts.data.overdue} overdue · {counts.data.today} due today · {counts.data.upcoming}{' '}
          coming up
        </p>
      ) : null}
      {problem ? <ProblemAlert problem={problem} /> : null}
      <DataTable
        label="Follow-ups due"
        noun="follow-ups"
        columns={columns}
        query={query}
        getRowId={(row) => row.id}
        filtered={filtered}
        emptyText="No follow-up is waiting."
        onPageChange={set.setPage}
        onPageSizeChange={set.setPageSize}
        sort={{ sortBy: params.sortBy, sortOrder: params.sortOrder }}
        onSortChange={set.setSort}
        columnVisibility
      />
      {moving ? (
        <RescheduleDialog
          followup={moving}
          onClose={() => setMoving(null)}
          onMoved={(message) => {
            toast.success(message);
            setMoving(null);
          }}
        />
      ) : null}
    </>
  );
}
