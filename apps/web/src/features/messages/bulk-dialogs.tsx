//apps/web/src/features/messages/bulk-dialogs.tsx
import { useState } from 'react';
import { CreateBulkMessageRequestSchema, MESSAGE_PLACEHOLDERS } from '@erp/contracts';
import type { Audience, BulkPreview, MessageCampaign, MessageChannel } from '@erp/contracts';
import { Alert } from '@/components/alert';
import { SimpleTable } from '@/components/data-table/simple-table';
import { FormDialog } from '@/components/form-dialog';
import { FormField, Input } from '@/components/form-field';
import { Select } from '@/components/select-field';
import { StatusBadge } from '@/components/status-badge';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { Textarea } from '@/components/ui/input';
import { useCustomers } from '../customers/use-customers';
import { ProblemAlert } from '../payments/payments-shared';
import { describeError } from '../purchasing/purchasing-shared';
import type { Problem } from '../purchasing/purchasing-shared';
import { useMessageMutations, useMessagingStatus } from './use-messages';

const VIA_LABEL: Record<string, string> = {
  TEXT: 'Message',
  DOCUMENT: 'PDF',
  TEMPLATE: 'Template',
  EMAIL: 'Email',
};

/** Sends the waiting messages of a campaign a few at a time until none are left, reporting as it goes. */
export function useCampaignSender() {
  const { send, retry } = useMessageMutations();
  const [progress, setProgress] = useState<MessageCampaign | null>(null);
  const [running, setRunning] = useState(false);
  const run = async (id: string, retryFailed = false): Promise<MessageCampaign | null> => {
    setRunning(true);
    try {
      if (retryFailed) setProgress(await retry.mutateAsync(id));
      let latest = await send.mutateAsync(id);
      setProgress(latest);
      for (let round = 0; round < 200 && latest.pending > 0; round += 1) {
        const next = await send.mutateAsync(id);
        setProgress(next);
        // A round that sent nothing and failed nothing is stuck: stop and let the person look.
        if (
          next.sent === latest.sent &&
          next.failed === latest.failed &&
          next.pending === latest.pending
        ) {
          latest = next;
          break;
        }
        latest = next;
      }
      return latest;
    } finally {
      setRunning(false);
    }
  };
  return { run, progress, running };
}

/** A campaign's progress and the people it went to. */
function ResultTable({ campaign }: { campaign: MessageCampaign }) {
  return (
    <>
      <p className="text-sm" role="status">
        {campaign.sent} sent · {campaign.failed} failed · {campaign.pending} waiting (of{' '}
        {campaign.total})
      </p>
      {(campaign.deliveries?.length ?? 0) > 0 ? (
        <SimpleTable
          label="Messages"
          rows={campaign.deliveries ?? []}
          getRowKey={(row) => row.id}
          columns={[
            { header: 'Name', cell: (row) => row.recipientName },
            { header: 'To', cell: (row) => row.toAddress },
            {
              header: 'Result',
              cell: (row) => (
                <>
                  <StatusBadge
                    status={row.status}
                    label={
                      row.status === 'SENT'
                        ? 'Sent'
                        : row.status === 'FAILED'
                          ? 'Failed'
                          : 'Waiting'
                    }
                  />
                  {row.via && row.status === 'SENT' ? (
                    <span className="block text-xs text-muted-foreground">
                      as {VIA_LABEL[row.via]}
                    </span>
                  ) : null}
                  {row.error ? (
                    <span className="block max-w-72 text-xs text-destructive">{row.error}</span>
                  ) : null}
                </>
              ),
            },
          ]}
        />
      ) : null}
    </>
  );
}

/** The people a campaign went to, with a way to send the waiting ones or the failed ones again. */
export function CampaignDialog({
  campaign,
  onClose,
}: {
  campaign: MessageCampaign;
  onClose: () => void;
}) {
  const sender = useCampaignSender();
  const shown = sender.progress ?? campaign;
  const [problem, setProblem] = useState<Problem | null>(null);
  const go = async (retryFailed: boolean) => {
    setProblem(null);
    try {
      await sender.run(campaign.id, retryFailed);
    } catch (error) {
      setProblem(describeError(error));
    }
  };
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
        <DialogTitle>
          {campaign.kind === 'BULK'
            ? 'Bulk message'
            : campaign.kind === 'INVOICE'
              ? 'Invoice sent'
              : 'Receipt sent'}
        </DialogTitle>
        <DialogDescription>
          {campaign.audience} · by {campaign.channel === 'WHATSAPP' ? 'WhatsApp' : 'email'}
        </DialogDescription>
        {campaign.subject ? <p className="mt-2 text-sm font-medium">{campaign.subject}</p> : null}
        <p className="mt-2 whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm">
          {campaign.body}
        </p>
        {problem ? <ProblemAlert problem={problem} /> : null}
        <div className="mt-3 space-y-3">
          <ResultTable campaign={shown} />
        </div>
        <div className="mt-4 flex flex-wrap justify-end gap-2">
          {shown.failed > 0 ? (
            <Button variant="secondary" disabled={sender.running} onClick={() => void go(true)}>
              Send the failed ones again
            </Button>
          ) : null}
          {shown.pending > 0 ? (
            <Button disabled={sender.running} onClick={() => void go(false)}>
              {sender.running ? 'Sending…' : 'Send the waiting ones'}
            </Button>
          ) : null}
          <Button variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

/** A small search to choose customers one by one. */
function CustomerChooser({
  chosen,
  onChange,
  error,
}: {
  chosen: Map<string, string>;
  onChange: (next: Map<string, string>) => void;
  error: string | undefined;
}) {
  const [search, setSearch] = useState('');
  const found = useCustomers({ page: 1, pageSize: 8, search, kycStatus: '' });
  return (
    <FormField label="Customers" error={error} hint={`${chosen.size} chosen`}>
      {(props) => (
        <div className="space-y-2">
          <Input
            {...props}
            value={search}
            placeholder="Search by name or phone"
            onChange={(event) => setSearch(event.target.value)}
          />
          <div
            className="max-h-40 space-y-1 overflow-y-auto rounded-md border bg-card p-2"
            role="group"
            aria-label="Customers found"
          >
            {(found.data?.items ?? []).map((customer) => (
              <label key={customer.id} className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={chosen.has(customer.id)}
                  onChange={(event) => {
                    const next = new Map(chosen);
                    if (event.target.checked) next.set(customer.id, customer.name);
                    else next.delete(customer.id);
                    onChange(next);
                  }}
                />
                {customer.name} · {customer.phone}
              </label>
            ))}
          </div>
        </div>
      )}
    </FormField>
  );
}

/** Makes a bulk message: who, what to say, and then sends it, showing how far it has got. */
export function BulkDialog({ onClose }: { onClose: () => void }) {
  const status = useMessagingStatus();
  const { create, preview } = useMessageMutations();
  const sender = useCampaignSender();
  const [channel, setChannel] = useState<MessageChannel>('WHATSAPP');
  const [kind, setKind] = useState<Audience['kind']>('DUES');
  const [chosen, setChosen] = useState<Map<string, string>>(new Map());
  const [subject, setSubject] = useState('');
  const [body, setBody] = useState('');
  const [counted, setCounted] = useState<BulkPreview | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<Problem | null>(null);
  const [made, setMade] = useState<MessageCampaign | null>(null);
  const ready =
    channel === 'WHATSAPP' ? status.data?.whatsapp.configured : status.data?.email.configured;

  const audience = (): Audience =>
    kind === 'SELECTED' ? { kind, customerIds: [...chosen.keys()] } : { kind };

  const check = async () => {
    setProblem(null);
    try {
      setCounted(await preview.mutateAsync({ channel, audience: audience() }));
    } catch (error) {
      const described = describeError(error);
      setProblem(described);
      setErrors(described.fields);
    }
  };

  const submit = async () => {
    setProblem(null);
    const values = {
      channel,
      audience: audience(),
      ...(channel === 'EMAIL' && subject.trim() ? { subject: subject.trim() } : {}),
      body: body.trim(),
    };
    const checked = CreateBulkMessageRequestSchema.safeParse(values);
    if (!checked.success) {
      setErrors(
        Object.fromEntries(checked.error.issues.map((i) => [String(i.path[0] ?? ''), i.message])),
      );
      return;
    }
    setErrors({});
    try {
      const campaign = await create.mutateAsync(values);
      setMade(campaign);
      await sender.run(campaign.id);
    } catch (error) {
      const described = describeError(error);
      setProblem(described);
      setErrors(described.fields);
    }
  };

  if (made) {
    const shown = sender.progress ?? made;
    return (
      <Dialog open onOpenChange={(next) => (next || sender.running ? undefined : onClose())}>
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogTitle>{sender.running ? 'Sending…' : 'Sent'}</DialogTitle>
          <DialogDescription>
            Each person gets their own message. Keep this open until it finishes.
          </DialogDescription>
          {problem ? <ProblemAlert problem={problem} /> : null}
          <div className="mt-3 space-y-3">
            <ResultTable campaign={shown} />
          </div>
          <div className="mt-4 flex justify-end gap-2">
            {!sender.running && shown.pending > 0 ? (
              <Button onClick={() => void sender.run(made.id)}>Send the waiting ones</Button>
            ) : null}
            <Button variant="secondary" disabled={sender.running} onClick={onClose}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    );
  }

  return (
    <FormDialog
      open
      size="xl"
      title="New bulk message"
      description="Each person gets their own ordinary message, not a broadcast. On WhatsApp a message reaches people who wrote to you in the last 24 hours; for anyone else it goes as your template, if you have one set up."
      onClose={onClose}
      onSubmit={submit}
      saving={create.isPending}
      dirty={body !== '' || chosen.size > 0}
      submitLabel="Send to everyone"
      error={problem ? <ProblemAlert problem={problem} /> : undefined}
    >
      <div className="grid gap-4 sm:grid-cols-2">
        {ready === false ? (
          <div className="sm:col-span-2">
            <Alert tone="warning">
              {channel === 'WHATSAPP'
                ? 'WhatsApp is not set up yet. Add the WhatsApp settings to the settings file first.'
                : 'Email is not set up yet. Add the email settings to the settings file first.'}
            </Alert>
          </div>
        ) : null}
        {channel === 'WHATSAPP' &&
        status.data?.whatsapp.configured &&
        !status.data.whatsapp.templates[kind === 'DUES' ? 'reminder' : 'general'] ? (
          <div className="sm:col-span-2">
            <Alert tone="info">
              {kind === 'DUES'
                ? 'No WhatsApp template is set up for reminders, so people who have not written to you in the last 24 hours cannot be reached.'
                : 'No WhatsApp template is set up for general messages, so people who have not written to you in the last 24 hours cannot be reached.'}
            </Alert>
          </div>
        ) : null}
        <FormField label="Send by" error={errors['channel']}>
          {(props) => (
            <Select
              {...props}
              value={channel}
              onChange={(event) => {
                setChannel(event.target.value as MessageChannel);
                setCounted(null);
              }}
            >
              <option value="WHATSAPP">WhatsApp</option>
              <option value="EMAIL">Email</option>
            </Select>
          )}
        </FormField>
        <FormField label="Send to" error={errors['audience']}>
          {(props) => (
            <Select
              {...props}
              value={kind}
              onChange={(event) => {
                setKind(event.target.value as Audience['kind']);
                setCounted(null);
              }}
            >
              <option value="DUES">Customers who owe money</option>
              <option value="ALL">All customers</option>
              <option value="SELECTED">Customers I choose</option>
            </Select>
          )}
        </FormField>
        {kind === 'SELECTED' ? (
          <div className="sm:col-span-2">
            <CustomerChooser
              chosen={chosen}
              onChange={(next) => {
                setChosen(next);
                setCounted(null);
              }}
              error={errors['customerIds']}
            />
          </div>
        ) : null}
        <div className="flex flex-wrap items-center gap-3 sm:col-span-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={preview.isPending}
            onClick={() => void check()}
          >
            Count who it reaches
          </Button>
          {counted ? (
            <span className="text-sm" role="status">
              It reaches {counted.count} {counted.count === 1 ? 'person' : 'people'}
              {counted.withoutContact > 0
                ? `; ${counted.withoutContact} more have no ${channel === 'WHATSAPP' ? 'phone number' : 'email address'}`
                : ''}
              {counted.optedOut > 0 ? `; ${counted.optedOut} have opted out and are left out` : ''}
              {counted.sampleNames.length > 0 ? ` (${counted.sampleNames.join(', ')}…)` : ''}
            </span>
          ) : null}
        </div>
        {channel === 'EMAIL' ? (
          <div className="sm:col-span-2">
            <FormField label="Subject" error={errors['subject']}>
              {(props) => (
                <Input
                  {...props}
                  value={subject}
                  onChange={(event) => setSubject(event.target.value)}
                />
              )}
            </FormField>
          </div>
        ) : null}
        <div className="sm:col-span-2">
          <FormField
            label="Message"
            error={errors['body']}
            hint="The details in {{brackets}} are filled in for each person"
          >
            {(props) => (
              <>
                <Textarea
                  {...props}
                  rows={6}
                  value={body}
                  onChange={(event) => setBody(event.target.value)}
                />
                <div className="mt-2 flex flex-wrap gap-1" role="group" aria-label="Add a detail">
                  {MESSAGE_PLACEHOLDERS.map((entry) => (
                    <Button
                      key={entry.code}
                      type="button"
                      variant="secondary"
                      size="sm"
                      title={entry.label}
                      onClick={() =>
                        setBody(
                          `${body}${body === '' || body.endsWith(' ') ? '' : ' '}{{${entry.code}}}`,
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
        </div>
      </div>
    </FormDialog>
  );
}
