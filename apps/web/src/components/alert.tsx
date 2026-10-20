import { AlertCircle, CheckCircle2, Info, TriangleAlert } from 'lucide-react';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

interface AlertProps {
  tone?: 'error' | 'info' | 'success' | 'warning';
  children: ReactNode;
  className?: string;
}

const ICONS = { error: AlertCircle, info: Info, success: CheckCircle2, warning: TriangleAlert };

/** Inline feedback. The icon means the tone never depends on colour alone. */
export function Alert({ tone = 'info', children, className }: AlertProps) {
  const Icon = ICONS[tone];
  return (
    <div
      role={tone === 'error' ? 'alert' : 'status'}
      className={cn(
        'flex items-start gap-2 rounded-md border px-3 py-2 text-sm',
        tone === 'error' && 'border-destructive/40 bg-destructive-subtle text-destructive',
        tone === 'success' && 'border-success/40 bg-success-subtle text-success',
        tone === 'warning' && 'border-warning/40 bg-warning-subtle text-warning',
        tone === 'info' && 'border-info/30 bg-info-subtle text-info',
        className,
      )}
    >
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
