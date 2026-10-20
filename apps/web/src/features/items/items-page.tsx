import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { Item } from '@erp/contracts';
import { Can } from '@/components/can';
import { DataTable, RowActions, actionsHeader } from '@/components/data-table/data-table';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { Select } from '@/components/select-field';
import { StatusBadge } from '@/components/status-badge';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-provider';
import { isFiltered, useListParams, useSearchBox } from '@/lib/use-list-params';
import { CategoriesDialog } from './categories-dialog';
import { categoryLabel, ItemFormDialog } from './item-form-dialog';
import { ItemStatusDialog } from './item-status-dialog';
import { LabelDialog } from './label-dialog';
import { ScanLookup } from './scan-lookup';
import type { ItemListParams } from './items-api';
import { useCategories, useItems } from './use-items';

const DEFAULTS = {
  pageSize: 10,
  filters: { category: '', status: 'active', tracking: 'any' },
};
const STATUS_LABEL: Record<string, string> = { inactive: 'Inactive items', all: 'All items' };
const TRACKING_LABEL: Record<string, string> = {
  serialized: 'Serial numbers',
  plain: 'Quantity only',
};

type FormTarget = { kind: 'create' } | { kind: 'edit'; item: Item } | null;

export function ItemsPage() {
  const { can } = useAuth();
  const canManage = can('items.manage');
  const [params, set] = useListParams(DEFAULTS);
  const [searchText, setSearchText, clearSearchText] = useSearchBox(params, set);
  const [formTarget, setFormTarget] = useState<FormTarget>(null);
  const [statusTarget, setStatusTarget] = useState<Item | null>(null);
  const [categoriesOpen, setCategoriesOpen] = useState(false);
  const [labelsOpen, setLabelsOpen] = useState(false);
  const [selected, setSelected] = useState<Map<string, Item>>(new Map());
  const categories = useCategories();
  const categoryId = params.filters['category'] ?? '';
  const status = params.filters['status'] as ItemListParams['status'];
  const tracking = params.filters['tracking'] as ItemListParams['tracking'];
  const query = useItems({
    page: params.page,
    pageSize: params.pageSize,
    search: params.search,
    categoryId,
    status,
    tracking,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
  });
  const filtered = isFiltered(params, DEFAULTS);

  const done = (message: string) => {
    toast.success(message);
    setFormTarget(null);
    setStatusTarget(null);
  };
  const clearFilters = () => {
    clearSearchText();
    set.clear();
  };
  const toggleSelected = (item: Item) =>
    setSelected((previous) => {
      const next = new Map(previous);
      if (next.has(item.id)) next.delete(item.id);
      else next.set(item.id, item);
      return next;
    });

  const categoryChoices = (categories.data ?? [])
    .map((category) => ({ id: category.id, label: categoryLabel(category, categories.data ?? []) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const columns: ColumnDef<Item, unknown>[] = [
    {
      id: 'select',
      header: () => <span className="sr-only">Select for labels</span>,
      enableHiding: false,
      cell: ({ row }) => (
        <input
          type="checkbox"
          className="size-4"
          aria-label={`Select ${row.original.itemCode} for labels`}
          checked={selected.has(row.original.id)}
          onChange={() => toggleSelected(row.original)}
        />
      ),
    },
    {
      accessorKey: 'itemCode',
      header: 'Code',
      meta: { sortKey: 'itemCode', alwaysVisible: true, className: 'font-medium' },
    },
    {
      id: 'name',
      header: 'Name',
      meta: { sortKey: 'name', wrap: true },
      cell: ({ row }) => (
        <>
          {row.original.name}
          {row.original.isSerialized ? (
            <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs">Serial</span>
          ) : null}
        </>
      ),
    },
    { accessorKey: 'categoryName', header: 'Category' },
    { accessorKey: 'unitCode', header: 'Unit' },
    {
      id: 'gst',
      header: 'GST',
      meta: { align: 'right' },
      cell: ({ row }) => (row.original.taxRate ? `${row.original.taxRate}%` : '—'),
    },
    {
      id: 'barcode',
      header: 'Barcode',
      meta: { className: 'font-mono text-xs' },
      cell: ({ row }) => (
        <>
          {row.original.barcodes[0]?.barcode ?? '—'}
          {row.original.barcodes.length > 1 ? ` +${row.original.barcodes.length - 1}` : ''}
        </>
      ),
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <StatusBadge
          status={row.original.isActive ? 'ACTIVE' : 'INACTIVE'}
          label={row.original.isActive ? 'Active' : 'Inactive'}
        />
      ),
    },
    {
      id: 'actions',
      header: actionsHeader,
      enableHiding: false,
      cell: ({ row }) => (
        <Can permission="items.manage">
          <RowActions>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Edit ${row.original.itemCode}`}
              onClick={() => setFormTarget({ kind: 'edit', item: row.original })}
            >
              Edit
            </Button>
            <Button
              variant="ghost"
              size="sm"
              aria-label={`${row.original.isActive ? 'Deactivate' : 'Reactivate'} ${row.original.itemCode}`}
              onClick={() => setStatusTarget(row.original)}
            >
              {row.original.isActive ? 'Deactivate' : 'Reactivate'}
            </Button>
          </RowActions>
        </Can>
      ),
    },
  ];

  const chips = [
    ...(categoryId !== ''
      ? [
          {
            label: `Category: ${categoryChoices.find((c) => c.id === categoryId)?.label ?? 'Selected'}`,
            onRemove: () => set.setFilter('category', ''),
          },
        ]
      : []),
    ...(status !== 'active'
      ? [
          {
            label: `Show: ${STATUS_LABEL[status] ?? status}`,
            onRemove: () => set.setFilter('status', 'active'),
          },
        ]
      : []),
    ...(tracking !== 'any'
      ? [
          {
            label: `Tracking: ${TRACKING_LABEL[tracking] ?? tracking}`,
            onRemove: () => set.setFilter('tracking', 'any'),
          },
        ]
      : []),
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Items"
        description="Products, spare parts and batteries, with their barcodes and GST rates."
        actions={
          <>
            <Button
              variant="secondary"
              disabled={selected.size === 0}
              onClick={() => setLabelsOpen(true)}
            >
              Print labels ({selected.size})
            </Button>
            <Can permission="items.manage">
              <Button variant="secondary" onClick={() => setCategoriesOpen(true)}>
                Categories
              </Button>
              <Button onClick={() => setFormTarget({ kind: 'create' })}>New item</Button>
            </Can>
          </>
        }
      />

      <ScanLookup
        onOpen={(item) => {
          if (canManage) setFormTarget({ kind: 'edit', item });
        }}
      />

      <DataTableToolbar
        search={searchText}
        onSearchChange={setSearchText}
        searchPlaceholder="Code, name or barcode"
        chips={chips}
        onClearFilters={clearFilters}
        onRefresh={query.refetch}
        refreshing={query.isFetching}
      >
        <label className="space-y-1 text-sm font-medium">
          <span>Category</span>
          <Select
            className="w-full sm:w-52"
            value={categoryId}
            onChange={(event) => set.setFilter('category', event.target.value)}
          >
            <option value="">All categories</option>
            {categoryChoices.map((choice) => (
              <option key={choice.id} value={choice.id}>
                {choice.label}
              </option>
            ))}
          </Select>
        </label>
        <label className="space-y-1 text-sm font-medium">
          <span>Show</span>
          <Select
            className="w-full sm:w-44"
            value={status}
            onChange={(event) => set.setFilter('status', event.target.value)}
          >
            <option value="active">Active items</option>
            <option value="inactive">Inactive items</option>
            <option value="all">All items</option>
          </Select>
        </label>
        <label className="space-y-1 text-sm font-medium">
          <span>Tracking</span>
          <Select
            className="w-full sm:w-44"
            value={tracking}
            onChange={(event) => set.setFilter('tracking', event.target.value)}
          >
            <option value="any">Any</option>
            <option value="serialized">Serial numbers</option>
            <option value="plain">Quantity only</option>
          </Select>
        </label>
      </DataTableToolbar>

      <DataTable
        label="Items"
        noun="items"
        columns={columns}
        query={query}
        getRowId={(item) => item.id}
        filtered={filtered}
        emptyText="There are no items yet."
        filteredEmptyText="No items match your search. Clear the search or change the filters."
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

      {formTarget ? (
        <ItemFormDialog
          key={formTarget.kind === 'edit' ? formTarget.item.id : 'new'}
          item={formTarget.kind === 'edit' ? formTarget.item : null}
          open
          canManage={canManage}
          onClose={() => setFormTarget(null)}
          onSaved={done}
        />
      ) : null}
      <ItemStatusDialog item={statusTarget} onClose={() => setStatusTarget(null)} onDone={done} />
      {categoriesOpen ? <CategoriesDialog onClose={() => setCategoriesOpen(false)} /> : null}
      {labelsOpen ? (
        <LabelDialog items={[...selected.values()]} onClose={() => setLabelsOpen(false)} />
      ) : null}
    </PageContainer>
  );
}
