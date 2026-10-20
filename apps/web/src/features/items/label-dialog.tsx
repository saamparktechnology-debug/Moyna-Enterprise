import { useState } from 'react';
import { createPortal } from 'react-dom';
import { MAX_LABELS_PER_PRINT, MAX_LABEL_COPIES } from '@erp/contracts';
import type { Item, LabelResponse } from '@erp/contracts';
import { Alert } from '@/components/alert';
import { BarcodeSvg } from '@/components/barcode/barcode-svg';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api-client';
import { useBuildLabels } from './use-items';

const PREVIEW_LIMIT = 8;

function LabelCard({ label }: { label: LabelResponse['labels'][number] }) {
  return (
    <div className="flex h-[25mm] w-[50mm] flex-col items-center justify-center overflow-hidden border border-dashed p-[1mm] text-[7pt] leading-tight print:border-0">
      <span className="max-w-full truncate font-medium">{label.name}</span>
      <BarcodeSvg value={label.barcode} className="h-[14mm] w-full" />
      <span>{label.itemCode}</span>
    </div>
  );
}

interface LabelDialogProps {
  items: Item[];
  onClose: () => void;
}

export function LabelDialog({ items, onClose }: LabelDialogProps) {
  const [copies, setCopies] = useState<Record<string, number>>({});
  const build = useBuildLabels();
  const withBarcode = items.filter((item) => item.barcodes.length > 0);
  const without = items.filter((item) => item.barcodes.length === 0);
  const copiesOf = (id: string): number => copies[id] ?? 1;
  const valid = (n: number): boolean => Number.isInteger(n) && n >= 1 && n <= MAX_LABEL_COPIES;
  const total = withBarcode.reduce((sum, item) => sum + copiesOf(item.id), 0);
  const allValid = withBarcode.every((item) => valid(copiesOf(item.id)));
  const tooMany = allValid && total > MAX_LABELS_PER_PRINT;
  const labels = build.data?.labels ?? [];

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogTitle>Print labels</DialogTitle>
        <DialogDescription>
          Labels are 50 × 25 mm. Barcodes in the EAN-13 format are drawn; any other barcode is
          printed as text.
        </DialogDescription>
        {without.length > 0 ? (
          <div className="mt-3">
            <Alert tone="info">
              No barcode yet, so no label for: {without.map((item) => item.itemCode).join(', ')}
            </Alert>
          </div>
        ) : null}
        {build.isError ? (
          <div className="mt-3">
            <Alert tone="error">
              {build.error instanceof ApiError
                ? build.error.message
                : 'Could not prepare the labels.'}
            </Alert>
          </div>
        ) : null}
        <ul className="mt-4 space-y-2">
          {withBarcode.map((item) => (
            <li key={item.id} className="flex items-center justify-between gap-3 text-sm">
              <span>
                {item.itemCode} · {item.name}
              </span>
              <Input
                aria-label={`Copies of ${item.itemCode}`}
                type="number"
                min={1}
                max={MAX_LABEL_COPIES}
                className="w-24"
                value={Number.isNaN(copiesOf(item.id)) ? '' : copiesOf(item.id)}
                onChange={(event) =>
                  setCopies({ ...copies, [item.id]: event.target.valueAsNumber })
                }
              />
            </li>
          ))}
        </ul>
        {tooMany ? (
          <p role="alert" className="mt-2 text-sm text-destructive">
            Print at most {MAX_LABELS_PER_PRINT} labels at a time.
          </p>
        ) : null}

        {labels.length > 0 ? (
          <>
            <div className="mt-4 flex flex-wrap gap-2" aria-label="Label preview">
              {labels.slice(0, PREVIEW_LIMIT).map((label, index) => (
                <LabelCard key={`${label.itemId}-${index}`} label={label} />
              ))}
            </div>
            {labels.length > PREVIEW_LIMIT ? (
              <p className="mt-2 text-sm text-muted-foreground">
                and {labels.length - PREVIEW_LIMIT} more in the print run
              </p>
            ) : null}
            {createPortal(
              <div className="label-print-root">
                {labels.map((label, index) => (
                  <LabelCard key={`${label.itemId}-${index}`} label={label} />
                ))}
              </div>,
              document.body,
            )}
          </>
        ) : null}

        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={build.isPending || withBarcode.length === 0 || !allValid || tooMany}
            onClick={() =>
              build.mutate({
                items: withBarcode.map((item) => ({ itemId: item.id, copies: copiesOf(item.id) })),
              })
            }
          >
            {build.isPending ? 'Preparing…' : 'Prepare labels'}
          </Button>
          <Button type="button" disabled={labels.length === 0} onClick={() => window.print()}>
            Print
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
