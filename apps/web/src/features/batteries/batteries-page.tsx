import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { DEFAULT_EXPIRY_WINDOW_DAYS } from '@erp/contracts';
import type { Battery } from '@erp/contracts';
import { Alert } from '@/components/alert';
import { Can } from '@/components/can';
import { DataTable, RowActions, actionsHeader } from '@/components/data-table/data-table';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { Select } from '@/components/select-field';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { isFiltered, useListParams, useSearchBox } from '@/lib/use-list-params';
import { BatteryDetailsDialog } from './battery-details-dialog';
import { BatteryInstallDialog } from './battery-install-dialog';
import type { BatteryListParams } from './batteries-api';
import { useBatteries, useBatteryAlerts, useBatteryMutations } from './use-batteries';

const DEFAULTS = { pageSize: 10, filters: { expiry: 'any', warranty: 'any', installed: 'any' } };
const EXPIRY_TEXT: Record<string, string> = {
  expired: 'Expired',
  expiring: 'Expiring soon',
  ok: 'Not near expiry',
  none: 'No expiry date',
};
const WARRANTY_TEXT: Record<string, string> = {
  active: 'Covered',
  ended: 'Ended',
  none: 'Not started',
};
const INSTALLED_TEXT: Record<string, string> = { yes: 'In a vehicle', no: 'Not installed' };

type Dialog =
  { kind: 'details'; battery: Battery | null } | { kind: 'install'; battery: Battery } | null;

export function describeExpiry(battery: Battery): string {
  const days = battery.daysToExpiry;
  if (battery.expiryOn === null || days === null) return '—';
  if (days < 0) return `${battery.expiryOn} · expired ${-days} day${days === -1 ? '' : 's'} ago`;
  if (days === 0) return `${battery.expiryOn} · expires today`;
  return `${battery.expiryOn} · in ${days} day${days === 1 ? '' : 's'}`;
}

export function describeWarranty(battery: Battery): string {
  if (battery.warrantyEnd === null)
    return battery.warrantyMonths === null ? '—' : `${battery.warrantyMonths} months, not started`;
  return `${battery.warrantyEnd} · ${battery.warrantyStatus === 'ACTIVE' ? 'covered' : 'ended'}`;
}

export function BatteriesPage() {
  const [params, set] = useListParams(DEFAULTS);
  const [searchText, setSearchText, clearSearchText] = useSearchBox(params, set);
  const [dialog, setDialog] = useState<Dialog>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const expiry = (params.filters['expiry'] ?? 'any') as BatteryListParams['expiry'];
  const warranty = (params.filters['warranty'] ?? 'any') as BatteryListParams['warranty'];
  const installed = (params.filters['installed'] ?? 'any') as BatteryListParams['installed'];
  const withinDays = DEFAULT_EXPIRY_WINDOW_DAYS;
  const alerts = useBatteryAlerts(withinDays);
  const { uninstall } = useBatteryMutations();
  const query = useBatteries({
    page: params.page,
    pageSize: params.pageSize,
    search: params.search,
    expiry,
    warranty,
    installed,
    withinDays,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
  });
  const filtered = isFiltered(params, DEFAULTS);

  const finish = (message: string) => {
    toast.success(message);
    setDialog(null);
  };
  const clearFilters = () => {
    clearSearchText();
    set.clear();
  };
  const takeOut = async (battery: Battery) => {
    setProblem(null);
    try {
      await uninstall.mutateAsync(battery.serialUnitId);
      toast.success(
        `Battery ${battery.serialNo} taken out of ${battery.installedInSerialNo ?? 'the vehicle'}`,
      );
    } catch (failure) {
      setProblem(failure instanceof Error ? failure.message : 'Something went wrong. Try again.');
    }
  };

  const columns: ColumnDef<Battery, unknown>[] = [
    {
      accessorKey: 'serialNo',
      header: 'Serial number',
      meta: { sortKey: 'serialNo', alwaysVisible: true, className: 'font-medium break-id' },
    },
    {
      id: 'item',
      header: 'Item',
      meta: { wrap: true },
      cell: ({ row }) => (
        <>
          {row.original.itemCode} · {row.original.itemName}
        </>
      ),
    },
    { accessorKey: 'branchCode', header: 'Branch' },
    {
      id: 'state',
      header: 'State',
      cell: ({ row }) => row.original.state.replace('_', ' ').toLowerCase(),
    },
    {
      id: 'expiry',
      header: 'Expiry',
      meta: { sortKey: 'expiryOn' },
      cell: ({ row }) => (
        <span
          className={
            row.original.expiryStatus === 'EXPIRED' ? 'font-medium text-destructive' : undefined
          }
        >
          {describeExpiry(row.original)}
        </span>
      ),
    },
    {
      id: 'warranty',
      header: 'Warranty',
      meta: { sortKey: 'warrantyEnd' },
      cell: ({ row }) => describeWarranty(row.original),
    },
    {
      id: 'installed',
      header: 'Installed in',
      meta: { sortKey: 'installedOn' },
      cell: ({ row }) =>
        row.original.installedInSerialNo
          ? `${row.original.installedInSerialNo} (${row.original.installedOn})`
          : '—',
    },
    {
      id: 'actions',
      header: actionsHeader,
      enableHiding: false,
      cell: ({ row }) => {
        const battery = row.original;
        return (
          <Can permission="stock.adjust">
            <RowActions>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Edit details of ${battery.serialNo}`}
                onClick={() => setDialog({ kind: 'details', battery })}
              >
                Details
              </Button>
              {battery.installedInSerialUnitId ? (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Take ${battery.serialNo} out of its vehicle`}
                  disabled={uninstall.isPending}
                  onClick={() => void takeOut(battery)}
                >
                  Take out
                </Button>
              ) : battery.state === 'AVAILABLE' ? (
                <Button
                  variant="ghost"
                  size="sm"
                  aria-label={`Install ${battery.serialNo}`}
                  onClick={() => setDialog({ kind: 'install', battery })}
                >
                  Install
                </Button>
              ) : null}
            </RowActions>
          </Can>
        );
      },
    },
  ];

  const chips = [
    ...(expiry !== 'any'
      ? [
          {
            label: `Expiry: ${EXPIRY_TEXT[expiry] ?? expiry}`,
            onRemove: () => set.setFilter('expiry', 'any'),
          },
        ]
      : []),
    ...(warranty !== 'any'
      ? [
          {
            label: `Warranty: ${WARRANTY_TEXT[warranty] ?? warranty}`,
            onRemove: () => set.setFilter('warranty', 'any'),
          },
        ]
      : []),
    ...(installed !== 'any'
      ? [
          {
            label: `Installed: ${INSTALLED_TEXT[installed] ?? installed}`,
            onRemove: () => set.setFilter('installed', 'any'),
          },
        ]
      : []),
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Batteries"
        description="Expiry and warranty of every battery in stock, and which vehicle it is fitted to."
        actions={
          <Can permission="stock.adjust">
            <Button onClick={() => setDialog({ kind: 'details', battery: null })}>
              Record battery details
            </Button>
          </Can>
        }
      />

      {problem ? <Alert tone="error">{problem}</Alert> : null}

      {alerts.data ? (
        <div aria-label="Expiry alerts" className="flex flex-wrap gap-3 text-sm">
          <Button variant="secondary" size="sm" onClick={() => set.setFilter('expiry', 'expired')}>
            {alerts.data.expired} expired in stock
          </Button>
          <Button variant="secondary" size="sm" onClick={() => set.setFilter('expiry', 'expiring')}>
            {alerts.data.expiring} expiring within {alerts.data.withinDays} days
          </Button>
        </div>
      ) : null}

      <DataTableToolbar
        search={searchText}
        onSearchChange={setSearchText}
        searchPlaceholder="Serial number, item code or name"
        chips={chips}
        onClearFilters={clearFilters}
        onRefresh={query.refetch}
        refreshing={query.isFetching}
      >
        <label className="space-y-1 text-sm font-medium">
          <span>Expiry</span>
          <Select
            className="w-full sm:w-44"
            value={expiry}
            onChange={(event) => set.setFilter('expiry', event.target.value)}
          >
            <option value="any">Any</option>
            <option value="expired">Expired</option>
            <option value="expiring">Expiring soon</option>
            <option value="ok">Not near expiry</option>
            <option value="none">No expiry date</option>
          </Select>
        </label>
        <label className="space-y-1 text-sm font-medium">
          <span>Warranty</span>
          <Select
            className="w-full sm:w-40"
            value={warranty}
            onChange={(event) => set.setFilter('warranty', event.target.value)}
          >
            <option value="any">Any</option>
            <option value="active">Covered</option>
            <option value="ended">Ended</option>
            <option value="none">Not started</option>
          </Select>
        </label>
        <label className="space-y-1 text-sm font-medium">
          <span>Installed</span>
          <Select
            className="w-full sm:w-40"
            value={installed}
            onChange={(event) => set.setFilter('installed', event.target.value)}
          >
            <option value="any">Any</option>
            <option value="yes">In a vehicle</option>
            <option value="no">Not installed</option>
          </Select>
        </label>
      </DataTableToolbar>

      <DataTable
        label="Batteries"
        noun="batteries"
        columns={columns}
        query={query}
        getRowId={(row) => row.serialUnitId}
        filtered={filtered}
        emptyText="No battery details have been recorded yet."
        filteredEmptyText="No batteries match your search. Clear the search or change the filters."
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

      {dialog?.kind === 'details' ? (
        <BatteryDetailsDialog
          key={dialog.battery?.serialUnitId ?? 'new'}
          battery={dialog.battery}
          onClose={() => setDialog(null)}
          onSaved={finish}
        />
      ) : null}
      {dialog?.kind === 'install' ? (
        <BatteryInstallDialog
          battery={dialog.battery}
          onClose={() => setDialog(null)}
          onDone={finish}
        />
      ) : null}
    </PageContainer>
  );
}
