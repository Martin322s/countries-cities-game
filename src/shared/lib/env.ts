/**
 * Validated access to public (browser-safe) environment variables.
 *
 * Validation is lazy: the landing page and pure game logic work without Supabase
 * credentials, while any feature that needs the backend fails fast with a clear message.
 */
export interface SupabaseEnv {
  supabaseUrl: string;
  supabasePublishableKey: string;
}

export type EnvResult = { ok: true; env: SupabaseEnv } | { ok: false; errors: string[] };

type RawEnv = Partial<
  Record<'VITE_SUPABASE_URL' | 'VITE_SUPABASE_PUBLISHABLE_KEY', string | undefined>
>;

/** Service-role / secret keys must never reach the browser bundle. */
function looksLikeSecretKey(key: string): boolean {
  if (key.startsWith('sb_secret_')) return true;
  // Legacy JWT keys carry their role in the payload.
  const payload = key.split('.')[1];
  if (!payload) return false;
  try {
    const decoded = JSON.parse(atob(payload.replace(/-/g, '+').replace(/_/g, '/'))) as unknown;
    return (
      typeof decoded === 'object' &&
      decoded !== null &&
      'role' in decoded &&
      decoded.role === 'service_role'
    );
  } catch {
    return false;
  }
}

export function parseSupabaseEnv(raw: RawEnv): EnvResult {
  const errors: string[] = [];
  const url = raw.VITE_SUPABASE_URL?.trim() ?? '';
  const key = raw.VITE_SUPABASE_PUBLISHABLE_KEY?.trim() ?? '';

  if (!url) {
    errors.push('VITE_SUPABASE_URL is not set.');
  } else if (!URL.canParse(url) || !/^https?:$/.test(new URL(url).protocol)) {
    errors.push('VITE_SUPABASE_URL must be an http(s) URL.');
  }

  if (!key) {
    errors.push('VITE_SUPABASE_PUBLISHABLE_KEY is not set.');
  } else if (looksLikeSecretKey(key)) {
    errors.push(
      'VITE_SUPABASE_PUBLISHABLE_KEY contains a secret/service-role key. ' +
        'Use the publishable (or legacy anon) key — secret keys must never be shipped to browsers.',
    );
  }

  return errors.length > 0
    ? { ok: false, errors }
    : { ok: true, env: { supabaseUrl: url, supabasePublishableKey: key } };
}

let cached: EnvResult | undefined;

export function getSupabaseEnv(): EnvResult {
  cached ??= parseSupabaseEnv({
    VITE_SUPABASE_URL: import.meta.env.VITE_SUPABASE_URL,
    VITE_SUPABASE_PUBLISHABLE_KEY: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY,
  });
  return cached;
}

/*
 * Bot protection for anonymous sign-ins (optional). Both values are PUBLIC: the site
 * key identifies the widget; verification happens in Supabase Auth with the secret
 * configured there (Dashboard → Authentication → Attack Protection). Leaving them unset
 * shows no CAPTCHA — and if the server requires one, sign-in is refused, never skipped.
 */
export type CaptchaProvider = 'turnstile' | 'hcaptcha';

export interface CaptchaConfig {
  provider: CaptchaProvider;
  siteKey: string;
}

export function parseCaptchaEnv(raw: {
  VITE_CAPTCHA_PROVIDER?: string | undefined;
  VITE_CAPTCHA_SITE_KEY?: string | undefined;
}): CaptchaConfig | null {
  const provider = raw.VITE_CAPTCHA_PROVIDER?.trim().toLowerCase() ?? '';
  const siteKey = raw.VITE_CAPTCHA_SITE_KEY?.trim() ?? '';
  if (!provider && !siteKey) return null;
  if ((provider === 'turnstile' || provider === 'hcaptcha') && siteKey) {
    return { provider, siteKey };
  }
  // Half-configured: better to fail loudly at build/test time than to ship a site that
  // cannot create identities.
  throw new Error(
    'VITE_CAPTCHA_PROVIDER must be "turnstile" or "hcaptcha" and VITE_CAPTCHA_SITE_KEY must be set together.',
  );
}

export function getCaptchaConfig(): CaptchaConfig | null {
  return parseCaptchaEnv({
    VITE_CAPTCHA_PROVIDER: import.meta.env.VITE_CAPTCHA_PROVIDER,
    VITE_CAPTCHA_SITE_KEY: import.meta.env.VITE_CAPTCHA_SITE_KEY,
  });
}
