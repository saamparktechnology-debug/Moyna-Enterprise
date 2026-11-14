//apps/web/src/features/messages/opt-out-dialog.tsx
import { useState } from 'react';
import { Alert } from '@/components/alert';
import { SimpleTable } from '@/components/data-table/simple-table';
import { FormField, Input } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useCustomers } from '../customers/use-customers';
import { ProblemAlert } from '../payments/payments-shared';
import { describeError } from '../purchasing/purchasing-shared';
import type { Problem } from '../purchasing/purchasing-shared';
import { useMessageMutations, useOptOuts } from './use-messages';

/** Customers who asked not to get bulk messages. They are left out of every bulk message; invoices and receipts still go. */
export function OptOutDialog({ onClose }: { onClose: () => void }) {
  const list = useOptOuts();
  const { addOptOut, removeOptOut } = useMessageMutations();
  const [search, setSearch] = useState('');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);
  const found = useCustomers({ page: 1, pageSize: 5, search, kycStatus: '' });
  const stopped = new Set((list.data?.items ?? []).map((entry) => entry.customerId));

  const add = async (customerId: string) => {
    setProblem(null);
    try {
      await addOptOut.mutateAsync({
        customerId,
        ...(reason.trim() ? { reason: reason.trim() } : {}),
      });
      setReason('');
    } catch (error) {
      setProblem(describeError(error));
    }
  };
  const remove = async (customerId: string) => {
    setProblem(null);
    try {
      await removeOptOut.mutateAsync(customerId);
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  return (
    <Dialog open onOpenChange={(open) => (open ? undefined : onClose())}>
      <DialogContent className="max-w-2xl">
        <DialogTitle>Customers who opted out</DialogTitle>
        <DialogDescription>
          These customers asked not to get bulk messages, so they are left out of them. Invoices and
          receipts still go to them.
        </DialogDescription>
        {problem ? <ProblemAlert problem={problem} /> : null}
        <div className="mt-3 space-y-4">
          {list.isError ? <Alert tone="error">Could not load the list.</Alert> : null}
          {(list.data?.items.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No one has opted out.</p>
          ) : (
            <SimpleTable
              label="Customers who opted out"
              rows={list.data?.items ?? []}
              getRowKey={(row) => row.customerId}
              columns={[
                {
                  header: 'Customer',
                  cell: (row) => (
                    <>
                      {row.customerName}
                      <span className="block text-xs text-muted-foreground">{row.phone}</span>
                    </>
                  ),
                },
                { header: 'Reason', cell: (row) => row.reason ?? '—' },
                {
                  header: 'Actions',
                  cell: (row) => (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={removeOptOut.isPending}
                      aria-label={`Include ${row.customerName} in bulk messages again`}
                      onClick={() => void remove(row.customerId)}
                    >
                      Include again
                    </Button>
                  ),
                },
              ]}
            />
          )}
          <div className="space-y-2 border-t pt-3">
            <FormField label="Add a customer" hint="Search by name or phone">
              {(props) => (
                <Input
                  {...props}
                  value={search}
                  placeholder="Search by name or phone"
                  onChange={(event) => setSearch(event.target.value)}
                />
              )}
            </FormField>
            <FormField label="Reason (optional)">
              {(props) => (
                <Input
                  {...props}
                  value={reason}
                  maxLength={200}
                  onChange={(event) => setReason(event.target.value)}
                />
              )}
            </FormField>
            {search.trim() ? (
              <ul className="space-y-1" aria-label="Customers found">
                {(found.data?.items ?? []).map((customer) => (
                  <li key={customer.id} className="flex items-center justify-between text-sm">
                    <span>
                      {customer.name} · {customer.phone}
                    </span>
                    <Button
                      size="sm"
                      variant="secondary"
                      disabled={stopped.has(customer.id) || addOptOut.isPending}
                      aria-label={`Opt out ${customer.name}`}
                      onClick={() => void add(customer.id)}
                    >
                      {stopped.has(customer.id) ? 'Opted out' : 'Opt out'}
                    </Button>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>
        </div>
        <div className="mt-4 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
