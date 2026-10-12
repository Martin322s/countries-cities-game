import { describe, expect, it } from 'vitest';

import { contentSecurityPolicy, headersFile, securityHeaders } from './security-headers';

describe('security headers', () => {
  const hosted = { supabaseUrl: 'https://abcd.supabase.co', captcha: null, https: true } as const;

  it('allows exactly the Supabase project over https and wss', () => {
    const csp = contentSecurityPolicy(hosted);
    expect(csp).toContain("connect-src 'self' https://abcd.supabase.co wss://abcd.supabase.co");
    expect(csp).toContain("script-src 'self'");
    expect(csp).toContain("frame-src https://www.google.com");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    expect(csp).not.toMatch(/unsafe-eval|googleapis|gstatic/);
  });

  it('opens only the CAPTCHA provider when one is configured', () => {
    const csp = contentSecurityPolicy({ ...hosted, captcha: 'turnstile' });
    expect(csp).toContain("script-src 'self' https://challenges.cloudflare.com");
    expect(csp).toContain('frame-src https://challenges.cloudflare.com https://www.google.com');
    expect(contentSecurityPolicy(hosted)).toContain('frame-src https://www.google.com');
  });

  it('sends HSTS only over HTTPS', () => {
    expect(securityHeaders(hosted)['Strict-Transport-Security']).toContain('max-age=');
    expect(
      securityHeaders({ supabaseUrl: 'http://127.0.0.1:54321', captcha: null, https: false })[
        'Strict-Transport-Security'
      ],
    ).toBeUndefined();
  });

  it('produces a host file with long caching for hashed assets only', () => {
    const file = headersFile(hosted);
    expect(file).toMatch(/^\/\*$/m);
    expect(file).toContain('X-Content-Type-Options: nosniff');
    expect(file).toContain('/assets/*\n  Cache-Control: public, max-age=31536000, immutable');
    expect(file).toContain('/index.html\n  Cache-Control: no-cache');
  });
});
