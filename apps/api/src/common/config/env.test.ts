import { describe, expect, it } from 'vitest';
import { ConfigValidationError, loadEnv } from './env.js';

const validSource = {
  DATABASE_URL: 'postgresql://erp:secret-pass@localhost:5432/erp_dev',
  SESSION_SECRET: 'a-session-secret-that-is-long-enough-123',
};

describe('loadEnv', () => {
  it('accepts a minimal valid environment and applies defaults', () => {
    const env = loadEnv(validSource);
    expect(env).toMatchObject({
      NODE_ENV: 'development',
      API_PORT: 3000,
      LOG_LEVEL: 'info',
      WEB_ORIGIN: 'http://localhost:5173',
      DATABASE_URL: validSource.DATABASE_URL,
    });
  });

  it('coerces the port from a string', () => {
    expect(loadEnv({ ...validSource, API_PORT: '4100' }).API_PORT).toBe(4100);
  });

  it('rejects a missing or short SESSION_SECRET and never echoes it', () => {
    expect(() => loadEnv({ DATABASE_URL: validSource.DATABASE_URL })).toThrowError(
      /SESSION_SECRET/,
    );
    try {
      loadEnv({ ...validSource, SESSION_SECRET: 'too-short-secret' });
      expect.unreachable();
    } catch (error) {
      expect((error as Error).message).toMatch(/SESSION_SECRET/);
      expect((error as Error).message).not.toContain('too-short-secret');
    }
  });

  it('rejects a missing DATABASE_URL', () => {
    expect(() => loadEnv({ SESSION_SECRET: validSource.SESSION_SECRET })).toThrowError(
      ConfigValidationError,
    );
    expect(() => loadEnv({ SESSION_SECRET: validSource.SESSION_SECRET })).toThrowError(
      /DATABASE_URL/,
    );
  });

  it('rejects a DATABASE_URL that is not a postgres URL', () => {
    expect(() => loadEnv({ DATABASE_URL: 'mysql://localhost/db' })).toThrowError(/postgres/);
  });

  it.each(['0', '70000', 'abc', '3000.5'])('rejects the invalid port %s', (port) => {
    expect(() => loadEnv({ ...validSource, API_PORT: port })).toThrowError(/API_PORT/);
  });

  it('rejects an unknown NODE_ENV and an unknown LOG_LEVEL', () => {
    expect(() => loadEnv({ ...validSource, NODE_ENV: 'staging' })).toThrowError(/NODE_ENV/);
    expect(() => loadEnv({ ...validSource, LOG_LEVEL: 'loud' })).toThrowError(/LOG_LEVEL/);
  });

  it('rejects an invalid WEB_ORIGIN', () => {
    expect(() => loadEnv({ ...validSource, WEB_ORIGIN: 'not a url' })).toThrowError(/WEB_ORIGIN/);
  });

  it('reports every problem at once and never echoes secret values', () => {
    try {
      loadEnv({
        DATABASE_URL: 'mysql://user:secret-pass@host/db',
        API_PORT: 'abc',
        SESSION_SECRET: validSource.SESSION_SECRET,
      });
      expect.unreachable('loadEnv should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(ConfigValidationError);
      const typed = error as ConfigValidationError;
      expect(typed.problems).toHaveLength(2);
      expect(typed.message).not.toContain('secret-pass');
    }
  });

  it('takes an optional approval limit for exchanges, as an amount in rupees', () => {
    expect(loadEnv(validSource).EXCHANGE_ADMIN_APPROVAL_LIMIT).toBeUndefined();
    expect(
      loadEnv({ ...validSource, EXCHANGE_ADMIN_APPROVAL_LIMIT: ' 50000 ' })
        .EXCHANGE_ADMIN_APPROVAL_LIMIT,
    ).toBe('50000');
    expect(
      loadEnv({ ...validSource, EXCHANGE_ADMIN_APPROVAL_LIMIT: '50000.50' })
        .EXCHANGE_ADMIN_APPROVAL_LIMIT,
    ).toBe('50000.50');
    for (const bad of ['-1', 'lots', '1.234', '50,000', ''])
      expect(() => loadEnv({ ...validSource, EXCHANGE_ADMIN_APPROVAL_LIMIT: bad }), bad).toThrow(
        ConfigValidationError,
      );
  });
});
