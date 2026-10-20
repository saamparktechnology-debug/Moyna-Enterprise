import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { CreateSupplierRequestSchema } from '@erp/contracts';
import type { Supplier, SupplierLedgerEntry } from '@erp/contracts';
import { z } from 'zod';
import type { ColumnDef } from '@tanstack/react-table';
import { Alert } from '@/components/alert';
import { DataTable, RowActions, actionsHeader } from '@/components/data-table/data-table';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import { FormActions } from '@/components/form-actions';
import { FormDialog } from '@/components/form-dialog';
import { FormField, Input } from '@/components/form-field';
import { Select } from '@/components/select-field';
import { StatusBadge } from '@/components/status-badge';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/features/auth/auth-provider';
import { useStates } from '@/features/branches/use-branches';
import { isFiltered, useListParams, useSearchBox } from '@/lib/use-list-params';
import { BranchField, describeError, useBranchChoice } from './purchasing-shared';
import type { Problem } from './purchasing-shared';
import {
  usePaymentModes,
  usePurchasingMutations,
  useSupplier,
  useSupplierLedger,
  useSuppliers,
} from './use-purchasing';

const PAGE_SIZE = 10;
const DEFAULTS = { pageSize: 10, filters: { status: 'active' } };
const STATUS_TEXT: Record<string, string> = {
  inactive: 'Inactive suppliers',
  all: 'All suppliers',
};

const FormSchema = z.object({
  name: z.string(),
  gstin: z.string(),
  stateCode: z.string(),
  phone: z.string(),
  isActive: z.boolean(),
});
type FormValues = z.infer<typeof FormSchema>;
const FIELDS = ['name', 'gstin', 'stateCode', 'phone'] as const;
type Field = (typeof FIELDS)[number];
const isField = (name: string): name is Field => (FIELDS as readonly string[]).includes(name);

export function SuppliersTab() {
  const { can } = useAuth();
  const [params, set] = useListParams(DEFAULTS, 'suppliers');
  const [searchText, setSearchText, clearSearchText] = useSearchBox(params, set);
  const [editing, setEditing] = useState<Supplier | 'new' | null>(null);
  const [ledgerFor, setLedgerFor] = useState<Supplier | null>(null);
  const status = params.filters['status'] ?? 'active';
  const query = useSuppliers({
    page: params.page,
    pageSize: params.pageSize,
    search: params.search,
    status,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
  });
  const filtered = isFiltered(params, DEFAULTS);
  const clearFilters = () => {
    clearSearchText();
    set.clear();
  };

  const columns: ColumnDef<Supplier, unknown>[] = [
    {
      accessorKey: 'name',
      header: 'Name',
      meta: { sortKey: 'name', alwaysVisible: true, className: 'font-medium', wrap: true },
    },
    {
      id: 'gstin',
      header: 'GSTIN',
      meta: { className: 'font-mono text-xs' },
      cell: ({ row }) => row.original.gstin ?? '—',
    },
    { id: 'phone', header: 'Phone', cell: ({ row }) => row.original.phone ?? '—' },
    { id: 'state', header: 'State', cell: ({ row }) => row.original.stateCode ?? '—' },
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
        <RowActions>
          <Button
            variant="ghost"
            size="sm"
            aria-label={`Ledger of ${row.original.name}`}
            onClick={() => setLedgerFor(row.original)}
          >
            Ledger
          </Button>
          {can('suppliers.manage') ? (
            <Button
              variant="ghost"
              size="sm"
              aria-label={`Edit ${row.original.name}`}
              onClick={() => setEditing(row.original)}
            >
              Edit
            </Button>
          ) : null}
        </RowActions>
      ),
    },
  ];

  return (
    <>
      <DataTableToolbar
        search={searchText}
        onSearchChange={setSearchText}
        searchPlaceholder="Supplier name or GSTIN"
        chips={
          status !== 'active'
            ? [
                {
                  label: `Show: ${STATUS_TEXT[status] ?? status}`,
                  onRemove: () => set.setFilter('status', 'active'),
                },
              ]
            : []
        }
        onClearFilters={clearFilters}
        onRefresh={query.refetch}
        refreshing={query.isFetching}
        actions={
          can('suppliers.manage') ? (
            <Button onClick={() => setEditing('new')}>New supplier</Button>
          ) : undefined
        }
      >
        <label className="space-y-1 text-sm font-medium">
          <span>Show</span>
          <Select
            className="w-full sm:w-48"
            value={status}
            onChange={(event) => set.setFilter('status', event.target.value)}
          >
            <option value="active">Active suppliers</option>
            <option value="inactive">Inactive suppliers</option>
            <option value="all">All suppliers</option>
          </Select>
        </label>
      </DataTableToolbar>
      <DataTable
        label="Suppliers"
        noun="suppliers"
        columns={columns}
        query={query}
        getRowId={(row) => row.id}
        filtered={filtered}
        emptyText="There are no suppliers yet."
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
      {editing ? (
        <SupplierFormDialog
          supplier={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(message) => {
            toast.success(message);
            setEditing(null);
          }}
        />
      ) : null}
      {ledgerFor ? (
        <SupplierLedgerDialog
          supplier={ledgerFor}
          onClose={() => setLedgerFor(null)}
          onPaid={(message) => {
            toast.success(message);
            setLedgerFor(null);
          }}
        />
      ) : null}
    </>
  );
}

interface SupplierFormProps {
  supplier: Supplier | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

function SupplierFormDialog({ supplier, onClose, onSaved }: SupplierFormProps) {
  const states = useStates();
  const { createSupplier, updateSupplier } = usePurchasingMutations();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      name: supplier?.name ?? '',
      gstin: supplier?.gstin ?? '',
      stateCode: supplier?.stateCode ?? '',
      phone: supplier?.phone ?? '',
      isActive: supplier?.isActive ?? true,
    },
  });

  const placeProblem = (problem: Problem) => {
    let placed = false;
    for (const [field, message] of Object.entries(problem.fields)) {
      if (isField(field)) {
        setError(field, { message });
        placed = true;
      }
    }
    if (!placed) setServerError(problem.message);
  };

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    const body = {
      name: values.name,
      gstin: values.gstin.trim() === '' ? null : values.gstin.trim().toUpperCase(),
      stateCode: values.stateCode === '' ? null : values.stateCode,
      phone: values.phone.trim() === '' ? null : values.phone.trim(),
    };
    const parsed = CreateSupplierRequestSchema.safeParse(body);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const name = String(issue.path[0]);
        if (isField(name)) setError(name, { message: issue.message });
      }
      return;
    }
    try {
      if (supplier) {
        await updateSupplier.mutateAsync({
          id: supplier.id,
          values: { ...parsed.data, isActive: values.isActive, rowVersion: supplier.rowVersion },
        });
        onSaved(`Supplier ${parsed.data.name} saved`);
      } else {
        await createSupplier.mutateAsync(parsed.data);
        onSaved(`Supplier ${parsed.data.name} created`);
      }
    } catch (error) {
      placeProblem(describeError(error));
    }
  });

  return (
    <FormDialog
      open
      title={supplier ? `Edit supplier ${supplier.name}` : 'New supplier'}
      description="The GSTIN must belong to the state you choose."
      onClose={onClose}
      onSubmit={(event) => onSubmit(event)}
      saving={isSubmitting}
      dirty={isDirty}
      submitLabel={supplier ? 'Save changes' : 'Create supplier'}
      error={serverError}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="sm:col-span-2">
          <FormField label="Name" error={errors.name?.message}>
            {(props) => <Input {...props} autoComplete="off" {...register('name')} />}
          </FormField>
        </div>
        <FormField label="GSTIN" error={errors.gstin?.message} hint="Optional">
          {(props) => <Input {...props} autoComplete="off" {...register('gstin')} />}
        </FormField>
        <FormField label="State" error={errors.stateCode?.message} hint="Optional">
          {(props) => (
            <Select {...props} {...register('stateCode')}>
              <option value="">No state</option>
              {states.data?.map((state) => (
                <option key={state.code} value={state.code}>
                  {state.code} · {state.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField label="Phone" error={errors.phone?.message} hint="Optional">
          {(props) => <Input {...props} autoComplete="off" {...register('phone')} />}
        </FormField>
        {supplier ? (
          <label className="flex min-h-control items-center gap-2 self-end text-sm font-medium">
            <input type="checkbox" className="size-4" {...register('isActive')} />
            Active
          </label>
        ) : null}
      </div>
    </FormDialog>
  );
}

const KIND_TEXT: Record<SupplierLedgerEntry['kind'], string> = {
  RECEIPT: 'Goods received',
  ACCEPTED_LATER: 'Accepted later',
  WRITTEN_OFF: 'Written off',
  RETURN: 'Returned',
  PAYMENT: 'Payment',
};

interface LedgerProps {
  supplier: Supplier;
  onClose: () => void;
  onPaid: (message: string) => void;
}

const LEDGER_COLUMNS: ColumnDef<SupplierLedgerEntry, unknown>[] = [
  { id: 'date', header: 'Date', cell: ({ row }) => row.original.at.slice(0, 10) },
  {
    id: 'document',
    header: 'Document',
    meta: { className: 'break-id' },
    cell: ({ row }) => (
      <>
        {row.original.documentNo} · {row.original.branchCode}
      </>
    ),
  },
  {
    id: 'what',
    header: 'What',
    meta: { wrap: true },
    cell: ({ row }) => (
      <>
        {KIND_TEXT[row.original.kind]}: {row.original.description}
      </>
    ),
  },
  { accessorKey: 'debit', header: 'Owed more', meta: { align: 'right' } },
  { accessorKey: 'credit', header: 'Owed less', meta: { align: 'right' } },
  { accessorKey: 'balance', header: 'Balance', meta: { align: 'right' } },
];

function SupplierLedgerDialog({ supplier, onClose, onPaid }: LedgerProps) {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [paying, setPaying] = useState(false);
  const detail = useSupplier(supplier.id);
  const ledger = useSupplierLedger(supplier.id, { page, pageSize: PAGE_SIZE });
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="lg">
        <DialogTitle>Ledger of {supplier.name}</DialogTitle>
        <DialogDescription>
          What the company owes this supplier, across the branches you can see.
        </DialogDescription>
        <div className="mt-4 space-y-4">
          {ledger.data ? (
            <p aria-label="Balance" className="tabular rounded-lg bg-muted px-3 py-2 text-sm">
              Charged {ledger.data.balance.charged} · Credited {ledger.data.balance.credited} · Paid{' '}
              {ledger.data.balance.paid} · <strong>Owed {ledger.data.balance.outstanding}</strong>
            </p>
          ) : null}
          <DataTable
            label="Supplier ledger"
            noun="ledger entries"
            columns={LEDGER_COLUMNS}
            query={ledger}
            filtered={false}
            emptyText="Nothing has been bought from this supplier yet."
            onPageChange={setPage}
          />
          {paying ? (
            <PaymentForm
              supplier={supplier}
              outstanding={detail.data?.balance.outstanding}
              onCancel={() => setPaying(false)}
              onPaid={onPaid}
            />
          ) : (
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={onClose}>
                Close
              </Button>
              {can('supplier_payments.create') ? (
                <Button onClick={() => setPaying(true)}>Record a payment</Button>
              ) : null}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}

interface PaymentFormProps {
  supplier: Supplier;
  outstanding: string | undefined;
  onCancel: () => void;
  onPaid: (message: string) => void;
}

function PaymentForm({ supplier, outstanding, onCancel, onPaid }: PaymentFormProps) {
  const modes = usePaymentModes();
  const { pay } = usePurchasingMutations();
  const branch = useBranchChoice();
  const [amount, setAmount] = useState('');
  const [paidOn, setPaidOn] = useState('');
  const [mode, setMode] = useState('');
  const [reference, setReference] = useState('');
  const [problem, setProblem] = useState<Problem | null>(null);

  const submit = async () => {
    setProblem(null);
    if (branch.mustChoose && branch.branchId === '') {
      setProblem({
        message: 'Choose a branch',
        reasons: [],
        fields: { branchId: 'Choose a branch' },
      });
      return;
    }
    try {
      const payment = await pay.mutateAsync({
        id: supplier.id,
        values: {
          amount: amount.trim(),
          mode,
          ...(branch.branchId ? { branchId: branch.branchId } : {}),
          ...(paidOn ? { paidOn } : {}),
          ...(reference.trim() ? { reference: reference.trim() } : {}),
        },
      });
      onPaid(
        `Payment of ${payment.amount} to ${supplier.name} recorded. Still owed: ${payment.outstanding}`,
      );
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  return (
    <form
      aria-label="Record a payment"
      onSubmit={(event) => {
        event.preventDefault();
        void submit();
      }}
      noValidate
      className="space-y-4 border-t pt-4"
    >
      {problem ? <Alert tone="error">{problem.message}</Alert> : null}
      <BranchField choice={branch} error={problem?.fields.branchId} />
      <FormField
        label="Amount"
        error={problem?.fields.amount}
        hint={outstanding ? `Owed now: ${outstanding}` : undefined}
      >
        {(props) => (
          <Input
            {...props}
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
          />
        )}
      </FormField>
      <FormField label="Paid on" hint="Leave empty for today" error={problem?.fields.paidOn}>
        {(props) => (
          <Input
            {...props}
            type="date"
            value={paidOn}
            onChange={(event) => setPaidOn(event.target.value)}
          />
        )}
      </FormField>
      <FormField label="Paid by" error={problem?.fields.mode}>
        {(props) => (
          <Select {...props} value={mode} onChange={(event) => setMode(event.target.value)}>
            <option value="">Choose how it was paid</option>
            {modes.data?.map((item) => (
              <option key={item.code} value={item.code}>
                {item.name}
              </option>
            ))}
          </Select>
        )}
      </FormField>
      <FormField
        label="Reference"
        hint="Optional, such as a cheque or UTR number"
        error={problem?.fields.reference}
      >
        {(props) => (
          <Input
            {...props}
            autoComplete="off"
            value={reference}
            onChange={(event) => setReference(event.target.value)}
          />
        )}
      </FormField>
      <FormActions
        onCancel={onCancel}
        saving={pay.isPending}
        submitLabel="Record payment"
        savingLabel="Recording…"
      />
    </form>
  );
}
