import type { CookieOptions } from 'express';

export function sessionCookieName(production: boolean): string {
  return production ? '__Host-erp_session' : 'erp_session';
}

export function sessionCookieOptions(production: boolean, maxAgeMs: number): CookieOptions {
  return { httpOnly: true, secure: production, sameSite: 'lax', path: '/', maxAge: maxAgeMs };
}

export function readCookie(header: string | undefined, name: string): string | undefined {
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const separator = part.indexOf('=');
    if (separator === -1) continue;
    if (part.slice(0, separator).trim() === name) {
      const value = part.slice(separator + 1).trim();
      return value.length > 0 ? value : undefined;
    }
  }
  return undefined;
}
