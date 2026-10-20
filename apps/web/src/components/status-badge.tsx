import { CheckCircle2, CircleDashed, Clock, Info, XCircle } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { cn } from '@/lib/utils';

export type StatusTone = 'success' | 'warning' | 'destructive' | 'info' | 'neutral';

const TONE_STYLE: Record<StatusTone, { classes: string; icon: LucideIcon }> = {
  success: { classes: 'bg-success-subtle text-success border-success/30', icon: CheckCircle2 },
  warning: { classes: 'bg-warning-subtle text-warning border-warning/30', icon: Clock },
  destructive: {
    classes: 'bg-destructive-subtle text-destructive border-destructive/30',
    icon: XCircle,
  },
  info: { classes: 'bg-info-subtle text-info border-info/30', icon: Info },
  neutral: { classes: 'bg-muted text-muted-foreground border-border', icon: CircleDashed },
};

/**
 * The tone of every status value the application already uses (invoice, payment, transfer, KYC,
 * lead, follow-up and so on). Unknown values are neutral. Keys are written the way the API sends
 * them; `toneOf` normalises case and punctuation first.
 */
const TONES: Record<string, StatusTone> = {
  ACTIVE: 'success',
  APPROVED: 'success',
  COMPLETED: 'success',
  COMPLETE: 'success',
  VERIFIED: 'success',
  PAID: 'success',
  ISSUED: 'success',
  FINALIZED: 'success',
  RESOLVED: 'success',
  OK: 'success',
  RECEIVED: 'success',
  READY: 'success',
  WON: 'success',
  PENDING: 'warning',
  PARTIAL: 'warning',
  PARTLY_RECEIVED: 'warning',
  UNPAID: 'warning',
  PAYABLE: 'warning',
  OPEN: 'warning',
  EXPIRING: 'warning',
  LOW_STOCK: 'warning',
  NOT_SUBMITTED: 'warning',
  IN_BUILD: 'warning',
  QUALITY_CHECK: 'warning',
  REJECTED: 'destructive',
  OVERDUE: 'destructive',
  EXPIRED: 'destructive',
  REVERSED: 'destructive',
  LOST: 'destructive',
  SENT: 'info',
  IN_TRANSIT: 'info',
  NEW: 'info',
  CONTACTED: 'info',
  QUALIFIED: 'info',
  QUOTED: 'info',
  NEGOTIATION: 'info',
  ACCEPTED: 'info',
  CANCELLED: 'neutral',
  INACTIVE: 'neutral',
  DRAFT: 'neutral',
  NONE: 'neutral',
  ENDED: 'neutral',
  NOT_STARTED: 'neutral',
  SCRAPPED: 'neutral',
};

const normalise = (status: string): string =>
  status
    .trim()
    .toUpperCase()
    .replace(/[\s-]+/g, '_');

export function toneOf(status: string): StatusTone {
  return TONES[normalise(status)] ?? 'neutral';
}

const sentence = (status: string): string => {
  const words = status.trim().toLowerCase().replace(/[_-]+/g, ' ');
  return words.charAt(0).toUpperCase() + words.slice(1);
};

interface StatusBadgeProps {
  /** The status value as the API sends it, for example `PARTIAL` or `low stock`. */
  status: string;
  /** Shown instead of the value when a screen has its own wording. */
  label?: string;
  /** Overrides the tone looked up from the status. */
  tone?: StatusTone;
  className?: string;
}

/** A status as words plus an icon, so its meaning never depends on colour alone. */
export function StatusBadge({ status, label, tone, className }: StatusBadgeProps) {
  const style = TONE_STYLE[tone ?? toneOf(status)];
  const Icon = style.icon;
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 whitespace-nowrap rounded-full border px-2 py-0.5 text-xs font-medium',
        style.classes,
        className,
      )}
    >
      <Icon className="size-3 shrink-0" aria-hidden="true" />
      {label ?? sentence(status)}
    </span>
  );
}
