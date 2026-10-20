import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { DISCREPANCY_TYPES } from '@erp/contracts';
import type { Discrepancy, DiscrepancyResolutionName } from '@erp/contracts';
import { DataTable, RowActions, actionsHeader } from '@/components/data-table/data-table';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import { FormDialog } from '@/components/form-dialog';
import { FormField, Input } from '@/components/form-field';
import { Select } from '@/components/select-field';
import { StatusBadge } from '@/components/status-badge';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/features/auth/auth-provider';
import { isFiltered, useListParams } from '@/lib/use-list-params';
import { describeError, label } from './purchasing-shared';
import type { Problem } from './purchasing-shared';
import { useDiscrepancies, usePurchasingMutations } from './use-purchasing';

const DEFAULTS = { pageSize: 10, filters: { status: 'OPEN', type: '' } };
const STATUS_TEXT: Record<string, string> = {
  RESOLVED: 'Settled',
  all: 'All',
};

export const RESOLUTION_TEXT: Record<DiscrepancyResolutionName, string> = {
  ACCEPT: 'Accept into stock',
  RETURN: 'Return to the supplier',
  CLAIM: 'Claim from the supplier (the rest is still expected)',
  WRITE_OFF: 'Write it off',
};

export function DiscrepanciesTab() {
  const { can, user } = useAuth();
  const [params, set] = useListParams(DEFAULTS, 'disc');
  const [resolving, setResolving] = useState<Discrepancy | null>(null);
  const status = params.filters['status'] ?? 'OPEN';
  const type = params.filters['type'] ?? '';
  const query = useDiscrepancies({
    page: params.page,
    pageSize: params.pageSize,
    status,
    type,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
  });
  const showBranch = (user?.branches.length ?? 0) > 1 || (user?.isSuperAdmin ?? false);
  const filtered = isFiltered(params, DEFAULTS);

  const columns: ColumnDef<Discrepancy, unknown>[] = [
    {
      id: 'kind',
      header: 'Kind',
      meta: { sortKey: 'type', alwaysVisible: true, className: 'font-medium' },
      cell: ({ row }) => label(row.original.type),
    },
    {
      id: 'item',
      header: 'Item',
      meta: { wrap: true },
      cell: ({ row }) =>
        row.original.itemCode ? `${row.original.itemCode} · ${row.original.itemName}` : '—',
    },
    { accessorKey: 'qty', header: 'Quantity', meta: { sortKey: 'qty', align: 'right' } },
    {
      id: 'document',
      header: 'Document',
      meta: { className: 'break-id' },
      cell: ({ row }) => row.original.documentNo ?? '—',
    },
    {
      id: 'supplier',
      header: 'Supplier',
      meta: { wrap: true },
      cell: ({ row }) => row.original.supplierName ?? '—',
    },
    ...(showBranch ? [{ accessorKey: 'branchCode', header: 'Branch' } as const] : []),
    {
      id: 'status',
      header: 'Status',
      meta: { sortKey: 'status' },
      cell: ({ row }) =>
        row.original.status === 'OPEN' ? (
          <StatusBadge status="PENDING" label="Waiting for a decision" />
        ) : (
          <StatusBadge
            status="RESOLVED"
            label={`Settled: ${row.original.resolution ? RESOLUTION_TEXT[row.original.resolution] : ''}`}
          />
        ),
    },
    {
      id: 'actions',
      header: actionsHeader,
      enableHiding: false,
      cell: ({ row }) =>
        row.original.status === 'OPEN' && can('discrepancies.resolve') ? (
          <RowActions>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Resolve ${label(row.original.type)} ${row.original.itemCode ?? ''}`.trim()}
              onClick={() => setResolving(row.original)}
            >
              Resolve
            </Button>
          </RowActions>
        ) : null,
    },
  ];

  const chips = [
    ...(status !== 'OPEN'
      ? [
          {
            label: `Show: ${STATUS_TEXT[status] ?? status}`,
            onRemove: () => set.setFilter('status', 'OPEN'),
          },
        ]
      : []),
    ...(type !== ''
      ? [{ label: `Kind: ${label(type)}`, onRemove: () => set.setFilter('type', '') }]
      : []),
  ];

  return (
    <>
      <DataTableToolbar
        chips={chips}
        onClearFilters={set.clear}
        onRefresh={query.refetch}
        refreshing={query.isFetching}
      >
        <label className="space-y-1 text-sm font-medium">
          <span>Show</span>
          <Select
            className="w-full sm:w-52"
            value={status}
            onChange={(event) => set.setFilter('status', event.target.value)}
          >
            <option value="OPEN">Waiting for a decision</option>
            <option value="RESOLVED">Settled</option>
            <option value="all">All</option>
          </Select>
        </label>
        <label className="space-y-1 text-sm font-medium">
          <span>Kind</span>
          <Select
            className="w-full sm:w-48"
            value={type}
            onChange={(event) => set.setFilter('type', event.target.value)}
          >
            <option value="">Any kind</option>
            {DISCREPANCY_TYPES.map((value) => (
              <option key={value} value={value}>
                {label(value)}
              </option>
            ))}
          </Select>
        </label>
      </DataTableToolbar>
      <DataTable
        label="Discrepancies"
        noun="discrepancies"
        columns={columns}
        query={query}
        getRowId={(row) => row.id}
        filtered={filtered}
        emptyText="Nothing is waiting for a decision."
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
      {resolving ? (
        <ResolveDialog
          discrepancy={resolving}
          onClose={() => setResolving(null)}
          onDone={(message) => {
            toast.success(message);
            setResolving(null);
          }}
        />
      ) : null}
    </>
  );
}

interface ResolveDialogProps {
  discrepancy: Discrepancy;
  onClose: () => void;
  onDone: (message: string) => void;
}

function ResolveDialog({ discrepancy, onClose, onDone }: ResolveDialogProps) {
  const { resolve } = usePurchasingMutations();
  const [resolution, setResolution] = useState<DiscrepancyResolutionName | ''>('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);
  const allowed = discrepancy.allowedResolutions;
  const title = `Settle a ${label(discrepancy.type)} problem`;
  const description = `${discrepancy.qty} × ${discrepancy.itemCode ?? 'item'} ${discrepancy.documentNo ? `on ${discrepancy.documentNo}` : ''}`;

  const submit = async () => {
    setProblem(null);
    setError(null);
    if (resolution === '') {
      setError('Choose what to do');
      return;
    }
    try {
      await resolve.mutateAsync({
        id: discrepancy.id,
        values: {
          resolution,
          rowVersion: discrepancy.rowVersion,
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      });
      onDone(`${label(discrepancy.type)} settled: ${RESOLUTION_TEXT[resolution]}`);
    } catch (failure) {
      setProblem(describeError(failure));
    }
  };

  if (allowed.length === 0)
    return (
      <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
        <DialogContent>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
          <p className="mt-4 text-sm">
            This kind of problem is settled in the transfer workflow, not here.
          </p>
          <div className="mt-6 flex justify-end">
            <Button variant="secondary" onClick={onClose}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );

  return (
    <FormDialog
      open
      title={title}
      description={description}
      onClose={onClose}
      onSubmit={submit}
      saving={resolve.isPending}
      dirty={resolution !== '' || note !== ''}
      submitLabel="Settle"
      error={
        problem ? (
          <>
            <p>{problem.message}</p>
            {problem.reasons.length > 0 ? (
              <ul className="mt-1 list-disc pl-5">
                {problem.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}
          </>
        ) : undefined
      }
    >
      <fieldset className="space-y-2">
        <legend className="mb-1 text-sm font-medium">What should happen?</legend>
        {allowed.map((option) => (
          <label key={option} className="flex min-h-control items-center gap-2 text-sm">
            <input
              type="radio"
              className="size-4"
              name="resolution"
              value={option}
              checked={resolution === option}
              onChange={() => setResolution(option)}
            />
            {RESOLUTION_TEXT[option]}
          </label>
        ))}
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
      </fieldset>
      <FormField label="Note">
        {(props) => (
          <Input
            {...props}
            autoComplete="off"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        )}
      </FormField>
    </FormDialog>
  );
}
