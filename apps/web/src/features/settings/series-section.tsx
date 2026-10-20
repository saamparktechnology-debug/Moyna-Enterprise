import { useState } from 'react';
import { DOCUMENT_TYPES } from '@erp/contracts';
import type { DocumentSeries } from '@erp/contracts';
import type { ColumnDef } from '@tanstack/react-table';
import { Alert } from '@/components/alert';
import { DataTable } from '@/components/data-table/data-table';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import { Select } from '@/components/select-field';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api-client';
import { useListParams } from '@/lib/use-list-params';
import { useAdvanceSeries, useSeries, useSettingsBranches } from './use-settings';

const label = (value: string): string => value.toLowerCase().replaceAll('_', ' ');

function AdvanceForm({ series, onDone }: { series: DocumentSeries; onDone: () => void }) {
  const advance = useAdvanceSeries();
  const [next, setNext] = useState(String(series.nextNumber + 1));
  const [reason, setReason] = useState('');
  const problem =
    advance.error instanceof ApiError
      ? (advance.error.details[0]?.message ?? advance.error.message)
      : advance.error
        ? 'The number could not be changed'
        : null;
  return (
    <form
      aria-label={`Move ${series.prefix} forward`}
      className="mt-2 space-y-3 rounded-lg border bg-muted/40 p-3 font-normal"
      onSubmit={(event) => {
        event.preventDefault();
        advance.mutate(
          {
            id: series.id,
            nextNumber: Number(next),
            reason: reason.trim(),
            rowVersion: series.rowVersion,
          },
          { onSuccess: onDone },
        );
      }}
    >
      <p className="text-sm text-muted-foreground">
        Numbers only move forward. Skipped numbers are never used again.
      </p>
      <label className="block space-y-1 text-sm">
        <span>New next number</span>
        <Input inputMode="numeric" value={next} onChange={(event) => setNext(event.target.value)} />
      </label>
      <label className="block space-y-1 text-sm">
        <span>Reason</span>
        <Input value={reason} onChange={(event) => setReason(event.target.value)} />
      </label>
      {problem ? <Alert tone="error">{problem}</Alert> : null}
      <div className="flex flex-wrap gap-2">
        <Button
          type="submit"
          disabled={advance.isPending || reason.trim().length < 5 || !/^\d+$/.test(next)}
        >
          Move forward
        </Button>
        <Button type="button" variant="secondary" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

const DEFAULTS = { pageSize: 25, filters: { branch: '', doc: '', year: '' } };

export function SeriesSection() {
  const branches = useSettingsBranches();
  const [params, set] = useListParams(DEFAULTS, 'series');
  const branchId = params.filters['branch'] ?? '';
  const docType = params.filters['doc'] ?? '';
  const financialYear = params.filters['year'] ?? '';
  const [open, setOpen] = useState<string | null>(null);
  const query = useSeries({ page: params.page, branchId, docType, financialYear });
  const yearOk = financialYear === '' || /^\d{4}-\d{2}$/.test(financialYear);

  const columns: ColumnDef<DocumentSeries, unknown>[] = [
    { accessorKey: 'branchCode', header: 'Branch', meta: { alwaysVisible: true } },
    { id: 'document', header: 'Document', cell: ({ row }) => label(row.original.docType) },
    { accessorKey: 'financialYear', header: 'Year' },
    {
      id: 'next',
      header: 'Next number',
      meta: { className: 'align-top' },
      cell: ({ row }) => (
        <>
          {row.original.nextExample}
          {open === row.original.id ? (
            <AdvanceForm series={row.original} onDone={() => setOpen(null)} />
          ) : null}
        </>
      ),
    },
    {
      id: 'actions',
      header: () => <span className="sr-only">Actions</span>,
      enableHiding: false,
      meta: { className: 'align-top' },
      cell: ({ row }) =>
        open === row.original.id ? null : (
          <Button
            type="button"
            size="sm"
            variant="secondary"
            onClick={() => setOpen(row.original.id)}
            aria-label={`Move ${row.original.nextExample} forward`}
          >
            Move forward
          </Button>
        ),
    },
  ];

  return (
    <>
      <DataTableToolbar
        chips={[
          ...(branchId !== ''
            ? [
                {
                  label: `Branch: ${(branches.data ?? []).find((b) => b.id === branchId)?.code ?? 'Selected'}`,
                  onRemove: () => set.setFilter('branch', ''),
                },
              ]
            : []),
          ...(docType !== ''
            ? [
                {
                  label: `Document: ${label(docType)}`,
                  onRemove: () => set.setFilter('doc', ''),
                },
              ]
            : []),
          ...(financialYear !== ''
            ? [{ label: `Year: ${financialYear}`, onRemove: () => set.setFilter('year', '') }]
            : []),
        ]}
        onClearFilters={set.clear}
        onRefresh={query.refetch}
        refreshing={query.isFetching}
      >
        <label className="space-y-1 text-sm font-medium">
          <span>Branch</span>
          <Select
            className="w-full sm:w-52"
            value={branchId}
            onChange={(e) => set.setFilter('branch', e.target.value)}
          >
            <option value="">All branches</option>
            {(branches.data ?? []).map((branch) => (
              <option key={branch.id} value={branch.id}>
                {branch.code} · {branch.name}
              </option>
            ))}
          </Select>
        </label>
        <label className="space-y-1 text-sm font-medium">
          <span>Document</span>
          <Select
            className="w-full sm:w-52"
            value={docType}
            onChange={(e) => set.setFilter('doc', e.target.value)}
          >
            <option value="">All documents</option>
            {DOCUMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {label(type)}
              </option>
            ))}
          </Select>
        </label>
        <label className="space-y-1 text-sm font-medium">
          <span>Financial year</span>
          <Input
            className="w-full sm:w-36"
            placeholder="2026-27"
            value={financialYear}
            onChange={(e) => set.setFilter('year', e.target.value)}
          />
        </label>
      </DataTableToolbar>
      {!yearOk ? <Alert tone="error">Use a financial year such as 2026-27</Alert> : null}
      <DataTable
        label="Document number series"
        noun="numbers"
        columns={columns}
        query={query}
        getRowId={(row) => row.id}
        filtered={set !== undefined && (branchId !== '' || docType !== '' || financialYear !== '')}
        emptyText="No number series match these filters."
        filteredEmptyText="No number series match these filters."
        onPageChange={set.setPage}
      />
    </>
  );
}
