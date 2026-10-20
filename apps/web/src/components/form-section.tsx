import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface FormSectionProps {
  title?: string;
  description?: string;
  /** One column on a phone; this many from the `sm` breakpoint up. */
  columns?: 1 | 2 | 3;
  children: ReactNode;
  className?: string;
}

const COLUMNS = { 1: '', 2: 'sm:grid-cols-2', 3: 'sm:grid-cols-2 lg:grid-cols-3' } as const;

/** A titled group of related fields. A fieldset, so assistive technology announces the group name. */
export function FormSection({
  title,
  description,
  columns = 2,
  children,
  className,
}: FormSectionProps) {
  return (
    <fieldset className={cn('min-w-0 space-y-3 border-0 p-0', className)}>
      {title ? (
        <legend className="mb-1 w-full border-b pb-1.5 text-sm font-semibold">{title}</legend>
      ) : null}
      {description ? <p className="text-xs text-muted-foreground">{description}</p> : null}
      <div className={cn('grid grid-cols-1 gap-x-4 gap-y-4', COLUMNS[columns])}>{children}</div>
    </fieldset>
  );
}
