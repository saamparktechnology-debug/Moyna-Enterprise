import { useState } from 'react';
import type { FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ADJUSTMENT_KINDS, CreateStockAdjustmentRequestSchema, STOCK_STATES } from '@erp/contracts';
import type { AdjustmentKind, Item } from '@erp/contracts';
import { Alert } from '@/components/alert';
import { FormField, Input } from '@/components/form-field';
import { Select } from '@/components/select-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/features/auth/auth-provider';
import { useActiveBranch } from '@/features/branches/active-branch';
import { listItems } from '@/features/items/items-api';
import { ApiError } from '@/lib/api-client';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useAdjustmentMutations, useSerialUnits } from './use-inventory';

const SEARCH_DELAY_MS = 300;
const KIND_LABELS: Record<AdjustmentKind, string> = {
  IN: 'Add stock',
  OUT: 'Remove stock',
  WRITE_OFF: 'Write off',
  STATE_CHANGE: 'Change state',
};
export const label = (value: string): string => value.toLowerCase().replaceAll('_', ' ');

const FIELDS = [
  'branchId',
  'itemId',
  'kind',
  'state',
  'toState',
  'qty',
  'serialUnitId',
  'serialNo',
  'chassisNo',
  'manufacturedOn',
  'expiryOn',
  'warrantyMonths',
  'reason',
] as const;
type Field = (typeof FIELDS)[number];
const isField = (name: string): name is Field => (FIELDS as readonly string[]).includes(name);

interface AdjustmentFormDialogProps {
  onClose: () => void;
  onSaved: (message: string) => void;
}

export function AdjustmentFormDialog({ onClose, onSaved }: AdjustmentFormDialogProps) {
  const { user } = useAuth();
  const active = useActiveBranch();
  const { create } = useAdjustmentMutations();
  const branches = user?.branches ?? [];
  const onlyBranch = branches.length === 1 ? branches[0]?.id : undefined;

  const [branchId, setBranchId] = useState(active ?? onlyBranch ?? '');
  const [itemSearch, setItemSearch] = useState('');
  const [item, setItem] = useState<Item | null>(null);
  const [kind, setKind] = useState<AdjustmentKind>('IN');
  const [state, setState] = useState('AVAILABLE');
  const [toState, setToState] = useState('');
  const [qty, setQty] = useState('1');
  const [serialUnitId, setSerialUnitId] = useState('');
  const [serialNo, setSerialNo] = useState('');
  const [chassisNo, setChassisNo] = useState('');
  const [manufacturedOn, setManufacturedOn] = useState('');
  const [expiryOn, setExpiryOn] = useState('');
  const [warrantyMonths, setWarrantyMonths] = useState('');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Partial<Record<Field, string>>>({});
  const [serverError, setServerError] = useState<string | null>(null);

  const search = useDebouncedValue(itemSearch.trim(), SEARCH_DELAY_MS);
  const found = useQuery({
    queryKey: ['stock-form-items', search],
    queryFn: () =>
      listItems({
        page: 1,
        pageSize: 8,
        search,
        categoryId: '',
        status: 'active',
        tracking: 'any',
      }),
    enabled: search.length >= 2,
  });
  const needsUnit = item?.isSerialized === true && kind !== 'IN';
  const units = useSerialUnits(
    {
      page: 1,
      pageSize: 100,
      search: '',
      state,
      itemId: item?.id,
      branchId: branchId || undefined,
    },
    needsUnit && branchId !== '',
  );

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setServerError(null);
    const payload = {
      ...(branchId ? { branchId } : {}),
      itemId: item?.id ?? '',
      kind,
      state,
      ...(kind === 'STATE_CHANGE' && toState ? { toState } : {}),
      qty: item?.isSerialized ? 1 : Number(qty),
      ...(needsUnit && serialUnitId ? { serialUnitId } : {}),
      ...(item?.isSerialized && kind === 'IN' && serialNo.trim() ? { serialNo } : {}),
      ...(item?.isSerialized && kind === 'IN' && chassisNo.trim() ? { chassisNo } : {}),
      ...(item?.isSerialized && kind === 'IN' && manufacturedOn ? { manufacturedOn } : {}),
      ...(item?.isSerialized && kind === 'IN' && expiryOn ? { expiryOn } : {}),
      ...(item?.isSerialized && kind === 'IN' && warrantyMonths.trim()
        ? { warrantyMonths: Number(warrantyMonths) }
        : {}),
      reason,
    };
    const parsed = CreateStockAdjustmentRequestSchema.safeParse(payload);
    const problems: Partial<Record<Field, string>> = {};
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        const name = String(issue.path[0]);
        if (isField(name) && !problems[name]) problems[name] = issue.message;
      }
    }
    if (!branchId) problems.branchId = 'Choose a branch';
    if (!item) problems.itemId = 'Choose an item';
    if (needsUnit && !serialUnitId) problems.serialUnitId = 'Choose the serial unit';
    if (item?.isSerialized && kind === 'IN' && !serialNo.trim())
      problems.serialNo = 'Enter the serial number';
    setErrors(problems);
    if (!parsed.success || Object.keys(problems).length > 0) return;
    try {
      await create.mutateAsync(parsed.data);
      onSaved('Adjustment requested. It waits for approval and no stock has moved yet.');
    } catch (error) {
      if (!(error instanceof ApiError)) {
        setServerError('Something went wrong. Try again.');
        return;
      }
      const placed: Partial<Record<Field, string>> = {};
      for (const detail of error.details)
        if (isField(detail.field)) placed[detail.field] = detail.message;
      if (Object.keys(placed).length > 0) setErrors(placed);
      else setServerError(error.message);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => (next || create.isPending ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogTitle>Request a stock adjustment</DialogTitle>
        <DialogDescription>Nothing moves until a manager approves the request.</DialogDescription>
        <form onSubmit={(event) => void submit(event)} noValidate className="mt-4 space-y-4">
          {serverError ? <Alert tone="error">{serverError}</Alert> : null}
          {branches.length > 1 ? (
            <FormField label="Branch" error={errors.branchId}>
              {(props) => (
                <Select
                  {...props}
                  value={branchId}
                  onChange={(event) => setBranchId(event.target.value)}
                >
                  <option value="">Choose a branch</option>
                  {branches.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.code} · {branch.name}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          ) : null}
          <FormField
            label="Find item"
            error={errors.itemId}
            hint={
              item
                ? `Chosen: ${item.itemCode} · ${item.name}`
                : 'Type at least 2 characters of the code, name or barcode'
            }
          >
            {(props) => (
              <>
                <Input
                  {...props}
                  autoComplete="off"
                  value={itemSearch}
                  onChange={(event) => setItemSearch(event.target.value)}
                />
                {found.data && found.data.items.length > 0 ? (
                  <Select
                    aria-label="Matching items"
                    className="mt-2"
                    value={item?.id ?? ''}
                    onChange={(event) => {
                      setItem(
                        found.data?.items.find(
                          (candidate) => candidate.id === event.target.value,
                        ) ?? null,
                      );
                      setSerialUnitId('');
                    }}
                  >
                    <option value="">Choose an item</option>
                    {found.data.items.map((candidate) => (
                      <option key={candidate.id} value={candidate.id}>
                        {candidate.itemCode} · {candidate.name}
                      </option>
                    ))}
                  </Select>
                ) : null}
                {found.data && found.data.items.length === 0 ? (
                  <p className="mt-1 text-sm text-muted-foreground">No active item matches.</p>
                ) : null}
              </>
            )}
          </FormField>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="What to do" error={errors.kind}>
              {(props) => (
                <Select
                  {...props}
                  value={kind}
                  onChange={(event) => {
                    setKind(event.target.value as AdjustmentKind);
                    setSerialUnitId('');
                  }}
                >
                  {ADJUSTMENT_KINDS.map((value) => (
                    <option key={value} value={value}>
                      {KIND_LABELS[value]}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField
              label={kind === 'STATE_CHANGE' ? 'From state' : 'Stock state'}
              error={errors.state}
            >
              {(props) => (
                <Select
                  {...props}
                  value={state}
                  onChange={(event) => {
                    setState(event.target.value);
                    setSerialUnitId('');
                  }}
                >
                  {STOCK_STATES.map((value) => (
                    <option key={value} value={value}>
                      {label(value)}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            {kind === 'STATE_CHANGE' ? (
              <FormField label="To state" error={errors.toState}>
                {(props) => (
                  <Select
                    {...props}
                    value={toState}
                    onChange={(event) => setToState(event.target.value)}
                  >
                    <option value="">Choose a state</option>
                    {STOCK_STATES.filter((value) => value !== state).map((value) => (
                      <option key={value} value={value}>
                        {label(value)}
                      </option>
                    ))}
                  </Select>
                )}
              </FormField>
            ) : null}
            {!item?.isSerialized ? (
              <FormField label="Quantity" error={errors.qty}>
                {(props) => (
                  <Input
                    {...props}
                    type="number"
                    min={1}
                    value={qty}
                    onChange={(event) => setQty(event.target.value)}
                  />
                )}
              </FormField>
            ) : null}
          </div>
          {needsUnit ? (
            <FormField label="Serial unit" error={errors.serialUnitId}>
              {(props) => (
                <Select
                  {...props}
                  value={serialUnitId}
                  onChange={(event) => setSerialUnitId(event.target.value)}
                >
                  <option value="">
                    {units.isPending ? 'Loading units…' : 'Choose a serial unit'}
                  </option>
                  {units.data?.items.map((unit) => (
                    <option key={unit.id} value={unit.id}>
                      {unit.serialNo}
                      {unit.chassisNo ? ` (${unit.chassisNo})` : ''}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          ) : null}
          {item?.isSerialized && kind === 'IN' ? (
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Serial number" error={errors.serialNo}>
                {(props) => (
                  <Input
                    {...props}
                    autoComplete="off"
                    value={serialNo}
                    onChange={(event) => setSerialNo(event.target.value)}
                  />
                )}
              </FormField>
              <FormField label="Chassis number" error={errors.chassisNo} hint="Optional">
                {(props) => (
                  <Input
                    {...props}
                    autoComplete="off"
                    value={chassisNo}
                    onChange={(event) => setChassisNo(event.target.value)}
                  />
                )}
              </FormField>
            </div>
          ) : null}
          {item?.isSerialized && kind === 'IN' ? (
            <fieldset className="space-y-2">
              <legend className="text-sm font-medium">Battery dates (optional)</legend>
              <div className="grid gap-4 sm:grid-cols-3">
                <FormField label="Manufactured on" error={errors.manufacturedOn}>
                  {(props) => (
                    <Input
                      {...props}
                      type="date"
                      value={manufacturedOn}
                      onChange={(event) => setManufacturedOn(event.target.value)}
                    />
                  )}
                </FormField>
                <FormField label="Expires on" error={errors.expiryOn}>
                  {(props) => (
                    <Input
                      {...props}
                      type="date"
                      value={expiryOn}
                      onChange={(event) => setExpiryOn(event.target.value)}
                    />
                  )}
                </FormField>
                <FormField label="Warranty (months)" error={errors.warrantyMonths}>
                  {(props) => (
                    <Input
                      {...props}
                      type="number"
                      min={0}
                      value={warrantyMonths}
                      onChange={(event) => setWarrantyMonths(event.target.value)}
                    />
                  )}
                </FormField>
              </div>
            </fieldset>
          ) : null}
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
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={create.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Sending…' : 'Request adjustment'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
