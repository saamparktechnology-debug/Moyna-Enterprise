//apps/web/src/features/brokers/broker-detail-dialog.tsx
import { SimpleTable } from '@/components/data-table/simple-table';
import { StatusBadge } from '@/components/status-badge';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  AddCommissionRuleRequestSchema,
  COMMISSION_RULE_TYPES,
  KYC_MAX_BYTES,
} from '@erp/contracts';
import type { Broker, BrokerFile, CommissionRuleTypeName } from '@erp/contracts';
import { FilePreview, useBlobUrl } from '@/components/file-preview';
import { FormField, Input } from '@/components/form-field';
import { Select } from '@/components/select-field';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { useAuth } from '@/features/auth/auth-provider';
import { describeError } from '../purchasing/purchasing-shared';
import type { Problem } from '../purchasing/purchasing-shared';
import { ProblemAlert } from '../payments/payments-shared';
import { formatSize } from '../customers/customers-shared';
import { formatWhen } from '../leads/leads-shared';
import { downloadBrokerDocument, downloadBrokerPhoto } from './brokers-api';
import { ruleText } from './brokers-shared';
import { useBroker, useBrokerMutations } from './use-brokers';

interface Props {
  brokerId: string;
  onClose: () => void;
  onEdit: (broker: Broker) => void;
  onLedger: (broker: Broker) => void;
}

const TYPE_TEXT: Record<CommissionRuleTypeName, string> = {
  PERCENT: 'Percentage of the taxable value',
  FIXED: 'Fixed amount a sale',
};

export function BrokerDetailDialog({ brokerId, onClose, onEdit, onLedger }: Props) {
  const { can } = useAuth();
  const query = useBroker(brokerId);
  const broker = query.data;
  const manage = can('brokers.manage');
  const { addRule, update, setPhoto, removePhoto, addDocument, removeDocument } =
    useBrokerMutations();
  const [type, setType] = useState<CommissionRuleTypeName>('PERCENT');
  const [value, setValue] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [problem, setProblem] = useState<Problem | null>(null);
  const busy =
    addRule.isPending ||
    update.isPending ||
    setPhoto.isPending ||
    removePhoto.isPending ||
    addDocument.isPending ||
    removeDocument.isPending;
  const [documentLabel, setDocumentLabel] = useState('');
  const [view, setView] = useState<{ url: string; mimeType: string; title: string } | null>(null);
  const viewUrl = useRef<string | null>(null);
  // The photo is fetched again whenever it is replaced (its `uploadedAt` changes).
  const photoStamp = broker?.photo ? `${broker.photo.id}:${broker.photo.uploadedAt}` : '';
  const loadPhoto = useCallback(() => downloadBrokerPhoto(brokerId), [brokerId]);
  const photo = useBlobUrl(broker?.photo ? loadPhoto : null, photoStamp);

  useEffect(
    () => () => {
      if (viewUrl.current) URL.revokeObjectURL(viewUrl.current);
    },
    [],
  );
  const closeView = () => {
    if (viewUrl.current) URL.revokeObjectURL(viewUrl.current);
    viewUrl.current = null;
    setView(null);
  };

  const run = async (action: () => Promise<unknown>, done?: () => void) => {
    setProblem(null);
    setErrors({});
    try {
      await action();
      done?.();
    } catch (error) {
      const described = describeError(error);
      setProblem(described);
      setErrors(described.fields);
    }
  };

  /** Checks a chosen file before it is sent; the server checks it again. Returns the file, or `null` with a message shown. */
  const chosen = (event: { target: HTMLInputElement }, field: string): File | null => {
    const file = event.target.files?.[0] ?? null;
    event.target.value = '';
    if (!file) return null;
    if (file.size > KYC_MAX_BYTES) {
      setErrors({ [field]: 'The file is larger than 5 MB' });
      return null;
    }
    return file;
  };
  const openDocument = (file: BrokerFile) =>
    run(async () => {
      const blob = await downloadBrokerDocument(brokerId, file.id);
      if (viewUrl.current) URL.revokeObjectURL(viewUrl.current);
      const url = URL.createObjectURL(blob);
      viewUrl.current = url;
      setView({
        url,
        mimeType: file.mimeType,
        title: `${file.label ?? 'Document'} · ${file.fileName}`,
      });
    });

  return (
    <Dialog open onOpenChange={(next) => (next || busy ? undefined : onClose())}>
      <DialogContent className="max-h-[90vh] max-w-2xl overflow-y-auto">
        <DialogTitle>{broker ? broker.name : 'Broker'}</DialogTitle>
        <DialogDescription>
          {broker
            ? `${broker.isActive ? 'Active' : 'Switched off'}${broker.phone ? ` · ${broker.phone}` : ''}`
            : 'Loading the broker'}
        </DialogDescription>
        {query.isPending ? (
          <p role="status" className="mt-4 text-sm text-muted-foreground">
            Loading the broker…
          </p>
        ) : query.isError || !broker ? (
          <div role="alert" className="mt-4 flex items-center gap-3 text-destructive">
            <p>Could not load the broker.</p>
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
              <dt className="text-muted-foreground">Address</dt>
              <dd>{broker.address ?? '—'}</dd>
              <dt className="text-muted-foreground">Standing rule</dt>
              <dd>{ruleText(broker.activeRule)}</dd>
              <dt className="text-muted-foreground">Commission to pay</dt>
              <dd>{broker.payable}</dd>
              <dt className="text-muted-foreground">To get back</dt>
              <dd>{broker.toRecover}</dd>
            </dl>
            <div className="mt-4 flex flex-wrap gap-2">
              <Button variant="secondary" size="sm" onClick={() => onLedger(broker)}>
                Open ledger
              </Button>
              {manage ? (
                <>
                  <Button variant="secondary" size="sm" onClick={() => onEdit(broker)}>
                    Edit details
                  </Button>
                  <Button
                    variant="secondary"
                    size="sm"
                    disabled={busy}
                    onClick={() =>
                      void run(() =>
                        update.mutateAsync({
                          id: broker.id,
                          values: { isActive: !broker.isActive, rowVersion: broker.rowVersion },
                        }),
                      )
                    }
                  >
                    {broker.isActive ? 'Switch off' : 'Switch on'}
                  </Button>
                </>
              ) : null}
            </div>

            <h3 className="mt-6 text-sm font-semibold">Photo</h3>
            <div className="mt-2 flex flex-wrap items-start gap-4">
              {broker.photo ? (
                photo.url ? (
                  <img
                    src={photo.url}
                    alt={`Photo of ${broker.name}`}
                    className="h-32 w-32 rounded-md border object-cover"
                  />
                ) : photo.failed ? (
                  <p role="alert" className="text-sm text-destructive">
                    Could not load the photo.
                  </p>
                ) : (
                  <p role="status" className="text-sm text-muted-foreground">
                    Loading the photo…
                  </p>
                )
              ) : (
                <p className="text-sm text-muted-foreground">No photo yet.</p>
              )}
              {manage ? (
                <div className="grid gap-2">
                  <FormField
                    label={broker.photo ? 'Replace photo' : 'Add photo'}
                    error={errors['photoFile'] ?? errors['file']}
                    hint="JPEG or PNG, up to 5 MB"
                  >
                    {(props) => (
                      <Input
                        {...props}
                        type="file"
                        accept="image/jpeg,image/png"
                        disabled={busy}
                        onChange={(event) => {
                          const file = chosen(event, 'photoFile');
                          if (file) void run(() => setPhoto.mutateAsync({ id: broker.id, file }));
                        }}
                      />
                    )}
                  </FormField>
                  {broker.photo ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      disabled={busy}
                      onClick={() => void run(() => removePhoto.mutateAsync(broker.id))}
                    >
                      Remove photo
                    </Button>
                  ) : null}
                </div>
              ) : null}
            </div>

            <h3 className="mt-6 text-sm font-semibold">Documents</h3>
            {(broker.documents ?? []).length > 0 ? (
              <SimpleTable
                label="Broker documents"
                rows={broker.documents ?? []}
                getRowKey={(file) => file.id}
                className="mt-2"
                columns={[
                  { header: 'Document', cell: (file) => file.label ?? '—' },
                  { header: 'File', cell: (file) => file.fileName },
                  { header: 'Size', cell: (file) => formatSize(file.sizeBytes) },
                  { header: 'Added', cell: (file) => formatWhen(file.uploadedAt) },
                  {
                    header: 'Actions',
                    cell: (file) => (
                      <span className="flex gap-2">
                        <Button
                          variant="secondary"
                          size="sm"
                          disabled={busy}
                          aria-label={`View ${file.label ?? file.fileName}`}
                          onClick={() => void openDocument(file)}
                        >
                          View
                        </Button>
                        {manage ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            disabled={busy}
                            aria-label={`Remove ${file.label ?? file.fileName}`}
                            onClick={() =>
                              void run(() =>
                                removeDocument.mutateAsync({ id: broker.id, fileId: file.id }),
                              )
                            }
                          >
                            Remove
                          </Button>
                        ) : null}
                      </span>
                    ),
                  },
                ]}
              />
            ) : (
              <p className="mt-2 text-sm text-muted-foreground">No documents yet.</p>
            )}
            {view ? (
              <FilePreview
                url={view.url}
                mimeType={view.mimeType}
                title={view.title}
                onClose={closeView}
              />
            ) : null}
            {manage ? (
              <div className="mt-3 grid gap-3 sm:grid-cols-2">
                <FormField
                  label="What the document is"
                  error={errors['label']}
                  hint="Optional. For example Aadhaar card or agreement"
                >
                  {(props) => (
                    <Input
                      {...props}
                      value={documentLabel}
                      onChange={(event) => setDocumentLabel(event.target.value)}
                    />
                  )}
                </FormField>
                <FormField
                  label="Add a document"
                  error={errors['documentFile'] ?? errors['file']}
                  hint="PDF, JPEG or PNG, up to 5 MB"
                >
                  {(props) => (
                    <Input
                      {...props}
                      type="file"
                      accept="application/pdf,image/jpeg,image/png"
                      disabled={busy}
                      onChange={(event) => {
                        const file = chosen(event, 'documentFile');
                        if (file)
                          void run(
                            () =>
                              addDocument.mutateAsync({
                                id: broker.id,
                                file,
                                label: documentLabel,
                              }),
                            () => setDocumentLabel(''),
                          );
                      }}
                    />
                  )}
                </FormField>
              </div>
            ) : null}

            <h3 className="mt-6 text-sm font-semibold">Standing commission rule (optional)</h3>
            <p className="text-sm text-muted-foreground">
              Commission is agreed on each invoice, as an amount or a gift. A standing rule is used
              only for an invoice where nothing was agreed. A rule is never edited: a new rule
              replaces the one in force, and commissions already worked out keep theirs.
            </p>
            {broker.rules.length > 0 ? (
              <SimpleTable
                label="Commission rules"
                rows={broker.rules}
                getRowKey={(rule) => rule.id}
                className="mt-2"
                columns={[
                  { header: 'Rule', cell: (rule) => ruleText(rule) },
                  { header: 'Added', cell: (rule) => formatWhen(rule.createdAt) },
                  { header: 'Added by', cell: (rule) => rule.createdByName ?? '—' },
                  {
                    header: 'State',
                    cell: (rule) => (
                      <StatusBadge
                        status={rule.isActive ? 'ACTIVE' : 'INACTIVE'}
                        label={rule.isActive ? 'In force' : 'Replaced'}
                      />
                    ),
                  },
                ]}
              />
            ) : (
              <p className="mt-2 text-sm">
                This broker has no standing rule. That is fine: commission is agreed on each
                invoice.
              </p>
            )}

            {manage && broker.isActive ? (
              <div className="mt-4 grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
                <FormField label="Kind of rule" error={errors['type']}>
                  {(props) => (
                    <Select
                      {...props}
                      value={type}
                      onChange={(event) => setType(event.target.value as CommissionRuleTypeName)}
                    >
                      {COMMISSION_RULE_TYPES.map((item) => (
                        <option key={item} value={item}>
                          {TYPE_TEXT[item]}
                        </option>
                      ))}
                    </Select>
                  )}
                </FormField>
                <FormField
                  label={type === 'PERCENT' ? 'Percentage' : 'Amount'}
                  error={errors['value']}
                >
                  {(props) => (
                    <Input
                      {...props}
                      inputMode="decimal"
                      value={value}
                      onChange={(event) => setValue(event.target.value)}
                    />
                  )}
                </FormField>
                <Button
                  disabled={busy}
                  onClick={() => {
                    const request = { type, value: value.trim() };
                    const parsed = AddCommissionRuleRequestSchema.safeParse(request);
                    if (!parsed.success) {
                      setErrors({ value: parsed.error.issues[0]?.message ?? 'Check the value' });
                      return;
                    }
                    void run(
                      () => addRule.mutateAsync({ id: broker.id, values: request }),
                      () => setValue(''),
                    );
                  }}
                >
                  {addRule.isPending ? 'Saving…' : 'Set new rule'}
                </Button>
              </div>
            ) : null}
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
