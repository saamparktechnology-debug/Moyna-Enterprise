import { ErrorResponseSchema } from '@erp/contracts';
import type { ErrorCode, ErrorDetail } from '@erp/contracts';
import type { z } from 'zod';

export type ApiErrorCode = ErrorCode | 'NETWORK_ERROR' | 'INVALID_RESPONSE';

export class ApiError extends Error {
  constructor(
    readonly code: ApiErrorCode,
    message: string,
    readonly status: number,
    readonly details: ErrorDetail[] = [],
    readonly requestId?: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

export interface ApiClient {
  get<S extends z.ZodType>(path: string, schema: S): Promise<z.output<S>>;
  post<S extends z.ZodType>(path: string, body: unknown, schema: S): Promise<z.output<S>>;
  put<S extends z.ZodType>(path: string, body: unknown, schema: S): Promise<z.output<S>>;
  patch<S extends z.ZodType>(path: string, body: unknown, schema: S): Promise<z.output<S>>;
  /** Sends a file as the request body (a KYC document, for example). Extra headers carry small details about it. */
  upload<S extends z.ZodType>(
    path: string,
    file: Blob,
    headers: Record<string, string>,
    schema: S,
  ): Promise<z.output<S>>;
  /** Fetches a file the signed-in user may read. */
  download(path: string): Promise<Blob>;
  setCsrfToken(token: string | null): void;
  /** The branch to work in, sent with every request. `null` means all the user's branches. */
  setActiveBranch(branchId: string | null): void;
}

interface ApiClientOptions {
  baseUrl: string;
  fetchFn?: typeof fetch;
  /** Called when the server says the session is no longer valid, except for the sign-in request itself. */
  onUnauthenticated?: () => void;
}

const SIGN_IN_PATH = '/auth/login';

async function readJson(response: Response): Promise<unknown> {
  try {
    return await response.json();
  } catch {
    return undefined;
  }
}

export function createApiClient({
  baseUrl,
  fetchFn,
  onUnauthenticated,
}: ApiClientOptions): ApiClient {
  const doFetch: typeof fetch = fetchFn ?? ((input, init) => fetch(input, init));
  let csrfToken: string | null = null;
  let activeBranch: string | null = null;

  async function toError(response: Response, path: string): Promise<ApiError> {
    const parsed = ErrorResponseSchema.safeParse(await readJson(response));
    const error = parsed.success
      ? new ApiError(
          parsed.data.code,
          parsed.data.message,
          response.status,
          parsed.data.details,
          parsed.data.requestId,
        )
      : new ApiError('INTERNAL_ERROR', 'The server returned an unexpected error', response.status);
    if (response.status === 401 && path !== SIGN_IN_PATH) onUnauthenticated?.();
    return error;
  }

  function baseHeaders(): Record<string, string> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (activeBranch) headers['x-branch-id'] = activeBranch;
    return headers;
  }

  async function transfer(path: string, init: RequestInit): Promise<Response> {
    try {
      return await doFetch(`${baseUrl}${path}`, { credentials: 'include', ...init });
    } catch {
      throw new ApiError('NETWORK_ERROR', 'Could not reach the server', 0);
    }
  }

  async function send<S extends z.ZodType>(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH',
    path: string,
    body: unknown,
    schema: S,
  ): Promise<z.output<S>> {
    const headers: Record<string, string> = { accept: 'application/json' };
    if (activeBranch) headers['x-branch-id'] = activeBranch;
    if (method !== 'GET') {
      headers['content-type'] = 'application/json';
      if (csrfToken) headers['x-csrf-token'] = csrfToken;
    }
    let response: Response;
    try {
      response = await doFetch(`${baseUrl}${path}`, {
        method,
        credentials: 'include',
        headers,
        ...(method !== 'GET' ? { body: JSON.stringify(body ?? {}) } : {}),
      });
    } catch {
      throw new ApiError('NETWORK_ERROR', 'Could not reach the server', 0);
    }

    if (!response.ok) throw await toError(response, path);
    const payload = await readJson(response);

    const result = schema.safeParse(payload);
    if (!result.success) {
      throw new ApiError(
        'INVALID_RESPONSE',
        'The server response did not match the contract',
        response.status,
      );
    }
    return result.data;
  }

  return {
    get: (path, schema) => send('GET', path, undefined, schema),
    post: (path, body, schema) => send('POST', path, body, schema),
    put: (path, body, schema) => send('PUT', path, body, schema),
    patch: (path, body, schema) => send('PATCH', path, body, schema),
    async upload(path, file, headers, schema) {
      const response = await transfer(path, {
        method: 'POST',
        headers: {
          ...baseHeaders(),
          ...headers,
          'content-type': file.type,
          ...(csrfToken ? { 'x-csrf-token': csrfToken } : {}),
        },
        body: file,
      });
      if (!response.ok) throw await toError(response, path);
      const result = schema.safeParse(await readJson(response));
      if (!result.success)
        throw new ApiError(
          'INVALID_RESPONSE',
          'The server response did not match the contract',
          response.status,
        );
      return result.data;
    },
    async download(path) {
      const response = await transfer(path, { method: 'GET', headers: baseHeaders() });
      if (!response.ok) throw await toError(response, path);
      return response.blob();
    },
    setCsrfToken(token) {
      csrfToken = token;
    },
    setActiveBranch(branchId) {
      activeBranch = branchId;
    },
  };
}
