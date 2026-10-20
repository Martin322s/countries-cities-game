# Deploying the frontend

The frontend is a static single-page app. Any static/edge host works (Netlify,
Cloudflare Pages, Vercel, S3 + CloudFront, nginx…).

## Build

```bash
nvm use            # Node from .nvmrc (24)
npm ci             # deterministic install from package-lock.json
npm run build      # → dist/
npm run scan:secrets
```

- Output directory: `dist/`
- Build-time variables: see `docs/production.md` §7 (public values only).
- Source maps are not generated for production (`build.sourcemap: false`).

## Routing (SPA fallback)

Every path (`/`, `/room/K7M4Q`, `/privacy`, `/about`) must serve `index.html` with
status 200. The build writes `dist/_redirects` (`/* /index.html 200`) for Netlify and
Cloudflare Pages. Elsewhere, configure the equivalent rewrite (nginx:
`try_files $uri /index.html;`).

## Security headers

The build writes `dist/_headers` (Netlify / Cloudflare Pages format), generated from
`deploy/security-headers.ts` with the configured Supabase URL and CAPTCHA provider. On
other hosts, copy the same values into the host's header configuration:

| Header                       | Value                                                                                                                                                                                                                                                                                                                                                                       |
| ---------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Content-Security-Policy`    | `default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; font-src 'self'; connect-src 'self' https://<ref>.supabase.co wss://<ref>.supabase.co; frame-src 'none'; worker-src 'none'; object-src 'none'; base-uri 'self'; form-action 'self'; frame-ancestors 'none'` (+ the CAPTCHA origin in `script-src`/`frame-src` when enabled) |
| `Strict-Transport-Security`  | `max-age=63072000; includeSubDomains` (HTTPS only)                                                                                                                                                                                                                                                                                                                          |
| `X-Content-Type-Options`     | `nosniff`                                                                                                                                                                                                                                                                                                                                                                   |
| `Referrer-Policy`            | `strict-origin-when-cross-origin`                                                                                                                                                                                                                                                                                                                                           |
| `X-Frame-Options`            | `DENY`                                                                                                                                                                                                                                                                                                                                                                      |
| `Permissions-Policy`         | `camera=(), microphone=(), geolocation=(), payment=(), usb=(), interest-cohort=()`                                                                                                                                                                                                                                                                                          |
| `Cross-Origin-Opener-Policy` | `same-origin`                                                                                                                                                                                                                                                                                                                                                               |

Caching: `/assets/*` (content-hashed) → `public, max-age=31536000, immutable`;
`/index.html` → `no-cache`, so a new deploy is picked up immediately.

`style-src 'unsafe-inline'` is needed for a few React inline style attributes
(animation delays, confetti); no user HTML is ever rendered. Fonts are self-hosted, so
no third-party font origin is allowed. Web Audio needs no CSP entry.

The same headers are served by `npm run preview`, so the policy is exercised locally.

## HTTPS

Production must be HTTPS only (redirect HTTP → HTTPS at the host). Supabase is HTTPS,
Realtime uses `wss://`, so there is no mixed content. Secure-context browser APIs used
by the game (`crypto.randomUUID`, BroadcastChannel, Web Audio, keepalive fetch) behave
as tested only over HTTPS (or `localhost`).

## Rollback

- **Frontend:** redeploy the previous known-good build (every host keeps deploy
  history; or rebuild the previous commit). Hashed assets of the old build stay valid.
- **Database:** migrations are **forward-only**. Do not roll back a production migration
  by hand. Fix forward with a new, additive migration. Keep frontend changes backward
  compatible with the previous schema for at least one deploy where possible.
- The v1.0 hardening migration changed one RPC contract (`join_room` returns `NULL` for
  an unknown code). Deploy the database migration and the v1.0 frontend together; an
  older frontend would show "room not found" as a generic error.
- Rate limits and retention are data/functions in the database and can be tuned with SQL
  without a deploy (see `docs/security.md`, `docs/operations.md`).
