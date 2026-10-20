import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';
import { ApiError, createApiClient } from './api-client';

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

describe('sending a file', () => {
  it('posts the file as the body with its own type, the session headers and any extra headers', async () => {
    const fetchFn = vi.fn(async () => json({ ok: true }));
    const api = createApiClient({ baseUrl: '/api', fetchFn });
    api.setCsrfToken('csrf-1');
    api.setActiveBranch('branch-1');
    const file = new File(['%PDF-1.4'], 'a.pdf', { type: 'application/pdf' });
    const result = await api.upload(
      '/up',
      file,
      { 'x-document-number': '123' },
      z.object({ ok: z.boolean() }),
    );
    expect(result).toEqual({ ok: true });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/up');
    expect(init.method).toBe('POST');
    expect(init.credentials).toBe('include');
    expect(init.body).toBe(file);
    expect(init.headers).toMatchObject({
      'content-type': 'application/pdf',
      'x-csrf-token': 'csrf-1',
      'x-branch-id': 'branch-1',
      'x-document-number': '123',
    });
  });

  it('turns an error answer into an ApiError with the server’s message and details', async () => {
    const api = createApiClient({
      baseUrl: '/api',
      fetchFn: async () =>
        json(
          {
            code: 'VALIDATION_ERROR',
            message: 'No',
            details: [{ field: 'file', message: 'Too big' }],
            requestId: 'r',
          },
          400,
        ),
    });
    const error = await api
      .upload('/up', new File(['x'], 'a.pdf', { type: 'application/pdf' }), {}, z.unknown())
      .catch((e: unknown) => e);
    expect(error).toBeInstanceOf(ApiError);
    expect(error).toMatchObject({
      code: 'VALIDATION_ERROR',
      status: 400,
      details: [{ field: 'file', message: 'Too big' }],
    });
  });

  it('reports a lost connection and an answer that does not match the contract', async () => {
    const down = createApiClient({
      baseUrl: '/api',
      fetchFn: async () => {
        throw new TypeError('offline');
      },
    });
    const file = new File(['x'], 'a.pdf', { type: 'application/pdf' });
    await expect(down.upload('/up', file, {}, z.unknown())).rejects.toMatchObject({
      code: 'NETWORK_ERROR',
    });
    const odd = createApiClient({ baseUrl: '/api', fetchFn: async () => json({ unexpected: 1 }) });
    await expect(odd.upload('/up', file, {}, z.object({ ok: z.boolean() }))).rejects.toMatchObject({
      code: 'INVALID_RESPONSE',
    });
  });

  it('signs the user out when the session has ended', async () => {
    const onUnauthenticated = vi.fn();
    const api = createApiClient({
      baseUrl: '/api',
      onUnauthenticated,
      fetchFn: async () =>
        json({ code: 'UNAUTHENTICATED', message: 'Sign in', details: [], requestId: 'r' }, 401),
    });
    await expect(
      api.upload('/up', new File(['x'], 'a.pdf', { type: 'application/pdf' }), {}, z.unknown()),
    ).rejects.toMatchObject({ status: 401 });
    expect(onUnauthenticated).toHaveBeenCalledTimes(1);
  });
});

describe('fetching a file', () => {
  it('returns the file and sends the session and branch', async () => {
    const fetchFn = vi.fn(
      async () => new Response('%PDF-1.4', { headers: { 'content-type': 'application/pdf' } }),
    );
    const api = createApiClient({ baseUrl: '/api', fetchFn });
    api.setActiveBranch('branch-1');
    const blob = await api.download('/file');
    expect(await blob.text()).toBe('%PDF-1.4');
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('/api/file');
    expect(init).toMatchObject({ method: 'GET', credentials: 'include' });
    expect(init.headers).toMatchObject({ 'x-branch-id': 'branch-1' });
  });

  it('turns an error answer into an ApiError', async () => {
    const api = createApiClient({
      baseUrl: '/api',
      fetchFn: async () =>
        json({ code: 'NOT_FOUND', message: 'Gone', details: [], requestId: 'r' }, 404),
    });
    await expect(api.download('/file')).rejects.toMatchObject({
      code: 'NOT_FOUND',
      message: 'Gone',
    });
  });

  it('reports a lost connection', async () => {
    const api = createApiClient({
      baseUrl: '/api',
      fetchFn: async () => {
        throw new TypeError('offline');
      },
    });
    await expect(api.download('/file')).rejects.toMatchObject({ code: 'NETWORK_ERROR' });
  });
});
