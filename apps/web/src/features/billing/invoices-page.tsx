import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { INVOICE_STATUSES, INVOICE_TYPES } from '@erp/contracts';
import type { Invoice, InvoiceStatusName, InvoiceSummary } from '@erp/contracts';
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
import { STATUS_TEXT, TYPE_TEXT } from './billing-shared';
import { CreditNoteRequestDialog } from './credit-note-dialogs';
import { CreditNotesTab } from './credit-notes-tab';
import { InvoiceDetailDialog } from './invoice-detail-dialog';
import { InvoiceFormDialog } from './invoice-form-dialog';
import { useInvoices } from './use-billing';

const DEFAULTS = { pageSize: 10, filters: { status: '', type: '' } };

type Dialogs =
  | { kind: 'form'; invoice: Invoice | null }
  | { kind: 'detail'; id: string }
  | { kind: 'credit'; invoice: Invoice }
  | null;

const SECTIONS = [
  { id: 'invoices', label: 'Invoices' },
  { id: 'credit-notes', label: 'Credit notes' },
] as const;

export function InvoicesPage() {
  const [params, set] = useListParams(DEFAULTS);
  const [searchText, setSearchText, clearSearchText] = useSearchBox(params, set);
  const [section, setSection] = useState<(typeof SECTIONS)[number]['id']>('invoices');
  const [dialog, setDialog] = useState<Dialogs>(null);
  const status = params.filters['status'] ?? '';
  const type = params.filters['type'] ?? '';
  const query = useInvoices({
    page: params.page,
    pageSize: params.pageSize,
    search: params.search,
    status,
    type,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
  });
  const filtered = isFiltered(params, DEFAULTS);
  const clearFilters = () => {
    clearSearchText();
    set.clear();
  };

  const columns: ColumnDef<InvoiceSummary, unknown>[] = [
    {
      id: 'invoiceNo',
      header: 'Invoice',
      meta: { sortKey: 'invoiceNo', alwaysVisible: true, className: 'font-medium break-id' },
      cell: ({ row }) => row.original.invoiceNo ?? 'Draft',
    },
    { accessorKey: 'customerName', header: 'Customer', meta: { wrap: true } },
    {
      id: 'issuedOn',
      header: 'Date',
      meta: { sortKey: 'issuedOn' },
      cell: ({ row }) => row.original.issuedOn ?? '—',
    },
    { id: 'kind', header: 'Kind', cell: ({ row }) => TYPE_TEXT[row.original.type] },
    {
      id: 'status',
      header: 'Status',
      cell: ({ row }) => (
        <StatusBadge status={row.original.status} label={STATUS_TEXT[row.original.status]} />
      ),
    },
    {
      accessorKey: 'total',
      header: 'Total',
      meta: { sortKey: 'total', align: 'right', className: 'tabular' },
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
            aria-label={`Open ${row.original.invoiceNo ?? `draft for ${row.original.customerName}`}`}
            onClick={() => setDialog({ kind: 'detail', id: row.original.id })}
          >
            Open
          </Button>
        </RowActions>
      ),
    },
  ];

  const chips = [
    ...(status !== ''
      ? [
          {
            label: `Status: ${STATUS_TEXT[status as InvoiceStatusName] ?? status}`,
            onRemove: () => set.setFilter('status', ''),
          },
        ]
      : []),
    ...(type !== ''
      ? [
          {
            label: `Kind: ${TYPE_TEXT[type as keyof typeof TYPE_TEXT] ?? type}`,
            onRemove: () => set.setFilter('type', ''),
          },
        ]
      : []),
  ];

  return (
    <PageContainer>
      <PageHeader
        title="Sales"
        description="Invoices and credit notes for the branch you are working in."
        actions={
          <Can permission="invoices.create">
            <Button onClick={() => setDialog({ kind: 'form', invoice: null })}>New invoice</Button>
          </Can>
        }
      />

      <SectionTabs
        label="Sales sections"
        idPrefix="sales"
        tabs={SECTIONS}
        value={section}
        onChange={setSection}
      />

      {section === 'credit-notes' ? (
        <SectionPanel idPrefix="sales" id="credit-notes">
          <CreditNotesTab />
        </SectionPanel>
      ) : (
        <SectionPanel idPrefix="sales" id="invoices">
          <DataTableToolbar
            search={searchText}
            onSearchChange={setSearchText}
            searchPlaceholder="Invoice number or customer"
            chips={chips}
            onClearFilters={clearFilters}
            onRefresh={query.refetch}
            refreshing={query.isFetching}
          >
            <label className="space-y-1 text-sm font-medium">
              <span>Status</span>
              <Select
                className="w-full sm:w-40"
                value={status}
                onChange={(event) => set.setFilter('status', event.target.value)}
              >
                <option value="">All</option>
                {INVOICE_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {STATUS_TEXT[value]}
                  </option>
                ))}
              </Select>
            </label>
            <label className="space-y-1 text-sm font-medium">
              <span>Kind</span>
              <Select
                className="w-full sm:w-48"
                value={type}
                onChange={(event) => set.setFilter('type', event.target.value)}
              >
                <option value="">All</option>
                {INVOICE_TYPES.map((value) => (
                  <option key={value} value={value}>
                    {TYPE_TEXT[value]}
                  </option>
                ))}
              </Select>
            </label>
          </DataTableToolbar>

          <DataTable
            label="Invoices"
            noun="invoices"
            columns={columns}
            query={query}
            getRowId={(row) => row.id}
            filtered={filtered}
            emptyText="There are no invoices yet."
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
        </SectionPanel>
      )}

      {dialog?.kind === 'form' ? (
        <InvoiceFormDialog
          key={dialog.invoice?.id ?? 'new'}
          invoice={dialog.invoice}
          onClose={() => setDialog(null)}
          onSaved={(saved, message) => {
            toast.success(message);
            setDialog({ kind: 'detail', id: saved.id });
          }}
        />
      ) : null}
      {dialog?.kind === 'detail' ? (
        <InvoiceDetailDialog
          key={dialog.id}
          invoiceId={dialog.id}
          onClose={() => setDialog(null)}
          onEdit={(invoice) => setDialog({ kind: 'form', invoice })}
          onCreditNote={(invoice) => setDialog({ kind: 'credit', invoice })}
          onChanged={(message, draft) => {
            toast.success(message);
            setDialog(draft ? { kind: 'detail', id: draft.id } : null);
          }}
        />
      ) : null}
      {dialog?.kind === 'credit' ? (
        <CreditNoteRequestDialog
          invoiceId={dialog.invoice.id}
          invoiceNo={dialog.invoice.invoiceNo}
          onClose={() => setDialog({ kind: 'detail', id: dialog.invoice.id })}
          onRequested={(note) => {
            toast.success(
              `Credit note request for ${note.invoiceNo ?? 'the invoice'} sent. It is waiting for approval.`,
            );
            setSection('credit-notes');
            setDialog(null);
          }}
        />
      ) : null}
    </PageContainer>
  );
}
