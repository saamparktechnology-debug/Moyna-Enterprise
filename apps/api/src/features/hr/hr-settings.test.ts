import { describe, expect, it } from 'vitest';
import type { TxClient } from '../../common/prisma/scoped-prisma.service.js';
import { loadHrSettings, loadOffDays, weeklyOffFor } from './hr-settings.js';

const at = (day: string) => new Date(`${day}T00:00:00.000Z`);

/** A transaction that answers only what these functions ask for. */
function fakeTx(data: {
  settings?: Record<string, unknown>;
  holidays?: { holidayDate: Date; name: string }[];
  daysOff?: { offDate: Date; name: string | null }[];
}): TxClient {
  return {
    appSetting: {
      findMany: async () =>
        Object.entries(data.settings ?? {}).map(([key, value]) => ({ key, value })),
    },
    holiday: { findMany: async () => data.holidays ?? [] },
    staffDayOff: { findMany: async () => data.daysOff ?? [] },
  } as unknown as TxClient;
}

describe('the HR settings', () => {
  it('are Sunday off, eight hours and no pay for off days until the owner says otherwise', async () => {
    expect(await loadHrSettings(fakeTx({}))).toEqual({
      dutyMinutes: 480,
      weeklyOff: ['SUN'],
      payOffDaysDaily: false,
    });
  });
  it('follow the settings the owner saved', async () => {
    const hr = await loadHrSettings(
      fakeTx({
        settings: {
          'company.full_duty_hours': 10,
          'company.weekly_off_days': 'SAT,SUN',
          'company.pay_off_days_daily': 'YES',
        },
      }),
    );
    expect(hr).toEqual({ dutyMinutes: 600, weeklyOff: ['SAT', 'SUN'], payOffDaysDaily: true });
    expect(
      (await loadHrSettings(fakeTx({ settings: { 'company.weekly_off_days': 'NONE' } }))).weeklyOff,
    ).toEqual([]);
  });
});

describe('weeklyOffFor', () => {
  it('uses the person’s own weekly off days when they have them, even none, and the company’s otherwise', () => {
    expect(weeklyOffFor(null, ['SUN'])).toEqual(['SUN']);
    expect(weeklyOffFor(undefined, ['SUN'])).toEqual(['SUN']);
    expect(weeklyOffFor('SAT,WED', ['SUN'])).toEqual(['WED', 'SAT']);
    expect(weeklyOffFor('NONE', ['SUN'])).toEqual([]);
  });
});

describe('loadOffDays', () => {
  const hr = { dutyMinutes: 480, weeklyOff: ['SUN' as const], payOffDaysDaily: false };

  it('lists the weekly offs in a range', async () => {
    const days = await loadOffDays(
      fakeTx({}),
      hr,
      { id: 's', weeklyOffDays: null },
      '2026-02-01',
      '2026-02-14',
    );
    expect([...days.keys()]).toEqual(['2026-02-01', '2026-02-08']);
    expect(days.get('2026-02-08')).toEqual({ kind: 'WEEKLY_OFF', name: null });
  });

  it('puts a person’s own day off before a holiday, and a holiday before a weekly off, naming each day once', async () => {
    const days = await loadOffDays(
      fakeTx({
        holidays: [
          { holidayDate: at('2026-02-08'), name: 'Shop holiday' },
          { holidayDate: at('2026-02-10'), name: 'Festival' },
        ],
        daysOff: [
          { offDate: at('2026-02-10'), name: 'Own day' },
          { offDate: at('2026-02-11'), name: null },
        ],
      }),
      hr,
      { id: 's', weeklyOffDays: null },
      '2026-02-01',
      '2026-02-14',
    );
    expect(days.get('2026-02-01')).toEqual({ kind: 'WEEKLY_OFF', name: null });
    expect(days.get('2026-02-08')).toEqual({ kind: 'HOLIDAY', name: 'Shop holiday' });
    expect(days.get('2026-02-10')).toEqual({ kind: 'DAY_OFF', name: 'Own day' });
    expect(days.get('2026-02-11')).toEqual({ kind: 'DAY_OFF', name: null });
    expect(days.size).toBe(4);
  });

  it('uses the weekly off days of the person, not the company’s, when they have their own', async () => {
    const days = await loadOffDays(
      fakeTx({}),
      hr,
      { id: 's', weeklyOffDays: 'SAT' },
      '2026-02-01',
      '2026-02-14',
    );
    expect([...days.keys()]).toEqual(['2026-02-07', '2026-02-14']);
    const none = await loadOffDays(
      fakeTx({}),
      hr,
      { id: 's', weeklyOffDays: 'NONE' },
      '2026-02-01',
      '2026-02-14',
    );
    expect(none.size).toBe(0);
  });

  it('covers a single day, and the last day of a range', async () => {
    const one = await loadOffDays(
      fakeTx({}),
      hr,
      { id: 's', weeklyOffDays: null },
      '2026-02-08',
      '2026-02-08',
    );
    expect([...one.keys()]).toEqual(['2026-02-08']);
    const end = await loadOffDays(
      fakeTx({}),
      hr,
      { id: 's', weeklyOffDays: null },
      '2026-02-02',
      '2026-02-08',
    );
    expect([...end.keys()]).toEqual(['2026-02-08']);
  });
});
