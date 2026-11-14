//apps/web/src/features/assembly/assembly-page.tsx
import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { Assembly } from '@erp/contracts';
import { Can } from '@/components/can';
import { DataTable, RowActions, actionsHeader } from '@/components/data-table/data-table';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import { PageContainer } from '@/components/page-container';
import { PageHeader } from '@/components/page-header';
import { StatusBadge } from '@/components/status-badge';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { isFiltered, useListParams, useSearchBox } from '@/lib/use-list-params';
import { formatWhen } from '../leads/leads-shared';
import { AssemblyDialog } from './assembly-dialog';
import { ReverseAssemblyDialog } from './reverse-assembly-dialog';
import { useAssemblies } from './use-assembly';

const DEFAULTS = { pageSize: 10 };

/** What went into an assembly, in a line: Tyre x4, Battery x1 (BAT-1). */
const partsText = (assembly: Assembly): string =>
  assembly.parts
    .map(
      (part) =>
        `${part.itemName} × ${part.qty}${part.serialNos.length > 0 ? ` (${part.serialNos.join(', ')})` : ''}`,
    )
    .join(', ');

/** Products assembled from our own stock, and a way to assemble another. */
export function AssemblyPage() {
  const [params, set] = useListParams(DEFAULTS);
  const [searchText, setSearchText, clearSearchText] = useSearchBox(params, set);
  const [open, setOpen] = useState(false);
  const [reversing, setReversing] = useState<Assembly | null>(null);
  const query = useAssemblies({
    page: params.page,
    pageSize: params.pageSize,
    search: params.search,
  });
  const filtered = isFiltered(params, DEFAULTS);

  const columns: ColumnDef<Assembly, unknown>[] = [
    {
      id: 'assemblyNo',
      header: 'Assembly',
      meta: { alwaysVisible: true, className: 'font-medium break-id' },
      cell: ({ row }) => (
        <>
          {row.original.assemblyNo}
          <span className="block text-xs font-normal text-muted-foreground">
            {formatWhen(row.original.createdAt)}
            {row.original.createdByName ? ` · ${row.original.createdByName}` : ''}
          </span>
        </>
      ),
    },
    {
      id: 'product',
      header: 'Product made',
      meta: { wrap: true },
      cell: ({ row }) => (
        <>
          {row.original.finishedItemName}
          <span className="block text-xs text-muted-foreground">
            {row.original.finishedItemCode}
            {row.original.units[0] ? ` · ${row.original.units[0].serialNo}` : ''}
          </span>
        </>
      ),
    },
    { accessorKey: 'qty', header: 'Made', meta: { align: 'right' } },
    {
      id: 'price',
      header: 'Selling price',
      meta: { align: 'right', className: 'tabular' },
      cell: ({ row }) => row.original.sellingPrice,
    },
    {
      id: 'cost',
      header: 'Cost of parts',
      meta: { align: 'right', className: 'tabular' },
      cell: ({ row }) => row.original.costTotal ?? '—',
    },
    {
      id: 'profit',
      header: 'Profit',
      meta: { align: 'right', className: 'tabular' },
      cell: ({ row }) => row.original.profit ?? '—',
    },
    {
      id: 'parts',
      header: 'Parts used',
      meta: { wrap: true, className: 'text-xs' },
      cell: ({ row }) => partsText(row.original),
    },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) =>
        row.original.reversed ? (
          <>
            <StatusBadge status="CANCELLED" label="Reversed" />
            <span className="block max-w-48 text-xs text-muted-foreground">
              {row.original.reversed.reason}
            </span>
          </>
        ) : (
          <StatusBadge status="DONE" label="Made" />
        ),
    },
    {
      id: 'actions',
      header: actionsHeader,
      enableHiding: false,
      cell: ({ row }) =>
        row.original.reversed ? null : (
          <Can permission="manufacturing.manage">
            <RowActions>
              <Button
                variant="ghost"
                size="sm"
                aria-label={`Reverse ${row.original.assemblyNo}`}
                onClick={() => setReversing(row.original)}
              >
                Reverse
              </Button>
            </RowActions>
          </Can>
        ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Assembly"
        description="Products made from our own stock. The parts leave stock, the product comes in, and its selling price is set."
        actions={
          <Can permission="manufacturing.manage">
            <Button onClick={() => setOpen(true)}>Assemble a product</Button>
          </Can>
        }
      />
      <DataTableToolbar
        search={searchText}
        onSearchChange={setSearchText}
        searchLabel="Search assemblies"
        searchPlaceholder="Number or product"
        onClearFilters={() => {
          clearSearchText();
          set.clear();
        }}
        onRefresh={query.refetch}
        refreshing={query.isFetching}
      />
      <DataTable
        label="Assemblies"
        noun="assemblies"
        columns={columns}
        query={query}
        getRowId={(row) => row.id}
        filtered={filtered}
        emptyText="Nothing has been assembled yet."
        onPageChange={set.setPage}
        onPageSizeChange={set.setPageSize}
        columnVisibility
      />
      {reversing ? (
        <ReverseAssemblyDialog
          assembly={reversing}
          onClose={() => setReversing(null)}
          onDone={(message) => {
            toast.success(message);
            setReversing(null);
          }}
        />
      ) : null}
      {open ? (
        <AssemblyDialog
          onClose={() => setOpen(false)}
          onDone={(message) => {
            toast.success(message);
            setOpen(false);
          }}
        />
      ) : null}
    </PageContainer>
  );
}
