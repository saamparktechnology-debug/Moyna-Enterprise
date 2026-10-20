import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface PageHeaderProps {
  title: string;
  /** One short line on what the screen is for. */
  description?: ReactNode;
  /** The primary action first, then secondary ones. Placed at the right on wide screens. */
  actions?: ReactNode;
  className?: string;
}

/** The title block every screen starts with, so the page heading and primary action never move. */
export function PageHeader({ title, description, actions, className }: PageHeaderProps) {
  return (
    <div className={cn('flex flex-wrap items-start justify-between gap-x-4 gap-y-3', className)}>
      <div className="min-w-0 space-y-1">
        <h1 className="page-title break-words">{title}</h1>
        {description ? (
          <p className="max-w-measure text-sm text-muted-foreground">{description}</p>
        ) : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
