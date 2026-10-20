import { useState } from 'react';
import { ReceiveGoodsRequestSchema } from '@erp/contracts';
import type { Item, PurchaseOrder, PurchaseOrderLine } from '@erp/contracts';
import { FormDialog } from '@/components/form-dialog';
import { FormField, Input } from '@/components/form-field';
import { FormSection } from '@/components/form-section';
import { Button } from '@/components/ui/button';
import { Textarea } from '@/components/ui/input';
import { ItemPicker, describeError } from './purchasing-shared';
import type { Problem } from './purchasing-shared';
import { usePurchasingMutations } from './use-purchasing';

interface LineState {
  received: string;
  damaged: string;
  noteQty: string;
  serials: string;
  damagedSerials: string;
  manufacturedOn: string;
  expiryOn: string;
  warrantyMonths: string;
}
const EMPTY_LINE: LineState = {
  received: '',
  damaged: '',
  noteQty: '',
  serials: '',
  damagedSerials: '',
  manufacturedOn: '',
  expiryOn: '',
  warrantyMonths: '',
};

interface WrongState {
  key: number;
  item: Item | null;
  qty: string;
  serials: string;
}

/** One serial number per line, or separated by commas. Blank entries are ignored. */
const splitSerials = (text: string): string[] =>
  text
    .split(/[\n,]/)
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');

interface ReceiveDialogProps {
  order: PurchaseOrder;
  onClose: () => void;
  onDone: (message: string) => void;
}

export function ReceiveDialog({ order, onClose, onDone }: ReceiveDialogProps) {
  const { receive } = usePurchasingMutations();
  const open = order.lines.filter((line) => line.remaining > 0);
  const [lines, setLines] = useState<Record<string, LineState>>({});
  const [wrong, setWrong] = useState<WrongState[]>([]);
  const [nextKey, setNextKey] = useState(0);
  const [deliveryNoteNo, setDeliveryNoteNo] = useState('');
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<Problem | null>(null);

  const stateOf = (line: PurchaseOrderLine): LineState => lines[line.id] ?? EMPTY_LINE;
  const change = (line: PurchaseOrderLine, patch: Partial<LineState>) =>
    setLines((previous) => ({ ...previous, [line.id]: { ...stateOf(line), ...patch } }));
  const changeWrong = (key: number, patch: Partial<WrongState>) =>
    setWrong((previous) =>
      previous.map((entry) => (entry.key === key ? { ...entry, ...patch } : entry)),
    );

  const build = () => {
    const found: Record<string, string> = {};
    const requestLines: object[] = [];
    const lineIds: string[] = [];
    for (const line of open) {
      const state = stateOf(line);
      const noteQty = state.noteQty.trim() === '' ? undefined : Number(state.noteQty);
      if (line.isSerialized) {
        const numbers = splitSerials(state.serials);
        if (numbers.length === 0 && noteQty === undefined) continue;
        const damaged = new Set(splitSerials(state.damagedSerials).map((no) => no.toUpperCase()));
        for (const no of damaged)
          if (!numbers.some((serial) => serial.toUpperCase() === no))
            found[`${line.id}.damagedSerials`] =
              `${no} is not in the list of serial numbers that arrived`;
        requestLines.push({
          poLineId: line.id,
          ...(noteQty === undefined ? {} : { deliveryNoteQty: noteQty }),
          serials: numbers.map((serialNo) => ({
            serialNo,
            damaged: damaged.has(serialNo.toUpperCase()),
            ...(state.manufacturedOn ? { manufacturedOn: state.manufacturedOn } : {}),
            ...(state.expiryOn ? { expiryOn: state.expiryOn } : {}),
            ...(state.warrantyMonths.trim() === ''
              ? {}
              : { warrantyMonths: Number(state.warrantyMonths) }),
          })),
        });
      } else {
        if (state.received.trim() === '' && noteQty === undefined) continue;
        requestLines.push({
          poLineId: line.id,
          received: state.received.trim() === '' ? 0 : Number(state.received),
          damaged: state.damaged.trim() === '' ? 0 : Number(state.damaged),
          ...(noteQty === undefined ? {} : { deliveryNoteQty: noteQty }),
        });
      }
      lineIds.push(line.id);
    }
    const wrongItems = wrong.map((entry) => ({
      itemId: entry.item?.id ?? '',
      qty: entry.qty.trim() === '' ? Number.NaN : Number(entry.qty),
      ...(entry.item?.isSerialized
        ? { serials: splitSerials(entry.serials).map((serialNo) => ({ serialNo })) }
        : {}),
    }));
    return {
      found,
      lineIds,
      request: {
        lines: requestLines,
        wrongItems,
        ...(deliveryNoteNo.trim() ? { deliveryNoteNo: deliveryNoteNo.trim() } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      },
    };
  };

  const submit = async () => {
    setProblem(null);
    const { found, lineIds, request } = build();
    const parsed = ReceiveGoodsRequestSchema.safeParse(request);
    if (!parsed.success)
      for (const issue of parsed.error.issues) {
        const [section, index, field] = issue.path;
        const key =
          section === 'lines' && typeof index === 'number'
            ? `${lineIds[index] ?? 'x'}.${String(field)}`
            : section === 'wrongItems' && typeof index === 'number'
              ? `wrong${wrong[index]?.key ?? index}.${String(field)}`
              : 'general';
        found[key] ??= issue.message;
      }
    setErrors(found);
    if (!parsed.success || Object.keys(found).length > 0) return;
    try {
      const receipt = await receive.mutateAsync({ id: order.id, values: parsed.data });
      const open = receipt.lines
        .flatMap((line) => line.discrepancies)
        .filter((d) => d.status === 'OPEN');
      onDone(
        `Goods receipt ${receipt.grnNo} recorded.` +
          (open.length > 0
            ? ` ${open.length} discrepanc${open.length === 1 ? 'y needs' : 'ies need'} a decision.`
            : ''),
      );
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  const dirty =
    deliveryNoteNo !== '' ||
    note !== '' ||
    wrong.length > 0 ||
    Object.values(lines).some((state) => Object.values(state).some((value) => value !== ''));
  const countOf = (text: string) => splitSerials(text).length;

  return (
    <FormDialog
      open
      size="xl"
      title={`Receive goods for ${order.poNo}`}
      description="Count what arrived. Good units go to Available stock; damaged, extra and wrong units go to Quarantine until someone decides what to do with them."
      onClose={onClose}
      onSubmit={submit}
      saving={receive.isPending}
      savingLabel="Recording…"
      dirty={dirty}
      submitLabel="Record goods receipt"
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
      {open.length === 0 ? (
        <p className="text-sm text-muted-foreground">Nothing is left to receive on this order.</p>
      ) : null}
      {open.map((line) => {
        const state = stateOf(line);
        const name = `${line.itemCode}`;
        return (
          <fieldset
            key={line.id}
            aria-label={`Receive ${name}`}
            className="space-y-3 rounded-lg border bg-muted/30 p-3"
          >
            <legend className="px-1 text-sm font-semibold">
              {line.itemCode} · {line.itemName}: {line.remaining} still to come
            </legend>
            {line.isSerialized ? (
              <>
                <div className="grid gap-3 md:grid-cols-2">
                  <FormField
                    label={`Serial numbers for ${name}`}
                    hint="One per line. A barcode scanner can fill this in."
                    error={errors[`${line.id}.serials`]}
                  >
                    {(props) => (
                      <div className="space-y-1">
                        <Textarea
                          {...props}
                          rows={4}
                          className="font-mono text-xs"
                          value={state.serials}
                          onChange={(event) => change(line, { serials: event.target.value })}
                        />
                        <p aria-live="polite" className="tabular text-xs text-muted-foreground">
                          {countOf(state.serials)} entered, {line.remaining} expected
                        </p>
                      </div>
                    )}
                  </FormField>
                  <FormField
                    label={`Damaged serial numbers for ${name}`}
                    hint="Optional. Copy the damaged ones here"
                    error={errors[`${line.id}.damagedSerials`] ?? errors[`${line.id}.damaged`]}
                  >
                    {(props) => (
                      <Textarea
                        {...props}
                        rows={4}
                        className="font-mono text-xs"
                        value={state.damagedSerials}
                        onChange={(event) => change(line, { damagedSerials: event.target.value })}
                      />
                    )}
                  </FormField>
                </div>
                <div className="grid gap-3 sm:grid-cols-3">
                  <FormField
                    label={`Manufactured on for ${name}`}
                    hint="Batteries only"
                    error={errors[`${line.id}.manufacturedOn`]}
                  >
                    {(props) => (
                      <Input
                        {...props}
                        type="date"
                        value={state.manufacturedOn}
                        onChange={(event) => change(line, { manufacturedOn: event.target.value })}
                      />
                    )}
                  </FormField>
                  <FormField
                    label={`Expires on for ${name}`}
                    hint="Batteries only"
                    error={errors[`${line.id}.expiryOn`]}
                  >
                    {(props) => (
                      <Input
                        {...props}
                        type="date"
                        value={state.expiryOn}
                        onChange={(event) => change(line, { expiryOn: event.target.value })}
                      />
                    )}
                  </FormField>
                  <FormField
                    label={`Warranty months for ${name}`}
                    hint="Batteries only"
                    error={errors[`${line.id}.warrantyMonths`]}
                  >
                    {(props) => (
                      <Input
                        {...props}
                        type="number"
                        min={0}
                        value={state.warrantyMonths}
                        onChange={(event) => change(line, { warrantyMonths: event.target.value })}
                      />
                    )}
                  </FormField>
                </div>
              </>
            ) : (
              <div className="grid gap-3 sm:grid-cols-2">
                <FormField label={`Arrived for ${name}`} error={errors[`${line.id}.received`]}>
                  {(props) => (
                    <Input
                      {...props}
                      type="number"
                      min={0}
                      value={state.received}
                      onChange={(event) => change(line, { received: event.target.value })}
                    />
                  )}
                </FormField>
                <FormField
                  label={`Damaged for ${name}`}
                  hint="How many of those arrived damaged"
                  error={errors[`${line.id}.damaged`]}
                >
                  {(props) => (
                    <Input
                      {...props}
                      type="number"
                      min={0}
                      value={state.damaged}
                      onChange={(event) => change(line, { damaged: event.target.value })}
                    />
                  )}
                </FormField>
              </div>
            )}
            <FormField
              label={`Delivery note quantity for ${name}`}
              hint="Optional. What the supplier says was sent; the difference is recorded as short"
              error={errors[`${line.id}.deliveryNoteQty`]}
            >
              {(props) => (
                <Input
                  {...props}
                  type="number"
                  min={0}
                  className="sm:max-w-48"
                  value={state.noteQty}
                  onChange={(event) => change(line, { noteQty: event.target.value })}
                />
              )}
            </FormField>
          </fieldset>
        );
      })}
      {wrong.map((entry, index) => (
        <fieldset
          key={entry.key}
          aria-label={`Wrong item ${index + 1}`}
          className="space-y-3 rounded-lg border border-warning/50 bg-warning-subtle p-3"
        >
          <legend className="px-1 text-sm font-semibold">Wrong item {index + 1}</legend>
          <ItemPicker
            label={`Item that arrived for wrong item ${index + 1}`}
            value={entry.item}
            onChange={(item) => changeWrong(entry.key, { item })}
            error={errors[`wrong${entry.key}.itemId`]}
          />
          <FormField
            label={`Quantity of wrong item ${index + 1}`}
            error={errors[`wrong${entry.key}.qty`]}
          >
            {(props) => (
              <Input
                {...props}
                type="number"
                min={1}
                className="sm:max-w-48"
                value={entry.qty}
                onChange={(event) => changeWrong(entry.key, { qty: event.target.value })}
              />
            )}
          </FormField>
          {entry.item?.isSerialized ? (
            <FormField
              label={`Serial numbers of wrong item ${index + 1}`}
              hint="One per line"
              error={errors[`wrong${entry.key}.serials`]}
            >
              {(props) => (
                <Textarea
                  {...props}
                  rows={2}
                  className="font-mono text-xs"
                  value={entry.serials}
                  onChange={(event) => changeWrong(entry.key, { serials: event.target.value })}
                />
              )}
            </FormField>
          ) : null}
          <Button
            type="button"
            variant="ghost"
            size="sm"
            aria-label={`Remove wrong item ${index + 1}`}
            onClick={() =>
              setWrong((previous) => previous.filter((candidate) => candidate.key !== entry.key))
            }
          >
            Remove
          </Button>
        </fieldset>
      ))}
      <div>
        <Button
          type="button"
          variant="secondary"
          onClick={() => {
            setWrong((previous) => [
              ...previous,
              { key: nextKey, item: null, qty: '', serials: '' },
            ]);
            setNextKey(nextKey + 1);
          }}
        >
          Something else arrived
        </Button>
      </div>
      <FormSection title="Delivery details">
        <FormField label="Delivery note number" hint="Optional" error={errors.deliveryNoteNo}>
          {(props) => (
            <Input
              {...props}
              autoComplete="off"
              value={deliveryNoteNo}
              onChange={(event) => setDeliveryNoteNo(event.target.value)}
            />
          )}
        </FormField>
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
      </FormSection>
    </FormDialog>
  );
}
