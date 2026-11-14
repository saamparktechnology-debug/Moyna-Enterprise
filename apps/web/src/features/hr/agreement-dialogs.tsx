//apps/web/src/features/hr/agreement-dialogs.tsx
import { useState } from 'react';
import {
  AGREEMENT_PLACEHOLDERS,
  CreateAgreementRequestSchema,
  CreateAgreementTemplateRequestSchema,
  DiscardAgreementRequestSchema,
  EndAgreementRequestSchema,
  KYC_MAX_BYTES,
  STARTER_AGREEMENT_TEXT,
  UpdateAgreementRequestSchema,
  UpdateAgreementTemplateRequestSchema,
  todayInIndia,
} from '@erp/contracts';
import type { Agreement, AgreementTemplate } from '@erp/contracts';
import { SimpleTable } from '@/components/data-table/simple-table';
import { FormDialog } from '@/components/form-dialog';
import { FormField, Input } from '@/components/form-field';
import { Select } from '@/components/select-field';
import { StatusBadge } from '@/components/status-badge';
import { toast } from '@/components/toast';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { ProblemAlert } from '../payments/payments-shared';
import { describeError } from '../purchasing/purchasing-shared';
import type { Problem } from '../purchasing/purchasing-shared';
import { useAgreementMutations, useAgreementTemplates } from './use-agreements';
import { useStaffList } from './use-hr';

function fieldErrors(issues: { path: PropertyKey[]; message: string }[]): Record<string, string> {
  const found: Record<string, string> = {};
  for (const issue of issues) {
    const key = String(issue.path[0] ?? 'form');
    if (!found[key]) found[key] = issue.message;
  }
  return found;
}

/** The terms and rules as plain text, with buttons to add the details that are filled in for each employee. */
function TermsField({
  value,
  onChange,
  error,
}: {
  value: string;
  onChange: (next: string) => void;
  error: string | undefined;
}) {
  return (
    <FormField
      label="Terms and rules"
      error={error}
      hint="A blank line starts a new paragraph. The details in {{brackets}} are filled in for each employee when it is printed"
    >
      {(props) => (
        <>
          <Textarea
            {...props}
            rows={14}
            value={value}
            onChange={(event) => onChange(event.target.value)}
          />
          <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="Add a detail">
            {AGREEMENT_PLACEHOLDERS.map((entry) => (
              <Button
                key={entry.code}
                type="button"
                variant="secondary"
                size="sm"
                title={entry.label}
                onClick={() =>
                  onChange(
                    `${value}${value === '' || value.endsWith(' ') ? '' : ' '}{{${entry.code}}}`,
                  )
                }
              >
                {entry.label.split(' (')[0]}
              </Button>
            ))}
          </div>
        </>
      )}
    </FormField>
  );
}

/** Makes a draft agreement for an employee, or changes the draft. A signed agreement cannot be changed. */
export function AgreementFormDialog({
  agreement,
  onClose,
  onDone,
}: {
  agreement: Agreement | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { create, update } = useAgreementMutations();
  const people = useStaffList({ page: 1, pageSize: 100, search: '', status: '', department: '' });
  const templates = useAgreementTemplates();
  const [staffId, setStaffId] = useState('');
  const [templateId, setTemplateId] = useState('');
  const [title, setTitle] = useState(agreement?.title ?? '');
  const [effectiveFrom, setEffectiveFrom] = useState(agreement?.effectiveFrom ?? todayInIndia());
  const [body, setBody] = useState(agreement?.body ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<Problem | null>(null);
  const active = (templates.data?.items ?? []).filter((template) => template.isActive);

  const chooseTemplate = (id: string) => {
    setTemplateId(id);
    const template = active.find((row) => row.id === id);
    if (template) {
      setBody(template.body);
      if (title.trim() === '') setTitle(template.name);
    }
  };

  const submit = async () => {
    setProblem(null);
    try {
      if (agreement) {
        const values = {
          title: title.trim(),
          body: body.trim(),
          effectiveFrom,
          rowVersion: agreement.rowVersion,
        };
        const checked = UpdateAgreementRequestSchema.safeParse(values);
        if (!checked.success) return setErrors(fieldErrors(checked.error.issues));
        await update.mutateAsync({ id: agreement.id, values });
        onDone(`${agreement.agreementNo} saved`);
      } else {
        const values = {
          staffId,
          ...(templateId ? { templateId } : {}),
          ...(title.trim() ? { title: title.trim() } : {}),
          ...(body.trim() ? { body: body.trim() } : {}),
          effectiveFrom,
        };
        const checked = CreateAgreementRequestSchema.safeParse(values);
        if (!checked.success) return setErrors(fieldErrors(checked.error.issues));
        const made = await create.mutateAsync(values);
        onDone(`Agreement ${made.agreementNo} made. Print it for signing.`);
      }
      setErrors({});
    } catch (error) {
      const described = describeError(error);
      setProblem(described);
      setErrors(described.fields);
    }
  };

  return (
    <FormDialog
      open
      size="xl"
      title={agreement ? `Edit ${agreement.agreementNo}` : 'New agreement'}
      description={
        agreement
          ? 'A draft can be changed until it is signed. Once the signed copy is uploaded it is frozen.'
          : 'Make an agreement for one employee from a template, or write the terms yourself. You can edit it before it is printed.'
      }
      onClose={onClose}
      onSubmit={submit}
      saving={create.isPending || update.isPending}
      dirty={
        staffId !== '' || title !== (agreement?.title ?? '') || body !== (agreement?.body ?? '')
      }
      submitLabel={agreement ? 'Save changes' : 'Make agreement'}
      error={problem ? <ProblemAlert problem={problem} /> : undefined}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {agreement === null ? (
          <>
            <FormField label="Employee" error={errors['staffId']}>
              {(props) => (
                <Select
                  {...props}
                  value={staffId}
                  onChange={(event) => setStaffId(event.target.value)}
                >
                  <option value="">Choose the employee</option>
                  {(people.data?.items ?? []).map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.fullName} · {person.employeeCode}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
            <FormField label="Template" error={errors['templateId']}>
              {(props) => (
                <Select
                  {...props}
                  value={templateId}
                  onChange={(event) => chooseTemplate(event.target.value)}
                >
                  <option value="">I will write the terms myself</option>
                  {active.map((template) => (
                    <option key={template.id} value={template.id}>
                      {template.name}
                    </option>
                  ))}
                </Select>
              )}
            </FormField>
          </>
        ) : null}
        <FormField label="Title" error={errors['title']}>
          {(props) => (
            <Input {...props} value={title} onChange={(event) => setTitle(event.target.value)} />
          )}
        </FormField>
        <FormField label="Starts on" error={errors['effectiveFrom']}>
          {(props) => (
            <Input
              {...props}
              type="date"
              value={effectiveFrom}
              onChange={(event) => setEffectiveFrom(event.target.value)}
            />
          )}
        </FormField>
        <div className="sm:col-span-2">
          <TermsField value={body} onChange={setBody} error={errors['body']} />
        </div>
      </div>
    </FormDialog>
  );
}

/**
 * The acceptance. The agreement is printed and signed by the employee (the left side) and the Super Admin (the right side),
 * then the scan or photo of the signed paper is uploaded here.
 */
export function SignedCopyDialog({
  agreement,
  onClose,
  onDone,
}: {
  agreement: Agreement;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { uploadSigned } = useAgreementMutations();
  const [file, setFile] = useState<File | null>(null);
  const [signedOn, setSignedOn] = useState(todayInIndia());
  const [employee, setEmployee] = useState(false);
  const [admin, setAdmin] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<Problem | null>(null);

  const submit = async () => {
    setProblem(null);
    const found: Record<string, string> = {};
    if (!file) found['file'] = 'Choose the scan or photo of the signed agreement';
    else if (file.size > KYC_MAX_BYTES) found['file'] = 'The file is larger than 5 MB';
    if (!employee) found['employee'] = 'The employee must have signed it, on the left';
    if (!admin) found['admin'] = 'The Super Admin must have signed it, on the right';
    if (signedOn === '') found['signedOn'] = 'Enter the date it was signed';
    setErrors(found);
    if (Object.keys(found).length > 0 || !file) return;
    try {
      await uploadSigned.mutateAsync({
        id: agreement.id,
        file,
        values: { signedOn, rowVersion: agreement.rowVersion },
      });
      onDone(`${agreement.agreementNo} is signed`);
    } catch (error) {
      const described = describeError(error);
      setProblem(described);
      setErrors(described.fields);
    }
  };

  return (
    <FormDialog
      open
      size="md"
      title={`Upload the signed ${agreement.agreementNo}`}
      description="Upload the printed agreement after the employee (left) and the Super Admin (right) have signed it. This is the acceptance: the agreement is then frozen."
      onClose={onClose}
      onSubmit={submit}
      saving={uploadSigned.isPending}
      dirty={file !== null || employee || admin}
      submitLabel="Upload signed copy"
      error={problem ? <ProblemAlert problem={problem} /> : undefined}
    >
      <div className="grid gap-4">
        <FormField label="Signed copy" error={errors['file']} hint="A PDF, JPEG or PNG, up to 5 MB">
          {(props) => (
            <Input
              {...props}
              type="file"
              accept="application/pdf,image/jpeg,image/png"
              onChange={(event) => setFile(event.target.files?.[0] ?? null)}
            />
          )}
        </FormField>
        <FormField label="Date signed" error={errors['signedOn']}>
          {(props) => (
            <Input
              {...props}
              type="date"
              value={signedOn}
              onChange={(event) => setSignedOn(event.target.value)}
            />
          )}
        </FormField>
        <div>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={employee}
              onChange={(event) => setEmployee(event.target.checked)}
            />
            The employee has signed it (left side)
          </label>
          {errors['employee'] ? (
            <p role="alert" className="text-sm text-destructive">
              {errors['employee']}
            </p>
          ) : null}
          <label className="mt-2 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={admin}
              onChange={(event) => setAdmin(event.target.checked)}
            />
            The Super Admin has signed it (right side)
          </label>
          {errors['admin'] ? (
            <p role="alert" className="text-sm text-destructive">
              {errors['admin']}
            </p>
          ) : null}
        </div>
      </div>
    </FormDialog>
  );
}

/** Ends a signed agreement from a day, or throws a draft away. Both need a reason. */
export function ReasonDialog({
  kind,
  agreement,
  onClose,
  onDone,
}: {
  kind: 'end' | 'discard';
  agreement: Agreement;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { end, discard } = useAgreementMutations();
  const [endedOn, setEndedOn] = useState(todayInIndia());
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<Problem | null>(null);

  const submit = async () => {
    setProblem(null);
    try {
      if (kind === 'end') {
        const values = { endedOn, reason: reason.trim(), rowVersion: agreement.rowVersion };
        const checked = EndAgreementRequestSchema.safeParse(values);
        if (!checked.success) return setErrors(fieldErrors(checked.error.issues));
        await end.mutateAsync({ id: agreement.id, values });
        onDone(`${agreement.agreementNo} ended`);
      } else {
        const values = { reason: reason.trim(), rowVersion: agreement.rowVersion };
        const checked = DiscardAgreementRequestSchema.safeParse(values);
        if (!checked.success) return setErrors(fieldErrors(checked.error.issues));
        await discard.mutateAsync({ id: agreement.id, values });
        onDone(`${agreement.agreementNo} thrown away`);
      }
      setErrors({});
    } catch (error) {
      const described = describeError(error);
      setProblem(described);
      setErrors(described.fields);
    }
  };

  return (
    <FormDialog
      open
      size="md"
      title={
        kind === 'end' ? `End ${agreement.agreementNo}` : `Throw away ${agreement.agreementNo}`
      }
      description={
        kind === 'end'
          ? 'The agreement stays on record and stops being in force from the day you give.'
          : 'A draft that is not needed. It stays in the list, marked discarded.'
      }
      onClose={onClose}
      onSubmit={submit}
      saving={end.isPending || discard.isPending}
      dirty={reason !== ''}
      submitLabel={kind === 'end' ? 'End agreement' : 'Throw away'}
      error={problem ? <ProblemAlert problem={problem} /> : undefined}
    >
      <div className="grid gap-4">
        {kind === 'end' ? (
          <FormField label="Ends on" error={errors['endedOn']}>
            {(props) => (
              <Input
                {...props}
                type="date"
                value={endedOn}
                onChange={(event) => setEndedOn(event.target.value)}
              />
            )}
          </FormField>
        ) : null}
        <FormField label="Reason" error={errors['reason']}>
          {(props) => (
            <Input {...props} value={reason} onChange={(event) => setReason(event.target.value)} />
          )}
        </FormField>
      </div>
    </FormDialog>
  );
}

/** Makes or changes a template: a name and the terms and rules, kept to make agreements from. */
function TemplateFormDialog({
  template,
  onClose,
  onDone,
}: {
  template: AgreementTemplate | null;
  onClose: () => void;
  onDone: (message: string) => void;
}) {
  const { createTemplate, updateTemplate } = useAgreementMutations();
  const [name, setName] = useState(template?.name ?? '');
  const [body, setBody] = useState(template?.body ?? '');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<Problem | null>(null);

  const submit = async () => {
    setProblem(null);
    try {
      if (template) {
        const values = { name: name.trim(), body: body.trim(), rowVersion: template.rowVersion };
        const checked = UpdateAgreementTemplateRequestSchema.safeParse(values);
        if (!checked.success) return setErrors(fieldErrors(checked.error.issues));
        await updateTemplate.mutateAsync({ id: template.id, values });
        onDone(`Template ${name.trim()} saved`);
      } else {
        const values = { name: name.trim(), body: body.trim() };
        const checked = CreateAgreementTemplateRequestSchema.safeParse(values);
        if (!checked.success) return setErrors(fieldErrors(checked.error.issues));
        await createTemplate.mutateAsync(values);
        onDone(`Template ${name.trim()} added`);
      }
      setErrors({});
    } catch (error) {
      const described = describeError(error);
      setProblem(described);
      setErrors(described.fields);
    }
  };

  return (
    <FormDialog
      open
      size="xl"
      title={template ? `Edit template ${template.name}` : 'New template'}
      description="The terms and rules that agreements are made from. Changing a template does not change agreements already made."
      onClose={onClose}
      onSubmit={submit}
      saving={createTemplate.isPending || updateTemplate.isPending}
      dirty={name !== (template?.name ?? '') || body !== (template?.body ?? '')}
      submitLabel="Save template"
      error={problem ? <ProblemAlert problem={problem} /> : undefined}
    >
      <div className="grid gap-4">
        <FormField label="Name of the template" error={errors['name']}>
          {(props) => (
            <Input {...props} value={name} onChange={(event) => setName(event.target.value)} />
          )}
        </FormField>
        {template === null && body === '' ? (
          <div>
            <Button
              type="button"
              variant="secondary"
              size="sm"
              onClick={() => setBody(STARTER_AGREEMENT_TEXT)}
            >
              Start from example terms
            </Button>
            <p className="mt-1 text-xs text-muted-foreground">
              The example is only a starting point. Have your own adviser check the wording before
              you use it.
            </p>
          </div>
        ) : null}
        <TermsField value={body} onChange={setBody} error={errors['body']} />
      </div>
    </FormDialog>
  );
}

/** The templates agreements are made from: add one, edit its terms, or switch it off. */
export function TemplatesDialog({ onClose }: { onClose: () => void }) {
  const templates = useAgreementTemplates();
  const { updateTemplate } = useAgreementMutations();
  const [editing, setEditing] = useState<AgreementTemplate | 'new' | null>(null);
  const [problem, setProblem] = useState<Problem | null>(null);

  const toggle = async (template: AgreementTemplate) => {
    setProblem(null);
    try {
      await updateTemplate.mutateAsync({
        id: template.id,
        values: { isActive: !template.isActive, rowVersion: template.rowVersion },
      });
      toast.success(
        `Template ${template.name} ${template.isActive ? 'switched off' : 'switched on'}`,
      );
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogTitle>Agreement templates</DialogTitle>
        <DialogDescription>
          Keep the terms and rules you use often. An agreement is made from a template and can then
          be edited for the person.
        </DialogDescription>
        {problem ? <ProblemAlert problem={problem} /> : null}
        <div className="mt-3 flex justify-end">
          <Button onClick={() => setEditing('new')}>New template</Button>
        </div>
        <div className="mt-3">
          {(templates.data?.items.length ?? 0) === 0 ? (
            <p className="text-sm text-muted-foreground">No template yet.</p>
          ) : (
            <SimpleTable
              label="Templates"
              rows={templates.data?.items ?? []}
              getRowKey={(row) => row.id}
              columns={[
                { header: 'Name', cell: (row) => <span className="font-medium">{row.name}</span> },
                { header: 'Agreements', align: 'right', cell: (row) => row.agreementCount },
                {
                  header: 'Status',
                  cell: (row) => (
                    <StatusBadge
                      status={row.isActive ? 'ACTIVE' : 'INACTIVE'}
                      label={row.isActive ? 'In use' : 'Off'}
                    />
                  ),
                },
                {
                  header: 'Actions',
                  cell: (row) => (
                    <span className="flex gap-2">
                      <Button
                        variant="secondary"
                        size="sm"
                        aria-label={`Edit template ${row.name}`}
                        onClick={() => setEditing(row)}
                      >
                        Edit
                      </Button>
                      <Button
                        variant="secondary"
                        size="sm"
                        aria-label={`${row.isActive ? 'Switch off' : 'Switch on'} template ${row.name}`}
                        onClick={() => void toggle(row)}
                      >
                        {row.isActive ? 'Switch off' : 'Switch on'}
                      </Button>
                    </span>
                  ),
                },
              ]}
            />
          )}
        </div>
        <div className="mt-6 flex justify-end">
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
        {editing ? (
          <TemplateFormDialog
            template={editing === 'new' ? null : editing}
            onClose={() => setEditing(null)}
            onDone={(message) => {
              toast.success(message);
              setEditing(null);
            }}
          />
        ) : null}
      </DialogContent>
    </Dialog>
  );
}
