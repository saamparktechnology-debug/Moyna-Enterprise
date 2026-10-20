import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

interface UnsavedChangesDialogProps {
  open: boolean;
  onKeepEditing: () => void;
  onDiscard: () => void;
}

/** Asked before a form with changes is closed, so nothing typed is lost by accident. */
export function UnsavedChangesDialog({
  open,
  onKeepEditing,
  onDiscard,
}: UnsavedChangesDialogProps) {
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onKeepEditing())}>
      <DialogContent role="alertdialog" size="sm">
        <DialogTitle>Discard your changes?</DialogTitle>
        <DialogDescription>
          You have changes that are not saved. If you leave now, they will be lost.
        </DialogDescription>
        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="destructive" onClick={onDiscard}>
            Discard changes
          </Button>
          <Button type="button" onClick={onKeepEditing} autoFocus>
            Keep editing
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
