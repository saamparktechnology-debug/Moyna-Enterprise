//apps/web/src/features/assembly/assembly-dialog.tsx
import { useState } from 'react';
import { CreateAssemblyRequestSchema } from '@erp/contracts';
import type { CreateAssemblyRequest, Item } from '@erp/contracts';
import { FormDialog } from '@/components/form-dialog';
import { FormField, Input } from '@/components/form-field';
import { Select } from '@/components/select-field';
import { Button } from '@/components/ui/button';
import { categoryLabel } from '../items/item-form-dialog';
import { useCategories, useGstRates, useUnits } from '../items/use-items';
import { useBalances } from '../inventory/use-inventory';
import { useSellableUnits } from '../billing/use-billing';
import { ProblemAlert } from '../payments/payments-shared';
import {
  BranchField,
  ItemPicker,
  describeError,
  useBranchChoice,
} from '../purchasing/purchasing-shared';
import type { Problem } from '../purchasing/purchasing-shared';
import { useAssemblyMutations } from './use-assembly';

interface PartState {
  key: number;
  item: Item | null;
  qty: string;
  units: string[];
}

let nextKey = 1;
const blankPart = (): PartState => ({ key: nextKey++, item: null, qty: '1', units: [] });

/** One part: the item, then either the units being used (a numbered part) or how many. */
function PartRow({
  part,
  index,
  branchId,
  taken,
  errors,
  canRemove,
  onChange,
  onRemove,
}: {
  part: PartState;
  index: number;
  branchId: string;
  /** Serial units already chosen in other rows of this assembly. */
  taken: string[];
  errors: Record<string, string>;
  canRemove: boolean;
  onChange: (patch: Partial<PartState>) => void;
  onRemove: () => void;
}) {
  const at = (field: string) => errors[`parts.${index}.${field}`];
  const serialized = part.item?.isSerialized ?? false;
  const units = useSellableUnits(serialized && part.item ? part.item.id : '', branchId);
  const balance = useBalances({
    page: 1,
    pageSize: 20,
    search: part.item?.itemCode ?? '',
    lowOnly: false,
  });
  const here = (balance.data?.items ?? []).find(
    (row) => row.itemId === part.item?.id && (branchId === '' || row.branchId === branchId),
  );
  return (
    <fieldset
      aria-label={`Part ${index + 1}`}
      className="grid gap-3 rounded-lg border bg-muted/30 p-3 sm:grid-cols-6"
    >
      <div className="sm:col-span-3">
        <ItemPicker
          label="Part"
          value={part.item}
          error={at('itemId')}
          onChange={(item) => onChange({ item, qty: '1', units: [] })}
        />
      </div>
      {serialized ? (
        <div className="sm:col-span-3">
          <FormField
            label="Serial numbers used"
            error={at('serialUnitIds')}
            hint={`${part.units.length} chosen`}
          >
            {() => (
              <div className="max-h-40 space-y-1 overflow-y-auto rounded-md border bg-card p-2">
                {(units.data?.items ?? []).length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    No unit of this part is in stock here.
                  </p>
                ) : null}
                {(units.data?.items ?? [])
                  .filter((unit) => part.units.includes(unit.id) || !taken.includes(unit.id))
                  .map((unit) => (
                    <label key={unit.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={part.units.includes(unit.id)}
                        onChange={(event) =>
                          onChange({
                            units: event.target.checked
                              ? [...part.units, unit.id]
                              : part.units.filter((id) => id !== unit.id),
                          })
                        }
                      />
                      {unit.serialNo}
                    </label>
                  ))}
              </div>
            )}
          </FormField>
        </div>
      ) : (
        <div className="sm:col-span-2">
          <FormField
            label="Quantity"
            error={at('qty')}
            hint={part.item ? `In stock here: ${here?.available ?? 0}` : undefined}
          >
            {(props) => (
              <Input
                {...props}
                inputMode="numeric"
                value={part.qty}
                onChange={(event) => onChange({ qty: event.target.value })}
              />
            )}
          </FormField>
        </div>
      )}
      {canRemove ? (
        <div className="flex items-end">
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Remove part ${index + 1}`}
            onClick={onRemove}
          >
            Remove
          </Button>
        </div>
      ) : null}
    </fieldset>
  );
}

/** Assembles a product from parts in stock. Nothing is costed: choose the parts, say what is made, and set its selling price. */
export function AssemblyDialog({
  onClose,
  onDone,
}: {
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { create } = useAssemblyMutations();
  const choice = useBranchChoice();
  const [finished, setFinished] = useState<Item | null>(null);
  // The product is an item that already exists, or one made on the spot.
  const [mode, setMode] = useState<'existing' | 'new'>('existing');
  const [itemCode, setItemCode] = useState('');
  const [itemName, setItemName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [unitCode, setUnitCode] = useState('');
  const [isSerialized, setIsSerialized] = useState(false);
  const [hsnCode, setHsnCode] = useState('');
  const [taxRate, setTaxRate] = useState('');
  const categories = useCategories().data ?? [];
  const units = useUnits().data ?? [];
  const rates = useGstRates().data ?? [];
  const [qty, setQty] = useState('1');
  const [price, setPrice] = useState('');
  const [serialNo, setSerialNo] = useState('');
  const [chassisNo, setChassisNo] = useState('');
  const [motorNo, setMotorNo] = useState('');
  const [note, setNote] = useState('');
  const [parts, setParts] = useState<PartState[]>([blankPart()]);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<Problem | null>(null);
  const numbered = mode === 'new' ? isSerialized : (finished?.isSerialized ?? false);

  const change = (key: number, patch: Partial<PartState>) =>
    setParts((previous) =>
      previous.map((part) => (part.key === key ? { ...part, ...patch } : part)),
    );
  const taken = parts.flatMap((part) => part.units);

  const submit = async () => {
    setProblem(null);
    const request: CreateAssemblyRequest = {
      ...(choice.mustChoose && choice.branchId ? { branchId: choice.branchId } : {}),
      ...(mode === 'new'
        ? {
            newItem: {
              itemCode: itemCode.trim(),
              name: itemName.trim(),
              categoryId,
              unitCode,
              isSerialized,
              hsnCode: hsnCode.trim() === '' ? null : hsnCode.trim(),
              taxRate: taxRate === '' ? null : taxRate,
            },
          }
        : { finishedItemId: finished?.id ?? '' }),
      qty: numbered ? 1 : Number(qty),
      sellingPrice: price.trim(),
      ...(numbered
        ? {
            units: [
              {
                serialNo: serialNo.trim(),
                ...(chassisNo.trim() ? { chassisNo: chassisNo.trim() } : {}),
                ...(motorNo.trim() ? { motorNo: motorNo.trim() } : {}),
              },
            ],
          }
        : {}),
      parts: parts.map((part) => ({
        itemId: part.item?.id ?? '',
        qty: part.item?.isSerialized ? part.units.length : Number(part.qty),
        ...(part.item?.isSerialized ? { serialUnitIds: part.units } : {}),
      })),
      ...(note.trim() ? { note: note.trim() } : {}),
    };
    const checked = CreateAssemblyRequestSchema.safeParse(request);
    if (!checked.success) {
      const found: Record<string, string> = {};
      for (const issue of checked.error.issues) {
        const key = issue.path.join('.');
        if (!found[key]) found[key] = issue.message;
      }
      setErrors(found);
      return;
    }
    setErrors({});
    try {
      const made = await create.mutateAsync(request);
      onDone(`${made.assemblyNo} made: ${made.finishedItemName}`);
    } catch (error) {
      const described = describeError(error);
      setProblem(described);
      setErrors(described.fields);
    }
  };

  return (
    <FormDialog
      open
      size="xl"
      title="Assemble a product"
      description="Choose the parts from your stock and say what is made. The parts leave stock, the product comes in, and the selling price is set. Nothing is costed."
      onClose={onClose}
      onSubmit={submit}
      saving={create.isPending}
      dirty={
        finished !== null ||
        itemCode !== '' ||
        price !== '' ||
        parts.some((part) => part.item !== null)
      }
      submitLabel="Assemble"
      error={problem ? <ProblemAlert problem={problem} /> : undefined}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <BranchField choice={choice} error={errors['branchId']} />
        <fieldset className="flex flex-wrap gap-4 sm:col-span-2">
          <legend className="mb-1 text-sm font-medium">The product being made is</legend>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="assembly-product"
              checked={mode === 'existing'}
              onChange={() => setMode('existing')}
            />
            An item that already exists
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="radio"
              name="assembly-product"
              checked={mode === 'new'}
              onChange={() => {
                setMode('new');
                setQty('1');
              }}
            />
            A new item
          </label>
        </fieldset>
        {mode === 'existing' ? (
          <div className="sm:col-span-2">
            <ItemPicker
              label="Product being made"
              value={finished}
              error={errors['finishedItemId']}
              onChange={(item) => {
                setFinished(item);
                setQty('1');
              }}
            />
          </div>
        ) : (
          <>
            <FormField
              label="Item code"
              error={errors['newItem.itemCode']}
              hint="Capital letters and digits"
            >
              {(props) => (
                <Input
                  {...props}
                  autoComplete="off"
                  value={itemCode}
                  onChange={(event) => setItemCode(event.target.value)}
                />
              )}
            </FormField>
            <FormField label="Name of the new item" error={errors['newItem.name']}>
              {(props) => (
                <Input
                  {...props}
                  value={itemName}
                  onChange={(event) => setItemName(event.target.value)}
                />
              )}
            </FormField>
            <FormField label="Category" error={errors['newItem.categoryId']}>
              {(props) => (
                <Select
                  {...props}
                  value={categoryId}
                  onChange={(event) => setCategoryId(event.target.value)}
                >
                  <option value="">Choose a category</option>
                  {categories
                    .filter((category) => category.isActive)
                    .map((category) => ({
                      id: category.id,
                      label: categoryLabel(category, categories),
                    }))
                    .sort((a, b) => a.label.localeCompare(b.label))
                    .map((choice) => (
                      <option key={choice.id} value={choice.id}>
                        {choice.label}
                      </option>
                    ))}
                </Select>
              )}
            </FormField>
            <FormField label="Unit" error={errors['newItem.unitCode']}>
              {(props) => (
                <Select
                  {...props}
                  value={unitCode}
                  onChange={(event) => setUnitCode(event.target.value)}
                >
                  <option value="">Choose a unit</option>
                  {units.map((unit) => (
                    <option key={unit.code} value={unit.code}>
                      {unit.name} ({unit.code})
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField label="HSN code" error={errors['newItem.hsnCode']} hint="Optional">
              {(props) => (
                <Input
                  {...props}
                  inputMode="numeric"
                  value={hsnCode}
                  onChange={(event) => setHsnCode(event.target.value)}
                />
              )}
            </FormField>
            <FormField label="GST rate" error={errors['newItem.taxRate']} hint="Optional">
              {(props) => (
                <Select
                  {...props}
                  value={taxRate}
                  onChange={(event) => setTaxRate(event.target.value)}
                >
                  <option value="">None</option>
                  {rates.map((rate) => (
                    <option key={rate.rate} value={rate.rate}>
                      {rate.label}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <label className="flex items-center gap-2 text-sm sm:col-span-2">
              <input
                type="checkbox"
                checked={isSerialized}
                onChange={(event) => setIsSerialized(event.target.checked)}
              />
              It has a serial number of its own, like a vehicle (made one at a time)
            </label>
          </>
        )}
        <FormField
          label="Selling price"
          error={errors['sellingPrice']}
          hint="Billing starts from this price"
        >
          {(props) => (
            <Input
              {...props}
              inputMode="decimal"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
            />
          )}
        </FormField>
        {!numbered ? (
          <FormField label="How many are made" error={errors['qty']}>
            {(props) => (
              <Input
                {...props}
                inputMode="numeric"
                value={qty}
                onChange={(event) => setQty(event.target.value)}
              />
            )}
          </FormField>
        ) : null}
        {numbered ? (
          <>
            <FormField label="Serial number" error={errors['units.0.serialNo'] ?? errors['units']}>
              {(props) => (
                <Input
                  {...props}
                  value={serialNo}
                  onChange={(event) => setSerialNo(event.target.value)}
                />
              )}
            </FormField>
            <FormField label="Chassis number" error={errors['units.0.chassisNo']} hint="Optional">
              {(props) => (
                <Input
                  {...props}
                  value={chassisNo}
                  onChange={(event) => setChassisNo(event.target.value)}
                />
              )}
            </FormField>
            <FormField label="Motor number" error={errors['units.0.motorNo']} hint="Optional">
              {(props) => (
                <Input
                  {...props}
                  value={motorNo}
                  onChange={(event) => setMotorNo(event.target.value)}
                />
              )}
            </FormField>
          </>
        ) : null}
      </div>

      <h3 className="mt-6 text-sm font-semibold">Parts from stock</h3>
      {errors['parts'] ? (
        <p role="alert" className="text-sm text-destructive">
          {errors['parts']}
        </p>
      ) : null}
      <div className="mt-2 space-y-3">
        {parts.map((part, index) => (
          <PartRow
            key={part.key}
            part={part}
            index={index}
            branchId={choice.branchId}
            taken={taken}
            errors={errors}
            canRemove={parts.length > 1}
            onChange={(patch) => change(part.key, patch)}
            onRemove={() => setParts((previous) => previous.filter((p) => p.key !== part.key))}
          />
        ))}
      </div>
      <Button
        type="button"
        variant="secondary"
        size="sm"
        className="mt-3"
        onClick={() => setParts((previous) => [...previous, blankPart()])}
      >
        Add another part
      </Button>

      <div className="mt-4">
        <FormField label="Note" error={errors['note']} hint="Optional">
          {(props) => (
            <Input {...props} value={note} onChange={(event) => setNote(event.target.value)} />
          )}
        </FormField>
      </div>
    </FormDialog>
  );
}
