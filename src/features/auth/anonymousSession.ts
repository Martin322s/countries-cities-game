import type { PlayerId } from '@/domain';

/** The subset of the supabase-js auth client this module depends on (keeps it testable). */
export interface AnonymousAuthClient {
  getSession(): Promise<{
    data: { session: { user: { id: string } } | null };
    error: unknown;
  }>;
  signInAnonymously(credentials?: { options?: { captchaToken?: string } }): Promise<{
    data: { user: { id: string } | null };
    error: unknown;
  }>;
}

/**
 * - `unreachable`: the auth server could not be reached (offline, server down). The
 *   stored session — if any — is kept, so the player keeps their identity once the
 *   server is back.
 * - `rejected`: the server answered but refused (e.g. anonymous sign-ins disabled).
 */
export type AnonymousSessionFailure = 'unreachable' | 'rejected';

export class AnonymousSignInError extends Error {
  constructor(
    readonly reason: AnonymousSessionFailure,
    readonly causeError: unknown,
  ) {
    super(`Anonymous session unavailable: ${reason}`);
    this.name = 'AnonymousSignInError';
  }
}

/** Network-level failure: supabase-js reports these as AuthRetryableFetchError. */
export function isNetworkFailure(error: unknown): boolean {
  if (error instanceof TypeError) return true;
  return (
    typeof error === 'object' &&
    error !== null &&
    'name' in error &&
    error.name === 'AuthRetryableFetchError'
  );
}

const inFlight = new WeakMap<AnonymousAuthClient, Promise<PlayerId>>();

/**
 * Returns the persistent anonymous player id, creating an anonymous session only when
 * none is stored yet.
 *
 * - Refresh/reconnect: supabase-js restores the session from localStorage, so the same
 *   `auth.uid()` (= PlayerId) comes back and no new user is created.
 * - Server unreachable: when the stored session cannot be refreshed because of a
 *   network failure, we fail with `unreachable` and NEVER create a new anonymous user —
 *   that would silently turn the player into a different person and cost them their
 *   seat. supabase-js keeps the stored session for the next attempt.
 * - Stored session invalid (e.g. revoked, local database reset): supabase-js drops it
 *   and a fresh anonymous session is created.
 * - Concurrent callers (e.g. React StrictMode double effects, several components)
 *   share one in-flight promise, so two anonymous users are never created at once.
 */
export interface EnsureSessionOptions {
  /**
   * Bot protection: asked for a fresh CAPTCHA token ONLY when a new anonymous identity
   * has to be created (never for a restored session, never for game actions).
   */
  captchaToken?: () => Promise<string>;
}

export function ensureAnonymousSession(
  auth: AnonymousAuthClient,
  options: EnsureSessionOptions = {},
): Promise<PlayerId> {
  const pending = inFlight.get(auth);
  if (pending) return pending;

  const promise = (async () => {
    const { data: sessionData, error: sessionError } = await auth.getSession();
    if (sessionData.session) {
      return sessionData.session.user.id as PlayerId;
    }
    if (sessionError && isNetworkFailure(sessionError)) {
      throw new AnonymousSignInError('unreachable', sessionError);
    }

    const captchaToken = options.captchaToken ? await options.captchaToken() : undefined;
    const { data, error } = await auth.signInAnonymously(
      captchaToken ? { options: { captchaToken } } : undefined,
    );
    if (error || !data.user) {
      throw new AnonymousSignInError(isNetworkFailure(error) ? 'unreachable' : 'rejected', error);
    }
    return data.user.id as PlayerId;
  })();

  inFlight.set(auth, promise);
  // Allow a later retry after failure; successful results stay cached per client.
  promise.catch(() => inFlight.delete(auth));
  return promise;
}

/** Forget the cached result, e.g. after the session was signed out elsewhere. */
export function resetAnonymousSessionCache(auth: AnonymousAuthClient): void {
  inFlight.delete(auth);
}
