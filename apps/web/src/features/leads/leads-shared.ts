import type { FollowupStatusName, LeadStageName } from '@erp/contracts';

export const STAGE_TEXT: Record<LeadStageName, string> = {
  NEW: 'New',
  CONTACTED: 'Contacted',
  QUALIFIED: 'Qualified',
  QUOTED: 'Quoted',
  NEGOTIATION: 'In negotiation',
  WON: 'Won',
  LOST: 'Lost',
};

export const FOLLOWUP_STATUS_TEXT: Record<FollowupStatusName, string> = {
  PENDING: 'Waiting',
  OVERDUE: 'Overdue',
  COMPLETED: 'Done',
};

export const FOLLOWUP_SCOPE_TEXT = {
  open: 'All waiting',
  overdue: 'Overdue',
  today: 'Due today',
  upcoming: 'Coming up',
  done: 'Done',
  all: 'Everything',
} as const;

/** How a stored time reads on screen, in the user's own time zone. */
export function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString('en-IN', { dateStyle: 'medium', timeStyle: 'short' });
}

/** The value a `datetime-local` field holds, turned into a time with its offset that the server accepts. */
export function localToIso(value: string): string {
  return new Date(value).toISOString();
}
