import { ChevronRight } from 'lucide-react';
import { Link } from 'react-router';
import { cn } from '@/lib/utils';

export interface Crumb {
  label: string;
  /** Crumbs without a destination (a menu group) are plain text. */
  to?: string;
}

interface BreadcrumbsProps {
  items: readonly Crumb[];
  className?: string;
}

/** The path to the current screen. On a phone only the current screen is shown, to leave room for controls. */
export function Breadcrumbs({ items, className }: BreadcrumbsProps) {
  const last = items.length - 1;
  return (
    <nav aria-label="Breadcrumb" className={cn('min-w-0', className)}>
      <ol className="flex min-w-0 items-center gap-1 text-sm text-muted-foreground">
        {items.map((crumb, index) => {
          const current = index === last;
          return (
            <li
              key={`${crumb.label}-${index}`}
              className={cn('flex min-w-0 items-center gap-1', !current && 'hidden sm:flex')}
            >
              {crumb.to && !current ? (
                <Link to={crumb.to} className="rounded-sm hover:text-foreground hover:underline">
                  {crumb.label}
                </Link>
              ) : (
                <span
                  aria-current={current ? 'page' : undefined}
                  className={cn('truncate', current && 'font-medium text-foreground')}
                >
                  {crumb.label}
                </span>
              )}
              {current ? null : <ChevronRight className="size-3.5 shrink-0" aria-hidden="true" />}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
