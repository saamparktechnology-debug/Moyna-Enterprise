import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { COMMISSION_STATUSES } from '@erp/contracts';
import type { Broker, BrokerSummary, Commission } from '@erp/contracts';
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
import { useAuth } from '@/features/auth/auth-provider';
import { isFiltered, useListParams, useSearchBox } from '@/lib/use-list-params';
import { BrokerDetailDialog } from './broker-detail-dialog';
import { BrokerFormDialog } from './broker-form-dialog';
import { BrokerLedgerDialog } from './broker-ledger-dialog';
import { COMMISSION_STATUS_TEXT, ruleText } from './brokers-shared';
import { PayoutDialog } from './payout-dialog';
import { useBrokers, useCommissions } from './use-brokers';

const SECTIONS = [
  { id: 'brokers', label: 'Brokers' },
  { id: 'commissions', label: 'Commissions' },
] as const;

type Dialogs =
  | { kind: 'form'; broker: Broker | undefined }
  | { kind: 'detail'; id: string }
  | { kind: 'ledger'; id: string; name: string }
  | { kind: 'payout'; commissions: Commission[] }
  | null;

export function BrokersPage() {
  const [section, setSection] = useState<(typeof SECTIONS)[number]['id']>('brokers');
  const [dialog, setDialog] = useState<Dialogs>(null);
  const done = (message: string) => {
    toast.success(message);
    setDialog(null);
  };

  return (
    <PageContainer>
      <PageHeader
        title="Brokers"
        description="Brokers, the commission rule each one works on and what is waiting to be paid."
        actions={
          <Can permission="brokers.manage">
            <Button onClick={() => setDialog({ kind: 'form', broker: undefined })}>
              New broker
            </Button>
          </Can>
        }
      />

      <SectionTabs
        label="Broker sections"
        idPrefix="brokers"
        tabs={SECTIONS}
        value={section}
        onChange={setSection}
      />

      <SectionPanel idPrefix="brokers" id={section}>
        {section === 'brokers' ? (
          <BrokersTab onOpen={(id) => setDialog({ kind: 'detail', id })} />
        ) : (
          <CommissionsTab onPay={(commissions) => setDialog({ kind: 'payout', commissions })} />
        )}
      </SectionPanel>

      {dialog?.kind === 'form' ? (
        <BrokerFormDialog broker={dialog.broker} onClose={() => setDialog(null)} onSaved={done} />
      ) : null}
      {dialog?.kind === 'detail' ? (
        <BrokerDetailDialog
          key={dialog.id}
          brokerId={dialog.id}
          onClose={() => setDialog(null)}
          onEdit={(broker) => setDialog({ kind: 'form', broker })}
          onLedger={(broker) => setDialog({ kind: 'ledger', id: broker.id, name: broker.name })}
        />
      ) : null}
      {dialog?.kind === 'ledger' ? (
        <BrokerLedgerDialog
          brokerId={dialog.id}
          brokerName={dialog.name}
          onClose={() => setDialog(null)}
        />
      ) : null}
      {dialog?.kind === 'payout' ? (
        <PayoutDialog
          commissions={dialog.commissions}
          onClose={() => setDialog(null)}
          onPaid={done}
        />
      ) : null}
    </PageContainer>
  );
}

const BROKER_DEFAULTS = { pageSize: 10, filters: { status: 'all' } };
const BROKER_STATUS_TEXT: Record<string, string> = { active: 'Active', inactive: 'Switched off' };

function BrokersTab({ onOpen }: { onOpen: (id: string) => void }) {
  const [params, set] = useListParams(BROKER_DEFAULTS, 'brokers');
  const [searchText, setSearchText, clearSearchText] = useSearchBox(params, set);
  const status = params.filters['status'] ?? 'all';
  const query = useBrokers({
    page: params.page,
    pageSize: params.pageSize,
    search: params.search,
    status,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
  });
  const filtered = isFiltered(params, BROKER_DEFAULTS);
  const clearFilters = () => {
    clearSearchText();
    set.clear();
  };

  const columns: ColumnDef<BrokerSummary, unknown>[] = [
    {
      id: 'broker',
      header: 'Broker',
      meta: { sortKey: 'name', alwaysVisible: true, className: 'font-medium', wrap: true },
      cell: ({ row }) => (
        <>
          {row.original.name}
          {row.original.phone ? (
            <span className="block text-xs font-normal text-muted-foreground">
              {row.original.phone}
            </span>
          ) : null}
        </>
      ),
    },
    {
      id: 'rule',
      header: 'Rule in force',
      cell: ({ row }) => ruleText(row.original.activeRule),
    },
    { accessorKey: 'payable', header: 'To pay', meta: { align: 'right' } },
    { accessorKey: 'toRecover', header: 'To get back', meta: { align: 'right' } },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <StatusBadge
          status={row.original.isActive ? 'ACTIVE' : 'INACTIVE'}
          label={row.original.isActive ? 'Active' : 'Switched off'}
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
            aria-label={`Open broker ${row.original.name}`}
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
        searchLabel="Search brokers"
        searchPlaceholder="Name or phone"
        chips={
          status !== 'all'
            ? [
                {
                  label: `Status: ${BROKER_STATUS_TEXT[status] ?? status}`,
                  onRemove: () => set.setFilter('status', 'all'),
                },
              ]
            : []
        }
        onClearFilters={clearFilters}
        onRefresh={query.refetch}
        refreshing={query.isFetching}
      >
        <label className="space-y-1 text-sm font-medium">
          <span>Broker status</span>
          <Select
            className="w-full sm:w-44"
            value={status}
            onChange={(event) => set.setFilter('status', event.target.value)}
          >
            <option value="all">All</option>
            <option value="active">Active</option>
            <option value="inactive">Switched off</option>
          </Select>
        </label>
      </DataTableToolbar>
      <DataTable
        label="Brokers"
        noun="brokers"
        columns={columns}
        query={query}
        getRowId={(row) => row.id}
        filtered={filtered}
        emptyText="No broker has been added yet."
        emptyAction={
          filtered ? (
            <Button variant="outline" size="sm" onClick={clearFilters}>
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
    </>
  );
}

const COMMISSION_DEFAULTS = { pageSize: 10, filters: { status: 'PAYABLE' } };

function CommissionsTab({ onPay }: { onPay: (commissions: Commission[]) => void }) {
  const { can } = useAuth();
  const [params, set] = useListParams(COMMISSION_DEFAULTS, 'comm');
  const [searchText, setSearchText, clearSearchText] = useSearchBox(params, set);
  const [chosen, setChosen] = useState<Commission[]>([]);
  const status = params.filters['status'] ?? 'PAYABLE';
  const query = useCommissions({
    page: params.page,
    pageSize: params.pageSize,
    search: params.search,
    status,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
  });
  const mayPay = can('commissions.approve_payout');
  const brokerOfChosen = chosen[0]?.brokerId;
  const filtered = isFiltered(params, COMMISSION_DEFAULTS);
  const clearFilters = () => {
    clearSearchText();
    set.clear();
  };

  const toggle = (row: Commission) =>
    setChosen((current) =>
      current.some((item) => item.id === row.id)
        ? current.filter((item) => item.id !== row.id)
        : [...current, row],
    );

  const columns: ColumnDef<Commission, unknown>[] = [
    ...(mayPay
      ? [
          {
            id: 'choose',
            header: () => <span className="sr-only">Choose</span>,
            enableHiding: false,
            cell: ({ row }) => {
              const mixed =
                brokerOfChosen !== undefined && brokerOfChosen !== row.original.brokerId;
              return row.original.status === 'PAYABLE' ? (
                <input
                  type="checkbox"
                  className="size-4"
                  aria-label={`Choose the commission on ${row.original.invoiceNo ?? 'the invoice'}`}
                  checked={chosen.some((item) => item.id === row.original.id)}
                  disabled={mixed}
                  title={mixed ? 'Pay one broker at a time' : undefined}
                  onChange={() => toggle(row.original)}
                />
              ) : null;
            },
          } satisfies ColumnDef<Commission, unknown>,
        ]
      : []),
    {
      accessorKey: 'invoiceNo',
      header: 'Invoice',
      meta: { alwaysVisible: true, className: 'font-medium break-id' },
    },
    { accessorKey: 'brokerName', header: 'Broker', meta: { wrap: true } },
    { accessorKey: 'customerName', header: 'Customer', meta: { wrap: true } },
    {
      id: 'worked',
      header: 'Worked out',
      meta: { sortKey: 'amount', align: 'right' },
      cell: ({ row }) => (
        <>
          {row.original.amount}
          <span className="block text-xs text-muted-foreground">
            {ruleText({ type: row.original.ruleType, value: row.original.ruleValue })} of{' '}
            {row.original.baseAmount}
          </span>
        </>
      ),
    },
    {
      id: 'worth',
      header: 'Worth now',
      meta: { align: 'right' },
      cell: ({ row }) => (
        <>
          {row.original.effective}
          {Number(row.original.adjusted) > 0 ? (
            <span className="block text-xs text-muted-foreground">
              {row.original.adjusted} taken back
            </span>
          ) : null}
          {Number(row.original.toRecover) > 0 ? (
            <span className="block text-xs text-destructive">
              {row.original.toRecover} to get back
            </span>
          ) : null}
        </>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <StatusBadge
          status={row.original.status}
          label={COMMISSION_STATUS_TEXT[row.original.status]}
        />
      ),
    },
  ];

  return (
    <>
      <DataTableToolbar
        search={searchText}
        onSearchChange={setSearchText}
        searchLabel="Search commissions"
        searchPlaceholder="Invoice, broker or customer"
        chips={
          status !== 'PAYABLE'
            ? [
                {
                  label: `Status: ${status === 'all' ? 'All' : (COMMISSION_STATUS_TEXT[status as keyof typeof COMMISSION_STATUS_TEXT] ?? status)}`,
                  onRemove: () => {
                    set.setFilter('status', 'PAYABLE');
                    setChosen([]);
                  },
                },
              ]
            : []
        }
        onClearFilters={() => {
          clearFilters();
          setChosen([]);
        }}
        onRefresh={query.refetch}
        refreshing={query.isFetching}
        actions={
          mayPay ? (
            <Button disabled={chosen.length === 0} onClick={() => onPay(chosen)}>
              Pay out chosen ({chosen.length})
            </Button>
          ) : undefined
        }
      >
        <label className="space-y-1 text-sm font-medium">
          <span>Commission status</span>
          <Select
            className="w-full sm:w-48"
            value={status}
            onChange={(event) => {
              set.setFilter('status', event.target.value);
              setChosen([]);
            }}
          >
            <option value="all">All</option>
            {COMMISSION_STATUSES.map((value) => (
              <option key={value} value={value}>
                {COMMISSION_STATUS_TEXT[value]}
              </option>
            ))}
          </Select>
        </label>
      </DataTableToolbar>
      <DataTable
        label="Commissions"
        noun="commissions"
        columns={columns}
        query={query}
        getRowId={(row) => row.id}
        filtered={filtered}
        emptyText="No commission is waiting to be paid."
        emptyAction={
          filtered ? (
            <Button variant="outline" size="sm" onClick={clearFilters}>
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
    </>
  );
}
