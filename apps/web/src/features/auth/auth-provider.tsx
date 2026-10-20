import { useQuery, useQueryClient } from '@tanstack/react-query';
import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { LoginRequest, SessionResponse, SessionUser } from '@erp/contracts';
import { clearActiveBranch } from '@/features/branches/active-branch';
import { api } from '@/lib/api';
import { onSessionExpired } from '@/lib/session-events';
import { fetchSession, login, logout } from './auth-api';

export const SESSION_KEY = ['session'] as const;
const SESSION_STALE_MS = 5 * 60_000;

type Status = 'loading' | 'authenticated' | 'anonymous' | 'error';

interface AuthState {
  status: Status;
  user: SessionUser | null;
  /** True when a signed-in user was signed out because their session ended. */
  expired: boolean;
  can: (permission: string) => boolean;
  signIn: (values: LoginRequest) => Promise<SessionResponse>;
  signOut: () => Promise<void>;
  applySession: (session: SessionResponse) => void;
  retry: () => void;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [expired, setExpired] = useState(false);
  const query = useQuery({
    queryKey: SESSION_KEY,
    queryFn: fetchSession,
    retry: false,
    staleTime: SESSION_STALE_MS,
    refetchOnWindowFocus: true,
  });

  useEffect(
    () =>
      onSessionExpired(() => {
        if (queryClient.getQueryData(SESSION_KEY)) setExpired(true);
        api.setCsrfToken(null);
        clearActiveBranch();
        queryClient.setQueryData(SESSION_KEY, null);
      }),
    [queryClient],
  );

  const applySession = useCallback(
    (session: SessionResponse) => {
      api.setCsrfToken(session.csrfToken);
      setExpired(false);
      queryClient.setQueryData(SESSION_KEY, session);
    },
    [queryClient],
  );

  const signIn = useCallback(
    async (values: LoginRequest) => {
      const session = await login(values);
      applySession(session);
      return session;
    },
    [applySession],
  );

  const signOut = useCallback(async () => {
    try {
      await logout();
    } catch {
      // The server could not be told, but this browser must still forget the user.
    } finally {
      setExpired(false);
      clearActiveBranch();
      queryClient.removeQueries({ predicate: (query) => query.queryKey[0] !== SESSION_KEY[0] });
      queryClient.setQueryData(SESSION_KEY, null);
    }
  }, [queryClient]);

  const user = query.data?.user ?? null;
  const status: Status = query.isError
    ? 'error'
    : query.isPending
      ? 'loading'
      : user
        ? 'authenticated'
        : 'anonymous';
  const permissions = useMemo(() => new Set(user?.permissions ?? []), [user]);
  const can = useCallback((permission: string) => permissions.has(permission), [permissions]);
  const retry = useCallback(() => void query.refetch(), [query]);

  const value = useMemo<AuthState>(
    () => ({ status, user, expired, can, signIn, signOut, applySession, retry }),
    [status, user, expired, can, signIn, signOut, applySession, retry],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const context = useContext(AuthContext);
  if (!context) throw new Error('useAuth must be used inside AuthProvider');
  return context;
}
