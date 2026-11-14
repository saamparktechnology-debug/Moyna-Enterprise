import { useState } from 'react';
import {
  CreateDuePromiseRequestSchema,
  KYC_MAX_BYTES,
  SetGuarantorRequestSchema,
  todayInIndia,
} from '@erp/contracts';
import type { Guarantor } from '@erp/contracts';
import { Can } from '@/components/can';
import { FormDialog } from '@/components/form-dialog';
import { FormField, Input } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { describeError } from '../purchasing/purchasing-shared';
import type { Problem } from '../purchasing/purchasing-shared';
import { ProblemAlert } from './payments-shared';
import { useDueFollowup, useDueFollowupMutations } from './use-payments';

interface Props {
  invoiceId: string;
  invoiceNo: string;
  customerName: string;
  onClose: () => void;
  onSaved: (message: string) => void;
}

/** Notes when the customer promised to pay, and who stands guarantor (with an optional KYC file) for an invoice that is not paid. */
export function DueFollowupDialog(props: Props) {
  const { guarantor } = useDueFollowup(props.invoiceId);
  // The form starts from what is on record, so it opens only once that has loaded.
  if (!guarantor.data)
    return (
      <FormDialog
        open
        size="lg"
        title={`Follow up ${props.invoiceNo}`}
        onClose={props.onClose}
        onSubmit={() => undefined}
        submitLabel="Save"
        submitDisabled
      >
        <p role="status" className="text-sm text-muted-foreground">
          {guarantor.isError ? 'Could not load the follow-up.' : 'Loading…'}
        </p>
      </FormDialog>
    );
  return <DueFollowupForm {...props} current={guarantor.data.guarantor} />;
}

function DueFollowupForm({
  invoiceId,
  invoiceNo,
  customerName,
  onClose,
  onSaved,
  current,
}: Props & { current: Guarantor | null }) {
  const { promises } = useDueFollowup(invoiceId);
  const actions = useDueFollowupMutations(invoiceId);
  const [promisedDate, setPromisedDate] = useState('');
  const [note, setNote] = useState('');
  const [name, setName] = useState(current?.name ?? '');
  const [phone, setPhone] = useState(current?.phone ?? '');
  const [address, setAddress] = useState(current?.address ?? '');
  const [relation, setRelation] = useState(current?.relation ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<Problem | null>(null);
  const fail = (error: unknown) => {
    const described = describeError(error);
    setProblem(described);
    setErrors(described.fields);
  };

  const submit = async () => {
    setProblem(null);
    const found: Record<string, string> = {};
    const promise = promisedDate
      ? { promisedDate, ...(note.trim() ? { note: note.trim() } : {}) }
      : null;
    if (promise) {
      const parsed = CreateDuePromiseRequestSchema.safeParse(promise);
      if (!parsed.success)
        found['promisedDate'] = parsed.error.issues[0]?.message ?? 'Check the date';
      else if (promisedDate < todayInIndia())
        found['promisedDate'] = 'The promised date cannot be in the past';
    }
    const wantsGuarantor = name.trim() !== '' || phone.trim() !== '';
    const details = {
      name: name.trim(),
      phone: phone.trim(),
      ...(address.trim() ? { address: address.trim() } : {}),
      ...(relation.trim() ? { relation: relation.trim() } : {}),
      ...(current ? { rowVersion: current.rowVersion } : {}),
    };
    if (wantsGuarantor) {
      const parsed = SetGuarantorRequestSchema.safeParse(details);
      if (!parsed.success)
        for (const issue of parsed.error.issues) {
          const field = issue.path.join('.') || 'name';
          found[field] ??= issue.message;
        }
    }
    if (file && !wantsGuarantor && !current)
      found['file'] = 'Note the guarantor before adding a KYC file';
    if (file && file.size > KYC_MAX_BYTES) found['file'] = 'The file is larger than 5 MB';
    if (!promise && !wantsGuarantor && !file)
      found['promisedDate'] = 'Enter a promised date or the guarantor';
    setErrors(found);
    if (Object.keys(found).length > 0) return;
    try {
      if (promise) await actions.addPromise.mutateAsync(promise);
      if (wantsGuarantor) await actions.setGuarantor.mutateAsync(details);
      if (file) await actions.uploadKyc.mutateAsync(file);
      onSaved(`Follow-up saved for ${invoiceNo}`);
    } catch (error) {
      fail(error);
    }
  };

  const saving =
    actions.addPromise.isPending || actions.setGuarantor.isPending || actions.uploadKyc.isPending;
  const removing = async (action: () => Promise<unknown>) => {
    setProblem(null);
    try {
      await action();
    } catch (error) {
      fail(error);
    }
  };

  return (
    <FormDialog
      open
      size="lg"
      title={`Follow up ${invoiceNo}`}
      description={`${customerName} · promised date and guarantor`}
      onClose={onClose}
      onSubmit={submit}
      saving={saving}
      savingLabel="Saving…"
      submitLabel="Save"
      error={problem ? <ProblemAlert problem={problem} /> : undefined}
    >
      <section aria-label="Promised date" className="space-y-3">
        <h3 className="text-sm font-semibold">Promised date</h3>
        {promises.data?.items[0] ? (
          <p className="text-sm text-muted-foreground">
            Promised to pay on {promises.data.items[0].promisedDate}
            {promises.data.items[0].note ? ` · ${promises.data.items[0].note}` : ''}
          </p>
        ) : null}
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="New promised date" error={errors['promisedDate']}>
            {(props) => (
              <Input
                {...props}
                type="date"
                min={todayInIndia()}
                value={promisedDate}
                onChange={(event) => setPromisedDate(event.target.value)}
              />
            )}
          </FormField>
          <FormField label="Note" error={errors['note']} hint="Optional">
            {(props) => (
              <Input {...props} value={note} onChange={(event) => setNote(event.target.value)} />
            )}
          </FormField>
        </div>
        {(promises.data?.items.length ?? 0) > 1 ? (
          <ul className="text-xs text-muted-foreground">
            {promises.data?.items.slice(1, 6).map((item) => (
              <li key={item.id}>
                Earlier promise: {item.promisedDate} (noted {item.createdAt.slice(0, 10)})
              </li>
            ))}
          </ul>
        ) : null}
      </section>
      <section aria-label="Guarantor" className="space-y-3">
        <h3 className="text-sm font-semibold">Guarantor</h3>
        <div className="grid gap-4 sm:grid-cols-2">
          <FormField label="Guarantor name" error={errors['name']}>
            {(props) => (
              <Input {...props} value={name} onChange={(event) => setName(event.target.value)} />
            )}
          </FormField>
          <FormField label="Guarantor phone" error={errors['phone']}>
            {(props) => (
              <Input
                {...props}
                inputMode="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            )}
          </FormField>
          <FormField label="Relation" error={errors['relation']} hint="Optional">
            {(props) => (
              <Input
                {...props}
                value={relation}
                onChange={(event) => setRelation(event.target.value)}
              />
            )}
          </FormField>
          <FormField label="Address" error={errors['address']} hint="Optional">
            {(props) => (
              <Input
                {...props}
                value={address}
                onChange={(event) => setAddress(event.target.value)}
              />
            )}
          </FormField>
        </div>
        <Can permission="kyc.upload">
          <FormField
            label="KYC file"
            error={errors['file']}
            hint="Optional · PDF, JPEG or PNG up to 5 MB"
          >
            {(props) => (
              <Input
                {...props}
                type="file"
                accept="application/pdf,image/jpeg,image/png"
                onChange={(event) => setFile(event.target.files?.[0] ?? null)}
              />
            )}
          </FormField>
          {current?.kyc ? (
            <p className="flex items-center gap-2 text-sm">
              KYC file on record: {current.kyc.fileName}
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => void removing(() => actions.removeKyc.mutateAsync())}
              >
                Remove the KYC file
              </Button>
            </p>
          ) : null}
        </Can>
        {current ? (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={() =>
              void removing(async () => {
                await actions.removeGuarantor.mutateAsync();
                setName('');
                setPhone('');
                setAddress('');
                setRelation('');
              })
            }
          >
            Remove the guarantor
          </Button>
        ) : null}
      </section>
    </FormDialog>
  );
}
