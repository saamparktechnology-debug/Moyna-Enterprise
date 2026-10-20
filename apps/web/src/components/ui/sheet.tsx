import * as DialogPrimitive from '@radix-ui/react-dialog';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import { useRestoreFocus } from './use-restore-focus';

/** A panel that slides in from a screen edge. Built on the dialog primitive, so focus is trapped and restored. */
export const Sheet = DialogPrimitive.Root;
export const SheetTrigger = DialogPrimitive.Trigger;
export const SheetClose = DialogPrimitive.Close;
export const SheetTitle = DialogPrimitive.Title;
export const SheetDescription = DialogPrimitive.Description;

interface SheetContentProps extends ComponentProps<typeof DialogPrimitive.Content> {
  side?: 'left' | 'right';
  width?: string;
}

export function SheetContent({
  className,
  children,
  side = 'right',
  width = 'sm:max-w-lg',
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: SheetContentProps) {
  const focus = useRestoreFocus({ onOpenAutoFocus, onCloseAutoFocus });
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-overlay motion-safe:animate-[erp-fade-in_var(--duration-base)_ease-out]" />
      <DialogPrimitive.Content
        className={cn(
          'fixed inset-y-0 z-50 flex w-[min(100vw-2rem,100%)] flex-col bg-card text-card-foreground shadow-lg focus:outline-none',
          side === 'right'
            ? 'right-0 border-l motion-safe:animate-[erp-slide-in-right_var(--duration-base)_ease-out]'
            : 'left-0 border-r motion-safe:animate-[erp-slide-in-left_var(--duration-base)_ease-out]',
          width,
          className,
        )}
        {...focus}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}
