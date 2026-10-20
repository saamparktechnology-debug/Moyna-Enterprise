import { useState } from 'react';
import type { FormEvent, KeyboardEvent, ReactNode } from 'react';
import { Alert } from '@/components/alert';
import { FormActions } from '@/components/form-actions';
import { UnsavedChangesDialog } from '@/components/unsaved-changes-dialog';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

interface FormDialogProps {
  open: boolean;
  title: string;
  description?: ReactNode;
  /** Width by task: `sm` a few fields, `md` an ordinary form, `lg` sectioned, `xl` a transaction. */
  size?: 'sm' | 'md' | 'lg' | 'xl';
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void | Promise<void>;
  saving?: boolean;
  /** True once the person has changed something; closing then asks first. */
  dirty?: boolean;
  submitLabel: string;
  savingLabel?: string;
  cancelLabel?: string;
  submitDisabled?: boolean;
  /** Show the form for reading only: no Save button, and Cancel becomes Close. */
  readOnly?: boolean;
  /** A failed save, shown above the fields so the entered values stay where they are. */
  error?: ReactNode;
  /** Extra footer buttons placed before Cancel. */
  footerExtra?: ReactNode;
  children: ReactNode;
  className?: string;
}

/**
 * Create and edit in a dialog: title, description, scrolling form body and a footer that stays in view.
 * It blocks closing while saving, asks before discarding changes, saves with Ctrl/Cmd+S, and moves
 * focus to the first invalid field after a failed save. The form's own submit handler does the work.
 */
export function FormDialog({
  open,
  title,
  description,
  size = 'md',
  onClose,
  onSubmit,
  saving = false,
  dirty = false,
  submitLabel,
  savingLabel,
  cancelLabel,
  submitDisabled,
  readOnly = false,
  error,
  footerExtra,
  children,
  className,
}: FormDialogProps) {
  const [asking, setAsking] = useState(false);

  const requestClose = () => {
    if (saving) return;
    if (dirty) setAsking(true);
    else onClose();
  };

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saving) return;
    const form = event.currentTarget;
    await onSubmit(event);
    requestAnimationFrame(() => {
      const invalid = form.querySelector<HTMLElement>('[aria-invalid="true"]');
      if (invalid && document.activeElement?.getAttribute('aria-invalid') !== 'true')
        invalid.focus();
    });
  };

  const onKeyDown = (event: KeyboardEvent<HTMLFormElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      if (!saving && !submitDisabled) event.currentTarget.requestSubmit();
    }
  };

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => (next ? undefined : requestClose())}>
        <DialogContent
          size={size}
          className={cn('gap-0 overflow-hidden p-0 sm:p-0', className)}
          onInteractOutside={(event) => {
            if (saving || dirty) event.preventDefault();
          }}
        >
          <form
            onSubmit={(event) => void handleSubmit(event)}
            onKeyDown={onKeyDown}
            noValidate
            className="flex min-h-0 flex-1 flex-col"
          >
            <div className="space-y-1 px-5 pt-5 sm:px-6 sm:pt-6">
              <DialogTitle>{title}</DialogTitle>
              {description ? <DialogDescription>{description}</DialogDescription> : null}
            </div>
            <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-5 py-4 sm:px-6">
              {error ? <Alert tone="error">{error}</Alert> : null}
              {children}
            </div>
            <div className="mt-auto shrink-0 border-t bg-card px-5 py-3 sm:px-6">
              <FormActions
                onCancel={requestClose}
                saving={saving}
                submitLabel={submitLabel}
                {...(savingLabel ? { savingLabel } : {})}
                cancelLabel={readOnly ? 'Close' : (cancelLabel ?? 'Cancel')}
                hideSubmit={readOnly}
                {...(submitDisabled !== undefined ? { submitDisabled } : {})}
              >
                {footerExtra}
              </FormActions>
            </div>
          </form>
        </DialogContent>
      </Dialog>
      <UnsavedChangesDialog
        open={asking}
        onKeepEditing={() => setAsking(false)}
        onDiscard={() => {
          setAsking(false);
          onClose();
        }}
      />
    </>
  );
}
