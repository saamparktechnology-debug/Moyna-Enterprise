import { useState } from 'react';
import type { Branch } from '@erp/contracts';
import { ConfirmDialog } from '@/components/confirm-dialog';
import type { ConfirmProblem } from '@/components/confirm-dialog';
import { ApiError } from '@/lib/api-client';
import { useBranchMutations } from './use-branches';

interface BranchStatusDialogProps {
  branch: Branch | null;
  onClose: () => void;
  onDone: (message: string) => void;
}

export function BranchStatusDialog({ branch, onClose, onDone }: BranchStatusDialogProps) {
  const { setActive } = useBranchMutations();
  const [problem, setProblem] = useState<ConfirmProblem | null>(null);
  const activating = branch ? !branch.isActive : false;

  const confirm = async () => {
    if (!branch) return;
    setProblem(null);
    try {
      await setActive.mutateAsync({ id: branch.id, active: activating });
      onDone(`Branch ${branch.code} ${activating ? 'reactivated' : 'deactivated'}`);
    } catch (error) {
      setProblem(
        error instanceof ApiError
          ? { message: error.message, reasons: error.details.map((detail) => detail.message) }
          : { message: 'Something went wrong. Try again.' },
      );
    }
  };

  return (
    <ConfirmDialog
      open={branch !== null}
      title={`${activating ? 'Reactivate' : 'Deactivate'} branch ${branch?.code ?? ''}?`}
      description={
        activating
          ? 'People assigned to this branch will be able to work in it again.'
          : 'People assigned to this branch lose access to it straight away. Its records are kept. You can reactivate it later.'
      }
      confirmLabel={activating ? 'Reactivate' : 'Deactivate'}
      tone={activating ? 'default' : 'destructive'}
      pending={setActive.isPending}
      problem={problem}
      onConfirm={() => void confirm()}
      onClose={() => {
        setProblem(null);
        onClose();
      }}
    />
  );
}
