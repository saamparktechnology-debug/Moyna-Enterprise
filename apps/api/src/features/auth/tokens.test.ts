import { describe, expect, it } from 'vitest';
import { csrfTokenFor, generateSessionToken, hashToken, isValidCsrfToken } from './tokens.js';

describe('session tokens', () => {
  it('generates long, unique, url-safe tokens', () => {
    const tokens = new Set(Array.from({ length: 200 }, generateSessionToken));
    expect(tokens.size).toBe(200);
    for (const token of tokens) expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('stores only a one-way hash that differs from the token', () => {
    const token = generateSessionToken();
    expect(hashToken(token)).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).not.toContain(token);
    expect(hashToken(token)).toBe(hashToken(token));
    expect(hashToken(token)).not.toBe(hashToken(`${token}x`));
  });
});

describe('CSRF tokens', () => {
  const secret = 'a-secret-that-is-at-least-thirty-two-chars';

  it('is bound to the session and the secret', () => {
    const token = csrfTokenFor(secret, 'session-1');
    expect(isValidCsrfToken(secret, 'session-1', token)).toBe(true);
    expect(isValidCsrfToken(secret, 'session-2', token)).toBe(false);
    expect(isValidCsrfToken('another-secret-that-is-at-least-32-chars', 'session-1', token)).toBe(
      false,
    );
  });

  it.each([undefined, null, '', 42, ['a'], 'short', 'x'.repeat(200)])(
    'rejects the value %j',
    (value) => {
      expect(isValidCsrfToken(secret, 'session-1', value)).toBe(false);
    },
  );
});
