import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { LedgerEntry } from '@erp/contracts';
import { DataTable } from '@/components/data-table/data-table';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-provider';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogTitle,
} from '@/components/ui/dialog';
import { balanceText, LEDGER_TYPE_TEXT } from './payments-shared';
import { useLedger } from './use-payments';

const PAGE_SIZE = 15;

interface Props {
  customerId: string;
  customerName: string;
  onClose: () => void;
  /** Opens the refund dialog for this customer. */
  onRefund?: () => void;
}

const COLUMNS: ColumnDef<LedgerEntry, unknown>[] = [
  { accessorKey: 'date', header: 'Date', meta: { alwaysVisible: true } },
  {
    id: 'entry',
    header: 'Entry',
    cell: ({ row }) => (
      <span title={row.original.description}>{LEDGER_TYPE_TEXT[row.original.type]}</span>
    ),
  },
  {
    id: 'document',
    header: 'Document',
    meta: { className: 'break-id' },
    cell: ({ row }) => row.original.documentNo ?? '—',
  },
  { accessorKey: 'branchCode', header: 'Branch' },
  {
    id: 'debit',
    header: 'Debit',
    meta: { align: 'right' },
    cell: ({ row }) => (Number(row.original.debit) > 0 ? row.original.debit : ''),
  },
  {
    id: 'credit',
    header: 'Credit',
    meta: { align: 'right' },
    cell: ({ row }) => (Number(row.original.credit) > 0 ? row.original.credit : ''),
  },
  {
    id: 'balance',
    header: 'Balance',
    meta: { align: 'right', className: 'font-medium' },
    cell: ({ row }) => balanceText(row.original.balance),
  },
];

/** Everything that changed what the customer owes, newest first, with the balance after each entry. */
export function LedgerDialog({ customerId, customerName, onClose, onRefund }: Props) {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const query = useLedger(customerId, { page, pageSize: PAGE_SIZE });
  const ledger = query.data;

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="lg">
        <DialogTitle>Ledger of {customerName}</DialogTitle>
        <DialogDescription>
          {ledger
            ? `Balance now: ${balanceText(ledger.balance)}. Only the branches you can see are counted.`
            : 'Loading the ledger'}
        </DialogDescription>
        <div className="mt-4">
          <DataTable
            label="Customer ledger"
            noun="ledger"
            columns={COLUMNS}
            query={query}
            getRowId={(entry) => `${entry.type}-${entry.documentId}`}
            filtered={false}
            emptyText="Nothing has been billed or paid yet."
            onPageChange={setPage}
          />
        </div>
        <DialogFooter>
          {onRefund && can('payments.refund') && ledger && Number(ledger.balance) < 0 ? (
            <Button type="button" variant="secondary" onClick={onRefund}>
              Refund credit
            </Button>
          ) : null}
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
