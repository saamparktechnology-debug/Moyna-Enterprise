import { createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';

const TOKEN_BYTES = 32;

export function generateSessionToken(): string {
  return randomBytes(TOKEN_BYTES).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export function csrfTokenFor(secret: string, sessionId: string): string {
  return createHmac('sha256', secret).update(`csrf:${sessionId}`).digest('base64url');
}

export function isValidCsrfToken(secret: string, sessionId: string, supplied: unknown): boolean {
  if (typeof supplied !== 'string' || supplied.length === 0) return false;
  const expected = Buffer.from(csrfTokenFor(secret, sessionId));
  const given = Buffer.from(supplied);
  return expected.length === given.length && timingSafeEqual(expected, given);
}
