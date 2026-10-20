import { useState } from 'react';
import type { StockAdjustment } from '@erp/contracts';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormField, Input } from '@/components/form-field';
import { ApiError } from '@/lib/api-client';
import { label } from './adjustment-form-dialog';
import { useAdjustmentMutations } from './use-inventory';

export type Decision = 'approve' | 'reject' | 'cancel';

export function describeAdjustment(adjustment: StockAdjustment): string {
  const what =
    adjustment.kind === 'IN'
      ? 'Add'
      : adjustment.kind === 'OUT'
        ? 'Remove'
        : adjustment.kind === 'WRITE_OFF'
          ? 'Write off'
          : 'Move';
  const unit = adjustment.serialNo ? ` ${adjustment.serialNo}` : ` ${adjustment.qty}`;
  const where =
    adjustment.kind === 'STATE_CHANGE' && adjustment.toState
      ? ` from ${label(adjustment.state)} to ${label(adjustment.toState)}`
      : ` (${label(adjustment.state)})`;
  return `${what}${unit} × ${adjustment.itemCode}${where}`;
}

interface DecisionDialogProps {
  adjustment: StockAdjustment;
  decision: Decision;
  onClose: () => void;
  onDone: (message: string) => void;
}

const TITLES: Record<Decision, string> = {
  approve: 'Approve this adjustment?',
  reject: 'Reject this adjustment?',
  cancel: 'Cancel your request?',
};
const DONE: Record<Decision, string> = {
  approve: 'Adjustment approved. The stock has been updated.',
  reject: 'Adjustment rejected. No stock moved.',
  cancel: 'Request cancelled.',
};

export function AdjustmentDecisionDialog({
  adjustment,
  decision,
  onClose,
  onDone,
}: DecisionDialogProps) {
  const { approve, reject, cancel } = useAdjustmentMutations();
  const [note, setNote] = useState('');
  const [problem, setProblem] = useState<{ message: string; reasons: string[] } | null>(null);
  const [noteError, setNoteError] = useState<string | null>(null);
  const pending = approve.isPending || reject.isPending || cancel.isPending;

  const confirm = async () => {
    setProblem(null);
    setNoteError(null);
    const base = { id: adjustment.id };
    try {
      if (decision === 'approve') {
        await approve.mutateAsync({
          ...base,
          values: {
            rowVersion: adjustment.rowVersion,
            ...(note.trim() ? { note: note.trim() } : {}),
          },
        });
      } else if (decision === 'reject') {
        if (note.trim().length < 3) {
          setNoteError('Say why it is rejected');
          return;
        }
        await reject.mutateAsync({
          ...base,
          values: { rowVersion: adjustment.rowVersion, note: note.trim() },
        });
      } else {
        await cancel.mutateAsync({ ...base, values: { rowVersion: adjustment.rowVersion } });
      }
      onDone(DONE[decision]);
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
      open
      title={TITLES[decision]}
      description={`${describeAdjustment(adjustment)}. Reason given: ${adjustment.reason}`}
      confirmLabel={
        decision === 'approve' ? 'Approve' : decision === 'reject' ? 'Reject' : 'Cancel request'
      }
      cancelLabel="Back"
      tone={decision === 'reject' ? 'destructive' : 'default'}
      pending={pending}
      problem={problem}
      onConfirm={confirm}
      onClose={onClose}
    >
      {decision !== 'cancel' ? (
        <FormField
          label={decision === 'reject' ? 'Why is it rejected?' : 'Note (optional)'}
          error={noteError ?? undefined}
        >
          {(props) => (
            <Input
              {...props}
              value={note}
              onChange={(event) => setNote(event.target.value)}
              autoComplete="off"
            />
          )}
        </FormField>
      ) : null}
    </ConfirmDialog>
  );
}
