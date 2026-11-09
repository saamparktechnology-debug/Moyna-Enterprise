//apps/web/src/features/billing/gift-photo-panel.tsx
import { useCallback, useState } from 'react';
import { KYC_MAX_BYTES } from '@erp/contracts';
import type { Invoice } from '@erp/contracts';
import { useBlobUrl } from '@/components/file-preview';
import { FormField, Input } from '@/components/form-field';
import { Button } from '@/components/ui/button';
import { ProblemAlert } from '../payments/payments-shared';
import { describeError } from '../purchasing/purchasing-shared';
import type { Problem } from '../purchasing/purchasing-shared';
import { downloadInvoiceGiftPhoto } from './billing-api';
import { useInvoiceMutations } from './use-billing';

interface GiftPhotoPanelProps {
  invoice: Invoice;
  /** True for a draft the person may change. An issued invoice only shows the photo. */
  editable: boolean;
}

/** The photo of the gift agreed with the broker. Shown only when the commission on the invoice is a gift. */
export function GiftPhotoPanel({ invoice, editable }: GiftPhotoPanelProps) {
  const { setGiftPhoto, removeGiftPhoto } = useInvoiceMutations();
  const [problem, setProblem] = useState<Problem | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const hasPhoto = invoice.commission?.hasPhoto ?? false;
  // Saving a photo changes the invoice's version, so the picture is fetched again.
  const stamp = `${invoice.rowVersion}:${invoice.commission?.photoFileName ?? ''}`;
  const load = useCallback(() => downloadInvoiceGiftPhoto(invoice.id), [invoice.id]);
  const photo = useBlobUrl(hasPhoto ? load : null, stamp);
  const busy = setGiftPhoto.isPending || removeGiftPhoto.isPending;

  if (invoice.commission?.type !== 'GIFT') return null;

  const run = async (action: () => Promise<unknown>) => {
    setProblem(null);
    setFileError(null);
    try {
      await action();
    } catch (error) {
      setProblem(describeError(error));
    }
  };

  return (
    <section aria-label="Gift photo" className="mt-4 space-y-2 print:hidden">
      <h3 className="text-sm font-semibold">Gift photo</h3>
      {problem ? <ProblemAlert problem={problem} /> : null}
      {hasPhoto ? (
        photo.url ? (
          <img
            src={photo.url}
            alt={`Gift: ${invoice.commission.giftName ?? ''}`}
            className="h-40 w-40 rounded-md border object-cover"
          />
        ) : photo.failed ? (
          <p role="alert" className="text-sm text-destructive">
            Could not load the gift photo.
          </p>
        ) : (
          <p role="status" className="text-sm text-muted-foreground">
            Loading the gift photo…
          </p>
        )
      ) : (
        <p className="text-sm text-muted-foreground">No photo of the gift yet.</p>
      )}
      {editable ? (
        <div className="grid max-w-sm gap-2">
          <FormField
            label={hasPhoto ? 'Replace gift photo' : 'Add gift photo'}
            error={fileError ?? undefined}
            hint="JPEG or PNG, up to 5 MB"
          >
            {(props) => (
              <Input
                {...props}
                type="file"
                accept="image/jpeg,image/png"
                disabled={busy}
                onChange={(event) => {
                  const file = event.target.files?.[0] ?? null;
                  event.target.value = '';
                  if (!file) return;
                  if (file.size > KYC_MAX_BYTES) {
                    setFileError('The file is larger than 5 MB');
                    return;
                  }
                  void run(() => setGiftPhoto.mutateAsync({ id: invoice.id, file }));
                }}
              />
            )}
          </FormField>
          {hasPhoto ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={busy}
              onClick={() => void run(() => removeGiftPhoto.mutateAsync(invoice.id))}
            >
              Remove gift photo
            </Button>
          ) : null}
        </div>
      ) : null}
    </section>
  );
}
