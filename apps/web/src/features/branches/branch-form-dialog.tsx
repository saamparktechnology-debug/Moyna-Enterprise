import { zodResolver } from '@hookform/resolvers/zod';
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { z } from 'zod';
import { BranchCodeSchema, BranchNameSchema, StateCodeSchema, gstinProblem } from '@erp/contracts';
import type { Branch, State } from '@erp/contracts';
import { Alert } from '@/components/alert';
import { FormDialog } from '@/components/form-dialog';
import { FormField, Input } from '@/components/form-field';
import { FormSection } from '@/components/form-section';
import { Select } from '@/components/select-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { ApiError } from '@/lib/api-client';
import { useBranchMutations, useStates } from './use-branches';

const FormSchema = z
  .object({
    code: BranchCodeSchema,
    name: BranchNameSchema,
    stateCode: StateCodeSchema,
    gstin: z.string().trim().toUpperCase(),
  })
  .superRefine((values, context) => {
    if (values.gstin === '') return;
    const problem = gstinProblem(values.gstin, values.stateCode);
    if (problem) context.addIssue({ code: 'custom', path: ['gstin'], message: problem });
  });
type FormValues = z.input<typeof FormSchema>;

const FIELDS = ['code', 'name', 'stateCode', 'gstin'] as const;
type FieldName = (typeof FIELDS)[number];
const isField = (name: string): name is FieldName => (FIELDS as readonly string[]).includes(name);

interface BranchFormDialogProps {
  branch: Branch | null;
  open: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}

export function BranchFormDialog({ branch, open, onClose, onSaved }: BranchFormDialogProps) {
  const states = useStates();
  if (states.data) {
    return (
      <BranchForm
        branch={branch}
        states={states.data}
        open={open}
        onClose={onClose}
        onSaved={onSaved}
      />
    );
  }
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent size="sm">
        <DialogTitle>{branch ? `Edit branch ${branch.code}` : 'New branch'}</DialogTitle>
        <DialogDescription>{description(branch)}</DialogDescription>
        {states.isPending ? (
          <p role="status" className="mt-4 text-sm text-muted-foreground">
            Loading states…
          </p>
        ) : (
          <div className="mt-4 space-y-3">
            <Alert tone="error">Could not load the list of states.</Alert>
            <Button variant="secondary" onClick={() => void states.refetch()}>
              Retry
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}

const description = (branch: Branch | null): string =>
  branch
    ? 'The code cannot be changed because it is part of every document number.'
    : 'The code is part of every document number and cannot be changed later.';

interface BranchFormProps {
  branch: Branch | null;
  states: State[];
  open: boolean;
  onClose: () => void;
  onSaved: (message: string) => void;
}

function BranchForm({ branch, states, open, onClose, onSaved }: BranchFormProps) {
  const editing = branch !== null;
  const { create, update } = useBranchMutations();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setError,
    formState: { errors, isSubmitting, isDirty },
  } = useForm<FormValues>({
    resolver: zodResolver(FormSchema),
    defaultValues: {
      code: branch?.code ?? '',
      name: branch?.name ?? '',
      stateCode: branch?.stateCode ?? '',
      gstin: branch?.gstin ?? '',
    },
  });

  const onSubmit = handleSubmit(async (values) => {
    setServerError(null);
    const parsed = FormSchema.parse(values);
    const gstin = parsed.gstin === '' ? null : parsed.gstin;
    try {
      if (branch) {
        await update.mutateAsync({
          id: branch.id,
          values: {
            name: parsed.name,
            stateCode: parsed.stateCode,
            gstin,
            rowVersion: branch.rowVersion,
          },
        });
        onSaved(`Branch ${branch.code} saved`);
      } else {
        await create.mutateAsync({
          code: parsed.code,
          name: parsed.name,
          stateCode: parsed.stateCode,
          gstin,
        });
        onSaved(`Branch ${parsed.code} created`);
      }
    } catch (error) {
      if (!(error instanceof ApiError)) {
        setServerError('Something went wrong. Try again.');
        return;
      }
      let placed = false;
      for (const detail of error.details) {
        if (isField(detail.field)) {
          setError(detail.field, { message: detail.message });
          placed = true;
        }
      }
      if (!placed) setServerError(error.message);
    }
  });

  return (
    <FormDialog
      open={open}
      title={branch ? `Edit branch ${branch.code}` : 'New branch'}
      description={description(branch)}
      onClose={onClose}
      onSubmit={onSubmit}
      saving={isSubmitting}
      dirty={isDirty}
      submitLabel={editing ? 'Save changes' : 'Create branch'}
      error={serverError}
    >
      <FormSection columns={2}>
        <FormField
          label="Code"
          required={!editing}
          error={errors.code?.message}
          hint="2 to 4 capital letters or digits, for example KOL"
        >
          {(props) => (
            <Input {...props} disabled={editing} autoComplete="off" {...register('code')} />
          )}
        </FormField>
        <FormField label="Name" required error={errors.name?.message}>
          {(props) => <Input {...props} autoComplete="off" {...register('name')} />}
        </FormField>
        <FormField label="State" required error={errors.stateCode?.message}>
          {(props) => (
            <Select {...props} {...register('stateCode')}>
              <option value="">Choose a state</option>
              {states.map((state) => (
                <option key={state.code} value={state.code}>
                  {state.code} · {state.name}
                </option>
              ))}
            </Select>
          )}
        </FormField>
        <FormField
          label="GSTIN"
          error={errors.gstin?.message}
          hint="Optional. 15 characters, starting with the state code"
        >
          {(props) => (
            <Input {...props} autoComplete="off" className="uppercase" {...register('gstin')} />
          )}
        </FormField>
      </FormSection>
    </FormDialog>
  );
}
