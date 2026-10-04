import { describe, expect, it, vi } from 'vitest';

import {
  AnonymousSignInError,
  ensureAnonymousSession,
  type AnonymousAuthClient,
} from './anonymousSession';

function fakeAuth(options: { storedUserId?: string; signInUserId?: string; failSignIn?: boolean }) {
  let storedUserId = options.storedUserId ?? null;
  const client = {
    getSession: vi.fn(() =>
      Promise.resolve({
        data: { session: storedUserId ? { user: { id: storedUserId } } : null },
        error: null,
      }),
    ),
    signInAnonymously: vi.fn(() => {
      if (options.failSignIn) {
        return Promise.resolve({ data: { user: null }, error: new Error('disabled') });
      }
      storedUserId = options.signInUserId ?? 'new-user';
      return Promise.resolve({ data: { user: { id: storedUserId } }, error: null });
    }),
  } satisfies AnonymousAuthClient;
  return client;
}

describe('ensureAnonymousSession', () => {
  it('reuses the persisted identity on refresh instead of creating a new user', async () => {
    const auth = fakeAuth({ storedUserId: 'existing-user' });
    await expect(ensureAnonymousSession(auth)).resolves.toBe('existing-user');
    expect(auth.signInAnonymously).not.toHaveBeenCalled();
  });

  it('signs in anonymously on first use', async () => {
    const auth = fakeAuth({ signInUserId: 'fresh-user' });
    await expect(ensureAnonymousSession(auth)).resolves.toBe('fresh-user');
    expect(auth.signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it('never creates two anonymous users for concurrent callers', async () => {
    const auth = fakeAuth({ signInUserId: 'only-user' });
    const results = await Promise.all([
      ensureAnonymousSession(auth),
      ensureAnonymousSession(auth),
      ensureAnonymousSession(auth),
    ]);
    expect(results).toEqual(['only-user', 'only-user', 'only-user']);
    expect(auth.signInAnonymously).toHaveBeenCalledTimes(1);
  });

  it('surfaces sign-in failure and allows a retry', async () => {
    const auth = fakeAuth({ failSignIn: true });
    await expect(ensureAnonymousSession(auth)).rejects.toBeInstanceOf(AnonymousSignInError);
    await expect(ensureAnonymousSession(auth)).rejects.toBeInstanceOf(AnonymousSignInError);
    expect(auth.signInAnonymously).toHaveBeenCalledTimes(2);
  });
});

describe('ensureAnonymousSession when the server is unreachable', () => {
  const networkError = { name: 'AuthRetryableFetchError', message: 'Failed to fetch', status: 0 };

  it('never creates a new identity when the stored session cannot be refreshed', async () => {
    const auth = {
      getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: networkError })),
      signInAnonymously: vi.fn(() =>
        Promise.resolve({ data: { user: { id: 'impostor' } }, error: null }),
      ),
    } satisfies AnonymousAuthClient;

    const result = ensureAnonymousSession(auth);
    await expect(result).rejects.toMatchObject({ reason: 'unreachable' });
    expect(auth.signInAnonymously).not.toHaveBeenCalled();
  });

  it('starts a fresh identity when the stored session is invalid (not a network problem)', async () => {
    const auth = {
      getSession: vi.fn(() =>
        Promise.resolve({
          data: { session: null },
          error: { name: 'AuthApiError', message: 'Invalid Refresh Token', status: 400 },
        }),
      ),
      signInAnonymously: vi.fn(() =>
        Promise.resolve({ data: { user: { id: 'fresh' } }, error: null }),
      ),
    } satisfies AnonymousAuthClient;

    await expect(ensureAnonymousSession(auth)).resolves.toBe('fresh');
  });

  it('classifies sign-in failures as unreachable or rejected', async () => {
    const offline = {
      getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
      signInAnonymously: vi.fn(() =>
        Promise.resolve({ data: { user: null }, error: networkError }),
      ),
    } satisfies AnonymousAuthClient;
    await expect(ensureAnonymousSession(offline)).rejects.toMatchObject({ reason: 'unreachable' });

    const refused = {
      getSession: vi.fn(() => Promise.resolve({ data: { session: null }, error: null })),
      signInAnonymously: vi.fn(() =>
        Promise.resolve({ data: { user: null }, error: { name: 'AuthApiError', status: 422 } }),
      ),
    } satisfies AnonymousAuthClient;
    await expect(ensureAnonymousSession(refused)).rejects.toMatchObject({ reason: 'rejected' });
  });
});

describe('ensureAnonymousSession with bot protection', () => {
  it('asks for a CAPTCHA token only when a new identity is created, and sends it', async () => {
    const auth = fakeAuth({ signInUserId: 'fresh-user' });
    const captchaToken = vi.fn(() => Promise.resolve('token-123'));
    await expect(ensureAnonymousSession(auth, { captchaToken })).resolves.toBe('fresh-user');
    expect(captchaToken).toHaveBeenCalledTimes(1);
    expect(auth.signInAnonymously).toHaveBeenCalledWith({ options: { captchaToken: 'token-123' } });
  });

  it('never shows a CAPTCHA to a returning player (restored session)', async () => {
    const auth = fakeAuth({ storedUserId: 'existing-user' });
    const captchaToken = vi.fn(() => Promise.resolve('unused'));
    await expect(ensureAnonymousSession(auth, { captchaToken })).resolves.toBe('existing-user');
    expect(captchaToken).not.toHaveBeenCalled();
  });

  it('does not ask for a CAPTCHA (or create a user) while the server is unreachable', async () => {
    const auth = {
      getSession: vi.fn(() =>
        Promise.resolve({ data: { session: null }, error: new TypeError('Failed to fetch') }),
      ),
      signInAnonymously: vi.fn(),
    } as unknown as AnonymousAuthClient;
    const captchaToken = vi.fn(() => Promise.resolve('unused'));
    await expect(ensureAnonymousSession(auth, { captchaToken })).rejects.toMatchObject({
      reason: 'unreachable',
    });
    expect(captchaToken).not.toHaveBeenCalled();
  });
});
