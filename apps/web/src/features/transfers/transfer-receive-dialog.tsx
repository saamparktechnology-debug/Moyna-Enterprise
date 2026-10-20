import { useState } from 'react';
import { ReceiveTransferRequestSchema } from '@erp/contracts';
import type { Transfer } from '@erp/contracts';
import { FormField, Input } from '@/components/form-field';
import { FormDialog } from '@/components/form-dialog';
import { Textarea } from '@/components/ui/input';
import { describeError } from '../purchasing/purchasing-shared';
import type { Problem } from '../purchasing/purchasing-shared';
import { splitSerials } from './transfers-shared';
import { useTransferMutations } from './use-transfers';

interface TransferReceiveDialogProps {
  transfer: Transfer;
  onClose: () => void;
  onDone: (message: string) => void;
}

export function TransferReceiveDialog({ transfer, onClose, onDone }: TransferReceiveDialogProps) {
  const { receive } = useTransferMutations();
  const plain = transfer.lines.filter((line) => !line.isSerialized);
  const serial = transfer.lines.filter((line) => line.isSerialized);
  const [arrived, setArrived] = useState<Record<string, string>>(() =>
    Object.fromEntries(plain.map((line) => [line.id, String(line.qtySent)])),
  );
  const [damaged, setDamaged] = useState<Record<string, string>>({});
  const [serialsText, setSerialsText] = useState('');
  const [damagedText, setDamagedText] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<Problem | null>(null);

  const submit = async () => {
    setProblem(null);
    const found: Record<string, string> = {};
    const numbers = splitSerials(serialsText);
    const damagedNumbers = new Set(splitSerials(damagedText));
    for (const no of damagedNumbers)
      if (!numbers.includes(no))
        found.damagedSerials = `${no} is not in the list of serial numbers that arrived`;
    const parsed = ReceiveTransferRequestSchema.safeParse({
      rowVersion: transfer.rowVersion,
      ...(note.trim() ? { note: note.trim() } : {}),
      lines: plain.map((line) => ({
        lineId: line.id,
        received: (arrived[line.id] ?? '').trim() === '' ? Number.NaN : Number(arrived[line.id]),
        damaged: (damaged[line.id] ?? '').trim() === '' ? 0 : Number(damaged[line.id]),
      })),
      serials: numbers.map((serialNo) => ({ serialNo, damaged: damagedNumbers.has(serialNo) })),
    });
    if (!parsed.success)
      for (const issue of parsed.error.issues) {
        const [section, index, field] = issue.path;
        const line = section === 'lines' && typeof index === 'number' ? plain[index] : undefined;
        const key = line
          ? `${line.id}.${String(field)}`
          : section === 'serials'
            ? 'serials'
            : 'general';
        found[key] ??= issue.message;
      }
    setErrors(found);
    if (!parsed.success || Object.keys(found).length > 0) return;
    try {
      const saved = await receive.mutateAsync({ id: transfer.id, values: parsed.data });
      const open = saved.lines.reduce(
        (sum, line) => sum + line.discrepancies.filter((entry) => entry.status === 'OPEN').length,
        0,
      );
      onDone(
        `Transfer ${transfer.transferNo} received.` +
          (open > 0 ? ` ${open} problem${open === 1 ? ' needs' : 's need'} a decision.` : ''),
      );
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  return (
    <FormDialog
      open
      size="md"
      title={`Receive ${transfer.transferNo}`}
      description={`Count what arrived from ${transfer.fromBranchCode}. Good units go to Available stock; damaged units go to Quarantine; anything missing stays in transit until someone decides what to do.`}
      onClose={onClose}
      onSubmit={submit}
      saving={receive.isPending}
      savingLabel="Recording…"
      submitLabel="Record receipt"
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
      {errors.general ? (
        <p role="alert" className="text-sm text-destructive">
          {errors.general}
        </p>
      ) : null}
      {plain.map((line) => (
        <fieldset
          key={line.id}
          aria-label={`Receive ${line.itemCode}`}
          className="space-y-2 rounded-md border p-3"
        >
          <legend className="px-1 text-sm font-medium">
            {line.itemCode} · {line.itemName}: {line.qtySent} sent
          </legend>
          <FormField label={`Arrived for ${line.itemCode}`} error={errors[`${line.id}.received`]}>
            {(props) => (
              <Input
                {...props}
                type="number"
                min={0}
                value={arrived[line.id] ?? ''}
                onChange={(event) => setArrived({ ...arrived, [line.id]: event.target.value })}
              />
            )}
          </FormField>
          <FormField
            label={`Damaged for ${line.itemCode}`}
            hint="How many of those arrived damaged"
            error={errors[`${line.id}.damaged`]}
          >
            {(props) => (
              <Input
                {...props}
                type="number"
                min={0}
                value={damaged[line.id] ?? ''}
                onChange={(event) => setDamaged({ ...damaged, [line.id]: event.target.value })}
              />
            )}
          </FormField>
        </fieldset>
      ))}
      {serial.length > 0 ? (
        <div className="space-y-2">
          <p className="text-sm">
            Serial numbers sent: {serial.map((line) => line.serialNo).join(', ')}
          </p>
          <FormField
            label="Serial numbers that arrived"
            hint="One per line. Leave out any that did not arrive"
            error={errors.serials}
          >
            {(props) => (
              <Textarea
                {...props}
                rows={3}
                value={serialsText}
                onChange={(event) => setSerialsText(event.target.value)}
              />
            )}
          </FormField>
          <FormField
            label="Damaged serial numbers"
            hint="Optional. Copy the damaged ones here"
            error={errors.damagedSerials}
          >
            {(props) => (
              <Textarea
                {...props}
                rows={2}
                value={damagedText}
                onChange={(event) => setDamagedText(event.target.value)}
              />
            )}
          </FormField>
        </div>
      ) : null}
      <FormField label="Note" hint="Optional">
        {(props) => (
          <Input
            {...props}
            autoComplete="off"
            value={note}
            onChange={(event) => setNote(event.target.value)}
          />
        )}
      </FormField>
    </FormDialog>
  );
}
