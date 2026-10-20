import { useState } from 'react';
import { CreatePurchaseOrderRequestSchema } from '@erp/contracts';
import type { PurchaseOrder } from '@erp/contracts';
import { FormDialog } from '@/components/form-dialog';
import { FormField, Input } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import {
  BranchField,
  ItemPicker,
  SupplierPicker,
  describeError,
  useBranchChoice,
} from './purchasing-shared';
import type { Problem } from './purchasing-shared';
import { usePurchasingMutations } from './use-purchasing';

interface LineDraft {
  key: number;
  item: { id: string; itemCode: string; name: string; isSerialized: boolean } | null;
  qty: string;
  cost: string;
}

const cents = (value: string): number => Math.round(Number(value) * 100);
const money = (total: number): string => (total / 100).toFixed(2);

interface OrderFormDialogProps {
  order: PurchaseOrder | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

export function OrderFormDialog({ order, onClose, onSaved }: OrderFormDialogProps) {
  const { createOrder, updateOrder } = usePurchasingMutations();
  const branch = useBranchChoice();
  const [supplier, setSupplier] = useState<{ id: string; name: string } | null>(
    order ? { id: order.supplierId, name: order.supplierName } : null,
  );
  const [orderDate, setOrderDate] = useState(order?.orderDate ?? '');
  const [nextKey, setNextKey] = useState(order ? order.lines.length : 1);
  const [lines, setLines] = useState<LineDraft[]>(
    order
      ? order.lines.map((line, index) => ({
          key: index,
          item: {
            id: line.itemId,
            itemCode: line.itemCode,
            name: line.itemName,
            isSerialized: line.isSerialized,
          },
          qty: String(line.qtyOrdered),
          cost: line.unitCost,
        }))
      : [{ key: 0, item: null, qty: '', cost: '' }],
  );
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [serverProblem, setServerProblem] = useState<Problem | null>(null);
  const saving = createOrder.isPending || updateOrder.isPending;

  const change = (key: number, patch: Partial<LineDraft>) =>
    setLines((previous) =>
      previous.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );
  const total = lines.reduce(
    (sum, line) =>
      sum +
      (Number.isFinite(Number(line.qty)) && line.cost !== ''
        ? Number(line.qty) * cents(line.cost)
        : 0),
    0,
  );

  const submit = async () => {
    setServerProblem(null);
    const request = {
      supplierId: supplier?.id ?? '',
      ...(order === null && branch.branchId ? { branchId: branch.branchId } : {}),
      ...(orderDate ? { orderDate } : {}),
      lines: lines.map((line) => ({
        itemId: line.item?.id ?? '',
        qtyOrdered: line.qty.trim() === '' ? Number.NaN : Number(line.qty),
        unitCost: line.cost.trim(),
      })),
    };
    const problems: Record<string, string> = {};
    if (order === null && branch.mustChoose && branch.branchId === '')
      problems.branchId = 'Choose a branch';
    const parsed = CreatePurchaseOrderRequestSchema.safeParse(request);
    if (!parsed.success)
      for (const issue of parsed.error.issues) {
        const key =
          issue.path[0] === 'lines' && typeof issue.path[1] === 'number'
            ? `line${issue.path[1]}.${String(issue.path[2])}`
            : String(issue.path[0]);
        problems[key] ??= issue.message;
      }
    setErrors(problems);
    if (!parsed.success || Object.keys(problems).length > 0) return;
    try {
      if (order) {
        const saved = await updateOrder.mutateAsync({
          id: order.id,
          values: {
            supplierId: parsed.data.supplierId,
            ...(orderDate ? { orderDate } : {}),
            lines: parsed.data.lines,
            rowVersion: order.rowVersion,
          },
        });
        onSaved(`Purchase order ${saved.poNo} saved`);
      } else {
        const saved = await createOrder.mutateAsync(parsed.data);
        onSaved(`Purchase order ${saved.poNo} created as a draft`);
      }
    } catch (error) {
      setServerProblem(describeError(error));
    }
  };

  const snapshot = (value: typeof lines, name: string, date: string) =>
    JSON.stringify([name, date, value.map((line) => [line.item?.id ?? '', line.qty, line.cost])]);
  const [initial] = useState(() => snapshot(lines, supplier?.id ?? '', orderDate));
  const dirty = snapshot(lines, supplier?.id ?? '', orderDate) !== initial;

  return (
    <FormDialog
      open
      size="lg"
      title={order ? `Edit ${order.poNo}` : 'New purchase order'}
      description="The order is saved as a draft. A manager approves it before goods can be received."
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      dirty={dirty}
      submitLabel={order ? 'Save changes' : 'Create order'}
      error={
        serverProblem ? (
          <>
            <p>{serverProblem.message}</p>
            {serverProblem.reasons.length > 0 ? (
              <ul className="mt-1 list-disc pl-5">
                {serverProblem.reasons.map((reason) => (
                  <li key={reason}>{reason}</li>
                ))}
              </ul>
            ) : null}
          </>
        ) : undefined
      }
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {order === null ? <BranchField choice={branch} error={errors.branchId} /> : null}
        <SupplierPicker value={supplier} onChange={setSupplier} error={errors.supplierId} />
        <FormField label="Order date" hint="Leave empty for today" error={errors.orderDate}>
          {(props) => (
            <Input
              {...props}
              type="date"
              value={orderDate}
              onChange={(event) => setOrderDate(event.target.value)}
            />
          )}
        </FormField>
      </div>
      {errors.lines ? (
        <p role="alert" className="text-sm text-destructive">
          {errors.lines}
        </p>
      ) : null}
      {lines.map((line, index) => (
        <fieldset
          key={line.key}
          aria-label={`Line ${index + 1}`}
          className="space-y-3 rounded-lg border bg-muted/30 p-3"
        >
          <legend className="px-1 text-sm font-medium">Line {index + 1}</legend>
          <ItemPicker
            label={`Item`}
            value={line.item}
            onChange={(item) => change(line.key, { item })}
            error={errors[`line${index}.itemId`]}
          />
          <div className="grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
            <FormField label={`Quantity`} error={errors[`line${index}.qtyOrdered`]}>
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  min={1}
                  value={line.qty}
                  onChange={(event) => change(line.key, { qty: event.target.value })}
                />
              )}
            </FormField>
            <FormField label={`Unit cost`} error={errors[`line${index}.unitCost`]}>
              {(props) => (
                <Input
                  {...props}
                  inputMode="decimal"
                  value={line.cost}
                  onChange={(event) => change(line.key, { cost: event.target.value })}
                />
              )}
            </FormField>
            {lines.length > 1 ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                aria-label={`Remove line ${index + 1}`}
                onClick={() =>
                  setLines((previous) => previous.filter((entry) => entry.key !== line.key))
                }
              >
                Remove line
              </Button>
            ) : null}
          </div>
        </fieldset>
      ))}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setLines((previous) => [...previous, { key: nextKey, item: null, qty: '', cost: '' }]);
            setNextKey(nextKey + 1);
          }}
        >
          Add a line
        </Button>
        <p aria-label="Order total" className="tabular text-base font-semibold">
          Total: {money(total)}
        </p>
      </div>
    </FormDialog>
  );
}
