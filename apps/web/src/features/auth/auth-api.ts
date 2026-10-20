import { OkResponseSchema, SessionResponseSchema } from '@erp/contracts';
import type { ChangePasswordRequest, LoginRequest, SessionResponse } from '@erp/contracts';
import { api } from '@/lib/api';
import { restoreActiveBranch } from '@/features/branches/active-branch';
import { ApiError } from '@/lib/api-client';

export async function fetchSession(): Promise<SessionResponse | null> {
  try {
    const session = await api.get('/auth/session', SessionResponseSchema);
    api.setCsrfToken(session.csrfToken);
    restoreActiveBranch(session.user);
    return session;
  } catch (error) {
    if (error instanceof ApiError && error.status === 401) {
      api.setCsrfToken(null);
      return null;
    }
    throw error;
  }
}

export async function login(values: LoginRequest): Promise<SessionResponse> {
  const session = await api.post('/auth/login', values, SessionResponseSchema);
  api.setCsrfToken(session.csrfToken);
  restoreActiveBranch(session.user);
  return session;
}

export async function logout(): Promise<void> {
  try {
    await api.post('/auth/logout', {}, OkResponseSchema);
  } finally {
    api.setCsrfToken(null);
  }
}

export async function changePassword(values: ChangePasswordRequest): Promise<SessionResponse> {
  const session = await api.post('/auth/change-password', values, SessionResponseSchema);
  api.setCsrfToken(session.csrfToken);
  return session;
}
