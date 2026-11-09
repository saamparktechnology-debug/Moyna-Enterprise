//apps/web/src/features/brokers/gift-photo-dialog.tsx
import { useCallback } from 'react';
import { useBlobUrl } from '@/components/file-preview';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogDescription, DialogTitle } from '@/components/ui/dialog';
import { downloadCommissionGiftPhoto } from './brokers-api';

interface Props {
  commissionId: string;
  giftName: string;
  onClose: () => void;
}

/** Shows the photo of the gift a commission was agreed as. */
export function GiftPhotoDialog({ commissionId, giftName, onClose }: Props) {
  const load = useCallback(() => downloadCommissionGiftPhoto(commissionId), [commissionId]);
  const photo = useBlobUrl(load);
  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent className="max-w-lg">
        <DialogTitle>Gift: {giftName}</DialogTitle>
        <DialogDescription>The gift agreed with the broker for this sale.</DialogDescription>
        <div className="mt-4">
          {photo.url ? (
            <img
              src={photo.url}
              alt={`Gift: ${giftName}`}
              className="max-h-[60vh] w-full rounded object-contain"
            />
          ) : photo.failed ? (
            <p role="alert" className="text-sm text-destructive">
              Could not load the gift photo.
            </p>
          ) : (
            <p role="status" className="text-sm text-muted-foreground">
              Loading the gift photo…
            </p>
          )}
        </div>
        <div className="mt-6 flex justify-end">
          <Button type="button" variant="secondary" onClick={onClose}>
            Close
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
