import { todayInIndia } from '@erp/contracts';
import type { DashboardPeriod } from '@erp/contracts';

const DAY_MS = 86_400_000;
const IST_OFFSET = '+05:30';

/** The period a dashboard answers for: the dates asked for, or this month so far (in India). */
export function resolvePeriod(
  query: { from?: string | undefined; to?: string | undefined },
  now: Date = new Date(),
): DashboardPeriod {
  if (query.from !== undefined && query.to !== undefined) return { from: query.from, to: query.to };
  const today = todayInIndia(now);
  return { from: `${today.slice(0, 8)}01`, to: today };
}

/** The first instant of tomorrow in India, which ends "today" for follow-ups. */
export function tomorrowStartInIndia(now: Date = new Date()): Date {
  const today = new Date(`${todayInIndia(now)}T00:00:00.000${IST_OFFSET}`);
  return new Date(today.getTime() + DAY_MS);
}

/** won / created as a percentage with one decimal, or null when nothing was created. */
export function conversionRate(created: number, won: number): number | null {
  if (created <= 0) return null;
  return Math.round((won / created) * 1000) / 10;
}
