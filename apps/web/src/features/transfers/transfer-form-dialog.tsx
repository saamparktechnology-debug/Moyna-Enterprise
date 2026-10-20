import { useState } from 'react';
import { CreateTransferRequestSchema } from '@erp/contracts';
import type { Item } from '@erp/contracts';
import { Alert } from '@/components/alert';
import { FormField, Input } from '@/components/form-field';
import { Select } from '@/components/select-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useActiveBranch } from '@/features/branches/active-branch';
import { useAuth } from '@/features/auth/auth-provider';
import { ItemPicker, describeError } from '../purchasing/purchasing-shared';
import type { Problem } from '../purchasing/purchasing-shared';
import { useBranchOptions, useTransferMutations } from './use-transfers';

interface LineDraft {
  key: number;
  item: Item | null;
  qty: string;
}

interface TransferFormDialogProps {
  onClose: () => void;
  onSaved: (message: string) => void;
}

export function TransferFormDialog({ onClose, onSaved }: TransferFormDialogProps) {
  const { user } = useAuth();
  const active = useActiveBranch();
  const branches = useBranchOptions();
  const { create } = useTransferMutations();
  const mine = user?.branches ?? [];
  const onlyMine = mine.length === 1 ? mine[0]?.id : undefined;
  const [toBranchId, setToBranchId] = useState(active ?? onlyMine ?? '');
  const [fromBranchId, setFromBranchId] = useState('');
  const [note, setNote] = useState('');
  const [lines, setLines] = useState<LineDraft[]>([{ key: 0, item: null, qty: '' }]);
  const [nextKey, setNextKey] = useState(1);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<Problem | null>(null);
  const all = branches.data ?? [];
  const receiving = user?.isSuperAdmin ? all : mine;
  const change = (key: number, patch: Partial<LineDraft>) =>
    setLines((previous) =>
      previous.map((line) => (line.key === key ? { ...line, ...patch } : line)),
    );

  const submit = async () => {
    setProblem(null);
    const request = {
      fromBranchId,
      toBranchId,
      ...(note.trim() ? { note: note.trim() } : {}),
      lines: lines.map((line) => ({
        itemId: line.item?.id ?? '',
        qty: line.qty.trim() === '' ? Number.NaN : Number(line.qty),
      })),
    };
    const parsed = CreateTransferRequestSchema.safeParse(request);
    const found: Record<string, string> = {};
    if (!parsed.success)
      for (const issue of parsed.error.issues) {
        const key =
          issue.path[0] === 'lines' && typeof issue.path[1] === 'number'
            ? `line${issue.path[1]}.${String(issue.path[2])}`
            : String(issue.path[0]);
        found[key] ??= issue.message;
      }
    setErrors(found);
    if (!parsed.success) return;
    try {
      const saved = await create.mutateAsync(parsed.data);
      onSaved(`Transfer ${saved.transferNo} requested from ${saved.fromBranchCode}`);
    } catch (error) {
      const described = describeError(error);
      setProblem(described);
      setErrors((previous) => ({ ...previous, ...described.fields }));
    }
  };

  return (
    <Dialog open onOpenChange={(next) => (next || create.isPending ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogTitle>Ask another branch for stock</DialogTitle>
        <DialogDescription>
          The branch that holds the stock approves the request and sends it. Nothing moves until it
          is sent.
        </DialogDescription>
        <form
          noValidate
          className="mt-4 space-y-4"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          {problem ? (
            <Alert tone="error">
              <p>{problem.message}</p>
              {problem.reasons.length > 0 ? (
                <ul className="mt-1 list-disc pl-5">
                  {problem.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              ) : null}
            </Alert>
          ) : null}
          <div className="flex justify-between">
            <FormField label="Receiving branch" error={errors.toBranchId}>
              {(props) => (
                <Select
                  {...props}
                  value={toBranchId}
                  onChange={(event) => setToBranchId(event.target.value)}
                >
                  <option value="">Choose your branch</option>
                  {receiving.map((branch) => (
                    <option key={branch.id} value={branch.id}>
                      {branch.code} · {branch.name}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField label="Take stock from" error={errors.fromBranchId}>
              {(props) => (
                <Select
                  {...props}
                  value={fromBranchId}
                  onChange={(event) => setFromBranchId(event.target.value)}
                >
                  <option value="">Choose the branch that has it</option>
                  {all
                    .filter((branch) => branch.id !== toBranchId)
                    .map((branch) => (
                      <option key={branch.id} value={branch.id}>
                        {branch.code} · {branch.name}
                      </option>
                    ))}
                </Select>
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
              className="space-y-2 rounded-md border p-3"
            >
              <legend className="px-1 text-sm font-medium">Item {index + 1}</legend>
              <div className="flex justify-between gap-x-5">
                <ItemPicker
                  label={`Item`}
                  value={line.item}
                  onChange={(item) => change(line.key, { item })}
                  error={errors[`line${index}.itemId`]}
                />
                <FormField label={`Quantity`} error={errors[`line${index}.qty`]}>
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
                {lines.length > 1 ? (
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="m-7"
                    aria-label={`Remove ${index + 1}`}
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
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setLines((previous) => [...previous, { key: nextKey, item: null, qty: '' }]);
              setNextKey(nextKey + 1);
            }}
          >
            Add a line
          </Button>
          <FormField label="Note" hint="Optional" error={errors.note}>
            {(props) => (
              <Input
                {...props}
                autoComplete="off"
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            )}
          </FormField>
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={onClose} disabled={create.isPending}>
              Cancel
            </Button>
            <Button type="submit" disabled={create.isPending}>
              {create.isPending ? 'Sending…' : 'Send request'}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
