import { describe, expect, it } from 'vitest';
import { loadWorkerEnv } from '../config.js';
import { todayIst, tomorrowStartIst } from './reminders.js';

describe('reminder dates', () => {
  it('judge the day by the clock in India', () => {
    expect(todayIst(new Date('2026-10-10T08:00:00Z'))).toBe('2026-10-10');
    expect(todayIst(new Date('2026-10-10T19:00:00Z'))).toBe('2026-10-11');
  });
  it('end today at midnight in India', () => {
    expect(tomorrowStartIst(new Date('2026-10-10T08:00:00Z')).toISOString()).toBe(
      '2026-10-10T18:30:00.000Z',
    );
  });
});

describe('notification settings', () => {
  const base = { WORKER_DATABASE_URL: 'postgresql://w:w@localhost:5432/db' };
  it('send in-app only unless other channels are named', () => {
    expect(loadWorkerEnv(base).NOTIFICATION_CHANNELS).toEqual([]);
    expect(loadWorkerEnv(base).REMINDER_CRON).toBe('0 8 * * *');
  });
  it('accept a list of channels in any case', () => {
    expect(
      loadWorkerEnv({ ...base, NOTIFICATION_CHANNELS: 'email, Sms ,whatsapp' })
        .NOTIFICATION_CHANNELS,
    ).toEqual(['EMAIL', 'SMS', 'WHATSAPP']);
  });
  it('refuse a channel that does not exist', () => {
    expect(() => loadWorkerEnv({ ...base, NOTIFICATION_CHANNELS: 'pigeon' })).toThrow(
      /NOTIFICATION_CHANNELS/,
    );
  });
});
