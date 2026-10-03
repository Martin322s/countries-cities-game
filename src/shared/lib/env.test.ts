import { describe, expect, it } from 'vitest';

import { parseCaptchaEnv, parseSupabaseEnv } from './env';

function fakeJwt(payload: object): string {
  const encode = (value: object) => btoa(JSON.stringify(value)).replace(/=+$/, '');
  return `${encode({ alg: 'HS256', typ: 'JWT' })}.${encode(payload)}.signature`;
}

describe('parseSupabaseEnv', () => {
  it('accepts a URL and publishable key', () => {
    const result = parseSupabaseEnv({
      VITE_SUPABASE_URL: 'https://example.supabase.co',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc123',
    });
    expect(result).toEqual({
      ok: true,
      env: {
        supabaseUrl: 'https://example.supabase.co',
        supabasePublishableKey: 'sb_publishable_abc123',
      },
    });
  });

  it('accepts a legacy anon JWT', () => {
    const result = parseSupabaseEnv({
      VITE_SUPABASE_URL: 'http://127.0.0.1:54321',
      VITE_SUPABASE_PUBLISHABLE_KEY: fakeJwt({ role: 'anon' }),
    });
    expect(result.ok).toBe(true);
  });

  it('reports missing variables', () => {
    const result = parseSupabaseEnv({});
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors).toHaveLength(2);
  });

  it('rejects malformed URLs', () => {
    const result = parseSupabaseEnv({
      VITE_SUPABASE_URL: 'not a url',
      VITE_SUPABASE_PUBLISHABLE_KEY: 'sb_publishable_abc123',
    });
    expect(result.ok).toBe(false);
  });

  it.each([['sb_secret_abc123'], [fakeJwt({ role: 'service_role' })]])(
    'refuses secret keys in browser config (%s)',
    (key) => {
      const result = parseSupabaseEnv({
        VITE_SUPABASE_URL: 'https://example.supabase.co',
        VITE_SUPABASE_PUBLISHABLE_KEY: key,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) expect(result.errors[0]).toMatch(/secret/i);
    },
  );
});

describe('parseCaptchaEnv', () => {
  it('is off when nothing is configured', () => {
    expect(parseCaptchaEnv({})).toBeNull();
  });

  it('accepts Turnstile and hCaptcha with a public site key', () => {
    expect(
      parseCaptchaEnv({ VITE_CAPTCHA_PROVIDER: 'Turnstile', VITE_CAPTCHA_SITE_KEY: '0x4AAA' }),
    ).toEqual({
      provider: 'turnstile',
      siteKey: '0x4AAA',
    });
    expect(
      parseCaptchaEnv({ VITE_CAPTCHA_PROVIDER: 'hcaptcha', VITE_CAPTCHA_SITE_KEY: 'abc' })
        ?.provider,
    ).toBe('hcaptcha');
  });

  it('refuses a half or unknown configuration loudly', () => {
    expect(() => parseCaptchaEnv({ VITE_CAPTCHA_PROVIDER: 'turnstile' })).toThrow();
    expect(() => parseCaptchaEnv({ VITE_CAPTCHA_SITE_KEY: 'abc' })).toThrow();
    expect(() =>
      parseCaptchaEnv({ VITE_CAPTCHA_PROVIDER: 'recaptcha', VITE_CAPTCHA_SITE_KEY: 'abc' }),
    ).toThrow();
  });
});
