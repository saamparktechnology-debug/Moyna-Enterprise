import { describe, expect, it } from 'vitest';
import { readCookie, sessionCookieName, sessionCookieOptions } from './cookies.js';

describe('session cookie', () => {
  it('is HttpOnly, SameSite=Lax and site-wide in every environment', () => {
    for (const production of [false, true]) {
      expect(sessionCookieOptions(production, 1000)).toMatchObject({
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 1000,
      });
    }
  });

  it('is Secure and uses the __Host- prefix in production only', () => {
    expect(sessionCookieOptions(true, 1).secure).toBe(true);
    expect(sessionCookieName(true)).toBe('__Host-erp_session');
    expect(sessionCookieOptions(false, 1).secure).toBe(false);
    expect(sessionCookieName(false)).toBe('erp_session');
  });
});

describe('readCookie', () => {
  it('finds a cookie among several and ignores look-alikes', () => {
    const header = 'theme=dark; xerp_session=wrong; erp_session=abc123; other=1';
    expect(readCookie(header, 'erp_session')).toBe('abc123');
  });

  it.each([undefined, '', 'a=1', 'erp_session=', 'erp_session', ';;;'])(
    'returns nothing for %j',
    (header) => {
      expect(readCookie(header, 'erp_session')).toBeUndefined();
    },
  );

  it('keeps equals signs inside the value', () => {
    expect(readCookie('erp_session=a=b=c', 'erp_session')).toBe('a=b=c');
  });
});
