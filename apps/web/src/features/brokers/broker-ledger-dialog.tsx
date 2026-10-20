import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { BrokerLedgerEntry } from '@erp/contracts';
import { DataTable } from '@/components/data-table/data-table';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { LEDGER_TYPE_TEXT, owedText } from './brokers-shared';
import { useBrokerLedger } from './use-brokers';

const PAGE_SIZE = 15;

const COLUMNS: ColumnDef<BrokerLedgerEntry, unknown>[] = [
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
    id: 'added',
    header: 'Added',
    meta: { align: 'right' },
    cell: ({ row }) => (Number(row.original.increase) > 0 ? row.original.increase : ''),
  },
  {
    id: 'taken',
    header: 'Taken off',
    meta: { align: 'right' },
    cell: ({ row }) => (Number(row.original.decrease) > 0 ? row.original.decrease : ''),
  },
  {
    id: 'after',
    header: 'Owed after',
    meta: { align: 'right', className: 'font-medium' },
    cell: ({ row }) => owedText(row.original.balance),
  },
];

interface Props {
  brokerId: string;
  brokerName: string;
  onClose: () => void;
}

/** What is owed to the broker, newest entry first, with the balance after each. */
export function BrokerLedgerDialog({ brokerId, brokerName, onClose }: Props) {
  const [page, setPage] = useState(1);
  const query = useBrokerLedger(brokerId, { page, pageSize: PAGE_SIZE });
  const ledger = query.data;

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="lg">
        <DialogTitle>Ledger of {brokerName}</DialogTitle>
        <DialogDescription>
          {ledger
            ? `Owed to the broker now: ${owedText(ledger.balance)}. Only the branches you can see are counted.`
            : 'Loading the ledger'}
        </DialogDescription>
        <div className="mt-4">
          <DataTable
            label="Broker ledger"
            noun="ledger"
            columns={COLUMNS}
            query={query}
            getRowId={(entry) => `${entry.type}-${entry.documentId}`}
            filtered={false}
            emptyText="No commission has been earned yet."
            onPageChange={setPage}
          />
        </div>
        <div className="mt-4 flex justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
