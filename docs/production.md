# Production setup — hosted Supabase

Web v1.0 runs on a hosted Supabase project plus any static web host. Nothing here is
specific to one frontend vendor. Do every step on a **staging** project first.

> Status: prepared and verified against the local Supabase stack. Not yet verified on a
> hosted project — follow `docs/release-checklist.md`.

## 1. Create the project

1. supabase.com → New project (choose a region close to the players, e.g. Frankfurt).
2. Save the database password in a password manager. It is never needed by the frontend.

## 2. Apply the migrations

From a clean checkout, with the Supabase CLI (a dev dependency):

```bash
npx supabase login                      # personal access token stays on your machine
npx supabase link --project-ref <ref>
npx supabase db push                    # applies supabase/migrations in order
```

Migrations are forward-only and additive. Never edit an applied migration; add a new
timestamped file instead.

Verify afterwards (SQL editor):

```sql
select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
 where n.nspname = 'public' and has_function_privilege('authenticated', p.oid, 'execute');
-- → 21 (17 RPCs + 4 RLS helpers)
select rolconfig from pg_roles where rolname = 'authenticator';
-- → includes pgrst.db_pre_request=private.check_request
select jobname, schedule from cron.job;                   -- → cleanup-expired-data, 17 * * * *
```

If the `pgrst.db_pre_request` line is missing (the hosted role could not be altered
by the migration), run once in the SQL editor and reload:

```sql
alter role authenticator set pgrst.db_pre_request = 'private.check_request';
notify pgrst, 'reload config';
```

## 3. Extensions

- `pg_cron` — Database → Extensions → enable `pg_cron`. The migration schedules the hourly
  cleanup automatically when the extension is available; if it was enabled after the
  migration ran, schedule it once:

  ```sql
  select cron.schedule('cleanup-expired-data', '17 * * * *', 'select private.cleanup_expired_data()');
  ```

- `pgcrypto` / `uuid` functions are built in (`gen_random_uuid`).

## 4. API settings (Project Settings → API / Data API)

- Exposed schemas: **`public` only**. Remove `graphql_public` (the app does not use
  GraphQL; this also hides schema introspection). Never expose `private`.
- Max rows: 1000 (default) is fine.

## 5. Authentication

- Authentication → Sign In / Providers → **Allow anonymous sign-ins: ON**.
- Email/phone/OAuth providers: not used — leave disabled.
- URL configuration → Site URL: `https://<your-domain>` (anonymous auth needs no redirects,
  but set it so nothing defaults to localhost).
- Rate limits → Anonymous sign-ins per hour per IP: start with **30** (a party sharing one
  Wi-Fi is ~15 people; raise if real groups hit it).
- JWT expiry: default (1 h) — sessions refresh automatically.

### CAPTCHA / bot protection (recommended before public launch)

Supabase Auth verifies CAPTCHA tokens for sign-ins, including anonymous ones
(`signInAnonymously({ options: { captchaToken } })` — supported by the installed
supabase-js). The game asks for a CAPTCHA **only when a new anonymous identity is
created** (first visit on a device), never for game actions or returning players.

1. Create a widget at Cloudflare Turnstile (recommended) or hCaptcha for your domain.
2. Supabase → Authentication → Attack Protection → enable CAPTCHA, choose the provider,
   paste the **secret** key (stays in Supabase).
3. Frontend build variables (public): `VITE_CAPTCHA_PROVIDER=turnstile` and
   `VITE_CAPTCHA_SITE_KEY=<site key>`. The build adds the provider to the CSP.

There is no client-side switch that disables verification: if Supabase requires a
CAPTCHA and the frontend does not send one, anonymous sign-in is refused and the player
sees a retry message. Local development leaves CAPTCHA off in `supabase/config.toml`.

## 6. Realtime

- Realtime → Settings: **disable "Allow public access"** (private channels only). The app
  uses only private channels authorized by RLS on `realtime.messages`.
- The `supabase_realtime` publication is created by the migrations (status tables only).

## 7. Frontend environment

Only public values; all `VITE_*` variables end up in the browser bundle.

| Variable                        | Required      | Value                                                         |
| ------------------------------- | ------------- | ------------------------------------------------------------- |
| `VITE_SUPABASE_URL`             | yes           | `https://<ref>.supabase.co`                                   |
| `VITE_SUPABASE_PUBLISHABLE_KEY` | yes           | Project Settings → API → publishable key (`sb_publishable_…`) |
| `VITE_CAPTCHA_PROVIDER`         | recommended   | `turnstile` or `hcaptcha`                                     |
| `VITE_CAPTCHA_SITE_KEY`         | with provider | the widget's public site key                                  |

Never put the service-role/secret key, the database password or an access token in any
`VITE_*` variable or in the hosting provider's build environment for the frontend. The
build refuses secret-looking Supabase keys (`src/shared/lib/env.ts`), and
`npm run scan:secrets` checks the repository and the built bundle.

## 8. Deploy the frontend

See `docs/deployment.md` (build, SPA fallback, security headers, HTTPS, rollback).

## 9. Post-deploy smoke test (staging)

Two separate browsers (or a normal + private window), on real network latency:
create a room, join, READY, countdown, type answers (watch "Запазено"), lock, results,
reveal, invalidate one answer, next round, switch tab during a round (fair play),
toggle airplane mode for a few seconds (reconnect). Compare with local behaviour.
