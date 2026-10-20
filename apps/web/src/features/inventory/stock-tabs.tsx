import type { ColumnDef } from '@tanstack/react-table';
import { MOVEMENT_TYPES, SERIAL_UNIT_STATES } from '@erp/contracts';
import type { LowStock, Movement, SerialUnit, StockBalance } from '@erp/contracts';
import { DataTable } from '@/components/data-table/data-table';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import { Select } from '@/components/select-field';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-provider';
import { isFiltered, useListParams, useSearchBox } from '@/lib/use-list-params';
import { useBalances, useLowStock, useMovements, useSerialUnits } from './use-inventory';

const label = (value: string): string => value.toLowerCase().replaceAll('_', ' ');
const sortOf = (params: { sortBy: string | undefined; sortOrder: 'asc' | 'desc' }) => ({
  sortBy: params.sortBy,
  sortOrder: params.sortOrder,
});

function useShowBranch(): boolean {
  const { user } = useAuth();
  return (user?.branches.length ?? 0) > 1 || (user?.isSuperAdmin ?? false);
}

const branchColumn = <T extends { branchCode: string }>(): ColumnDef<T, unknown> => ({
  accessorKey: 'branchCode',
  header: 'Branch',
});

const itemCell = (row: { itemCode: string; itemName: string }) => (
  <>
    <span className="font-medium">{row.itemCode}</span> · {row.itemName}
  </>
);

const ClearButton = ({ onClick }: { onClick: () => void }) => (
  <Button variant="outline" size="sm" onClick={onClick}>
    Clear filters
  </Button>
);

const STOCK_DEFAULTS = { pageSize: 10, filters: { low: '' } };

export function StockTab() {
  const showBranch = useShowBranch();
  const [params, set] = useListParams(STOCK_DEFAULTS, 'stock');
  const [searchText, setSearchText, clearSearchText] = useSearchBox(params, set);
  const lowOnly = params.filters['low'] === '1';
  const query = useBalances({
    page: params.page,
    pageSize: params.pageSize,
    search: params.search,
    lowOnly,
    ...sortOf(params),
  });
  const filtered = isFiltered(params, STOCK_DEFAULTS);
  const clearFilters = () => {
    clearSearchText();
    set.clear();
  };
  const quantity = (key: keyof StockBalance, header: string): ColumnDef<StockBalance, unknown> => ({
    accessorKey: key,
    header,
    meta: { align: 'right', className: 'tabular' },
  });

  const columns: ColumnDef<StockBalance, unknown>[] = [
    ...(showBranch ? [{ ...branchColumn<StockBalance>(), meta: { sortKey: 'branch' } }] : []),
    {
      id: 'item',
      header: 'Item',
      meta: { sortKey: 'itemCode', alwaysVisible: true, wrap: true },
      cell: ({ row }) => (
        <>
          {itemCell(row.original)}
          {row.original.isLow ? (
            <strong className="ml-2 rounded bg-destructive-subtle px-1.5 py-0.5 text-xs text-destructive">
              Low
            </strong>
          ) : null}
        </>
      ),
    },
    {
      accessorKey: 'available',
      header: 'Available',
      meta: { sortKey: 'available', align: 'right', className: 'font-medium tabular' },
    },
    quantity('reserved', 'Reserved'),
    quantity('inTransit', 'In transit'),
    quantity('damaged', 'Damaged'),
    quantity('returned', 'Returned'),
    quantity('quarantine', 'Quarantine'),
    {
      id: 'reorder',
      header: 'Reorder at',
      meta: { align: 'right', className: 'tabular' },
      cell: ({ row }) => (row.original.reorderLevel === 0 ? '—' : row.original.reorderLevel),
    },
  ];

  return (
    <>
      <DataTableToolbar
        search={searchText}
        onSearchChange={setSearchText}
        searchPlaceholder="Item code or name"
        chips={
          lowOnly ? [{ label: 'Low stock only', onRemove: () => set.setFilter('low', '') }] : []
        }
        onClearFilters={clearFilters}
        onRefresh={query.refetch}
        refreshing={query.isFetching}
      >
        <label className="flex min-h-control items-center gap-2 text-sm font-medium">
          <input
            type="checkbox"
            className="size-4"
            checked={lowOnly}
            onChange={(event) => set.setFilter('low', event.target.checked ? '1' : '')}
          />
          Low stock only
        </label>
      </DataTableToolbar>
      <DataTable
        label="Stock"
        noun="stock"
        columns={columns}
        query={query}
        getRowId={(row) => `${row.branchId}-${row.itemId}`}
        filtered={filtered}
        emptyText="No stock has been recorded yet."
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

const LOW_DEFAULTS = { pageSize: 10 };

export function LowStockTab() {
  const showBranch = useShowBranch();
  const [params, set] = useListParams(LOW_DEFAULTS, 'low');
  const query = useLowStock({ page: params.page, pageSize: params.pageSize, ...sortOf(params) });
  const columns: ColumnDef<LowStock, unknown>[] = [
    ...(showBranch ? [{ ...branchColumn<LowStock>(), meta: { sortKey: 'branch' } }] : []),
    {
      id: 'item',
      header: 'Item',
      meta: { sortKey: 'itemCode', alwaysVisible: true, wrap: true },
      cell: ({ row }) => itemCell(row.original),
    },
    {
      accessorKey: 'available',
      header: 'Available',
      meta: { sortKey: 'available', align: 'right', className: 'tabular' },
    },
    {
      accessorKey: 'reorderLevel',
      header: 'Reorder at',
      meta: { align: 'right', className: 'tabular' },
    },
    {
      accessorKey: 'shortBy',
      header: 'Short by',
      meta: { sortKey: 'shortfall', align: 'right', className: 'font-medium tabular' },
    },
  ];
  return (
    <DataTable
      label="Low stock"
      noun="low-stock items"
      columns={columns}
      query={query}
      getRowId={(row) => `${row.branchId}-${row.itemId}`}
      filtered={false}
      emptyText="Nothing is at or below its reorder level."
      onPageChange={set.setPage}
      onPageSizeChange={set.setPageSize}
      sort={sortOf(params)}
      onSortChange={set.setSort}
      columnVisibility
    />
  );
}

const MOVEMENT_DEFAULTS = { pageSize: 10, filters: { type: '' } };

export function MovementsTab() {
  const showBranch = useShowBranch();
  const [params, set] = useListParams(MOVEMENT_DEFAULTS, 'moves');
  const [serialText, setSerialText, clearSerialText] = useSearchBox(params, set);
  const movementType = params.filters['type'] ?? '';
  const query = useMovements({
    page: params.page,
    pageSize: params.pageSize,
    movementType,
    serialNo: params.search,
    ...sortOf(params),
  });
  const filtered = isFiltered(params, MOVEMENT_DEFAULTS);
  const clearFilters = () => {
    clearSerialText();
    set.clear();
  };

  const columns: ColumnDef<Movement, unknown>[] = [
    {
      id: 'when',
      header: 'When',
      meta: { sortKey: 'createdAt', alwaysVisible: true, className: 'whitespace-nowrap' },
      cell: ({ row }) => new Date(row.original.createdAt).toLocaleString(),
    },
    ...(showBranch ? [branchColumn<Movement>()] : []),
    {
      id: 'item',
      header: 'Item',
      meta: { className: 'break-id' },
      cell: ({ row }) => (
        <>
          <span className="font-medium">{row.original.itemCode}</span>
          {row.original.serialNo ? ` · ${row.original.serialNo}` : ''}
        </>
      ),
    },
    {
      id: 'movement',
      header: 'Movement',
      meta: { sortKey: 'movementType' },
      cell: ({ row }) => label(row.original.movementType),
    },
    { id: 'state', header: 'State', cell: ({ row }) => label(row.original.state) },
    {
      id: 'change',
      header: 'Change',
      meta: { sortKey: 'qtyDelta', align: 'right', className: 'font-medium tabular' },
      cell: ({ row }) =>
        row.original.qtyDelta > 0 ? `+${row.original.qtyDelta}` : row.original.qtyDelta,
    },
    { id: 'by', header: 'By', cell: ({ row }) => row.original.createdByName ?? '—' },
  ];

  return (
    <>
      <DataTableToolbar
        search={serialText}
        onSearchChange={setSerialText}
        searchLabel="Serial number"
        searchPlaceholder="Exact serial number"
        chips={
          movementType !== ''
            ? [
                {
                  label: `Movement: ${label(movementType)}`,
                  onRemove: () => set.setFilter('type', ''),
                },
              ]
            : []
        }
        onClearFilters={clearFilters}
        onRefresh={query.refetch}
        refreshing={query.isFetching}
      >
        <label className="space-y-1 text-sm font-medium">
          <span>Movement</span>
          <Select
            className="w-full sm:w-52"
            value={movementType}
            onChange={(event) => set.setFilter('type', event.target.value)}
          >
            <option value="">All movements</option>
            {MOVEMENT_TYPES.map((type) => (
              <option key={type} value={type}>
                {label(type)}
              </option>
            ))}
          </Select>
        </label>
      </DataTableToolbar>
      <DataTable
        label="Movements"
        noun="movements"
        columns={columns}
        query={query}
        getRowId={(row) => row.id}
        filtered={filtered}
        emptyText="No stock has moved yet."
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

const SERIAL_DEFAULTS = { pageSize: 10, filters: { state: '' } };

export function SerialUnitsTab() {
  const showBranch = useShowBranch();
  const [params, set] = useListParams(SERIAL_DEFAULTS, 'serial');
  const [searchText, setSearchText, clearSearchText] = useSearchBox(params, set);
  const state = params.filters['state'] ?? '';
  const query = useSerialUnits({
    page: params.page,
    pageSize: params.pageSize,
    search: params.search,
    state,
    ...sortOf(params),
  });
  const filtered = isFiltered(params, SERIAL_DEFAULTS);
  const clearFilters = () => {
    clearSearchText();
    set.clear();
  };

  const columns: ColumnDef<SerialUnit, unknown>[] = [
    {
      accessorKey: 'serialNo',
      header: 'Serial number',
      meta: { sortKey: 'serialNo', alwaysVisible: true, className: 'font-medium break-id' },
    },
    {
      id: 'chassis',
      header: 'Chassis number',
      meta: { className: 'break-id' },
      cell: ({ row }) => row.original.chassisNo ?? '—',
    },
    {
      id: 'item',
      header: 'Item',
      meta: { wrap: true },
      cell: ({ row }) => itemCell(row.original),
    },
    ...(showBranch ? [branchColumn<SerialUnit>()] : []),
    { id: 'state', header: 'State', cell: ({ row }) => label(row.original.state) },
  ];

  return (
    <>
      <DataTableToolbar
        search={searchText}
        onSearchChange={setSearchText}
        searchPlaceholder="Serial or chassis number"
        chips={
          state !== ''
            ? [{ label: `State: ${label(state)}`, onRemove: () => set.setFilter('state', '') }]
            : []
        }
        onClearFilters={clearFilters}
        onRefresh={query.refetch}
        refreshing={query.isFetching}
      >
        <label className="space-y-1 text-sm font-medium">
          <span>State</span>
          <Select
            className="w-full sm:w-48"
            value={state}
            onChange={(event) => set.setFilter('state', event.target.value)}
          >
            <option value="">Any state</option>
            {SERIAL_UNIT_STATES.map((value) => (
              <option key={value} value={value}>
                {label(value)}
              </option>
            ))}
          </Select>
        </label>
      </DataTableToolbar>
      <DataTable
        label="Serial units"
        noun="serial units"
        columns={columns}
        query={query}
        getRowId={(row) => row.id}
        filtered={filtered}
        emptyText="No serial units have been recorded yet."
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
