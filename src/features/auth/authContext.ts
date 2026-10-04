import { createContext, useContext } from 'react';

import type { PlayerId } from '@/domain';

/**
 * - not_configured: no Supabase URL/key in this build
 * - unreachable: the server cannot be reached; retried automatically, identity kept
 * - sign_in_failed: the server refused the anonymous sign-in
 */
export type AuthErrorKind = 'not_configured' | 'unreachable' | 'sign_in_failed';

export type AuthState =
  | { status: 'loading' }
  | { status: 'ready'; playerId: PlayerId }
  | { status: 'error'; kind: AuthErrorKind };

export interface AuthContextValue {
  state: AuthState;
  /** True when connecting has taken unusually long (the server is not answering). */
  slow: boolean;
  retry: () => void;
}

export const AuthContext = createContext<AuthContextValue | null>(null);

/** The anonymous player identity of this browser. */
export function useAuthSession(): AuthContextValue {
  const value = useContext(AuthContext);
  if (!value) throw new Error('useAuthSession must be used inside <AuthProvider>');
  return value;
}

/** Whether room actions can run yet (identity ready) or are still connecting. */
export function useIdentityGate(): { ready: boolean; connecting: boolean } {
  const { state } = useAuthSession();
  return {
    ready: state.status === 'ready',
    connecting:
      state.status === 'loading' || (state.status === 'error' && state.kind === 'unreachable'),
  };
}
