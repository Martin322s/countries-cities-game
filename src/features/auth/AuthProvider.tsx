import {
  lazy,
  Suspense,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';

import type { PlayerId } from '@/domain';
import { getCaptchaConfig } from '@/shared/lib/env';
import { getSupabaseClient, isSupabaseConfigured } from '@/shared/lib/supabase';
import { reportError } from '@/shared/lib/telemetry';

import {
  AnonymousSignInError,
  ensureAnonymousSession,
  resetAnonymousSessionCache,
} from './anonymousSession';
import { AuthContext, type AuthState } from './authContext';

// Only loaded when bot protection is configured and a new identity is being created.
const CaptchaChallenge = lazy(async () => ({
  default: (await import('./CaptchaChallenge')).CaptchaChallenge,
}));

/** After this long without an identity, tell the player the server is not answering. */
const SLOW_CONNECT_MS = 6_000;
/** While the server is unreachable, try again on this interval (identity is kept). */
const UNREACHABLE_RETRY_MS = 5_000;

/**
 * Establishes the anonymous Supabase identity once for the whole app.
 * Only identity lives here — room data stays in TanStack Query.
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<AuthState>(() =>
    isSupabaseConfigured() ? { status: 'loading' } : { status: 'error', kind: 'not_configured' },
  );
  const [attempt, setAttempt] = useState(0);
  const [slowAttempt, setSlowAttempt] = useState<number | null>(null);
  // Bot protection: shown only while a NEW anonymous identity waits for its token.
  const [captcha] = useState(getCaptchaConfig);
  const [captchaVisible, setCaptchaVisible] = useState(false);
  const resolveToken = useRef<((token: string) => void) | null>(null);
  const onCaptchaToken = useCallback((token: string) => {
    setCaptchaVisible(false);
    resolveToken.current?.(token);
    resolveToken.current = null;
  }, []);

  useEffect(() => {
    if (!isSupabaseConfigured()) return;
    const supabase = getSupabaseClient();
    let cancelled = false;
    let retryTimer: number | undefined;

    const slowTimer = window.setTimeout(() => {
      if (!cancelled) setSlowAttempt(attempt);
    }, SLOW_CONNECT_MS);

    const captchaToken = captcha
      ? () =>
          new Promise<string>((resolve) => {
            resolveToken.current = resolve;
            setCaptchaVisible(true);
          })
      : undefined;

    ensureAnonymousSession(supabase.auth, captchaToken ? { captchaToken } : {})
      .then((playerId) => {
        if (!cancelled) setState({ status: 'ready', playerId });
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        const unreachable = error instanceof AnonymousSignInError && error.reason === 'unreachable';
        // Being offline is expected; a refused sign-in (e.g. CAPTCHA, limits) is not.
        if (!unreachable) reportError('auth_failure', error);
        setState({ status: 'error', kind: unreachable ? 'unreachable' : 'sign_in_failed' });
        // A down server usually comes back: keep trying without user action.
        if (unreachable) {
          retryTimer = window.setTimeout(() => {
            setAttempt((value) => value + 1);
          }, UNREACHABLE_RETRY_MS);
        }
      });

    // Keep React in sync if the session changes outside this effect (other tab,
    // token refresh, sign-out). A sign-out triggers a fresh anonymous session.
    const { data } = supabase.auth.onAuthStateChange((event, session) => {
      if (cancelled) return;
      if (event === 'SIGNED_OUT') {
        resetAnonymousSessionCache(supabase.auth);
        setState({ status: 'loading' });
        setAttempt((value) => value + 1);
        return;
      }
      // INITIAL_SESSION is null on a first visit while sign-in is still in flight.
      if (!session) return;
      const playerId = session.user.id as PlayerId;
      setState((current) =>
        current.status === 'ready' && current.playerId === playerId
          ? current
          : { status: 'ready', playerId },
      );
    });

    return () => {
      cancelled = true;
      window.clearTimeout(slowTimer);
      window.clearTimeout(retryTimer);
      data.subscription.unsubscribe();
    };
  }, [attempt, captcha]);

  const retry = useCallback(() => {
    setState({ status: 'loading' });
    setAttempt((value) => value + 1);
  }, []);

  const slow = state.status !== 'ready' && slowAttempt !== null;
  const value = useMemo(() => ({ state, slow, retry }), [state, slow, retry]);
  return (
    <AuthContext value={value}>
      {children}
      {captcha && captchaVisible ? (
        <Suspense fallback={null}>
          <CaptchaChallenge config={captcha} onToken={onCaptchaToken} />
        </Suspense>
      ) : null}
    </AuthContext>
  );
}
