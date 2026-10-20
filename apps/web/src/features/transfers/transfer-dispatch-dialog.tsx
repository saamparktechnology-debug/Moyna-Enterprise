import { useState } from 'react';
import { DispatchTransferRequestSchema } from '@erp/contracts';
import type { Transfer } from '@erp/contracts';
import { FormField, Input } from '@/components/form-field';
import { FormDialog } from '@/components/form-dialog';
import { Textarea } from '@/components/ui/input';
import { describeError } from '../purchasing/purchasing-shared';
import type { Problem } from '../purchasing/purchasing-shared';
import { splitSerials } from './transfers-shared';
import { useTransferMutations } from './use-transfers';

interface TransferDispatchDialogProps {
  transfer: Transfer;
  onClose: () => void;
  onDone: (message: string) => void;
}

export function TransferDispatchDialog({ transfer, onClose, onDone }: TransferDispatchDialogProps) {
  const { dispatch } = useTransferMutations();
  const [qty, setQty] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      transfer.lines
        .filter((line) => !line.isSerialized)
        .map((line) => [line.id, String(line.qtyRequested)]),
    ),
  );
  const [serials, setSerials] = useState<Record<string, string>>({});
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<Problem | null>(null);

  const submit = async () => {
    setProblem(null);
    const found: Record<string, string> = {};
    const items = transfer.lines.map((line) => {
      if (line.isSerialized) {
        const numbers = splitSerials(serials[line.id] ?? '');
        if (numbers.length !== line.qtyRequested)
          found[line.id] =
            `${line.qtyRequested} unit${line.qtyRequested === 1 ? ' was' : 's were'} asked for, ${numbers.length} entered`;
        return { itemId: line.itemId, serialNos: numbers };
      }
      const text = (qty[line.id] ?? '').trim();
      return { itemId: line.itemId, qty: text === '' ? Number.NaN : Number(text) };
    });
    const parsed = DispatchTransferRequestSchema.safeParse({
      rowVersion: transfer.rowVersion,
      ...(note.trim() ? { note: note.trim() } : {}),
      items,
    });
    if (!parsed.success)
      for (const issue of parsed.error.issues) {
        const index = issue.path[0] === 'items' ? issue.path[1] : undefined;
        const line = typeof index === 'number' ? transfer.lines[index] : undefined;
        found[line?.id ?? 'general'] ??= issue.message;
      }
    setErrors(found);
    if (!parsed.success || Object.keys(found).length > 0) return;
    try {
      await dispatch.mutateAsync({ id: transfer.id, values: parsed.data });
      onDone(`Transfer ${transfer.transferNo} dispatched`);
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  return (
    <FormDialog
      open
      size="md"
      title={`Dispatch ${transfer.transferNo}`}
      description={`Count what is being sent to ${transfer.toBranchCode}. It leaves your stock now and is held in transit until they receive it.`}
      onClose={onClose}
      onSubmit={submit}
      saving={dispatch.isPending}
      savingLabel="Dispatching…"
      submitLabel="Dispatch"
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
      {transfer.lines.map((line) =>
        line.isSerialized ? (
          <FormField
            key={line.id}
            label={`Serial numbers for ${line.itemCode}`}
            hint={`${line.qtyRequested} unit${line.qtyRequested === 1 ? ' was' : 's were'} asked for. One per line`}
            error={errors[line.id]}
          >
            {(props) => (
              <Textarea
                {...props}
                rows={3}
                value={serials[line.id] ?? ''}
                onChange={(event) => setSerials({ ...serials, [line.id]: event.target.value })}
              />
            )}
          </FormField>
        ) : (
          <FormField
            key={line.id}
            label={`Quantity to send for ${line.itemCode}`}
            hint={`${line.qtyRequested} asked for. You may send fewer`}
            error={errors[line.id]}
          >
            {(props) => (
              <Input
                {...props}
                type="number"
                min={1}
                value={qty[line.id] ?? ''}
                onChange={(event) => setQty({ ...qty, [line.id]: event.target.value })}
              />
            )}
          </FormField>
        ),
      )}
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
