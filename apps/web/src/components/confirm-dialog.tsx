import type { ReactNode } from 'react';
import { Alert } from '@/components/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

export interface ConfirmProblem {
  message: string;
  reasons?: readonly string[];
}

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** What will happen, in plain words: the consequence is the point of the dialog. */
  description: ReactNode;
  confirmLabel: string;
  pendingLabel?: string;
  cancelLabel?: string;
  /** Destructive actions get a red button; reversible ones do not. */
  tone?: 'default' | 'destructive';
  pending?: boolean;
  problem?: ConfirmProblem | null;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
  /** Extra content between the description and the buttons, such as a reason field. */
  children?: ReactNode;
}

/** A yes/no question before something that cannot easily be undone. Cannot be dismissed while working. */
export function ConfirmDialog({
  open,
  title,
  description,
  confirmLabel,
  pendingLabel = 'Working…',
  cancelLabel = 'Cancel',
  tone = 'default',
  pending = false,
  problem = null,
  onConfirm,
  onClose,
  children,
}: ConfirmDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => (next || pending ? undefined : onClose())}>
      <DialogContent size="sm">
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        {children ? <div className="mt-4">{children}</div> : null}
        {problem ? (
          <div className="mt-4">
            <Alert tone="error">
              <p>{problem.message}</p>
              {problem.reasons && problem.reasons.length > 0 ? (
                <ul className="mt-1 list-disc pl-5">
                  {problem.reasons.map((reason) => (
                    <li key={reason}>{reason}</li>
                  ))}
                </ul>
              ) : null}
            </Alert>
          </div>
        ) : null}
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="secondary" onClick={onClose} disabled={pending}>
            {cancelLabel}
          </Button>
          <Button
            type="button"
            variant={tone === 'destructive' ? 'destructive' : 'default'}
            onClick={() => void onConfirm()}
            disabled={pending}
            aria-busy={pending}
          >
            {pending ? pendingLabel : confirmLabel}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
