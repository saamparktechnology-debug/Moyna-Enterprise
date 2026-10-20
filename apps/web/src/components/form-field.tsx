import { useId } from 'react';
import type { ReactElement, ReactNode } from 'react';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

interface FormFieldProps {
  label: string;
  error?: string | undefined;
  hint?: ReactNode;
  /** Marks the field as required for everyone: an asterisk for the eye and `aria-required` for screen readers. */
  required?: boolean;
  /** Spans both columns of a two-column section (addresses, notes and other long fields). */
  wide?: boolean;
  className?: string;
  children: (props: {
    id: string;
    'aria-invalid': boolean;
    'aria-describedby': string | undefined;
    'aria-required': boolean | undefined;
  }) => ReactElement;
}

export function FormField({
  label,
  error,
  hint,
  required,
  wide,
  className,
  children,
}: FormFieldProps) {
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;
  const describedBy =
    [error ? errorId : null, hint ? hintId : null].filter(Boolean).join(' ') || undefined;
  return (
    <div className={cn('min-w-0 space-y-1.5', wide && 'sm:col-span-full', className)}>
      <label
        htmlFor={id}
        className={cn(
          'block text-sm font-medium',
          required && "after:ml-0.5 after:text-destructive after:content-['*']",
        )}
      >
        {label}
      </label>
      {children({
        id,
        'aria-invalid': Boolean(error),
        'aria-describedby': describedBy,
        'aria-required': required ? true : undefined,
      })}
      {hint ? (
        <p id={hintId} className="text-xs text-muted-foreground">
          {hint}
        </p>
      ) : null}
      {error ? (
        <p id={errorId} aria-live="polite" className="text-sm text-destructive">
          {error}
        </p>
      ) : null}
    </div>
  );
}

export { Input };
