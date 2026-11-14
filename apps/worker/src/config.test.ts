import { describe, expect, it } from 'vitest';
import { loadWorkerEnv } from './config.js';

describe('loadWorkerEnv', () => {
  it('accepts a valid environment and applies defaults', () => {
    const env = loadWorkerEnv({
      WORKER_DATABASE_URL: 'postgresql://erp:erp@localhost:5432/erp_dev',
    });
    expect(env.NODE_ENV).toBe('development');
    expect(env.LOG_LEVEL).toBe('info');
  });

  it('rejects a missing or non-postgres WORKER_DATABASE_URL', () => {
    expect(() => loadWorkerEnv({})).toThrowError(/WORKER_DATABASE_URL/);
    expect(() => loadWorkerEnv({ WORKER_DATABASE_URL: 'http://x' })).toThrowError(/postgres/);
  });
});

describe('outbox settings', () => {
  const base = { WORKER_DATABASE_URL: 'postgresql://erp_worker:x@localhost:5432/erp_dev' };

  it('defaults to a 2 second poll, batches of 50 and 5 attempts', () => {
    expect(loadWorkerEnv(base)).toMatchObject({
      OUTBOX_POLL_INTERVAL_MS: 2000,
      OUTBOX_BATCH_SIZE: 50,
      OUTBOX_MAX_ATTEMPTS: 5,
    });
  });

  it.each([
    ['OUTBOX_POLL_INTERVAL_MS', '5'],
    ['OUTBOX_BATCH_SIZE', '0'],
    ['OUTBOX_BATCH_SIZE', '1000'],
    ['OUTBOX_MAX_ATTEMPTS', '0'],
    ['OUTBOX_MAX_ATTEMPTS', 'many'],
  ])('rejects %s=%s', (name, value) => {
    expect(() => loadWorkerEnv({ ...base, [name]: value })).toThrowError(new RegExp(name));
  });
});

describe('the mail settings', () => {
  const base = { WORKER_DATABASE_URL: 'postgresql://erp_worker:x@localhost:5432/erp' };

  it('use Google as the mail server unless told otherwise, and need no user', () => {
    const env = loadWorkerEnv(base);
    expect(env.SMTP_HOST).toBe('smtp.gmail.com');
    expect(env.SMTP_PORT).toBe(465);
    expect(env.SMTP_USER).toBeUndefined();
  });

  it('take a user, a password and a sender', () => {
    const env = loadWorkerEnv({
      ...base,
      SMTP_USER: 'shop@gmail.com',
      SMTP_PASSWORD: 'app-password',
      SMTP_FROM: 'Shop <shop@gmail.com>',
    });
    expect(env).toMatchObject({ SMTP_USER: 'shop@gmail.com', SMTP_FROM: 'Shop <shop@gmail.com>' });
  });
});
