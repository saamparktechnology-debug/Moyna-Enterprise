import { useState } from 'react';
import type { User } from '@erp/contracts';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { ApiError } from '@/lib/api-client';
import { useUserMutations } from './use-users';

export type StatusAction = 'deactivate' | 'reactivate' | 'reset';

interface UserStatusDialogProps {
  target: { user: User; action: StatusAction } | null;
  onClose: () => void;
  onDone: (user: User, action: StatusAction, temporaryPassword?: string) => void;
}

const COPY: Record<StatusAction, { title: string; body: string; button: string }> = {
  deactivate: {
    title: 'Deactivate',
    body: 'They are signed out everywhere straight away and cannot sign in. Their history is kept. You can reactivate them later.',
    button: 'Deactivate',
  },
  reactivate: {
    title: 'Reactivate',
    body: 'They can sign in again with their existing password.',
    button: 'Reactivate',
  },
  reset: {
    title: 'Reset the password of',
    body: 'They are signed out everywhere and get a temporary password that they must change at their next sign-in.',
    button: 'Reset password',
  },
};

export function UserStatusDialog({ target, onClose, onDone }: UserStatusDialogProps) {
  const { setActive, resetPassword } = useUserMutations();
  const [problem, setProblem] = useState<string | null>(null);
  const pending = setActive.isPending || resetPassword.isPending;

  const confirm = async () => {
    if (!target) return;
    setProblem(null);
    try {
      if (target.action === 'reset') {
        const { temporaryPassword } = await resetPassword.mutateAsync(target.user.id);
        onDone(target.user, 'reset', temporaryPassword);
      } else {
        const updated = await setActive.mutateAsync({
          id: target.user.id,
          active: target.action === 'reactivate',
        });
        onDone(updated, target.action);
      }
    } catch (error) {
      setProblem(error instanceof ApiError ? error.message : 'Something went wrong. Try again.');
    }
  };

  const copy = target ? COPY[target.action] : null;
  return (
    <ConfirmDialog
      open={target !== null}
      title={`${copy?.title ?? ''} ${target?.user.fullName ?? ''}?`}
      description={copy?.body ?? ''}
      confirmLabel={copy?.button ?? 'Confirm'}
      tone={target?.action === 'deactivate' ? 'destructive' : 'default'}
      pending={pending}
      problem={problem ? { message: problem } : null}
      onConfirm={confirm}
      onClose={onClose}
    />
  );
}
