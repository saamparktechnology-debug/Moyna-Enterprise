import { useState } from 'react';
import { Alert } from '@/components/alert';
import { SimpleTable } from '@/components/data-table/simple-table';
import { ErrorState } from '@/components/error-state';
import { LoadingState } from '@/components/loading-state';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api-client';
import { useRateMutations, useRates } from './use-settings';

const problemOf = (error: unknown): string | null =>
  error instanceof ApiError
    ? (error.details[0]?.message ?? error.message)
    : error
      ? 'That could not be saved'
      : null;

export function RatesSection() {
  const { data, error, isPending, refetch } = useRates();
  const { create, update } = useRateMutations();
  const [rate, setRate] = useState('');
  const [label, setLabel] = useState('');

  if (isPending) return <LoadingState label="Loading tax rates…" rows={3} />;
  if (error)
    return (
      <ErrorState onRetry={refetch} retryLabel="Try again">
        {error instanceof ApiError ? error.message : 'Tax rates could not be loaded'}
      </ErrorState>
    );

  return (
    <div className="space-y-4">
      <p className="max-w-measure text-sm text-muted-foreground">
        A rate’s percentage never changes once it exists, because invoices already issued used it.
        Switch a rate off to stop offering it; a rate that active items still use cannot be switched
        off.
      </p>
      <SimpleTable
        label="GST rates"
        rows={data}
        getRowKey={(row) => row.id}
        columns={[
          { header: 'Rate', cell: (row) => `${row.rate}%` },
          { header: 'Label', cell: (row) => row.label },
          { header: 'Active items', align: 'right', cell: (row) => row.itemsUsing },
          {
            header: 'Offered',
            cell: (row) => (
              <StatusBadge
                status={row.isActive ? 'ACTIVE' : 'INACTIVE'}
                label={row.isActive ? 'Yes' : 'No'}
              />
            ),
          },
          {
            header: <span className="sr-only">Actions</span>,
            align: 'right',
            cell: (row) => (
              <Button
                type="button"
                size="sm"
                variant="secondary"
                disabled={update.isPending}
                aria-label={`${row.isActive ? 'Switch off' : 'Switch on'} ${row.rate}%`}
                onClick={() =>
                  update.mutate({
                    id: row.id,
                    isActive: !row.isActive,
                    rowVersion: row.rowVersion,
                  })
                }
              >
                {row.isActive ? 'Switch off' : 'Switch on'}
              </Button>
            ),
          },
        ]}
      />
      {problemOf(update.error) ? <Alert tone="error">{problemOf(update.error)}</Alert> : null}

      <form
        aria-label="Add a GST rate"
        className="flex flex-wrap items-end gap-3 rounded-lg border bg-card p-3"
        onSubmit={(event) => {
          event.preventDefault();
          create.mutate(
            { rate: rate.trim(), label: label.trim() },
            {
              onSuccess: () => {
                setRate('');
                setLabel('');
              },
            },
          );
        }}
      >
        <label className="space-y-1 text-sm font-medium">
          <span>Percentage</span>
          <Input
            inputMode="decimal"
            className="w-full sm:w-36"
            value={rate}
            onChange={(e) => setRate(e.target.value)}
          />
        </label>
        <label className="space-y-1 text-sm font-medium">
          <span>Label</span>
          <Input
            className="w-full sm:w-56"
            value={label}
            onChange={(e) => setLabel(e.target.value)}
          />
        </label>
        <Button
          type="submit"
          disabled={create.isPending || rate.trim() === '' || label.trim() === ''}
        >
          Add rate
        </Button>
      </form>
      {problemOf(create.error) ? <Alert tone="error">{problemOf(create.error)}</Alert> : null}
    </div>
  );
}
