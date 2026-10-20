import { useState } from 'react';
import type { Item } from '@erp/contracts';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { ApiError } from '@/lib/api-client';
import { useItemMutations } from './use-items';

interface ItemStatusDialogProps {
  item: Item | null;
  onClose: () => void;
  onDone: (message: string) => void;
}

export function ItemStatusDialog({ item, onClose, onDone }: ItemStatusDialogProps) {
  const { setActive } = useItemMutations();
  const [problem, setProblem] = useState<{ message: string; reasons: string[] } | null>(null);
  const activating = item ? !item.isActive : false;

  const confirm = async () => {
    if (!item) return;
    setProblem(null);
    try {
      await setActive.mutateAsync({ id: item.id, active: activating });
      onDone(`Item ${item.itemCode} ${activating ? 'reactivated' : 'deactivated'}`);
    } catch (error) {
      setProblem(
        error instanceof ApiError
          ? { message: error.message, reasons: error.details.map((detail) => detail.message) }
          : { message: 'Something went wrong. Try again.', reasons: [] },
      );
    }
  };

  return (
    <ConfirmDialog
      open={item !== null}
      title={`${activating ? 'Reactivate' : 'Deactivate'} item ${item?.itemCode ?? ''}?`}
      description={
        activating
          ? 'The item can be scanned, sold, received and moved again.'
          : 'The item can no longer be scanned, sold, received or moved. Its history is kept. You can reactivate it later.'
      }
      confirmLabel={activating ? 'Reactivate' : 'Deactivate'}
      tone={activating ? 'default' : 'destructive'}
      pending={setActive.isPending}
      problem={problem}
      onConfirm={confirm}
      onClose={onClose}
    />
  );
}
