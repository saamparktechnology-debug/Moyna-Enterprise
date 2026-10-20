import { HealthResponseSchema } from '@erp/contracts';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApiClient } from './api-client';
import { databaseDownBody, healthyBody, jsonResponse } from '@/test/fetch-mock';

function clientWith(fetchFn: typeof fetch) {
  return createApiClient({ baseUrl: '/api', fetchFn });
}

describe('api client', () => {
  it('requests the base URL plus path with credentials and returns the parsed body', async () => {
    const fetchFn = vi.fn(() => Promise.resolve(jsonResponse(healthyBody)));

    const result = await clientWith(fetchFn).get('/health', HealthResponseSchema);

    expect(result).toEqual(healthyBody);
    expect(fetchFn).toHaveBeenCalledWith(
      '/api/health',
      expect.objectContaining({ credentials: 'include' }),
    );
  });

  it('resolves the global fetch at call time when none is injected', async () => {
    const client = createApiClient({ baseUrl: '/api' });
    const fetchMock = vi.fn(() => Promise.resolve(jsonResponse(healthyBody)));
    vi.stubGlobal('fetch', fetchMock);

    await client.get('/health', HealthResponseSchema);

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('turns a standard error response into an ApiError', async () => {
    const client = clientWith(() => Promise.resolve(jsonResponse(databaseDownBody, 503)));

    const error = await client.get('/health', HealthResponseSchema).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: 'DATABASE_UNAVAILABLE',
      status: 503,
      requestId: 'req-9',
      message: 'The database is not reachable',
    });
  });

  it('falls back to INTERNAL_ERROR when an error body is not in the standard shape', async () => {
    const client = clientWith(() =>
      Promise.resolve(new Response('<html>Bad gateway</html>', { status: 502 })),
    );

    await expect(client.get('/health', HealthResponseSchema)).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      status: 502,
    });
  });

  it('reports a network failure as NETWORK_ERROR', async () => {
    const client = clientWith(() => Promise.reject(new TypeError('Failed to fetch')));

    await expect(client.get('/health', HealthResponseSchema)).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
      status: 0,
    });
  });

  it('rejects a success response that does not match the contract', async () => {
    const client = clientWith(() =>
      Promise.resolve(jsonResponse({ status: 'ok', database: 'down', uptimeSeconds: 1 })),
    );

    await expect(client.get('/health', HealthResponseSchema)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('rejects a success response that is not JSON', async () => {
    const client = clientWith(() => Promise.resolve(new Response('ok', { status: 200 })));

    await expect(client.get('/health', HealthResponseSchema)).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });
});

describe('api client sessions', () => {
  const Ok = HealthResponseSchema;

  it('sends JSON and the CSRF token on writes, and nothing extra on reads', async () => {
    const fetchFn = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(jsonResponse(healthyBody)),
    );
    const client = createApiClient({
      baseUrl: '/api',
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    client.setCsrfToken('token-1');

    await client.get('/health', Ok);
    await client.post('/things', { a: 1 }, Ok);

    const [read, write] = fetchFn.mock.calls.map((call) => call[1] as RequestInit);
    expect((read?.headers as Record<string, string>)['x-csrf-token']).toBeUndefined();
    expect(read?.body).toBeUndefined();
    expect(write?.method).toBe('POST');
    expect(write?.headers).toMatchObject({
      'x-csrf-token': 'token-1',
      'content-type': 'application/json',
    });
    expect(write?.body).toBe('{"a":1}');
    expect(write?.credentials).toBe('include');
  });

  it('stops sending the token once it is cleared', async () => {
    const fetchFn = vi.fn((_url: string, _init?: RequestInit) =>
      Promise.resolve(jsonResponse(healthyBody)),
    );
    const client = createApiClient({
      baseUrl: '/api',
      fetchFn: fetchFn as unknown as typeof fetch,
    });
    client.setCsrfToken('token-1');
    client.setCsrfToken(null);
    await client.post('/things', {}, Ok);
    expect((fetchFn.mock.calls[0]?.[1] as RequestInit).headers).not.toHaveProperty('x-csrf-token');
  });

  const unauthenticated = {
    code: 'UNAUTHENTICATED',
    message: 'Sign in to continue',
    details: [],
    requestId: 'r',
  };

  it('tells the application when the session has expired', async () => {
    const onUnauthenticated = vi.fn();
    const client = createApiClient({
      baseUrl: '/api',
      fetchFn: () => Promise.resolve(jsonResponse(unauthenticated, 401)),
      onUnauthenticated,
    });
    await expect(client.get('/stock', Ok)).rejects.toMatchObject({
      code: 'UNAUTHENTICATED',
      status: 401,
    });
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
  });

  it('does not treat a failed sign-in as an expired session', async () => {
    const onUnauthenticated = vi.fn();
    const client = createApiClient({
      baseUrl: '/api',
      fetchFn: () => Promise.resolve(jsonResponse(unauthenticated, 401)),
      onUnauthenticated,
    });
    await expect(client.post('/auth/login', {}, Ok)).rejects.toMatchObject({ status: 401 });
    expect(onUnauthenticated).not.toHaveBeenCalled();
  });

  it('keeps field details from a validation error', async () => {
    const body = {
      code: 'VALIDATION_ERROR',
      message: 'Choose a stronger password',
      details: [{ field: 'newPassword', message: 'Too common' }],
      requestId: 'r',
    };
    const client = createApiClient({
      baseUrl: '/api',
      fetchFn: () => Promise.resolve(jsonResponse(body, 400)),
    });
    await expect(client.post('/auth/change-password', {}, Ok)).rejects.toMatchObject({
      details: [{ field: 'newPassword', message: 'Too common' }],
    });
  });
});
