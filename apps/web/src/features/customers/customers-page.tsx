import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import type { Customer, KycStatusName } from '@erp/contracts';
import { KYC_STATUSES } from '@erp/contracts';
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
import { CustomerFormDialog } from './customer-form-dialog';
import { KYC_LABELS } from './customers-shared';
import { KycDialog } from './kyc-dialog';
import { useCustomers } from './use-customers';

const DEFAULTS = { pageSize: 10, filters: { kyc: '' } };

type FormTarget = { kind: 'create' } | { kind: 'edit'; customer: Customer } | null;

export function CustomersPage() {
  const { can } = useAuth();
  const canManage = can('customers.manage');
  const canKyc = can('kyc.view') || can('kyc.upload');
  const [params, set] = useListParams(DEFAULTS);
  const [searchText, setSearchText, clearSearchText] = useSearchBox(params, set);
  const [formTarget, setFormTarget] = useState<FormTarget>(null);
  const [kycTarget, setKycTarget] = useState<Customer | null>(null);
  const kycStatus = (params.filters['kyc'] ?? '') as KycStatusName | '';
  const query = useCustomers({
    page: params.page,
    pageSize: params.pageSize,
    search: params.search,
    kycStatus,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
  });
  const filtered = isFiltered(params, DEFAULTS);
  const clearFilters = () => {
    clearSearchText();
    set.clear();
  };

  const columns: ColumnDef<Customer, unknown>[] = [
    {
      accessorKey: 'name',
      header: 'Name',
      meta: { sortKey: 'name', alwaysVisible: true, className: 'font-medium', wrap: true },
    },
    { accessorKey: 'phone', header: 'Phone', meta: { sortKey: 'phone' } },
    { id: 'state', header: 'State', cell: ({ row }) => row.original.stateName ?? '—' },
    {
      id: 'gstin',
      header: 'GSTIN',
      meta: { className: 'font-mono text-xs' },
      cell: ({ row }) => row.original.gstin ?? '—',
    },
    {
      id: 'kyc',
      header: 'KYC',
      cell: ({ row }) => (
        <StatusBadge status={row.original.kycStatus} label={KYC_LABELS[row.original.kycStatus]} />
      ),
    },
    {
      id: 'actions',
      header: actionsHeader,
      enableHiding: false,
      cell: ({ row }) => (
        <RowActions>
          {canKyc ? (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`KYC documents of ${row.original.name}`}
              onClick={() => setKycTarget(row.original)}
            >
              KYC
            </Button>
          ) : null}
          {canManage ? (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Edit ${row.original.name}`}
              onClick={() => setFormTarget({ kind: 'edit', customer: row.original })}
            >
              Edit
            </Button>
          ) : null}
        </RowActions>
      ),
    },
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Customers"
        description="Buyers shared by every branch, with their KYC status."
        actions={
          canManage ? (
            <Button onClick={() => setFormTarget({ kind: 'create' })}>New customer</Button>
          ) : undefined
        }
      />
      <DataTableToolbar
        search={searchText}
        onSearchChange={setSearchText}
        searchPlaceholder="Name, phone or GSTIN"
        chips={
          kycStatus !== ''
            ? [{ label: `KYC: ${KYC_LABELS[kycStatus]}`, onRemove: () => set.setFilter('kyc', '') }]
            : []
        }
        onClearFilters={clearFilters}
        onRefresh={query.refetch}
        refreshing={query.isFetching}
      >
        <label className="space-y-1 text-sm font-medium">
          <span>KYC</span>
          <Select
            className="w-full sm:w-44"
            value={kycStatus}
            onChange={(event) => set.setFilter('kyc', event.target.value)}
          >
            <option value="">Any</option>
            {KYC_STATUSES.map((status) => (
              <option key={status} value={status}>
                {KYC_LABELS[status]}
              </option>
            ))}
          </Select>
        </label>
      </DataTableToolbar>

      <DataTable
        label="Customers"
        noun="customers"
        columns={columns}
        query={query}
        getRowId={(customer) => customer.id}
        filtered={filtered}
        emptyText="There are no customers yet."
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
        <CustomerFormDialog
          key={formTarget.kind === 'edit' ? formTarget.customer.id : 'new'}
          customer={formTarget.kind === 'edit' ? formTarget.customer : null}
          onClose={() => setFormTarget(null)}
          onSaved={(message) => {
            toast.success(message);
            setFormTarget(null);
          }}
        />
      ) : null}
      {kycTarget ? <KycDialog customer={kycTarget} onClose={() => setKycTarget(null)} /> : null}
    </PageContainer>
  );
}
