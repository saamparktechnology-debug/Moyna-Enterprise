import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageContainerProps {
  children: ReactNode;
  /** `narrow` suits forms and reading; `wide` is the default for tables. */
  width?: 'narrow' | 'wide';
  className?: string;
}

/** Consistent vertical rhythm and width for the content of one screen. */
export function PageContainer({ children, width = 'wide', className }: PageContainerProps) {
  return (
    <div
      className={cn(
        'w-full space-y-(--page-gap)',
        width === 'narrow' ? 'max-w-3xl' : 'max-w-page',
        className,
      )}
    >
      {children}
    </div>
  );
}
