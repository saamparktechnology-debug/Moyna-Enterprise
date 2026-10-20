import { Inbox } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface EmptyStateProps {
  title?: string;
  /** The explanation, and what to do about it. */
  children: ReactNode;
  icon?: LucideIcon;
  /** A button or link that fixes the emptiness, such as "Clear filters". */
  action?: ReactNode;
  className?: string;
}

/** What a list or panel shows when there is nothing to show, and what the person can do next. */
export function EmptyState({
  title,
  children,
  icon: Icon = Inbox,
  action,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center gap-2 rounded-lg border border-dashed p-8 text-center',
        className,
      )}
    >
      <Icon className="size-8 text-muted-foreground" aria-hidden="true" />
      {title ? <p className="font-medium">{title}</p> : null}
      <div className="max-w-md text-sm text-muted-foreground">{children}</div>
      {action ? <div className="mt-1">{action}</div> : null}
    </div>
  );
}
