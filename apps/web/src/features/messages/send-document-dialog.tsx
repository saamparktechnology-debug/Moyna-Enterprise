//apps/web/src/features/messages/send-document-dialog.tsx
import { useState } from 'react';
import { SendDocumentRequestSchema } from '@erp/contracts';
import type { MessageCampaign, MessageChannel } from '@erp/contracts';
import { Alert } from '@/components/alert';
import { FormDialog } from '@/components/form-dialog';
import { FormField, Input } from '@/components/form-field';
import { Select } from '@/components/select-field';
import { Textarea } from '@/components/ui/input';
import { ProblemAlert } from '../payments/payments-shared';
import { describeError } from '../purchasing/purchasing-shared';
import type { Problem } from '../purchasing/purchasing-shared';
import { useMessageMutations, useMessagingStatus } from './use-messages';

const VIA_TEXT: Record<string, string> = {
  DOCUMENT: 'Sent on WhatsApp with the PDF attached.',
  TEMPLATE:
    'Sent on WhatsApp as a template message. The PDF is not attached, because the customer has not written to you in the last 24 hours. Once they reply, send it again.',
  EMAIL: 'Sent by email with the PDF attached.',
  TEXT: 'Sent on WhatsApp.',
};

/** Sends an invoice or a receipt to the customer as a PDF, by WhatsApp or email, and says how it went. */
export function SendDocumentDialog({
  kind,
  id,
  label,
  onClose,
}: {
  kind: 'INVOICE' | 'RECEIPT';
  id: string;
  /** The invoice or receipt number, for the title. */
  label: string;
  onClose: () => void;
}) {
  const status = useMessagingStatus();
  const { document } = useMessageMutations();
  const [channel, setChannel] = useState<MessageChannel>('WHATSAPP');
  const [to, setTo] = useState('');
  const [message, setMessage] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<Problem | null>(null);
  const [result, setResult] = useState<MessageCampaign | null>(null);
  const ready =
    channel === 'WHATSAPP' ? status.data?.whatsapp.configured : status.data?.email.configured;

  const submit = async () => {
    setProblem(null);
    const values = {
      kind,
      id,
      channel,
      ...(to.trim() ? { to: to.trim() } : {}),
      ...(message.trim() ? { message: message.trim() } : {}),
    };
    // The number of the invoice or receipt is the server's to check; only what is typed here is checked here.
    const checked = SendDocumentRequestSchema.omit({ kind: true, id: true }).safeParse(values);
    if (!checked.success) {
      setErrors(
        Object.fromEntries(checked.error.issues.map((i) => [String(i.path[0] ?? ''), i.message])),
      );
      return;
    }
    setErrors({});
    try {
      setResult(await document.mutateAsync(values));
    } catch (error) {
      const described = describeError(error);
      setProblem(described);
      setErrors(described.fields);
    }
  };

  const delivery = result?.deliveries?.[0];
  return (
    <FormDialog
      open
      size="md"
      title={`Send ${kind === 'INVOICE' ? 'invoice' : 'receipt'} ${label}`}
      description="The customer gets the PDF by WhatsApp or by email."
      onClose={onClose}
      onSubmit={result ? async () => onClose() : submit}
      saving={document.isPending}
      dirty={!result && (to !== '' || message !== '')}
      submitLabel={result ? 'Close' : 'Send'}
      error={problem ? <ProblemAlert problem={problem} /> : undefined}
    >
      {result && delivery ? (
        <div className="space-y-3">
          {delivery.status === 'SENT' ? (
            <Alert tone={delivery.via === 'TEMPLATE' ? 'warning' : 'success'}>
              {VIA_TEXT[delivery.via ?? 'TEXT']} (to {delivery.toAddress})
            </Alert>
          ) : (
            <Alert tone="error">
              It could not be sent to {delivery.toAddress}: {delivery.error ?? 'unknown reason'}
            </Alert>
          )}
          <p className="text-sm text-muted-foreground">
            Every message sent is kept under Messages.
          </p>
        </div>
      ) : (
        <div className="grid gap-4">
          {ready === false ? (
            <Alert tone="warning">
              {channel === 'WHATSAPP'
                ? 'WhatsApp is not set up yet. Add the WhatsApp settings to the settings file first.'
                : 'Email is not set up yet. Add the email settings to the settings file first.'}
            </Alert>
          ) : null}
          <FormField label="Send by" error={errors['channel']}>
            {(props) => (
              <Select
                {...props}
                value={channel}
                onChange={(event) => setChannel(event.target.value as MessageChannel)}
              >
                <option value="WHATSAPP">WhatsApp</option>
                <option value="EMAIL">Email</option>
              </Select>
            )}
          </FormField>
          <FormField
            label={channel === 'WHATSAPP' ? 'Phone number' : 'Email address'}
            error={errors['to']}
            hint="Leave empty to use the customer's own"
          >
            {(props) => (
              <Input {...props} value={to} onChange={(event) => setTo(event.target.value)} />
            )}
          </FormField>
          <FormField
            label="Message"
            error={errors['message']}
            hint="Leave empty for the usual message"
          >
            {(props) => (
              <Textarea
                {...props}
                rows={4}
                value={message}
                onChange={(event) => setMessage(event.target.value)}
              />
            )}
          </FormField>
        </div>
      )}
    </FormDialog>
  );
}
