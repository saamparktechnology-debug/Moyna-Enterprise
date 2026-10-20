import { ScanLine } from 'lucide-react';
import { useId, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

export type BarcodeFeedback = { tone: 'success' | 'error'; message: string } | null;

interface BarcodeInputProps {
  label: string;
  /** Called with the trimmed code when Enter is pressed (a scanner sends it) or Look up is used. */
  onScan: (code: string) => void;
  /** The result of the last lookup, announced politely; the field keeps focus either way. */
  feedback?: BarcodeFeedback;
  busy?: boolean;
  placeholder?: string;
  autoFocus?: boolean;
  /** Extra content beside the field, for example a camera button when the device supports one. */
  trailing?: ReactNode;
  className?: string;
}

/**
 * Made for keyboard-wedge scanners, which type the code and press Enter like a keyboard. The field is
 * a plain text input (so no on-screen keyboard is forced open), it clears after each scan so the next
 * code can follow at once, and it keeps focus so nothing has to be clicked in between. A person can
 * always type the code and press Enter or use the Look up button instead.
 */
export function BarcodeInput({
  label,
  onScan,
  feedback = null,
  busy = false,
  placeholder = 'Scan a barcode, then press Enter',
  autoFocus,
  trailing,
  className,
}: BarcodeInputProps) {
  const [text, setText] = useState('');
  const field = useRef<HTMLInputElement>(null);
  const statusId = useId();

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const code = text.trim();
    if (code === '' || busy) return;
    onScan(code);
    setText('');
    field.current?.focus();
  };

  return (
    <form onSubmit={submit} className={cn('space-y-1.5', className)}>
      <label className="block text-sm font-medium">
        {label}
        <div className="mt-1.5 flex gap-2">
          <div className="relative flex-1">
            <ScanLine
              className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              aria-hidden="true"
            />
            <Input
              ref={field}
              value={text}
              autoFocus={autoFocus}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              enterKeyHint="go"
              placeholder={placeholder}
              aria-describedby={statusId}
              className="pl-8 font-mono"
              onChange={(event) => setText(event.target.value)}
            />
          </div>
          <Button type="submit" variant="secondary" disabled={busy}>
            Look up
          </Button>
          {trailing}
        </div>
      </label>
      <div id={statusId} aria-live="polite" className="min-h-5 text-sm">
        {busy ? (
          <span className="text-muted-foreground">Looking up…</span>
        ) : feedback ? (
          <span className={feedback.tone === 'error' ? 'text-destructive' : 'text-success'}>
            {feedback.message}
          </span>
        ) : null}
      </div>
    </form>
  );
}
