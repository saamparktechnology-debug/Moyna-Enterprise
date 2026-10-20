import { useState } from 'react';
import type { FormEvent } from 'react';
import { MAX_WARRANTY_MONTHS, SetBatteryDetailsRequestSchema } from '@erp/contracts';
import type { Battery, SerialUnit } from '@erp/contracts';
import { FormField, Input } from '@/components/form-field';
import { FormDialog } from '@/components/form-dialog';
import { ApiError } from '@/lib/api-client';
import { useSerialUnits } from '@/features/inventory/use-inventory';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useBatteryMutations } from './use-batteries';

const SEARCH_DELAY_MS = 250;
type Field = 'manufacturedOn' | 'expiryOn' | 'warrantyMonths' | 'warrantyEnd';
const FIELDS: readonly Field[] = ['manufacturedOn', 'expiryOn', 'warrantyMonths', 'warrantyEnd'];
const isField = (name: string): name is Field => (FIELDS as readonly string[]).includes(name);

interface BatteryDetailsDialogProps {
  /** The battery being changed, or null to record details for a serial unit chosen in the dialog. */
  battery: Battery | null;
  onClose: () => void;
  onSaved: (message: string) => void;
}

export function BatteryDetailsDialog({ battery, onClose, onSaved }: BatteryDetailsDialogProps) {
  const { setDetails } = useBatteryMutations();
  const [unit, setUnit] = useState<SerialUnit | null>(null);
  const [search, setSearch] = useState('');
  const [manufacturedOn, setManufacturedOn] = useState(battery?.manufacturedOn ?? '');
  const [expiryOn, setExpiryOn] = useState(battery?.expiryOn ?? '');
  const [warrantyMonths, setWarrantyMonths] = useState(battery?.warrantyMonths?.toString() ?? '');
  const [warrantyEnd, setWarrantyEnd] = useState(battery?.warrantyEnd ?? '');
  const [errors, setErrors] = useState<Partial<Record<Field | 'unit', string>>>({});
  const [serverError, setServerError] = useState<string | null>(null);
  const typed = useDebouncedValue(search.trim(), SEARCH_DELAY_MS);
  const found = useSerialUnits(
    { page: 1, pageSize: 10, search: typed, state: '' },
    battery === null && typed.length >= 2,
  );
  const target = battery
    ? { id: battery.serialUnitId, serialNo: battery.serialNo }
    : unit && { id: unit.id, serialNo: unit.serialNo };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setServerError(null);
    const problems: Partial<Record<Field | 'unit', string>> = {};
    if (!target) problems.unit = 'Choose the serial unit';
    const parsed = SetBatteryDetailsRequestSchema.safeParse({
      manufacturedOn: manufacturedOn || null,
      expiryOn: expiryOn || null,
      warrantyMonths: warrantyMonths.trim() === '' ? null : Number(warrantyMonths),
      warrantyEnd: warrantyEnd || null,
      ...(battery?.rowVersion ? { rowVersion: battery.rowVersion } : {}),
    });
    if (!parsed.success)
      for (const issue of parsed.error.issues) {
        const name = String(issue.path[0]);
        if (isField(name) && !problems[name]) problems[name] = issue.message;
      }
    setErrors(problems);
    if (!target || !parsed.success || Object.keys(problems).length > 0) return;
    try {
      await setDetails.mutateAsync({ id: target.id, values: parsed.data });
      onSaved(`Battery ${target.serialNo} saved`);
    } catch (error) {
      if (!(error instanceof ApiError)) {
        setServerError('Something went wrong. Try again.');
        return;
      }
      const placed: Partial<Record<Field, string>> = {};
      for (const detail of error.details)
        if (isField(detail.field)) placed[detail.field] = detail.message;
      setErrors(placed);
      if (Object.keys(placed).length === 0) setServerError(error.message);
    }
  };

  return (
    <FormDialog
      open
      size="md"
      title={battery ? `Battery ${battery.serialNo}` : 'Record battery details'}
      description="Dates are judged by the calendar day in India. A battery is good through its expiry date."
      onClose={onClose}
      onSubmit={submit}
      saving={setDetails.isPending}
      submitLabel="Save details"
      error={serverError}
    >
      {battery === null ? (
        <FormField
          label="Find the serial number"
          error={errors.unit}
          hint={unit ? `Chosen: ${unit.serialNo} · ${unit.itemName}` : 'Type at least 2 characters'}
        >
          {(props) => (
            <>
              <Input
                {...props}
                autoComplete="off"
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
              {found.data && found.data.items.length > 0 ? (
                <ul
                  aria-label="Matching serial numbers"
                  className="mt-2 max-h-32 overflow-auto rounded-md border text-sm"
                >
                  {found.data.items.map((candidate) => (
                    <li key={candidate.id}>
                      <button
                        type="button"
                        className="w-full px-3 py-1 text-left hover:bg-accent"
                        onClick={() => setUnit(candidate)}
                      >
                        {candidate.serialNo} · {candidate.itemName} · {candidate.branchCode}
                      </button>
                    </li>
                  ))}
                </ul>
              ) : null}
              {found.data && found.data.items.length === 0 ? (
                <p className="mt-1 text-sm text-muted-foreground">No serial number matches.</p>
              ) : null}
            </>
          )}
        </FormField>
      ) : null}
      <div className="grid gap-4 sm:grid-cols-2">
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
        <FormField
          label="Warranty (months)"
          error={errors.warrantyMonths}
          hint={`0 to ${MAX_WARRANTY_MONTHS}`}
        >
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
        <FormField
          label="Warranty ends on"
          error={errors.warrantyEnd}
          hint="Set when the battery is sold"
        >
          {(props) => (
            <Input
              {...props}
              type="date"
              value={warrantyEnd}
              onChange={(event) => setWarrantyEnd(event.target.value)}
            />
          )}
        </FormField>
      </div>
    </FormDialog>
  );
}
