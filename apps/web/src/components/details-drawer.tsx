import { X } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import {
  Sheet,
  SheetClose,
  SheetContent,
  SheetDescription,
  SheetTitle,
} from '@/components/ui/sheet';

interface DetailsDrawerProps {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: ReactNode;
  children: ReactNode;
  /** Actions pinned to the bottom, such as Approve and Reject. */
  footer?: ReactNode;
}

/** A panel from the right edge for previewing one record without leaving the list. */
export function DetailsDrawer({
  open,
  onClose,
  title,
  description,
  children,
  footer,
}: DetailsDrawerProps) {
  return (
    <Sheet open={open} onOpenChange={(next) => (next ? undefined : onClose())}>
      <SheetContent side="right">
        <div className="flex items-start justify-between gap-3 border-b px-5 py-4">
          <div className="min-w-0 space-y-1">
            <SheetTitle className="text-lg font-semibold leading-snug">{title}</SheetTitle>
            {description ? (
              <SheetDescription className="text-sm text-muted-foreground">
                {description}
              </SheetDescription>
            ) : (
              <SheetDescription className="sr-only">
                Details of the selected record.
              </SheetDescription>
            )}
          </div>
          <SheetClose asChild>
            <Button variant="ghost" size="icon-sm" aria-label="Close details">
              <X />
            </Button>
          </SheetClose>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer ? <div className="border-t px-5 py-3">{footer}</div> : null}
      </SheetContent>
    </Sheet>
  );
}
