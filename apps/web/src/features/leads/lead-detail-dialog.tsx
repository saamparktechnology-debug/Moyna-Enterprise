import { SimpleTable } from '@/components/data-table/simple-table';
import { StatusBadge } from '@/components/status-badge';
import { useState } from 'react';
import { ChangeStageRequestSchema, allowedNextStages, isOpenStage } from '@erp/contracts';
import type { Lead, LeadStageName } from '@erp/contracts';
import { FormField, Input } from '@/components/form-field';
import { Select } from '@/components/select-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/features/auth/auth-provider';
import { describeError } from '../purchasing/purchasing-shared';
import type { Problem } from '../purchasing/purchasing-shared';
import { ProblemAlert } from '../payments/payments-shared';
import { FOLLOWUP_STATUS_TEXT, STAGE_TEXT, formatWhen, localToIso } from './leads-shared';
import { useAssignees, useLead, useLeadMutations } from './use-leads';

interface Props {
  leadId: string;
  onClose: () => void;
  onEdit: (lead: Lead) => void;
  onConverted: (message: string) => void;
}

export function LeadDetailDialog({ leadId, onClose, onEdit, onConverted }: Props) {
  const { can } = useAuth();
  const query = useLead(leadId);
  const lead = query.data;
  const manage = can('leads.manage');
  const open = lead ? isOpenStage(lead.stage) : false;
  const assignees = useAssignees(Boolean(lead) && manage && open);
  const m = useLeadMutations();
  const [problem, setProblem] = useState<Problem | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [toStage, setToStage] = useState('');
  const [stageNote, setStageNote] = useState('');
  const [assignee, setAssignee] = useState<string | null>(null);
  const [noteText, setNoteText] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [dueNote, setDueNote] = useState('');
  const [converting, setConverting] = useState(false);
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const busy = Object.values(m).some((mutation) => mutation.isPending);

  const run = async (action: () => Promise<void>, clear?: () => void) => {
    setProblem(null);
    setErrors({});
    try {
      await action();
      clear?.();
    } catch (error) {
      const described = describeError(error);
      setProblem(described);
      setErrors(described.fields);
    }
  };

  const nextStages = lead ? allowedNextStages(lead.stage) : [];

  return (
    <Dialog open onOpenChange={(next) => (next || busy ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogTitle>{lead ? lead.name : 'Lead'}</DialogTitle>
        <DialogDescription>
          {lead ? `${STAGE_TEXT[lead.stage]} · ${lead.phone}` : 'Loading the lead'}
        </DialogDescription>
        {query.isPending ? (
          <p role="status" className="mt-4 text-sm text-muted-foreground">
            Loading the lead…
          </p>
        ) : query.isError || !lead ? (
          <div role="alert" className="mt-4 flex items-center gap-3 text-destructive">
            <p>Could not load the lead.</p>
            <Button variant="secondary" size="sm" onClick={() => void query.refetch()}>
              Retry
            </Button>
          </div>
        ) : (
          <>
            {problem ? (
              <div className="mt-3">
                <ProblemAlert problem={problem} />
              </div>
            ) : null}
            <dl className="mt-4 grid gap-x-6 gap-y-1 text-sm sm:grid-cols-2">
              <dt className="text-muted-foreground">Came from</dt>
              <dd>{lead.sourceName}</dd>
              <dt className="text-muted-foreground">What they want</dt>
              <dd>{lead.interest ?? '—'}</dd>
              <dt className="text-muted-foreground">Looked after by</dt>
              <dd>{lead.assignedToName ?? 'Nobody yet'}</dd>
              <dt className="text-muted-foreground">Branch</dt>
              <dd>{lead.branchCode}</dd>
              {lead.customerName ? (
                <>
                  <dt className="text-muted-foreground">Customer</dt>
                  <dd>{lead.customerName}</dd>
                </>
              ) : null}
            </dl>

            {manage && open ? (
              <div className="mt-4 flex flex-wrap gap-2">
                <Button variant="secondary" size="sm" onClick={() => onEdit(lead)}>
                  Edit details
                </Button>
                <Button size="sm" onClick={() => setConverting((value) => !value)}>
                  Convert to customer
                </Button>
              </div>
            ) : null}

            {converting && manage && open ? (
              <div className="mt-3 space-y-3 rounded-md border p-3">
                <p className="text-sm text-muted-foreground">
                  A customer is made from this lead. If someone already has this phone number, they
                  are linked instead of being added twice.
                </p>
                <div className="grid gap-3 sm:grid-cols-2">
                  <FormField label="Customer email" error={errors['email']}>
                    {(props) => (
                      <Input
                        {...props}
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                      />
                    )}
                  </FormField>
                  <FormField label="Customer address" error={errors['address']}>
                    {(props) => (
                      <Input
                        {...props}
                        value={address}
                        onChange={(event) => setAddress(event.target.value)}
                      />
                    )}
                  </FormField>
                </div>
                <Button
                  size="sm"
                  disabled={busy}
                  onClick={() =>
                    void run(async () => {
                      const result = await m.convert.mutateAsync({
                        id: lead.id,
                        values: {
                          rowVersion: lead.rowVersion,
                          ...(email.trim() ? { email: email.trim() } : {}),
                          ...(address.trim() ? { address: address.trim() } : {}),
                        },
                      });
                      onConverted(
                        result.customerCreated
                          ? `${result.customerName} is now a customer`
                          : `${lead.name} was linked to the existing customer ${result.customerName}`,
                      );
                    })
                  }
                >
                  {m.convert.isPending ? 'Converting…' : 'Convert'}
                </Button>
              </div>
            ) : null}

            {manage && nextStages.length > 0 ? (
              <fieldset className="mt-4 grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
                <legend className="mb-2 text-sm font-medium">
                  {lead.stage === 'LOST' ? 'Reopen this lead' : 'Move to another stage'}
                </legend>
                <FormField label="New stage" error={errors['stage']}>
                  {(props) => (
                    <Select
                      {...props}
                      value={toStage}
                      onChange={(event) => setToStage(event.target.value)}
                    >
                      <option value="">Choose a stage</option>
                      {nextStages.map((stage) => (
                        <option key={stage} value={stage}>
                          {STAGE_TEXT[stage]}
                        </option>
                      ))}
                    </Select>
                  )}
                </FormField>
                <FormField
                  label="Reason or note"
                  error={errors['note']}
                  hint={toStage === 'LOST' ? 'A reason is needed to lose a lead' : undefined}
                >
                  {(props) => (
                    <Input
                      {...props}
                      value={stageNote}
                      onChange={(event) => setStageNote(event.target.value)}
                    />
                  )}
                </FormField>
                <Button
                  disabled={busy || toStage === ''}
                  onClick={() => {
                    const request = {
                      stage: toStage as Exclude<LeadStageName, 'WON'>,
                      rowVersion: lead.rowVersion,
                      ...(stageNote.trim() ? { note: stageNote.trim() } : {}),
                    };
                    const parsed = ChangeStageRequestSchema.safeParse(request);
                    if (!parsed.success) {
                      setErrors({ note: parsed.error.issues[0]?.message ?? 'Check the note' });
                      return;
                    }
                    void run(
                      async () =>
                        void (await m.stage.mutateAsync({ id: lead.id, values: request })),
                      () => {
                        setToStage('');
                        setStageNote('');
                      },
                    );
                  }}
                >
                  {m.stage.isPending ? 'Moving…' : 'Move'}
                </Button>
              </fieldset>
            ) : null}

            {manage && open ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <FormField label="Look after this lead">
                  {(props) => (
                    <Select
                      {...props}
                      value={assignee ?? lead.assignedTo ?? ''}
                      onChange={(event) => setAssignee(event.target.value)}
                    >
                      <option value="">Nobody</option>
                      {(assignees.data ?? []).map((person) => (
                        <option key={person.id} value={person.id}>
                          {person.fullName}
                        </option>
                      ))}
                    </Select>
                  )}
                </FormField>
                <Button
                  variant="secondary"
                  disabled={busy || (assignee ?? lead.assignedTo ?? '') === (lead.assignedTo ?? '')}
                  onClick={() =>
                    void run(
                      async () =>
                        void (await m.assign.mutateAsync({
                          id: lead.id,
                          values: {
                            assignedTo: (assignee ?? '') === '' ? null : assignee,
                            rowVersion: lead.rowVersion,
                          },
                        })),
                      () => setAssignee(null),
                    )
                  }
                >
                  Assign
                </Button>
              </div>
            ) : null}

            <h3 className="mt-6 text-sm font-semibold">Follow-ups</h3>
            {lead.followups.length > 0 ? (
              <SimpleTable
                label="Follow-ups"
                rows={lead.followups}
                getRowKey={(followup) => followup.id}
                className="mt-2"
                columns={[
                  { header: 'Due', cell: (followup) => formatWhen(followup.dueAt) },
                  {
                    header: 'Note',
                    cell: (followup) => (
                      <>
                        {followup.note ?? '—'}
                        {followup.completionNote ? (
                          <span className="block text-xs text-muted-foreground">
                            Result: {followup.completionNote}
                          </span>
                        ) : null}
                      </>
                    ),
                  },
                  {
                    header: 'Status',
                    cell: (followup) => (
                      <StatusBadge
                        status={followup.status}
                        label={FOLLOWUP_STATUS_TEXT[followup.status]}
                      />
                    ),
                  },
                  {
                    header: <span className="sr-only">Actions</span>,
                    align: 'right',
                    cell: (followup) =>
                      manage && followup.status !== 'COMPLETED' ? (
                        <Button
                          variant="ghost"
                          size="sm"
                          disabled={busy}
                          aria-label={`Mark the follow-up of ${formatWhen(followup.dueAt)} done`}
                          onClick={() =>
                            void run(
                              async () =>
                                void (await m.complete.mutateAsync({
                                  id: followup.id,
                                  values: {},
                                })),
                            )
                          }
                        >
                          Mark done
                        </Button>
                      ) : null,
                  },
                ]}
              />
            ) : (
              <p className="mt-1 text-sm text-muted-foreground">No follow-up has been planned.</p>
            )}
            {manage && open ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-[1fr_2fr_auto] sm:items-end">
                <FormField label="Follow up on" error={errors['dueAt']}>
                  {(props) => (
                    <Input
                      {...props}
                      type="datetime-local"
                      value={dueAt}
                      onChange={(event) => setDueAt(event.target.value)}
                    />
                  )}
                </FormField>
                <FormField label="What to do" error={errors['followupNote']}>
                  {(props) => (
                    <Input
                      {...props}
                      value={dueNote}
                      onChange={(event) => setDueNote(event.target.value)}
                    />
                  )}
                </FormField>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    if (dueAt === '') {
                      setErrors({ dueAt: 'Choose the date and time' });
                      return;
                    }
                    void run(
                      async () =>
                        void (await m.schedule.mutateAsync({
                          id: lead.id,
                          values: {
                            dueAt: localToIso(dueAt),
                            ...(dueNote.trim() ? { note: dueNote.trim() } : {}),
                          },
                        })),
                      () => {
                        setDueAt('');
                        setDueNote('');
                      },
                    );
                  }}
                >
                  Plan follow-up
                </Button>
              </div>
            ) : null}

            <h3 className="mt-6 text-sm font-semibold">History and notes</h3>
            {manage ? (
              <div className="mt-2 grid gap-3 sm:grid-cols-[1fr_auto] sm:items-end">
                <FormField label="Add a note" error={errors['body']}>
                  {(props) => (
                    <Input
                      {...props}
                      value={noteText}
                      onChange={(event) => setNoteText(event.target.value)}
                    />
                  )}
                </FormField>
                <Button
                  variant="secondary"
                  disabled={busy}
                  onClick={() => {
                    if (noteText.trim() === '') {
                      setErrors({ body: 'Write something' });
                      return;
                    }
                    void run(
                      async () =>
                        void (await m.note.mutateAsync({
                          id: lead.id,
                          values: { body: noteText.trim() },
                        })),
                      () => setNoteText(''),
                    );
                  }}
                >
                  Add note
                </Button>
              </div>
            ) : null}
            <ul aria-label="History" className="mt-3 space-y-2 text-sm">
              {lead.notes.map((note) => (
                <li key={note.id} className="rounded-md border px-3 py-2">
                  <p>{note.body}</p>
                  <p className="text-xs text-muted-foreground">
                    {note.createdByName ?? 'Unknown'} · {formatWhen(note.createdAt)}
                    {note.fromStage && note.toStage
                      ? ` · ${STAGE_TEXT[note.fromStage]} to ${STAGE_TEXT[note.toStage]}`
                      : ''}
                  </p>
                </li>
              ))}
              {lead.notes.length === 0 ? (
                <li className="text-muted-foreground">Nothing has been written yet.</li>
              ) : null}
            </ul>
            <div className="mt-6 flex justify-end">
              <Button type="button" variant="secondary" onClick={onClose} disabled={busy}>
                Close
              </Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
