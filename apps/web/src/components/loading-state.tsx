import { Skeleton } from '@/components/ui/skeleton';
import { cn } from '@/lib/utils';

interface LoadingStateProps {
  /** Announced and shown, for example "Loading branches…". */
  label: string;
  /** How many placeholder rows to draw. */
  rows?: number;
  className?: string;
}

/** Skeleton rows with one polite announcement, shown while a request is in flight. */
export function LoadingState({ label, rows = 4, className }: LoadingStateProps) {
  return (
    <div className={cn('space-y-3', className)}>
      <p role="status" className="text-sm text-muted-foreground">
        {label}
      </p>
      {Array.from({ length: rows }, (_, index) => (
        <Skeleton key={index} className="h-9 w-full" />
      ))}
    </div>
  );
}
