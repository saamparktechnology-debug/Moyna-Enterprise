import { useState } from 'react';
import { Alert } from '@/components/alert';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';

export interface IssuedPassword {
  username: string;
  password: string;
  reason: 'created' | 'reset';
}

interface TemporaryPasswordDialogProps {
  issued: IssuedPassword | null;
  onClose: () => void;
}

export function TemporaryPasswordDialog({ issued, onClose }: TemporaryPasswordDialogProps) {
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null);

  const copy = async () => {
    if (!issued) return;
    try {
      await navigator.clipboard.writeText(issued.password);
      setCopied('yes');
    } catch {
      setCopied('no');
    }
  };

  return (
    <Dialog open={issued !== null} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogTitle>
          {issued?.reason === 'created' ? 'Account created' : 'Password reset'}
        </DialogTitle>
        <DialogDescription>
          Give this temporary password to {issued?.username} in person or by phone. It is shown only
          once and cannot be looked up later. They must choose their own password the first time
          they sign in.
        </DialogDescription>
        <div className="mt-4 space-y-3">
          <p className="text-sm font-medium">Temporary password</p>
          <p
            aria-label="Temporary password"
            className="select-all rounded-md border bg-muted px-3 py-2 font-mono text-lg tracking-wider"
          >
            {issued?.password}
          </p>
          {copied === 'yes' ? <Alert tone="success">Copied to the clipboard.</Alert> : null}
          {copied === 'no' ? (
            <Alert>Could not copy automatically. Select the password and copy it yourself.</Alert>
          ) : null}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={() => void copy()}>
            Copy
          </Button>
          <Button type="button" onClick={onClose}>
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
