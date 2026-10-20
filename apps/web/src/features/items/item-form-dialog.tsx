import { zodResolver } from '@hookform/resolvers/zod';
import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { z } from 'zod';
import {
  BarcodeSchema,
  HsnCodeValueSchema,
  ItemCodeSchema,
  ItemNameSchema,
  ReorderLevelSchema,
} from '@erp/contracts';
import type { Item, ItemCategory } from '@erp/contracts';
import { Alert } from '@/components/alert';
import { FormField, Input } from '@/components/form-field';
import { Select } from '@/components/select-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ApiError } from '@/lib/api-client';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import {
  useCategories,
  useGstRates,
  useHsnSuggestions,
  useItemMutations,
  useUnits,
} from './use-items';

const HSN_SEARCH_DELAY_MS = 250;

const FormSchema = z
  .object({
    itemCode: ItemCodeSchema,
    name: ItemNameSchema,
    categoryId: z.string().min(1, 'Choose a category'),
    unitCode: z.string().min(1, 'Choose a unit'),
    hsnCode: z.string().trim(),
    taxRate: z.string(),
    reorderLevel: ReorderLevelSchema,
    isSerialized: z.boolean(),
    barcode: z.string().trim(),
    generateBarcode: z.boolean(),
  })
  .superRefine((values, context) => {
    if (values.hsnCode !== '' && !HsnCodeValueSchema.safeParse(values.hsnCode).success)
      context.addIssue({
        code: 'custom',
        path: ['hsnCode'],
        message: 'An HSN code has 4 to 8 digits',
      });
    if (values.barcode !== '') {
      const parsed = BarcodeSchema.safeParse(values.barcode);
      if (!parsed.success)
        context.addIssue({
          code: 'custom',
          path: ['barcode'],
          message: parsed.error.issues[0]?.message ?? 'Enter a valid barcode',
        });
      else if (values.generateBarcode)
        context.addIssue({
          code: 'custom',
          path: ['barcode'],
          message: 'Enter a barcode or ask for one to be generated, not both',
        });
    }
  });
type FormValues = z.input<typeof FormSchema>;

const FIELDS = [
  'itemCode',
  'name',
  'categoryId',
  'unitCode',
  'hsnCode',
  'taxRate',
  'reorderLevel',
  'isSerialized',
  'barcode',
] as const;
type FieldName = (typeof FIELDS)[number];
const isField = (name: string): name is FieldName => (FIELDS as readonly string[]).includes(name);

export function categoryLabel(category: ItemCategory, all: ItemCategory[]): string {
  const parent = all.find((candidate) => candidate.id === category.parentId);
  return parent ? `${categoryLabel(parent, all)} › ${category.name}` : category.name;
}

interface ItemFormDialogProps {
  item: Item | null;
  open: boolean;
  canManage: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}

export function ItemFormDialog({ item, open, canManage, onClose, onSaved }: ItemFormDialogProps) {
  const categories = useCategories();
  const units = useUnits();
  const rates = useGstRates();
  const loading = categories.isPending || units.isPending || rates.isPending;
  const failed = categories.isError || units.isError || rates.isError;
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="md" className="overflow-hidden">
        <DialogTitle>{item ? `Edit item ${item.itemCode}` : 'New item'}</DialogTitle>
        <DialogDescription>
          {item
            ? 'The item code cannot be changed because other records refer to it.'
            : 'Items are shared by every branch. Stock is counted per branch.'}
        </DialogDescription>
        {loading ? (
          <p role="status" className="mt-4 text-sm text-muted-foreground">
            Loading choices…
          </p>
        ) : failed || !categories.data || !units.data || !rates.data ? (
          <div className="mt-4 space-y-3">
            <Alert tone="error">Could not load the categories, units and GST rates.</Alert>
            <Button
              variant="secondary"
              onClick={() => {
                void categories.refetch();
                void units.refetch();
                void rates.refetch();
              }}
            >
              Retry
            </Button>
          </div>
        ) : (
          <ItemForm
            item={item}
            categories={categories.data}
            units={units.data}
            rates={rates.data}
            canManage={canManage}
            onClose={onClose}
            onSaved={onSaved}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}

interface ItemFormProps {
  item: Item | null;
  categories: ItemCategory[];
  units: { code: string; name: string }[];
  rates: { rate: string; label: string }[];
  canManage: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}

function ItemForm({ item, categories, units, rates, canManage, onClose, onSaved }: ItemFormProps) {
  const { create, update, addBarcode, removeBarcode } = useItemMutations();
  const [current, setCurrent] = useState<Item | null>(item);
  const [serverError, setServerError] = useState<string | null>(null);
  const [manualBarcode, setManualBarcode] = useState('');
  const editing = current !== null;
  const {
    register,
    handleSubmit,
    setError,
    setValue,
    control,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      itemCode: item?.itemCode ?? '',
      name: item?.name ?? '',
      categoryId: item?.categoryId ?? '',
      unitCode: item?.unitCode ?? '',
      hsnCode: item?.hsnCode ?? '',
      taxRate: item?.taxRate ?? '',
      reorderLevel: item?.reorderLevel ?? 0,
      isSerialized: item?.isSerialized ?? false,
      barcode: '',
      generateBarcode: false,
    },
  });

  const hsnText = (useWatch({ control, name: 'hsnCode' }) ?? '').trim();
  const generate = useWatch({ control, name: 'generateBarcode' });
  const suggestions = useHsnSuggestions(useDebouncedValue(hsnText, HSN_SEARCH_DELAY_MS));
  const taxRate = useWatch({ control, name: 'taxRate' });
  useEffect(() => {
    const match = suggestions.data?.items.find((hsn) => hsn.code === hsnText);
    if (match?.gstRate && taxRate === '') setValue('taxRate', match.gstRate);
  }, [suggestions.data, hsnText, taxRate, setValue]);

  const categoryChoices = categories
    .filter((category) => category.isActive || category.id === item?.categoryId)
    .map((category) => ({ id: category.id, label: categoryLabel(category, categories) }))
    .sort((a, b) => a.label.localeCompare(b.label));

  const placeError = (error: unknown): void => {
    if (!(error instanceof ApiError)) {
      setServerError('Something went wrong. Try again.');
      return;
    }
    let placed = false;
    for (const detail of error.details) {
      if (isField(detail.field)) {
        setError(detail.field, { message: detail.message });
        placed = true;
      }
    }
    if (!placed) setServerError(error.message);
  };

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    const parsed = FormSchema.parse(values);
    const hsnCode = parsed.hsnCode === '' ? null : parsed.hsnCode;
    const taxRateValue = parsed.taxRate === '' ? null : parsed.taxRate;
    try {
      if (current) {
        await update.mutateAsync({
          id: current.id,
          values: {
            name: parsed.name,
            categoryId: parsed.categoryId,
            unitCode: parsed.unitCode,
            hsnCode,
            taxRate: taxRateValue,
            reorderLevel: parsed.reorderLevel,
            isSerialized: parsed.isSerialized,
            rowVersion: current.rowVersion,
          },
        });
        onSaved(`Item ${current.itemCode} saved`);
      } else {
        await create.mutateAsync({
          itemCode: parsed.itemCode,
          name: parsed.name,
          categoryId: parsed.categoryId,
          unitCode: parsed.unitCode,
          hsnCode,
          taxRate: taxRateValue,
          reorderLevel: parsed.reorderLevel,
          isSerialized: parsed.isSerialized,
          generateBarcode: parsed.generateBarcode,
          ...(parsed.barcode === '' ? {} : { barcode: parsed.barcode }),
        });
        onSaved(`Item ${parsed.itemCode} created`);
      }
    } catch (error) {
      placeError(error);
    }
  });

  const changeBarcodes = async (action: () => Promise<Item>): Promise<void> => {
    setServerError(null);
    try {
      setCurrent(await action());
      setManualBarcode('');
    } catch (error) {
      setServerError(
        error instanceof ApiError ? error.message : 'Something went wrong. Try again.',
      );
    }
  };

  return (
    <form onSubmit={onSubmit} noValidate className="mt-4 flex min-h-0 flex-1 flex-col gap-4">
      <div className="min-h-0 flex-1 space-y-4 overflow-y-auto px-1 pb-1">
        {serverError ? <Alert tone="error">{serverError}</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Item code" error={errors.itemCode?.message} hint="For example TOTO-X1">
            {(props) => (
              <Input
                {...props}
                disabled={editing}
                autoComplete="off"
                className="uppercase"
                {...register('itemCode')}
              />
            )}
          </FormField>
          <FormField label="Name" error={errors.name?.message}>
            {(props) => <Input {...props} autoComplete="off" {...register('name')} />}
          </FormField>
          <FormField label="Category" error={errors.categoryId?.message}>
            {(props) => (
              <Select {...props} {...register('categoryId')}>
                <option value="">Choose a category</option>
                {categoryChoices.map((choice) => (
                  <option key={choice.id} value={choice.id}>
                    {choice.label}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField label="Unit" error={errors.unitCode?.message}>
            {(props) => (
              <Select {...props} {...register('unitCode')}>
                <option value="">Choose a unit</option>
                {units.map((unit) => (
                  <option key={unit.code} value={unit.code}>
                    {unit.name} ({unit.code})
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField
            label="HSN code"
            error={errors.hsnCode?.message}
            hint="Optional. Start typing to search"
          >
            {(props) => (
              <>
                <Input
                  {...props}
                  list="hsn-options"
                  inputMode="numeric"
                  autoComplete="off"
                  {...register('hsnCode')}
                />
                <datalist id="hsn-options">
                  {suggestions.data?.items.map((hsn) => (
                    <option key={hsn.code} value={hsn.code}>
                      {hsn.description}
                    </option>
                  ))}
                </datalist>
              </>
            )}
          </FormField>
          <FormField
            label="GST rate"
            error={errors.taxRate?.message}
            hint="Optional. Filled in from the HSN code when it has one"
          >
            {(props) => (
              <Select {...props} {...register('taxRate')}>
                <option value="">No GST rate</option>
                {rates.map((rate) => (
                  <option key={rate.rate} value={rate.rate}>
                    {rate.label}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          <FormField
            label="Reorder level"
            error={errors.reorderLevel?.message}
            hint="Warn when stock in a branch falls to this"
          >
            {(props) => (
              <Input
                {...props}
                type="number"
                min={0}
                {...register('reorderLevel', { valueAsNumber: true })}
              />
            )}
          </FormField>
        </div>

        <div className="space-y-1">
          <label className="flex items-center gap-2 text-sm font-medium">
            <input type="checkbox" {...register('isSerialized')} />
            Tracked by serial number (each unit is recorded separately)
          </label>
          {errors.isSerialized ? (
            <p className="text-sm text-destructive">{errors.isSerialized.message}</p>
          ) : null}
        </div>

        {editing && current ? (
          <fieldset className="space-y-2">
            <legend className="text-sm font-medium">Barcodes</legend>
            {current.barcodes.length === 0 ? (
              <p className="text-sm text-muted-foreground">This item has no barcode yet.</p>
            ) : (
              <ul className="space-y-1">
                {current.barcodes.map((barcode) => (
                  <li
                    key={barcode.id}
                    className="flex items-center justify-between rounded-md border px-3 py-1 text-sm"
                  >
                    <span className="font-mono">{barcode.barcode}</span>
                    {canManage ? (
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        aria-label={`Remove barcode ${barcode.barcode}`}
                        disabled={removeBarcode.isPending}
                        onClick={() =>
                          void changeBarcodes(() =>
                            removeBarcode.mutateAsync({ id: current.id, barcodeId: barcode.id }),
                          )
                        }
                      >
                        Remove
                      </Button>
                    ) : null}
                  </li>
                ))}
              </ul>
            )}
            {canManage ? (
              <div className="flex flex-wrap items-center gap-2">
                <Input
                  aria-label="New barcode"
                  className="w-56"
                  placeholder="Type or scan a barcode"
                  value={manualBarcode}
                  onChange={(event) => setManualBarcode(event.target.value)}
                />
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={manualBarcode.trim() === '' || addBarcode.isPending}
                  onClick={() =>
                    void changeBarcodes(() =>
                      addBarcode.mutateAsync({
                        id: current.id,
                        values: { barcode: manualBarcode.trim() },
                      }),
                    )
                  }
                >
                  Add barcode
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  disabled={addBarcode.isPending}
                  onClick={() =>
                    void changeBarcodes(() =>
                      addBarcode.mutateAsync({ id: current.id, values: { generate: true } }),
                    )
                  }
                >
                  Generate barcode
                </Button>
              </div>
            ) : null}
          </fieldset>
        ) : (
          <div className="space-y-2">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input type="checkbox" {...register('generateBarcode')} />
              Generate a barcode for this item
            </label>
            {!generate ? (
              <FormField
                label="Barcode"
                error={errors.barcode?.message}
                hint="Optional. Type or scan the one on the product"
              >
                {(props) => <Input {...props} autoComplete="off" {...register('barcode')} />}
              </FormField>
            ) : null}
          </div>
        )}
      </div>

      <div className="flex shrink-0 flex-col-reverse gap-2 border-t pt-3 sm:flex-row sm:justify-end">
        <Button type="button" variant="secondary" onClick={onClose} disabled={isSubmitting}>
          Cancel
        </Button>
        <Button type="submit" disabled={isSubmitting}>
          {isSubmitting ? 'Saving…' : editing ? 'Save changes' : 'Create item'}
        </Button>
      </div>
    </form>
  );
}
