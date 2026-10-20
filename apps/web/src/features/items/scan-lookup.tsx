import { useState } from 'react';
import type { FormEvent } from 'react';
import type { Item } from '@erp/contracts';
import { Alert } from '@/components/alert';
import { Input } from '@/components/ui/input';
import { Button } from '@/components/ui/button';
import { ApiError } from '@/lib/api-client';
import { useItemLookup } from './use-items';

function messageFor(error: unknown): string {
  if (error instanceof ApiError && error.code === 'NOT_FOUND')
    return 'No item has this barcode or code.';
  if (error instanceof ApiError && error.code === 'BUSINESS_RULE_VIOLATION')
    return 'This item is inactive and cannot be used.';
  return 'The lookup failed. Try again.';
}

interface ScanLookupProps {
  onOpen?: ((item: Item) => void) | undefined;
}

/** A scanner types the barcode and presses Enter, so a plain text box with a submit handler is all it needs. */
export function ScanLookup({ onOpen }: ScanLookupProps) {
  const [text, setText] = useState('');
  const lookup = useItemLookup();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const barcode = text.trim();
    if (barcode === '') return;
    lookup.mutate(barcode);
    setText('');
  };

  return (
    <section aria-label="Scan lookup" className="space-y-2 rounded-md border p-4">
      <form onSubmit={submit} className="flex items-end gap-2">
        <label className="flex-1 space-y-1 text-sm font-medium">
          <span>Scan or type a barcode</span>
          <Input
            autoComplete="off"
            placeholder="Scan a barcode, then press Enter"
            value={text}
            onChange={(event) => setText(event.target.value)}
          />
        </label>
        <Button type="submit" variant="secondary" disabled={lookup.isPending}>
          Look up
        </Button>
      </form>
      <div aria-live="polite">
        {lookup.isPending ? <p className="text-sm text-muted-foreground">Looking up…</p> : null}
        {lookup.isError ? <Alert tone="error">{messageFor(lookup.error)}</Alert> : null}
        {lookup.isSuccess ? (
          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <p>
              <span className="font-medium">{lookup.data.itemCode}</span> · {lookup.data.name} ·{' '}
              {lookup.data.categoryName}
              {lookup.data.taxRate ? ` · GST ${lookup.data.taxRate}%` : ''}
              {lookup.data.isSerialized ? (
                <strong className="ml-2 rounded bg-muted px-2 py-0.5">
                  Serial number required
                </strong>
              ) : null}
            </p>
            {onOpen ? (
              <Button type="button" variant="ghost" size="sm" onClick={() => onOpen(lookup.data)}>
                Open item
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    </section>
  );
}
