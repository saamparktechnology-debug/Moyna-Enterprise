import { useState } from 'react';
import { CreateLeadRequestSchema } from '@erp/contracts';
import type { CreateLeadRequest, Lead } from '@erp/contracts';
import { FormField, Input } from '@/components/form-field';
import { Select } from '@/components/select-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/features/auth/auth-provider';
import { BranchField, describeError, useBranchChoice } from '../purchasing/purchasing-shared';
import type { Problem } from '../purchasing/purchasing-shared';
import { ProblemAlert } from '../payments/payments-shared';
import { useAssignees, useLeadMutations, useLeadSources } from './use-leads';

interface Props {
  /** Edit this lead; leave out to start a new one. */
  lead?: Lead;
  onClose: () => void;
  onSaved: (message: string) => void;
}

export function LeadFormDialog({ lead, onClose, onSaved }: Props) {
  const { user } = useAuth();
  const { create, update } = useLeadMutations();
  const sources = useLeadSources();
  const assignees = useAssignees(!lead);
  const choice = useBranchChoice();
  const [name, setName] = useState(lead?.name ?? '');
  const [phone, setPhone] = useState(lead?.phone ?? '');
  const [source, setSource] = useState(lead?.source ?? '');
  const [interest, setInterest] = useState(lead?.interest ?? '');
  const [assignedTo, setAssignedTo] = useState(lead ? '' : (user?.id ?? ''));
  const [note, setNote] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<Problem | null>(null);
  const busy = create.isPending || update.isPending;

  const fail = (error: unknown) => {
    const described = describeError(error);
    setProblem(described);
    setErrors(described.fields);
  };

  const submit = async () => {
    setProblem(null);
    if (lead) {
      try {
        await update.mutateAsync({
          id: lead.id,
          values: {
            name: name.trim(),
            phone: phone.trim(),
            source,
            interest: interest.trim() === '' ? null : interest.trim(),
            rowVersion: lead.rowVersion,
          },
        });
        onSaved(`${name.trim()} updated`);
      } catch (error) {
        fail(error);
      }
      return;
    }
    const request: CreateLeadRequest = {
      name: name.trim(),
      phone: phone.trim(),
      source,
      interest: interest.trim() === '' ? null : interest.trim(),
      assignedTo: assignedTo === '' ? null : assignedTo,
      ...(note.trim() ? { note: note.trim() } : {}),
      ...(choice.mustChoose ? { branchId: choice.branchId } : {}),
    };
    const parsed = CreateLeadRequestSchema.safeParse(request);
    if (!parsed.success) {
      const found: Record<string, string> = {};
      for (const issue of parsed.error.issues) {
        const field = issue.path.join('.') || 'form';
        if (!found[field]) found[field] = issue.message;
      }
      setErrors(found);
      return;
    }
    setErrors({});
    try {
      await create.mutateAsync(request);
      onSaved(`Lead ${name.trim()} added`);
    } catch (error) {
      fail(error);
    }
  };

  return (
    <Dialog open onOpenChange={(next) => (next || busy ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] max-w-xl overflow-y-auto">
        <DialogTitle>{lead ? 'Edit lead' : 'New lead'}</DialogTitle>
        <DialogDescription>
          {lead ? 'Change who the lead is or what they want.' : 'Someone who may buy from us.'}
        </DialogDescription>
        {problem ? (
          <div className="mt-3">
            <ProblemAlert problem={problem} />
          </div>
        ) : null}
        <div className="mt-4 grid gap-4 sm:grid-cols-2">
          <FormField label="Name" error={errors['name']}>
            {(props) => (
              <Input {...props} value={name} onChange={(event) => setName(event.target.value)} />
            )}
          </FormField>
          <FormField label="Phone" error={errors['phone']} hint="10-digit mobile number">
            {(props) => (
              <Input
                {...props}
                inputMode="numeric"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            )}
          </FormField>
          <FormField label="Where the lead came from" error={errors['source']}>
            {(props) => (
              <Select {...props} value={source} onChange={(event) => setSource(event.target.value)}>
                <option value="">Choose a source</option>
                {(sources.data ?? []).map((item) => (
                  <option key={item.code} value={item.code}>
                    {item.name}
                  </option>
                ))}
              </Select>
            )}
          </FormField>
          {!lead ? (
            <FormField label="Assign to" error={errors['assignedTo']}>
              {(props) => (
                <Select
                  {...props}
                  value={assignedTo}
                  onChange={(event) => setAssignedTo(event.target.value)}
                >
                  <option value="">Nobody yet</option>
                  {(assignees.data ?? []).map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.fullName}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          ) : null}
          <BranchField
            choice={lead ? { ...choice, mustChoose: false } : choice}
            error={errors['branchId']}
          />
          <div className="sm:col-span-2">
            <FormField label="What they want" error={errors['interest']}>
              {(props) => (
                <Input
                  {...props}
                  value={interest}
                  onChange={(event) => setInterest(event.target.value)}
                />
              )}
            </FormField>
          </div>
          {!lead ? (
            <div className="sm:col-span-2">
              <FormField label="First note" error={errors['note']}>
                {(props) => (
                  <Input
                    {...props}
                    value={note}
                    onChange={(event) => setNote(event.target.value)}
                  />
                )}
              </FormField>
            </div>
          ) : null}
        </div>
        <div className="mt-6 flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
            Cancel
          </Button>
          <Button type="button" disabled={busy} onClick={() => void submit()}>
            {busy ? 'Saving…' : lead ? 'Save changes' : 'Add lead'}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
