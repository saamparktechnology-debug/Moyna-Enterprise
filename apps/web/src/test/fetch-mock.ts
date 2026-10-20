import type { SessionResponse, SessionUser } from '@erp/contracts';
import { vi } from 'vitest';

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

export function stubFetch(handler: () => Promise<Response>) {
  const fetchMock = vi.fn(handler);
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

export const healthyBody = { status: 'ok', database: 'up', uptimeSeconds: 42.7 };

export const databaseDownBody = {
  code: 'DATABASE_UNAVAILABLE',
  message: 'The database is not reachable',
  details: [],
  requestId: 'req-9',
};

export const unauthenticatedBody = {
  code: 'UNAUTHENTICATED',
  message: 'Sign in to continue',
  details: [],
  requestId: 'req-1',
};

export const ALL_PERMISSIONS = [
  'stock.view',
  'invoices.view',
  'customers.view',
  'reports.view',
  'settings.manage',
];

export function makeUser(overrides: Partial<SessionUser> = {}): SessionUser {
  return {
    id: 'user-1',
    username: 'ravi',
    fullName: 'Ravi Kumar',
    email: 'ravi@example.com',
    roles: ['ADMIN'],
    permissions: ALL_PERMISSIONS,
    branches: [{ id: 'b1', code: 'HQ', name: 'Head Office' }],
    isSuperAdmin: false,
    mustChangePassword: false,
    ...overrides,
  };
}

export function makeSession(
  overrides: Partial<SessionUser> = {},
  csrfToken = 'csrf-1',
): SessionResponse {
  return { user: makeUser(overrides), csrfToken, expiresAt: '2026-10-08T00:00:00.000Z' };
}

export interface RecordedCall {
  key: string;
  body: unknown;
  headers: Record<string, string>;
}

export type RouteHandler = (call: RecordedCall) => Response | Promise<Response>;

export function routeFetch(handlers: Record<string, RouteHandler>) {
  const calls: RecordedCall[] = [];
  const fetchMock = vi.fn(async (input: string, init?: RequestInit) => {
    const key = `${init?.method ?? 'GET'} ${input}`;
    const call: RecordedCall = {
      key,
      body: typeof init?.body === 'string' ? (JSON.parse(init.body) as unknown) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
    calls.push(call);
    const handler =
      handlers[key] ??
      Object.entries(handlers).find(
        ([pattern]) => pattern.endsWith('*') && key.startsWith(pattern.slice(0, -1)),
      )?.[1];
    if (!handler)
      return jsonResponse(
        { code: 'NOT_FOUND', message: `No test handler for ${key}`, details: [], requestId: 't' },
        404,
      );
    return handler(call);
  });
  vi.stubGlobal('fetch', fetchMock);
  return {
    fetchMock,
    calls,
    count: (key: string) => calls.filter((call) => call.key === key).length,
  };
}

export const signedIn = (session = makeSession()): Record<string, RouteHandler> => ({
  'GET /api/auth/session': () => jsonResponse(session),
  'GET /api/health': () => jsonResponse(healthyBody),
});

export const signedOut = (): Record<string, RouteHandler> => ({
  'GET /api/auth/session': () => jsonResponse(unauthenticatedBody, 401),
  'GET /api/health': () => jsonResponse(healthyBody),
});
