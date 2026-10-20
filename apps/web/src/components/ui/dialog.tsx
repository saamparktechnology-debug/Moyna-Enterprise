import * as DialogPrimitive from '@radix-ui/react-dialog';
import { cva } from 'class-variance-authority';
import type { VariantProps } from 'class-variance-authority';
import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';
import { useRestoreFocus } from './use-restore-focus';

export const Dialog = DialogPrimitive.Root;
export const DialogClose = DialogPrimitive.Close;

const dialogSizes = cva(
  'fixed z-50 flex max-h-[calc(100dvh-1rem)] w-[calc(100vw-1rem)] flex-col overflow-y-auto rounded-lg border bg-card p-4 text-card-foreground shadow-lg focus:outline-none left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 sm:max-h-[calc(100dvh-3rem)] sm:p-6',
  {
    variants: {
      size: {
        sm: 'sm:max-w-md',
        md: 'sm:max-w-xl',
        lg: 'sm:max-w-3xl',
        xl: 'sm:max-w-5xl',
      },
    },
    defaultVariants: { size: 'sm' },
  },
);

type DialogContentProps = ComponentProps<typeof DialogPrimitive.Content> &
  VariantProps<typeof dialogSizes>;

export function DialogContent({
  className,
  children,
  size,
  onOpenAutoFocus,
  onCloseAutoFocus,
  ...props
}: DialogContentProps) {
  const focus = useRestoreFocus({ onOpenAutoFocus, onCloseAutoFocus });
  // A dialog that sets its own `max-w-*` keeps it; otherwise the size prop (default: small) sets the width.
  const ownWidth = size === undefined && /(^|\s)(sm:|md:|lg:)?max-w-/.test(className ?? '');
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className="fixed inset-0 z-40 bg-overlay motion-safe:animate-[erp-fade-in_var(--duration-base)_ease-out]" />
      <DialogPrimitive.Content
        className={cn(dialogSizes({ size: ownWidth ? null : size }), className)}
        {...focus}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  );
}

export function DialogTitle({ className, ...props }: ComponentProps<typeof DialogPrimitive.Title>) {
  return (
    <DialogPrimitive.Title
      className={cn('text-lg font-semibold leading-tight', className)}
      {...props}
    />
  );
}

export function DialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogPrimitive.Description>) {
  return (
    <DialogPrimitive.Description
      className={cn('mt-1 text-sm text-muted-foreground', className)}
      {...props}
    />
  );
}

export function DialogFooter({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      className={cn(
        'mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end [&>button]:w-full sm:[&>button]:w-auto',
        className,
      )}
      {...props}
    />
  );
}
