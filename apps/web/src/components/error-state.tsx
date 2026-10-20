import { AlertCircle } from 'lucide-react';
import type { ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

interface ErrorStateProps {
  children: ReactNode;
  /** When given, a Retry button calls it. */
  onRetry?: (() => unknown) | undefined;
  /** The retry button's wording. */
  retryLabel?: string;
  className?: string;
}

/** A failed request, announced to screen readers, with a way to try again. */
export function ErrorState({
  children,
  onRetry,
  retryLabel = 'Retry',
  className,
}: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-wrap items-center gap-3 rounded-lg border border-destructive/40 bg-destructive-subtle p-4 text-sm text-destructive',
        className,
      )}
    >
      <AlertCircle className="size-5 shrink-0" aria-hidden="true" />
      <p className="min-w-0 flex-1">{children}</p>
      {onRetry ? (
        <Button variant="outline" size="sm" onClick={() => void onRetry()}>
          {retryLabel}
        </Button>
      ) : null}
    </div>
  );
}
