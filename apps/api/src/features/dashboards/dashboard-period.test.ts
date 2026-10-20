import { describe, expect, it } from 'vitest';
import { conversionRate, resolvePeriod, tomorrowStartInIndia } from './dashboard-period.js';

describe('resolvePeriod', () => {
  it('uses the dates given', () => {
    expect(resolvePeriod({ from: '2026-01-05', to: '2026-02-01' })).toEqual({
      from: '2026-01-05',
      to: '2026-02-01',
    });
  });

  it('defaults to this month so far, judged by the date in India', () => {
    expect(resolvePeriod({}, new Date('2026-10-10T08:00:00Z'))).toEqual({
      from: '2026-10-01',
      to: '2026-10-10',
    });
    // 20:00 UTC on 31 October is already 1 November in India.
    expect(resolvePeriod({}, new Date('2026-10-31T20:00:00Z'))).toEqual({
      from: '2026-11-01',
      to: '2026-11-01',
    });
  });
});

describe('tomorrowStartInIndia', () => {
  it('is midnight at the start of the next day in India', () => {
    expect(tomorrowStartInIndia(new Date('2026-10-10T08:00:00Z')).toISOString()).toBe(
      '2026-10-10T18:30:00.000Z',
    );
    expect(tomorrowStartInIndia(new Date('2026-10-10T19:00:00Z')).toISOString()).toBe(
      '2026-10-11T18:30:00.000Z',
    );
  });
});

describe('conversionRate', () => {
  it('is a percentage with one decimal', () => {
    expect(conversionRate(6, 1)).toBe(16.7);
    expect(conversionRate(4, 4)).toBe(100);
    expect(conversionRate(3, 0)).toBe(0);
  });
  it('is null when nothing was created', () => {
    expect(conversionRate(0, 0)).toBeNull();
  });
});
