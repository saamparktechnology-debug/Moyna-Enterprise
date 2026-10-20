import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface FormActionsProps {
  onCancel?: (() => void) | undefined;
  /** True while the request is in flight: both buttons are disabled, so nothing is sent twice. */
  saving?: boolean;
  submitLabel: string;
  savingLabel?: string;
  cancelLabel?: string;
  submitDisabled?: boolean;
  submitVariant?: 'default' | 'destructive';
  /** A view-only form: no Save button. */
  hideSubmit?: boolean;
  /** Extra buttons placed before Cancel (for example "Save and add another"). */
  children?: ReactNode;
  className?: string;
}

/** Cancel and Save, always in the same places: Save last and on the right, stacked on a phone. */
export function FormActions({
  onCancel,
  saving = false,
  submitLabel,
  savingLabel = 'Saving…',
  cancelLabel = 'Cancel',
  submitDisabled = false,
  submitVariant = 'default',
  hideSubmit = false,
  children,
  className,
}: FormActionsProps) {
  return (
    <div className={cn('flex flex-col-reverse gap-2 sm:flex-row sm:justify-end', className)}>
      {children}
      {onCancel ? (
        <Button type="button" variant="secondary" onClick={onCancel} disabled={saving}>
          {cancelLabel}
        </Button>
      ) : null}
      {hideSubmit ? null : (
        <Button
          type="submit"
          variant={submitVariant}
          disabled={saving || submitDisabled}
          aria-busy={saving}
        >
          {saving ? savingLabel : submitLabel}
        </Button>
      )}
    </div>
  );
}
