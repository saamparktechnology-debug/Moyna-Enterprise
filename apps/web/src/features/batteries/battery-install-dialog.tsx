import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Battery, SerialUnit } from '@erp/contracts';
import { Alert } from '@/components/alert';
import { FormField, Input } from '@/components/form-field';
import { FormDialog } from '@/components/form-dialog';
import { useAuth } from '@/features/auth/auth-provider';
import { useSerialUnits } from '@/features/inventory/use-inventory';
import { ApiError } from '@/lib/api-client';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useBatteryMutations } from './use-batteries';

const SEARCH_DELAY_MS = 250;

interface BatteryInstallDialogProps {
  battery: Battery;
  onClose: () => void;
  onDone: (message: string) => void;
}

export function BatteryInstallDialog({ battery, onClose, onDone }: BatteryInstallDialogProps) {
  const { can } = useAuth();
  const { install } = useBatteryMutations();
  const [search, setSearch] = useState('');
  const [vehicle, setVehicle] = useState<SerialUnit | null>(null);
  const [installedOn, setInstalledOn] = useState('');
  const [reason, setReason] = useState('');
  const [problem, setProblem] = useState<{ message: string; reasons: string[] } | null>(null);
  const [vehicleError, setVehicleError] = useState<string | undefined>();
  const typed = useDebouncedValue(search.trim(), SEARCH_DELAY_MS);
  const found = useSerialUnits(
    { page: 1, pageSize: 10, search: typed, state: '', branchId: battery.branchId },
    typed.length >= 2,
  );
  const expired = battery.expiryStatus === 'EXPIRED';
  const mayOverride = can('batteries.override_expiry');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setProblem(null);
    setVehicleError(undefined);
    if (!vehicle) {
      setVehicleError('Choose the vehicle');
      return;
    }
    try {
      await install.mutateAsync({
        id: battery.serialUnitId,
        values: {
          vehicleSerialUnitId: vehicle.id,
          ...(installedOn ? { installedOn } : {}),
          ...(expired && reason.trim() ? { overrideReason: reason.trim() } : {}),
        },
      });
      onDone(`Battery ${battery.serialNo} installed in ${vehicle.serialNo}`);
    } catch (error) {
      setProblem(
        error instanceof ApiError
          ? { message: error.message, reasons: error.details.map((detail) => detail.message) }
          : { message: 'Something went wrong. Try again.', reasons: [] },
      );
    }
  };

  return (
    <FormDialog
      open
      size="md"
      title={`Install battery ${battery.serialNo}`}
      description="The battery is reserved for the vehicle. It leaves available stock but is not sold."
      onClose={onClose}
      onSubmit={submit}
      saving={install.isPending}
      savingLabel="Installing…"
      submitLabel="Install battery"
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
      {expired ? (
        <Alert tone="info">
          This battery expired on {battery.expiryOn}.{' '}
          {mayOverride
            ? 'Give a reason to install it anyway.'
            : 'Only a manager can install it, with a reason.'}
        </Alert>
      ) : null}
      <FormField
        label="Find the vehicle"
        error={vehicleError}
        hint={
          vehicle
            ? `Chosen: ${vehicle.serialNo} · ${vehicle.itemName}`
            : 'Type at least 2 characters of its serial number'
        }
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
                aria-label="Matching vehicles"
                className="mt-2 max-h-32 overflow-auto rounded-md border text-sm"
              >
                {found.data.items
                  .filter((candidate) => candidate.id !== battery.serialUnitId)
                  .map((candidate) => (
                    <li key={candidate.id}>
                      <button
                        type="button"
                        className="w-full px-3 py-1 text-left hover:bg-accent"
                        onClick={() => setVehicle(candidate)}
                      >
                        {candidate.serialNo} · {candidate.itemName}
                      </button>
                    </li>
                  ))}
              </ul>
            ) : null}
          </>
        )}
      </FormField>
      <FormField label="Installed on" hint="Leave empty for today">
        {(props) => (
          <Input
            {...props}
            type="date"
            value={installedOn}
            onChange={(event) => setInstalledOn(event.target.value)}
          />
        )}
      </FormField>
      {expired ? (
        <FormField label="Reason for the override">
          {(props) => (
            <Input
              {...props}
              autoComplete="off"
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </FormField>
      ) : null}
    </FormDialog>
  );
}
