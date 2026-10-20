import { useState } from 'react';
import type { Setting } from '@erp/contracts';
import { Alert } from '@/components/alert';
import { ErrorState } from '@/components/error-state';
import { LoadingState } from '@/components/loading-state';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { ApiError } from '@/lib/api-client';
import { useSettingMutations, useSettings } from './use-settings';

function SettingRow({ setting }: { setting: Setting }) {
  const { save, reset } = useSettingMutations();
  const initial = setting.value === null ? '' : String(setting.value);
  const [draft, setDraft] = useState(initial);
  const [message, setMessage] = useState<{ tone: 'error' | 'success'; text: string } | null>(null);
  const changed = draft.trim() !== initial;
  const inputId = `setting-${setting.key}`;

  const failed = (error: unknown) =>
    setMessage({
      tone: 'error',
      text:
        error instanceof ApiError
          ? (error.details[0]?.message ?? error.message)
          : 'The setting could not be saved',
    });

  return (
    <Card>
      <CardContent className="space-y-2 p-4">
        <label htmlFor={inputId} className="block font-medium">
          {setting.label}
        </label>
        <p className="text-sm text-muted-foreground">{setting.description}</p>
        <div className="flex flex-wrap items-center gap-2">
          <Input
            id={inputId}
            className="max-w-sm"
            value={draft}
            inputMode={setting.type === 'text' ? 'text' : 'decimal'}
            onChange={(event) => {
              setDraft(event.target.value);
              setMessage(null);
            }}
          />
          <Button
            type="button"
            disabled={!changed || draft.trim() === '' || save.isPending}
            onClick={() =>
              save.mutate(
                { key: setting.key, value: draft.trim(), rowVersion: setting.rowVersion },
                {
                  onSuccess: () => setMessage({ tone: 'success', text: 'Saved' }),
                  onError: failed,
                },
              )
            }
          >
            Save
          </Button>
          {setting.source === 'SETTING' && setting.rowVersion !== null ? (
            <Button
              type="button"
              variant="secondary"
              disabled={reset.isPending}
              onClick={() =>
                reset.mutate(
                  { key: setting.key, rowVersion: setting.rowVersion as number },
                  {
                    onSuccess: (next) => {
                      setDraft(next.value === null ? '' : String(next.value));
                      setMessage({ tone: 'success', text: 'Back to the default' });
                    },
                    onError: failed,
                  },
                )
              }
            >
              Use the default
            </Button>
          ) : null}
        </div>
        <p className="text-xs text-muted-foreground">
          {setting.source === 'SETTING'
            ? 'Saved value in use.'
            : setting.defaultValue === null
              ? 'Not set.'
              : `Default in use: ${setting.defaultValue}.`}
        </p>
        {message ? <Alert tone={message.tone}>{message.text}</Alert> : null}
      </CardContent>
    </Card>
  );
}

export function CompanySection() {
  const { data, error, isPending, refetch } = useSettings();
  if (isPending) return <LoadingState label="Loading settings…" rows={3} />;
  if (error)
    return (
      <ErrorState onRetry={refetch} retryLabel="Try again">
        {error instanceof ApiError ? error.message : 'Settings could not be loaded'}
      </ErrorState>
    );
  const group = (name: 'company' | 'approvals') => data.filter((setting) => setting.group === name);
  return (
    <div className="space-y-6">
      <section aria-label="Company details" className="space-y-3">
        <h2 className="section-title">Company details</h2>
        {group('company').map((setting) => (
          <SettingRow key={setting.key} setting={setting} />
        ))}
      </section>
      <section aria-label="Approval limits" className="space-y-3">
        <h2 className="section-title">Approval limits</h2>
        {group('approvals').map((setting) => (
          <SettingRow key={setting.key} setting={setting} />
        ))}
      </section>
    </div>
  );
}
