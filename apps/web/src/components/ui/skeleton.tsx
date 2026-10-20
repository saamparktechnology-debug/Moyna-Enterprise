import type { ComponentProps } from 'react';
import { cn } from '@/lib/utils';

/** A grey placeholder shape. Hidden from assistive technology: the surrounding LoadingState announces. */
export function Skeleton({ className, ...props }: ComponentProps<'div'>) {
  return (
    <div
      aria-hidden="true"
      className={cn('animate-[erp-pulse_1.6s_ease-in-out_infinite] rounded-md bg-muted', className)}
      {...props}
    />
  );
}
