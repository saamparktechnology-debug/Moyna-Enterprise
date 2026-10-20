import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { DUE_SCOPES, PAYMENT_STATUSES } from '@erp/contracts';
import type { CustomerDue, DueInvoice, PaymentSummary } from '@erp/contracts';
import { Can } from '@/components/can';
import { DataTable, RowActions, actionsHeader } from '@/components/data-table/data-table';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { SectionPanel, SectionTabs } from '@/components/section-tabs';
import { Select } from '@/components/select-field';
import { StatusBadge } from '@/components/status-badge';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { isFiltered, useListParams, useSearchBox } from '@/lib/use-list-params';
import { LedgerDialog } from './ledger-dialog';
import { RefundDialog } from './refund-dialog';
import { PaymentDetailDialog } from './payment-detail-dialog';
import { DUE_SCOPE_TEXT, DUE_STATUS_TEXT } from './payments-shared';
import { RecordPaymentDialog } from './record-payment-dialog';
import { useCustomerDues, useDues, usePayments } from './use-payments';

const SECTIONS = [
  { id: 'dues', label: 'Invoices due' },
  { id: 'customers', label: 'Customers' },
  { id: 'payments', label: 'Payments' },
] as const;

type Section = (typeof SECTIONS)[number]['id'];
type Dialogs =
  | { kind: 'record'; customer: { id: string; name: string } | null }
  | { kind: 'payment'; id: string }
  | { kind: 'ledger'; customerId: string; customerName: string }
  | { kind: 'refund'; customerId: string; customerName: string }
  | null;

const sortOf = (params: { sortBy: string | undefined; sortOrder: 'asc' | 'desc' }) => ({
  sortBy: params.sortBy,
  sortOrder: params.sortOrder,
});

const ClearButton = ({ onClick }: { onClick: () => void }) => (
  <Button variant="outline" size="sm" onClick={onClick}>
    Clear filters
  </Button>
);

export function PaymentsPage() {
  const [section, setSection] = useState<Section>('dues');
  const [dialog, setDialog] = useState<Dialogs>(null);
  const open = (next: Dialogs) => setDialog(next);
  const done = (message: string) => {
    toast.success(message);
    setDialog(null);
  };

  return (
    <PageContainer>
      <PageHeader
        title="Payments"
        description="What customers owe, what they have paid and any credit they hold."
        actions={
          <Can permission="payments.create">
            <Button onClick={() => open({ kind: 'record', customer: null })}>Record payment</Button>
          </Can>
        }
      />

      <SectionTabs
        label="Payment sections"
        idPrefix="payments"
        tabs={SECTIONS}
        value={section}
        onChange={setSection}
      />

      <SectionPanel idPrefix="payments" id={section}>
        {section === 'dues' ? (
          <DuesTab onPay={(customer) => open({ kind: 'record', customer })} />
        ) : null}
        {section === 'customers' ? (
          <CustomersTab
            onLedger={(row) =>
              open({ kind: 'ledger', customerId: row.customerId, customerName: row.customerName })
            }
          />
        ) : null}
        {section === 'payments' ? (
          <PaymentsTab onOpen={(id) => open({ kind: 'payment', id })} />
        ) : null}
      </SectionPanel>

      {dialog?.kind === 'record' ? (
        <RecordPaymentDialog
          customer={dialog.customer}
          onClose={() => setDialog(null)}
          onRecorded={done}
        />
      ) : null}
      {dialog?.kind === 'payment' ? (
        <PaymentDetailDialog
          key={dialog.id}
          paymentId={dialog.id}
          onClose={() => setDialog(null)}
          onDone={done}
        />
      ) : null}
      {dialog?.kind === 'ledger' ? (
        <LedgerDialog
          customerId={dialog.customerId}
          customerName={dialog.customerName}
          onClose={() => setDialog(null)}
          onRefund={() =>
            setDialog({
              kind: 'refund',
              customerId: dialog.customerId,
              customerName: dialog.customerName,
            })
          }
        />
      ) : null}
      {dialog?.kind === 'refund' ? (
        <RefundDialog
          customerId={dialog.customerId}
          customerName={dialog.customerName}
          onClose={() => setDialog(null)}
          onPaid={done}
        />
      ) : null}
    </PageContainer>
  );
}

const DUES_DEFAULTS = { pageSize: 10, filters: { scope: 'outstanding' } };

function DuesTab({ onPay }: { onPay: (customer: { id: string; name: string }) => void }) {
  const [params, set] = useListParams(DUES_DEFAULTS, 'dues');
  const [searchText, setSearchText, clearSearchText] = useSearchBox(params, set);
  const scope = params.filters['scope'] ?? 'outstanding';
  const query = useDues({
    page: params.page,
    pageSize: params.pageSize,
    search: params.search,
    scope,
    ...sortOf(params),
  });
  const totals = query.data?.totals;
  const filtered = isFiltered(params, DUES_DEFAULTS);
  const clearFilters = () => {
    clearSearchText();
    set.clear();
  };

  const columns: ColumnDef<DueInvoice, unknown>[] = [
    {
      accessorKey: 'invoiceNo',
      header: 'Invoice',
      meta: { sortKey: 'invoiceNo', alwaysVisible: true, className: 'font-medium break-id' },
    },
    {
      accessorKey: 'customerName',
      header: 'Customer',
      meta: { sortKey: 'customerName', wrap: true },
    },
    {
      id: 'dueDate',
      header: 'Due date',
      meta: { sortKey: 'dueDate' },
      cell: ({ row }) => row.original.dueDate ?? '—',
    },
    { accessorKey: 'total', header: 'Total', meta: { align: 'right' } },
    { accessorKey: 'paid', header: 'Paid', meta: { align: 'right' } },
    {
      accessorKey: 'outstanding',
      header: 'Outstanding',
      meta: { sortKey: 'outstanding', align: 'right', className: 'font-medium' },
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <>
          <StatusBadge
            status={row.original.overdue ? 'OVERDUE' : row.original.status}
            label={DUE_STATUS_TEXT[row.original.status]}
          />
          {row.original.overdue ? (
            <span className="mt-1 block text-xs text-destructive">
              Overdue by {row.original.overdueDays}{' '}
              {row.original.overdueDays === 1 ? 'day' : 'days'}
            </span>
          ) : null}
        </>
      ),
    },
    {
      id: 'actions',
      header: actionsHeader,
      enableHiding: false,
      cell: ({ row }) =>
        Number(row.original.outstanding) > 0 ? (
          <Can permission="payments.create">
            <RowActions>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Take payment for ${row.original.invoiceNo ?? 'invoice'}`}
                onClick={() =>
                  onPay({ id: row.original.customerId, name: row.original.customerName })
                }
              >
                Take payment
              </Button>
            </RowActions>
          </Can>
        ) : null,
    },
  ];

  return (
    <>
      <DataTableToolbar
        search={searchText}
        onSearchChange={setSearchText}
        searchLabel="Search dues"
        searchPlaceholder="Invoice or customer"
        chips={
          scope !== 'outstanding'
            ? [
                {
                  label: `Show: ${DUE_SCOPE_TEXT[scope as keyof typeof DUE_SCOPE_TEXT] ?? scope}`,
                  onRemove: () => set.setFilter('scope', 'outstanding'),
                },
              ]
            : []
        }
        onClearFilters={clearFilters}
        onRefresh={query.refetch}
        refreshing={query.isFetching}
      >
        <label className="space-y-1 text-sm font-medium">
          <span>Show</span>
          <Select
            className="w-full sm:w-48"
            value={scope}
            onChange={(event) => set.setFilter('scope', event.target.value)}
          >
            {DUE_SCOPES.map((value) => (
              <option key={value} value={value}>
                {DUE_SCOPE_TEXT[value]}
              </option>
            ))}
          </Select>
        </label>
      </DataTableToolbar>
      {totals ? (
        <p className="tabular rounded-lg bg-muted px-3 py-2 text-sm" aria-live="polite">
          {totals.invoices} invoices owing · Outstanding {totals.outstanding} · Overdue{' '}
          {totals.overdue}
        </p>
      ) : null}
      <DataTable
        label="Invoices due"
        noun="dues"
        columns={columns}
        query={query}
        getRowId={(row) => row.invoiceId}
        filtered={filtered}
        emptyText="Nothing is owed."
        emptyAction={filtered ? <ClearButton onClick={clearFilters} /> : undefined}
        onPageChange={set.setPage}
        onPageSizeChange={set.setPageSize}
        sort={sortOf(params)}
        onSortChange={set.setSort}
        columnVisibility
      />
    </>
  );
}

const CUSTOMER_DEFAULTS = { pageSize: 10 };

function CustomersTab({ onLedger }: { onLedger: (row: CustomerDue) => void }) {
  const [params, set] = useListParams(CUSTOMER_DEFAULTS, 'cust');
  const [searchText, setSearchText, clearSearchText] = useSearchBox(params, set);
  const query = useCustomerDues({
    page: params.page,
    pageSize: params.pageSize,
    search: params.search,
    ...sortOf(params),
  });
  const filtered = isFiltered(params, CUSTOMER_DEFAULTS);
  const clearFilters = () => {
    clearSearchText();
    set.clear();
  };

  const columns: ColumnDef<CustomerDue, unknown>[] = [
    {
      id: 'customer',
      header: 'Customer',
      meta: { sortKey: 'customerName', alwaysVisible: true, className: 'font-medium', wrap: true },
      cell: ({ row }) => (
        <>
          {row.original.customerName}
          {row.original.phone ? (
            <span className="block text-xs font-normal text-muted-foreground">
              {row.original.phone}
            </span>
          ) : null}
        </>
      ),
    },
    { accessorKey: 'openInvoices', header: 'Open invoices', meta: { align: 'right' } },
    {
      accessorKey: 'outstanding',
      header: 'Outstanding',
      meta: { sortKey: 'outstanding', align: 'right' },
    },
    { accessorKey: 'overdue', header: 'Overdue', meta: { sortKey: 'overdue', align: 'right' } },
    { accessorKey: 'credit', header: 'Credit held', meta: { align: 'right' } },
    {
      id: 'actions',
      header: actionsHeader,
      enableHiding: false,
      cell: ({ row }) => (
        <RowActions>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Open ledger of ${row.original.customerName}`}
            onClick={() => onLedger(row.original)}
          >
            Ledger
          </Button>
        </RowActions>
      ),
    },
  ];

  return (
    <>
      <DataTableToolbar
        search={searchText}
        onSearchChange={setSearchText}
        searchLabel="Search customers"
        searchPlaceholder="Name or phone"
        onClearFilters={clearFilters}
        onRefresh={query.refetch}
        refreshing={query.isFetching}
      />
      <DataTable
        label="Customer dues"
        noun="customer dues"
        columns={columns}
        query={query}
        getRowId={(row) => row.customerId}
        filtered={filtered}
        emptyText="No customer owes anything or holds credit."
        emptyAction={filtered ? <ClearButton onClick={clearFilters} /> : undefined}
        onPageChange={set.setPage}
        onPageSizeChange={set.setPageSize}
        sort={sortOf(params)}
        onSortChange={set.setSort}
        columnVisibility
      />
    </>
  );
}

const PAYMENT_DEFAULTS = { pageSize: 10, filters: { status: '' } };

function PaymentsTab({ onOpen }: { onOpen: (id: string) => void }) {
  const [params, set] = useListParams(PAYMENT_DEFAULTS, 'pay');
  const [searchText, setSearchText, clearSearchText] = useSearchBox(params, set);
  const status = params.filters['status'] ?? '';
  const query = usePayments({
    page: params.page,
    pageSize: params.pageSize,
    search: params.search,
    status,
    ...sortOf(params),
  });
  const filtered = isFiltered(params, PAYMENT_DEFAULTS);
  const clearFilters = () => {
    clearSearchText();
    set.clear();
  };

  const columns: ColumnDef<PaymentSummary, unknown>[] = [
    {
      accessorKey: 'receiptNo',
      header: 'Receipt',
      meta: { sortKey: 'receiptNo', alwaysVisible: true, className: 'font-medium break-id' },
    },
    { accessorKey: 'paidOn', header: 'Date', meta: { sortKey: 'paidOn' } },
    { accessorKey: 'customerName', header: 'Customer', meta: { wrap: true } },
    { accessorKey: 'modeName', header: 'Paid by' },
    {
      accessorKey: 'amount',
      header: 'Amount',
      meta: { sortKey: 'amount', align: 'right', className: 'font-medium' },
    },
    { accessorKey: 'unallocated', header: 'Held as credit', meta: { align: 'right' } },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <StatusBadge
          status={row.original.status}
          label={row.original.status === 'ACTIVE' ? 'Active' : 'Reversed'}
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
            aria-label={`Open receipt ${row.original.receiptNo}`}
            onClick={() => onOpen(row.original.id)}
          >
            Open
          </Button>
        </RowActions>
      ),
    },
  ];

  return (
    <>
      <DataTableToolbar
        search={searchText}
        onSearchChange={setSearchText}
        searchLabel="Search payments"
        searchPlaceholder="Receipt, reference or customer"
        chips={
          status !== ''
            ? [
                {
                  label: `Status: ${status === 'ACTIVE' ? 'Active' : 'Reversed'}`,
                  onRemove: () => set.setFilter('status', ''),
                },
              ]
            : []
        }
        onClearFilters={clearFilters}
        onRefresh={query.refetch}
        refreshing={query.isFetching}
      >
        <label className="space-y-1 text-sm font-medium">
          <span>Payment status</span>
          <Select
            className="w-full sm:w-40"
            value={status}
            onChange={(event) => set.setFilter('status', event.target.value)}
          >
            <option value="">All</option>
            {PAYMENT_STATUSES.map((value) => (
              <option key={value} value={value}>
                {value === 'ACTIVE' ? 'Active' : 'Reversed'}
              </option>
            ))}
          </Select>
        </label>
      </DataTableToolbar>
      <DataTable
        label="Payments"
        noun="payments"
        columns={columns}
        query={query}
        getRowId={(row) => row.id}
        filtered={filtered}
        emptyText="No payment has been recorded yet."
        emptyAction={filtered ? <ClearButton onClick={clearFilters} /> : undefined}
        onPageChange={set.setPage}
        onPageSizeChange={set.setPageSize}
        sort={sortOf(params)}
        onSortChange={set.setSort}
        columnVisibility
      />
    </>
  );
}
