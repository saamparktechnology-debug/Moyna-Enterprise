import { useState } from 'react';
import type { AuditEntry } from '@erp/contracts';
import type { ColumnDef } from '@tanstack/react-table';
import { Alert } from '@/components/alert';
import { DataTable, RowActions } from '@/components/data-table/data-table';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import { DetailsDrawer } from '@/components/details-drawer';
import { ErrorState } from '@/components/error-state';
import { LoadingState } from '@/components/loading-state';
import { Select } from '@/components/select-field';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api-client';
import { useAudit, useAuditFacets, useAuditUsers, useUserActivity } from './use-settings';

const when = (iso: string): string =>
  new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
const pretty = (value: unknown): string => JSON.stringify(value, null, 2);

function Details({ entry }: { entry: AuditEntry }) {
  return (
    <div className="grid gap-3 text-xs">
      <div>
        <p className="font-medium">Before</p>
        <pre className="overflow-auto rounded-md bg-muted p-2 font-mono">
          {entry.oldValue === null ? 'Nothing recorded' : pretty(entry.oldValue)}
        </pre>
      </div>
      <div>
        <p className="font-medium">After</p>
        <pre className="overflow-auto rounded-md bg-muted p-2 font-mono">
          {entry.newValue === null ? 'Nothing recorded' : pretty(entry.newValue)}
        </pre>
      </div>
      <p className="text-muted-foreground">
        Request {entry.requestId ?? 'unknown'} · from {entry.ipAddress ?? 'unknown address'}
      </p>
    </div>
  );
}

function Activity({ userId }: { userId: string }) {
  const { data, error, isPending } = useUserActivity(userId);
  if (isPending) return <LoadingState label="Loading activity…" rows={2} />;
  if (error)
    return (
      <Alert tone="error">
        {error instanceof ApiError ? error.message : 'Activity could not be loaded'}
      </Alert>
    );
  return (
    <Card>
      <CardContent className="space-y-1 p-4 text-sm" aria-label="User activity">
        <p className="font-medium">
          {data.fullName} ({data.username})
        </p>
        <p>Last signed in: {data.lastLoginAt ? when(data.lastLoginAt) : 'never'}</p>
        <p>Open sessions: {data.activeSessions}</p>
        <p>Actions in the last 30 days: {data.actionsLast30Days}</p>
        {data.topActions.length > 0 ? (
          <p>
            Most common:{' '}
            {data.topActions.map((item) => `${item.action} (${item.count})`).join(', ')}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function AuditSection() {
  const [page, setPage] = useState(1);
  const [actorId, setActorId] = useState('');
  const [action, setAction] = useState('');
  const [entityType, setEntityType] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<AuditEntry | null>(null);
  const facets = useAuditFacets();
  const users = useAuditUsers();
  const rangeBad = from !== '' && to !== '' && from > to;
  const query = useAudit({
    page,
    actorId,
    action,
    entityType,
    from: rangeBad ? '' : from,
    to: rangeBad ? '' : to,
    q: q.trim().length >= 2 ? q.trim() : '',
  });
  const reset =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      set(value);
      setPage(1);
    };
  const filtered =
    actorId !== '' || action !== '' || entityType !== '' || from !== '' || to !== '' || q !== '';
  const clear = () => {
    setActorId('');
    setAction('');
    setEntityType('');
    setFrom('');
    setTo('');
    setQ('');
    setPage(1);
  };

  const columns: ColumnDef<AuditEntry, unknown>[] = [
    {
      id: 'when',
      header: 'When',
      meta: { alwaysVisible: true, className: 'whitespace-nowrap' },
      cell: ({ row }) => when(row.original.createdAt),
    },
    { id: 'who', header: 'Who', cell: ({ row }) => row.original.actorName ?? 'System' },
    { id: 'branch', header: 'Branch', cell: ({ row }) => row.original.branchCode ?? '—' },
    { accessorKey: 'action', header: 'Action', meta: { className: 'break-id' } },
    { accessorKey: 'entityType', header: 'Record' },
    {
      id: 'details',
      header: () => <span className="sr-only">Details</span>,
      enableHiding: false,
      cell: ({ row }) => (
        <RowActions>
          <Button
            type="button"
            size="sm"
            variant="secondary"
            aria-haspopup="dialog"
            aria-label={`Show details of ${row.original.action}`}
            onClick={() => setOpen(row.original)}
          >
            Details
          </Button>
        </RowActions>
      ),
    },
  ];

  return (
    <>
      <form aria-label="Audit filters" onSubmit={(e) => e.preventDefault()}>
        <DataTableToolbar
          chips={[]}
          onClearFilters={filtered ? clear : undefined}
          onRefresh={query.refetch}
          refreshing={query.isFetching}
        >
          <label className="space-y-1 text-sm font-medium">
            <span>Person</span>
            <Select
              className="w-full sm:w-48"
              value={actorId}
              onChange={(e) => reset(setActorId)(e.target.value)}
            >
              <option value="">Anyone</option>
              {(users.data?.items ?? []).map((user) => (
                <option key={user.id} value={user.id}>
                  {user.fullName}
                </option>
              ))}
            </Select>
          </label>
          <label className="space-y-1 text-sm font-medium">
            <span>Action</span>
            <Select
              className="w-full sm:w-48"
              value={action}
              onChange={(e) => reset(setAction)(e.target.value)}
            >
              <option value="">Any action</option>
              {(facets.data?.actions ?? []).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </label>
          <label className="space-y-1 text-sm font-medium">
            <span>Record type</span>
            <Select
              className="w-full sm:w-48"
              value={entityType}
              onChange={(e) => reset(setEntityType)(e.target.value)}
            >
              <option value="">Any record</option>
              {(facets.data?.entityTypes ?? []).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </Select>
          </label>
          <label className="space-y-1 text-sm font-medium">
            <span>From</span>
            <Input
              type="date"
              className="w-full sm:w-40"
              value={from}
              onChange={(e) => reset(setFrom)(e.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm font-medium">
            <span>To</span>
            <Input
              type="date"
              className="w-full sm:w-40"
              value={to}
              onChange={(e) => reset(setTo)(e.target.value)}
            />
          </label>
          <label className="space-y-1 text-sm font-medium">
            <span>Contains</span>
            <Input
              className="w-full sm:w-48"
              value={q}
              onChange={(e) => reset(setQ)(e.target.value)}
            />
          </label>
        </DataTableToolbar>
      </form>
      {rangeBad ? <Alert tone="error">The end date is before the start</Alert> : null}
      {actorId ? <Activity userId={actorId} /> : null}

      {query.error ? (
        <ErrorState onRetry={query.refetch} retryLabel="Try again">
          {query.error instanceof ApiError
            ? query.error.message
            : 'The audit log could not be loaded'}
        </ErrorState>
      ) : (
        <DataTable
          label="Audit log"
          noun="audit log entries"
          columns={columns}
          query={query}
          getRowId={(row) => row.id}
          filtered={filtered}
          emptyText="Nothing recorded for these filters."
          filteredEmptyText="Nothing recorded for these filters."
          onPageChange={setPage}
        />
      )}

      <DetailsDrawer
        open={open !== null}
        onClose={() => setOpen(null)}
        title={open ? `${open.action} on ${open.entityType}` : 'Audit entry'}
        description={open ? when(open.createdAt) : undefined}
      >
        {open ? <Details entry={open} /> : null}
      </DetailsDrawer>
    </>
  );
}
