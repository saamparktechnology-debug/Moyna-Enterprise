import { useState } from 'react';
import type { ColumnDef } from '@tanstack/react-table';
import { CreatePurchaseReturnRequestSchema } from '@erp/contracts';
import type { PurchaseOrder, PurchaseReturnListResponse } from '@erp/contracts';
import { DataTable } from '@/components/data-table/data-table';
import { DataTableToolbar } from '@/components/data-table/data-table-toolbar';
import { FormDialog } from '@/components/form-dialog';
import { FormField, Input } from '@/components/form-field';
import { Select } from '@/components/select-field';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/features/auth/auth-provider';
import { useSerialUnits } from '@/features/inventory/use-inventory';
import { useListParams } from '@/lib/use-list-params';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { describeError } from './purchasing-shared';
import type { Problem } from './purchasing-shared';
import { useOrder, useOrders, usePurchasingMutations, useReturns } from './use-purchasing';

type PurchaseReturnRow = PurchaseReturnListResponse['items'][number];

const DEFAULTS = { pageSize: 10 };
const SEARCH_DELAY_MS = 250;

export function ReturnsTab() {
  const { can, user } = useAuth();
  const [params, set] = useListParams(DEFAULTS, 'returns');
  const [creating, setCreating] = useState(false);
  const query = useReturns({
    page: params.page,
    pageSize: params.pageSize,
    sortBy: params.sortBy,
    sortOrder: params.sortOrder,
  });
  const showBranch = (user?.branches.length ?? 0) > 1 || (user?.isSuperAdmin ?? false);

  const columns: ColumnDef<PurchaseReturnRow, unknown>[] = [
    {
      accessorKey: 'returnNo',
      header: 'Return',
      meta: { sortKey: 'returnNo', alwaysVisible: true, className: 'font-medium break-id' },
    },
    { accessorKey: 'supplierName', header: 'Supplier', meta: { wrap: true } },
    { id: 'order', header: 'Order', cell: ({ row }) => row.original.poNo ?? '—' },
    ...(showBranch ? [{ accessorKey: 'branchCode', header: 'Branch' } as const] : []),
    { accessorKey: 'returnedOn', header: 'Date' },
    {
      id: 'items',
      header: 'Items',
      meta: { wrap: true },
      cell: ({ row }) =>
        row.original.lines
          .map(
            (line) => `${line.qty} × ${line.itemCode}${line.serialNo ? ` (${line.serialNo})` : ''}`,
          )
          .join(', '),
    },
    { accessorKey: 'reason', header: 'Reason', meta: { wrap: true } },
    { accessorKey: 'credit', header: 'Credit', meta: { align: 'right' } },
  ];

  return (
    <>
      <DataTableToolbar
        onRefresh={query.refetch}
        refreshing={query.isFetching}
        actions={
          can('purchases.return') ? (
            <Button onClick={() => setCreating(true)}>Return goods to a supplier</Button>
          ) : undefined
        }
      />
      <DataTable
        label="Purchase returns"
        noun="purchase returns"
        columns={columns}
        query={query}
        getRowId={(row) => row.id}
        filtered={false}
        emptyText="No goods have been returned to a supplier."
        onPageChange={set.setPage}
        onPageSizeChange={set.setPageSize}
        sort={{ sortBy: params.sortBy, sortOrder: params.sortOrder }}
        onSortChange={set.setSort}
        columnVisibility
      />
      {creating ? (
        <ReturnFormDialog
          onClose={() => setCreating(false)}
          onDone={(message) => {
            toast.success(message);
            setCreating(false);
          }}
        />
      ) : null}
    </>
  );
}

interface ReturnFormProps {
  onClose: () => void;
  onDone: (message: string) => void;
}

function ReturnFormDialog({ onClose, onDone }: ReturnFormProps) {
  const { createReturn } = usePurchasingMutations();
  const [search, setSearch] = useState('');
  const [orderId, setOrderId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  const [qty, setQty] = useState<Record<string, string>>({});
  const [serials, setSerials] = useState<Record<string, string[]>>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<Problem | null>(null);
  const typed = useDebouncedValue(search.trim(), SEARCH_DELAY_MS);
  const found = useOrders({ page: 1, pageSize: 10, search: typed, status: 'all' });
  const order = useOrder(orderId);
  const choices = (found.data?.items ?? []).filter(
    (candidate) => candidate.status === 'PARTIALLY_RECEIVED' || candidate.status === 'RECEIVED',
  );

  const submit = async () => {
    setProblem(null);
    const data = order.data;
    type ReturnLine =
      { poLineId: string; serialUnitIds: string[] } | { poLineId: string; qty: number };
    const lines = (data?.lines ?? []).flatMap((line): ReturnLine[] => {
      if (line.isSerialized) {
        const ids = serials[line.id] ?? [];
        return ids.length > 0 ? [{ poLineId: line.id, serialUnitIds: ids }] : [];
      }
      const value = (qty[line.id] ?? '').trim();
      return value === '' ? [] : [{ poLineId: line.id, qty: Number(value) }];
    });
    const parsed = CreatePurchaseReturnRequestSchema.safeParse({
      poId: orderId ?? '',
      reason,
      lines,
    });
    const found: Record<string, string> = {};
    if (!parsed.success)
      for (const issue of parsed.error.issues) {
        const key = String(issue.path[0]);
        found[key] ??= issue.message;
      }
    setErrors(found);
    if (!parsed.success) return;
    try {
      const made = await createReturn.mutateAsync(parsed.data);
      onDone(`Return ${made.returnNo} recorded. Credit from ${made.supplierName}: ${made.credit}`);
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  const dirty =
    search !== '' ||
    orderId !== null ||
    reason !== '' ||
    Object.values(qty).some((value) => value !== '') ||
    Object.values(serials).some((ids) => ids.length > 0);

  return (
    <FormDialog
      open
      size="md"
      title="Return goods to a supplier"
      description="Only goods that were accepted into stock on an order can be returned. The supplier credits the cost."
      onClose={onClose}
      onSubmit={submit}
      saving={createReturn.isPending}
      savingLabel="Recording…"
      dirty={dirty}
      submitLabel="Record return"
      error={
        problem ? (
          <>
            <p>{problem.message}</p>
            {problem.reasons.length > 0 ? (
              <ul className="mt-1 list-disc pl-5">
                {problem.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}
          </>
        ) : undefined
      }
    >
      <FormField
        label="Find the purchase order"
        error={errors.poId}
        hint="Order number or supplier name"
      >
        {(props) => (
          <div className="space-y-2">
            <Input
              {...props}
              autoComplete="off"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
            />
            {choices.length > 0 ? (
              <Select
                aria-label="Matching orders"
                value={orderId ?? ''}
                onChange={(event) => {
                  setOrderId(event.target.value === '' ? null : event.target.value);
                  setQty({});
                  setSerials({});
                }}
              >
                <option value="">Choose an order</option>
                {choices.map((candidate) => (
                  <option key={candidate.id} value={candidate.id}>
                    {candidate.poNo} · {candidate.supplierName}
                  </option>
                ))}
              </Select>
            ) : null}
            {found.data && choices.length === 0 ? (
              <p className="text-sm text-muted-foreground">No order with received goods matches.</p>
            ) : null}
          </div>
        )}
      </FormField>
      {errors.lines ? (
        <p role="alert" className="text-sm text-destructive">
          {errors.lines}
        </p>
      ) : null}
      {order.data
        ? order.data.lines
            .filter((line) => line.accepted > 0)
            .map((line) =>
              line.isSerialized ? (
                <SerialChoice
                  key={line.id}
                  order={order.data}
                  lineId={line.id}
                  itemId={line.itemId}
                  itemCode={line.itemCode}
                  selected={serials[line.id] ?? []}
                  onChange={(ids) => setSerials((previous) => ({ ...previous, [line.id]: ids }))}
                />
              ) : (
                <FormField
                  key={line.id}
                  label={`Quantity to return for ${line.itemCode}`}
                  hint={`${line.accepted} accepted so far`}
                >
                  {(props) => (
                    <Input
                      {...props}
                      type="number"
                      min={1}
                      value={qty[line.id] ?? ''}
                      onChange={(event) =>
                        setQty((previous) => ({ ...previous, [line.id]: event.target.value }))
                      }
                    />
                  )}
                </FormField>
              ),
            )
        : null}
      <FormField label="Reason" error={errors.reason}>
        {(props) => (
          <Input
            {...props}
            autoComplete="off"
            value={reason}
            onChange={(event) => setReason(event.target.value)}
          />
        )}
      </FormField>
    </FormDialog>
  );
}

interface SerialChoiceProps {
  order: PurchaseOrder;
  lineId: string;
  itemId: string;
  itemCode: string;
  selected: string[];
  onChange: (ids: string[]) => void;
}

function SerialChoice({ order, itemId, itemCode, selected, onChange }: SerialChoiceProps) {
  const units = useSerialUnits({
    page: 1,
    pageSize: 50,
    search: '',
    state: 'AVAILABLE',
    itemId,
    branchId: order.branchId,
  });
  return (
    <fieldset
      aria-label={`Serial numbers to return for ${itemCode}`}
      className="space-y-1 rounded-lg border p-3"
    >
      <legend className="px-1 text-sm font-medium">Serial numbers to return for {itemCode}</legend>
      {units.isPending ? (
        <p role="status" className="text-sm text-muted-foreground">
          Loading serial numbers…
        </p>
      ) : null}
      {units.data && units.data.items.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No unit of {itemCode} is available to return.
        </p>
      ) : null}
      {units.data?.items.map((unit) => (
        <label key={unit.id} className="flex min-h-control items-center gap-2 text-sm">
          <input
            type="checkbox"
            className="size-4"
            checked={selected.includes(unit.id)}
            onChange={() =>
              onChange(
                selected.includes(unit.id)
                  ? selected.filter((id) => id !== unit.id)
                  : [...selected, unit.id],
              )
            }
          />
          Return {unit.serialNo}
        </label>
      ))}
    </fieldset>
  );
}
